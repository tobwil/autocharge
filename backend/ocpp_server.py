"""
OCPP 1.6 Central System (server).
Wallbox connects as OCPP Charge Point to ws://<host>:<port>/<charger-id>
"""
from __future__ import annotations
import asyncio
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import aiohttp
import websockets
from ocpp.routing import on
from ocpp.v16 import ChargePoint as OcppCP, call, call_result
from ocpp.v16.enums import (
    Action, AvailabilityType, ChargePointErrorCode, ChargePointStatus, RegistrationStatus,
)

log = logging.getLogger(__name__)

_chargers: dict[str, "ChargePointHandler"] = {}
_tx_counter = 0


@dataclass
class ChargerState:
    id: str
    status: str = "Unavailable"
    car_connected: bool = False
    charging: bool = False
    power_w: float = 0.0
    energy_session_wh: float = 0.0
    # None = baseline not yet set; set from the first MeterValues energy reading
    # per session (resets on StartTransaction / StopTransaction)
    _energy_baseline_wh: float | None = None
    phases_actual: int = 3   # phases currently in use (may differ from config max)
    amp_set: float = 6.0
    amp_actual: float = 0.0
    voltage: float = 230.0
    transaction_id: int | None = None
    last_seen: float = field(default_factory=time.time)
    error: str | None = None
    vendor: str = ""
    model: str = ""


def get_all_states() -> list[dict]:
    return [_state_to_dict(cp.state) for cp in _chargers.values()]


def get_charger(cp_id: str) -> "ChargePointHandler | None":
    return _chargers.get(cp_id)


def _state_to_dict(s: ChargerState) -> dict:
    return {
        "id": s.id, "status": s.status, "car_connected": s.car_connected,
        "charging": s.charging, "power_w": s.power_w,
        "energy_session_wh": s.energy_session_wh,
        "phases_actual": s.phases_actual,
        "amp_set": s.amp_set, "amp_actual": s.amp_actual, "voltage": s.voltage,
        "transaction_id": s.transaction_id, "last_seen": s.last_seen,
        "error": s.error, "vendor": s.vendor, "model": s.model,
    }


