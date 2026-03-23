"""
MQTT Inverter Client.

Subscribes to a configurable MQTT topic (or wildcard) and extracts
solar/grid/battery/load power from the JSON payload.

Supported payload formats
--------------------------
1. Single JSON blob on one topic  (most WiNet-S / SunGather setups):
   topic: "sungrow/state"
   payload: {"pv_power": 3500, "grid_power": -200, "battery_soc": 85, ...}

2. Individual topics per value  (Home Assistant MQTT sensors, ioBroker, etc.):
   topic pattern: "solar/#"
   pv_power on "solar/pv_power", grid on "solar/grid_power", ...

The client tries to extract known field names automatically.
Field aliases cover the most common naming conventions across integrations.
"""

import asyncio
import json
import logging
from typing import Optional

import aiomqtt

from config import MqttConfig
from devices.sungrow import InverterData

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Field name aliases  → internal key
# ---------------------------------------------------------------------------
_ALIASES: dict[str, str] = {
    # PV / solar generation
    "pv_power": "pv_w",
    "pv_power_w": "pv_w",
    "solar_power": "pv_w",
    "solar_w": "pv_w",
    "generation_power": "pv_w",
    "total_active_power": "pv_w",
    "totalactivepow": "pv_w",
    "power_dc": "pv_w",
    "pac": "pv_w",
    # Grid  (positive = export, negative = import – we normalise below)
    "grid_power": "grid_w",
    "grid_power_w": "grid_w",
    "meter_power": "grid_w",
    "grid_w": "grid_w",
    "export_power": "grid_w",
    "feedin_power": "grid_w",
    "feed_in_power": "grid_w",
    "grid_import": "grid_import_w",   # some split import/export
    "grid_export": "grid_export_w",
    "purchase_power": "grid_import_w",
    "feed_power": "grid_export_w",
    # Battery
    "battery_power": "batt_w",
    "battery_power_w": "batt_w",
    "batt_power": "batt_w",
    "bat_power": "batt_w",
    "charge_power": "charge_w",       # split charge/discharge
    "discharge_power": "discharge_w",
    # Battery SOC
    "battery_soc": "soc",
    "battery_soc_pct": "soc",
    "soc": "soc",
    "bat_soc": "soc",
    # Load / consumption
    "load_power": "load_w",
    "load_power_w": "load_w",
    "load_w": "load_w",
    "use_power": "load_w",
    "home_power": "load_w",
    "consumption": "load_w",
    "house_load": "load_w",
    # Daily yield
    "daily_yield_kwh": "daily_kwh",
    "daily_generation": "daily_kwh",
    "today_yield": "daily_kwh",
    "energy_today": "daily_kwh",
    # Temperature
    "temperature": "temp_c",
    "temperature_c": "temp_c",
    "inverter_temperature": "temp_c",
}


def _parse_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


class MqttInverterClient:
    def __init__(self, cfg: MqttConfig):
        self.cfg = cfg
        self._data: dict[str, float] = {}   # normalised field → value
        self._last_ts: float = 0.0
        self._task: Optional[asyncio.Task] = None
        self._started = False

    # ------------------------------------------------------------------
    # Internal normalisation
    # ------------------------------------------------------------------

    def _ingest(self, raw: dict) -> None:
        """Merge raw key-value dict into normalised _data, applying aliases."""
        for k, v in raw.items():
            norm_key = _ALIASES.get(k.lower())
            if norm_key:
                fv = _parse_float(v)
                if fv is not None:
                    self._data[norm_key] = fv
        self._last_ts = asyncio.get_event_loop().time()

    def _ingest_single(self, topic_suffix: str, payload: str) -> None:
        """Handle individual-topic format: topic suffix IS the key."""
        key = topic_suffix.lstrip("/").lower()
        norm = _ALIASES.get(key)
        if norm:
            fv = _parse_float(payload.strip())
            if fv is not None:
                self._data[norm] = fv
                self._last_ts = asyncio.get_event_loop().time()

    # ------------------------------------------------------------------
    # MQTT listener task
    # ------------------------------------------------------------------

    async def _listen(self) -> None:
        topic = self.cfg.topic.rstrip("/#") + "/#" if "#" not in self.cfg.topic else self.cfg.topic
        # Determine base prefix for single-topic-per-value extraction
        base = self.cfg.topic.rstrip("/#")

        reconnect_delay = 5
        while True:
            try:
                kwargs: dict = dict(hostname=self.cfg.host, port=self.cfg.port)
                if self.cfg.username:
                    kwargs["username"] = self.cfg.username
                if self.cfg.password:
                    kwargs["password"] = self.cfg.password

                async with aiomqtt.Client(**kwargs) as client:
                    log.info("MQTT connected to %s:%s, subscribing %s", self.cfg.host, self.cfg.port, topic)
                    reconnect_delay = 5
                    await client.subscribe(topic)
                    async for message in client.messages:
                        payload_str = message.payload.decode("utf-8", errors="replace").strip()
                        msg_topic = str(message.topic)

                        # Try JSON blob first
                        try:
                            data = json.loads(payload_str)
                            if isinstance(data, dict):
                                self._ingest(data)
                                continue
                        except (json.JSONDecodeError, ValueError):
                            pass

                        # Try individual-topic format
                        if msg_topic.startswith(base):
                            suffix = msg_topic[len(base):]
                            self._ingest_single(suffix, payload_str)

            except aiomqtt.MqttError as exc:
                log.warning("MQTT disconnected: %s – retry in %ds", exc, reconnect_delay)
            except Exception as exc:
                log.error("MQTT listener error: %s – retry in %ds", exc, reconnect_delay)

            await asyncio.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 2, 60)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def start(self) -> None:
        if not self._started:
            self._task = asyncio.create_task(self._listen())
            self._started = True

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None
        self._started = False

    def read(self) -> InverterData:
        """Return current InverterData from last MQTT message (non-blocking)."""
        d = self._data
        stale = (asyncio.get_event_loop().time() - self._last_ts) > 120  # 2 min timeout

        if not d or stale:
            return InverterData(
                inverter_id="mqtt",
                name=self.cfg.name,
                error="Keine MQTT-Daten" if not d else "MQTT-Daten veraltet (>2 min)",
            )

        # Resolve grid_w: prefer direct, fall back to export - import
        grid_w = d.get("grid_w")
        if grid_w is None:
            exp = d.get("grid_export_w", 0.0)
            imp = d.get("grid_import_w", 0.0)
            grid_w = exp - imp   # positive = export

        # Resolve battery: prefer net, fall back to charge - discharge
        batt_w = d.get("batt_w")
        if batt_w is None:
            batt_w = d.get("charge_w", 0.0) - d.get("discharge_w", 0.0)

        return InverterData(
            inverter_id="mqtt",
            name=self.cfg.name,
            online=True,
            pv_power_w=max(0.0, d.get("pv_w", 0.0)),
            grid_power_w=grid_w or 0.0,
            battery_soc_pct=d.get("soc"),
        )
