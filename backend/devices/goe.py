"""
go-e Gemini 2 – lokale HTTP API v2.

Dokumentation: https://github.com/goecharger/go-eCharger-API-v2
"""

import logging
from dataclasses import dataclass
from typing import Optional

import aiohttp

from config import GoeConfig

log = logging.getLogger(__name__)

# car status codes
CAR_STATUS = {
    1: "Bereit (kein Auto)",
    2: "Lädt",
    3: "Warte auf Auto",
    4: "Ladevorgang beendet",
    5: "Fehler",
}


@dataclass
class ChargerData:
    online: bool = False
    car_status: int = 1          # 1=idle, 2=charging, 3=waitcar, 4=complete, 5=error
    car_connected: bool = False
    charging: bool = False
    charging_allowed: bool = False
    amp_set: float = 0           # configured charging current (A)
    amp_actual: float = 0        # measured current (A)
    power_w: float = 0           # total charging power (W)
    energy_session_wh: float = 0 # energy this session (Wh)
    voltage_l1: float = 0
    voltage_l2: float = 0
    voltage_l3: float = 0
    current_l1: float = 0
    current_l2: float = 0
    current_l3: float = 0
    phases_active: int = 0
    temperature_c: Optional[float] = None
    serial: str = ""
    error: Optional[str] = None
    force_state: int = 0  # 0=neutral, 1=off, 2=on
    phase_switch_mode: int = 3  # 1=1phase, 2=3phase, 3=auto


class GoeClient:
    def __init__(self, cfg: GoeConfig):
        self.cfg = cfg
        self._base = f"http://{cfg.host}/api"
        self._session: Optional[aiohttp.ClientSession] = None

    def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            timeout = aiohttp.ClientTimeout(total=5)
            self._session = aiohttp.ClientSession(timeout=timeout)
        return self._session

    async def _get(self, path: str, params: Optional[dict] = None):
        url = f"{self._base}/{path}"
        async with self._get_session().get(url, params=params) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def _post(self, path: str, json_data: dict):
        url = f"{self._base}/{path}"
        async with self._get_session().post(url, json=json_data) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def read(self) -> ChargerData:
        data = ChargerData()
        if not self.cfg.enabled:
            return data
        try:
            status = await self._get("status")
            data.online = True

            car = status.get("car", 1)
            data.car_status = car
            data.car_connected = car in (2, 3, 4)
            data.charging = car == 2

            data.charging_allowed = bool(status.get("alw", False))
            data.amp_set = float(status.get("amp", 0))
            data.force_state = int(status.get("frc", 0))
            data.phase_switch_mode = int(status.get("psm", 3))

            nrg = status.get("nrg", [0] * 16)
            if len(nrg) >= 12:
                data.voltage_l1 = nrg[0]
                data.voltage_l2 = nrg[1]
                data.voltage_l3 = nrg[2]
                data.current_l1 = nrg[4]
                data.current_l2 = nrg[5]
                data.current_l3 = nrg[6]
                # nrg[11] = total power in W (×10 in API, already scaled?)
                # go-e API v2 returns W directly in nrg[11]
                data.power_w = float(nrg[11])

            # Measure active phases
            phases = 0
            for i in [data.current_l1, data.current_l2, data.current_l3]:
                if i > 0.5:
                    phases += 1
            data.phases_active = phases if phases > 0 else (
                1 if data.phase_switch_mode == 1 else 3
            )

            data.amp_actual = max(data.current_l1, data.current_l2, data.current_l3)

            wh = status.get("wh", 0)
            data.energy_session_wh = float(wh) if wh else 0.0

            # Temperature from tma array
            tma = status.get("tma", [])
            if tma:
                data.temperature_c = float(tma[0])

            data.serial = str(status.get("sse", ""))

        except Exception as exc:
            data.error = str(exc)
            log.warning("go-e Lesefehler: %s", exc)

        return data

    async def set_charging_current(self, amps: int) -> bool:
        """Set charging current (6–32 A)."""
        try:
            amps = max(6, min(32, amps))
            await self._get("set", {"amp": amps})
            return True
        except Exception as exc:
            log.warning("go-e set_amp Fehler: %s", exc)
            return False

    async def set_charging_allowed(self, allowed: bool) -> bool:
        """Allow or deny charging (force state)."""
        try:
            # frc: 0=neutral, 1=force off, 2=force on
            frc = 2 if allowed else 1
            await self._get("set", {"frc": frc})
            return True
        except Exception as exc:
            log.warning("go-e set_charging_allowed Fehler: %s", exc)
            return False

    async def set_phase_mode(self, phases: int) -> bool:
        """Switch between 1-phase (1) and 3-phase (3) charging."""
        try:
            psm = 1 if phases == 1 else 2
            await self._get("set", {"psm": psm})
            return True
        except Exception as exc:
            log.warning("go-e set_phase_mode Fehler: %s", exc)
            return False

    async def close(self) -> None:
        if self._session and not self._session.closed:
            await self._session.close()