class ChargePointHandler(OcppCP):
    def __init__(self, cp_id: str, websocket):
        super().__init__(cp_id, websocket)
        self.state = ChargerState(id=cp_id)
        _chargers[cp_id] = self
        log.info("ChargePoint connected: %s", cp_id)

    @on(Action.boot_notification)
    async def on_boot_notification(self, charge_point_vendor="", charge_point_model="", **kw):
        self.state.vendor = charge_point_vendor
        self.state.model = charge_point_model
        self.state.last_seen = time.time()
        log.info("BootNotification %s: %s %s", self.id, charge_point_vendor, charge_point_model)
        asyncio.create_task(self._post_boot_configure())
        return call_result.BootNotification(
            current_time=_utc_now(),
            interval=30,
            status=RegistrationStatus.accepted,
        )

    async def _post_boot_configure(self):
        """Send ChangeConfiguration requests shortly after boot."""
        await asyncio.sleep(2)
        for key, value in [
            ("MeterValueSampleInterval", "30"),
            ("MeterValuesSampledData",
             "Energy.Active.Import.Register,Power.Active.Import,Current.Import,Voltage"),
        ]:
            try:
                resp = await self.call(call.ChangeConfiguration(key=key, value=value))
                log.info("ChangeConfiguration %s=%s → %s", key, value, resp.status)
            except Exception as e:
                log.warning("ChangeConfiguration %s: %s", key, e)

    @on(Action.heartbeat)
    async def on_heartbeat(self, **kw):
        self.state.last_seen = time.time()
        return call_result.Heartbeat(current_time=_utc_now())

    @on(Action.status_notification)
    async def on_status_notification(self, connector_id, error_code, status, **kw):
        self.state.last_seen = time.time()
        if connector_id > 0:
            self.state.status = status
            self.state.car_connected = status in (
                ChargePointStatus.preparing,
                ChargePointStatus.charging,
                ChargePointStatus.suspended_evse,
                ChargePointStatus.suspended_ev,
                ChargePointStatus.finishing,
            )
            self.state.charging = (status == ChargePointStatus.charging)
            self.state.error = None if error_code == ChargePointErrorCode.no_error else error_code
        log.debug("Status %s conn=%s: %s", self.id, connector_id, status)
        return call_result.StatusNotification()

    @on(Action.meter_values)
    async def on_meter_values(self, connector_id, meter_value, transaction_id=None, **kw):
        self.state.last_seen = time.time()
        # Recover transaction_id if we missed StartTransaction (e.g. server restart)
        if transaction_id and not self.state.transaction_id:
            self.state.transaction_id = transaction_id
            log.info("Recovered transaction_id %d for %s from MeterValues", transaction_id, self.id)
        for mv in meter_value:
            samples = mv.get("sampled_value", [])
            # Collect per-phase and aggregate values separately; prefer aggregate.
            # go-e (and many chargers) send only per-phase L1/L2/L3 without an
            # overall aggregate for Current and Voltage.
            phase_amps: dict[str, float] = {}   # "L1"/"L2"/"L3" → amps
            phase_volts: dict[str, float] = {}
            agg_amps: float | None = None
            agg_volts: float | None = None

            for sv in samples:
                measurand = sv.get("measurand", "")
                val = float(sv.get("value") or 0)
                unit = sv.get("unit", "")
                phase = sv.get("phase", "")

                if measurand in ("Power.Active.Import", ""):
                    if unit == "kW":
                        val *= 1000
                    if not phase:          # aggregate wins; skip per-phase
                        self.state.power_w = val
                    elif self.state.power_w == 0:
                        self.state.power_w += val   # accumulate until aggregate arrives

                elif measurand == "Current.Import":
                    if not phase:
                        agg_amps = val
                    elif phase in ("L1", "L2", "L3"):
                        phase_amps[phase] = val

                elif measurand == "Voltage":
                    if not phase:
                        agg_volts = val
                    elif phase in ("L1", "L2", "L3"):
                        phase_volts[phase] = val

                elif measurand == "Energy.Active.Import.Register":
                    if unit == "kWh":
                        val *= 1000
                    if self.state._energy_baseline_wh is None:
                        self.state._energy_baseline_wh = val
                        log.info("Energy session baseline %s: %.0f Wh", self.id, val)
                    self.state.energy_session_wh = max(0.0, val - self.state._energy_baseline_wh)

            # Resolve current: aggregate > L1 > max active phase
            if agg_amps is not None:
                self.state.amp_actual = agg_amps
            elif phase_amps:
                self.state.amp_actual = phase_amps.get("L1", max(phase_amps.values()))

            # Resolve voltage: aggregate > L1 > any phase
            if agg_volts is not None:
                self.state.voltage = agg_volts
            elif phase_volts:
                self.state.voltage = phase_volts.get("L1", next(iter(phase_volts.values())))

            # Auto-detect phases_actual from how many phases carry current (>0.5 A)
            if phase_amps:
                active = sum(1 for a in phase_amps.values() if a > 0.5)
                if active > 0:
                    self.state.phases_actual = active
        return call_result.MeterValues()

    @on(Action.start_transaction)
    async def on_start_transaction(self, connector_id, id_tag, meter_start, timestamp, **kw):
        global _tx_counter
        _tx_counter += 1
        self.state.transaction_id = _tx_counter
        self.state._energy_baseline_wh = None  # next MeterValue sets new baseline
        self.state.energy_session_wh = 0.0
        self.state.charging = True
        log.info("StartTransaction %s tx=%d", self.id, _tx_counter)
        return call_result.StartTransaction(
            transaction_id=_tx_counter,
            id_tag_info={"status": "Accepted"},
        )

    @on(Action.stop_transaction)
    async def on_stop_transaction(self, meter_stop, timestamp, transaction_id, **kw):
        self.state.charging = False
        self.state.transaction_id = None
        self.state.power_w = 0.0
        self.state.amp_actual = 0.0
        self.state._energy_baseline_wh = None  # reset for next session
        log.info("StopTransaction %s", self.id)
        return call_result.StopTransaction(id_tag_info={"status": "Accepted"})

    @on(Action.authorize)
    async def on_authorize(self, id_tag, **kw):
        return call_result.Authorize(id_tag_info={"status": "Accepted"})

    # ── Commands sent to charger ───────────────────────────────────────────────

    async def set_charge_limit(self, amps: float) -> bool:
        self.state.amp_set = amps
        schedule = {
            "chargingRateUnit": "A",
            "chargingSchedulePeriod": [{"startPeriod": 0, "limit": float(amps)}],
        }
        ok = False

        # TxDefaultProfile on connector 0 – applies to future transactions
        try:
            resp = await self.call(call.SetChargingProfile(
                connector_id=0,
                cs_charging_profiles={
                    "chargingProfileId": 1, "stackLevel": 0,
                    "chargingProfilePurpose": "TxDefaultProfile",
                    "chargingProfileKind": "Absolute",
                    "chargingSchedule": schedule,
                },
            ))
            ok = str(resp.status).lower() == "accepted"
            log.info("SetChargingProfile(Default) %s → %.0fA: %s", self.id, amps, resp.status)
        except Exception as e:
            log.error("SetChargingProfile(Default) %s: %s", self.id, e)

        # TxProfile on connector 1 – immediately affects the ACTIVE transaction.
        # This is what actually resumes a SuspendedEVSE session.
        tx_id = self.state.transaction_id
        if tx_id:
            try:
                resp = await self.call(call.SetChargingProfile(
                    connector_id=1,
                    cs_charging_profiles={
                        "chargingProfileId": 2, "stackLevel": 0,
                        "chargingProfilePurpose": "TxProfile",
                        "chargingProfileKind": "Absolute",
                        "transactionId": tx_id,
                        "chargingSchedule": schedule,
                    },
                ))
                ok = ok or str(resp.status).lower() == "accepted"
                log.info("SetChargingProfile(Tx %d) %s → %.0fA: %s",
                         tx_id, self.id, amps, resp.status)
            except Exception as e:
                log.error("SetChargingProfile(Tx) %s: %s", self.id, e)

        return ok

    async def switch_phases(self, phases: int, goe_ip: str = "") -> bool:
        """Switch charger between 1-phase and 3-phase operation.

        Tries (in order):
        1. OCPP ChangeConfiguration(NumberOfPhases) – standard, few chargers support it
        2. go-e local HTTP API (/api/set?psm=1|2) – if goe_ip is configured
        Falls back to updating internal state only (charger may not follow).
        """
        if phases == self.state.phases_actual:
            return True  # nothing to do

        log.info("Phase switch %s: %d → %d phase(s)", self.id, self.state.phases_actual, phases)

        # 1. OCPP ChangeConfiguration
        try:
            resp = await self.call(call.ChangeConfiguration(
                key="NumberOfPhases", value=str(phases),
            ))
            if str(resp.status).lower() == "accepted":
                self.state.phases_actual = phases
                log.info("Phase switch via OCPP OK: %s → %d phases", self.id, phases)
                return True
            log.debug("OCPP NumberOfPhases not accepted (%s), trying HTTP", resp.status)
        except Exception as e:
            log.debug("OCPP NumberOfPhases not supported on %s: %s", self.id, e)

        # 2. go-e HTTP API  (psm: 0=auto, 1=force 1-phase, 2=force 3-phase)
        if goe_ip:
            psm = 1 if phases == 1 else 2
            try:
                conn = aiohttp.TCPConnector(ssl=False)
                async with aiohttp.ClientSession(connector=conn) as session:
                    url = f"http://{goe_ip}/api/set?psm={psm}"
                    async with session.get(url, timeout=aiohttp.ClientTimeout(total=5)) as r:
                        log.info("go-e phase switch %s psm=%d → HTTP %d", self.id, psm, r.status)
                        self.state.phases_actual = phases
                        return r.status < 300
            except Exception as e:
                log.error("go-e HTTP phase switch %s: %s", self.id, e)

        # Fallback: update state, hope charger follows (e.g. charger in auto-psm mode)
        log.warning("Phase switch %s: no OCPP/HTTP support – state updated, charger may not follow",
                    self.id)
        self.state.phases_actual = phases
        return False

    async def remote_start(self, connector_id: int = 1) -> bool:
        if self.state.transaction_id:
            # Active transaction already exists (server restarted / charger auto-started).
            # RemoteStartTransaction would be rejected – the TxProfile sent by
            # set_charge_limit() is sufficient to resume a SuspendedEVSE session.
            log.info("RemoteStart %s: tx=%d already active – profile applied, no RemoteStart needed",
                     self.id, self.state.transaction_id)
            return True
        try:
            resp = await self.call(call.RemoteStartTransaction(
                connector_id=connector_id,
                id_tag="AUTOCHARGE",
            ))
            log.info("RemoteStart %s: %s", self.id, resp.status)
            return str(resp.status).lower() == "accepted"
        except Exception as e:
            log.error("RemoteStart %s: %s", self.id, e)
            return False

    async def remote_stop(self) -> bool:
        tx_id = self.state.transaction_id
        if tx_id:
            # Normal path: OCPP RemoteStopTransaction
            try:
                resp = await self.call(call.RemoteStopTransaction(transaction_id=tx_id))
                log.info("RemoteStop %s tx=%d: %s", self.id, tx_id, resp.status)
                return str(resp.status).lower() == "accepted"
            except Exception as e:
                log.error("RemoteStop %s: %s", self.id, e)
                return False
        else:
            # No transaction_id (server restarted, missed StartTransaction).
            # Toggle connector Inoperative → Operative to force-stop charging.
            log.warning("RemoteStop %s: no transaction_id – using ChangeAvailability", self.id)
            try:
                await self.call(call.ChangeAvailability(
                    connector_id=1, type=AvailabilityType.inoperative,
                ))
                await asyncio.sleep(2)
                await self.call(call.ChangeAvailability(
                    connector_id=1, type=AvailabilityType.operative,
                ))
                return True
            except Exception as e:
                log.error("ChangeAvailability stop %s: %s", self.id, e)
                return False


async def _on_connect(websocket):
    path = getattr(websocket, "path", "/") or "/"
    cp_id = path.strip("/") or "unknown"
    cp = ChargePointHandler(cp_id, websocket)
    try:
        await cp.start()
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        _chargers.pop(cp_id, None)
        log.info("ChargePoint disconnected: %s", cp_id)


async def run_ocpp_server(port: int = 9000):
    log.info("OCPP 1.6 server listening on :%d  (ws://<ip>:%d/<charger-id>)", port, port)
    async with websockets.serve(_on_connect, "0.0.0.0", port, subprotocols=["ocpp1.6"]):
        await asyncio.Future()  # run until cancelled


def _utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
