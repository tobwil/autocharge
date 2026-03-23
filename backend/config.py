from __future__ import annotations
import json
import os
from pathlib import Path
from pydantic import BaseModel

CONFIG_PATH = Path(os.environ.get("CONFIG_PATH", "/data/config.json"))


class LocationConfig(BaseModel):
    lat: float = 48.1351
    lon: float = 11.5820
    altitude_m: float = 520.0
    timezone: str = "Europe/Berlin"
    address: str = ""


class PVArrayConfig(BaseModel):
    name: str = "Anlage 1"
    kwp: float = 10.0
    tilt_deg: float = 30.0
    # 0=N, 90=E, 180=S, 270=W
    azimuth_deg: float = 180.0
    # Combined efficiency: inverter + temp + cable + soiling (~0.80–0.90)
    efficiency: float = 0.85


class ChargingConfig(BaseModel):
    mode: str = "solar"  # off | solar | fixed
    fixed_kw: float = 5.52   # used when mode == "fixed" (8 A × 3 ph × 230 V)
    start_threshold_w: float = 1380.0
    stop_threshold_w: float = 500.0
    min_amps: int = 6
    max_amps: int = 16
    phases: int = 3          # maximum / configured phases of the charger
    phases_switching: bool = False  # auto 1-/3-phase switching by available power
    goe_ip: str = ""         # go-e charger local IP for phase switching (optional)
    buffer_fraction: float = 0.10
    update_interval_s: int = 30


class AppConfig(BaseModel):
    location: LocationConfig = LocationConfig()
    pv_arrays: list[PVArrayConfig] = [PVArrayConfig()]
    charging: ChargingConfig = ChargingConfig()
    weather_interval_s: int = 900  # 15 min
    ocpp_port: int = 9000


def load_config() -> AppConfig:
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text())
            valid = {k: v for k, v in data.items() if k in AppConfig.model_fields}
            return AppConfig(**valid)
        except Exception:
            pass
    return AppConfig()


def save_config(cfg: AppConfig) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(cfg.model_dump_json(indent=2))
