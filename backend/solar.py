"""
Solar estimation without external libraries.
Uses Open-Meteo for irradiance data, pure-Python geometry for PV calculation.
"""
from __future__ import annotations
import math
import time
import logging
from datetime import datetime, timezone, timedelta

import aiohttp

from config import LocationConfig, PVArrayConfig

log = logging.getLogger(__name__)

_cache: dict = {}
_cache_ts: float = 0.0


async def fetch_weather(loc: LocationConfig) -> dict:
    global _cache, _cache_ts
    now = time.monotonic()
    if _cache and (now - _cache_ts) < 600:
        return _cache

    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": loc.lat,
        "longitude": loc.lon,
        "hourly": "shortwave_radiation,direct_normal_irradiance,diffuse_radiation",
        "current": "shortwave_radiation,cloud_cover,temperature_2m",
        "forecast_days": 2,
        "timezone": loc.timezone,
    }
    try:
        connector = aiohttp.TCPConnector(ssl=False)
        async with aiohttp.ClientSession(connector=connector) as s:
            async with s.get(url, params=params, timeout=aiohttp.ClientTimeout(total=10)) as r:
                data = await r.json()
                _cache = data
                _cache_ts = now
                ghi = data.get("current", {}).get("shortwave_radiation", 0)
                log.info("Weather updated: GHI=%.0f W/m²", ghi)
                return data
    except Exception as e:
        log.error("Weather fetch error: %s", e)
        return _cache or {}


def _solar_position(lat_deg: float, lon_deg: float, dt: datetime) -> tuple[float, float]:
    """Return (elevation_deg, azimuth_deg_from_north_cw)."""
    day = dt.timetuple().tm_yday
    B = math.radians(360 / 365 * (day - 1))
    # Equation of time (minutes)
    eot = 229.18 * (0.000075 + 0.001868 * math.cos(B) - 0.032077 * math.sin(B)
                    - 0.014615 * math.cos(2 * B) - 0.04089 * math.sin(2 * B))
    # Solar declination
    decl = math.radians(23.45 * math.sin(math.radians(360 / 365 * (284 + day))))
    # True solar time
    utc_h = dt.hour + dt.minute / 60 + dt.second / 3600
    solar_h = utc_h + lon_deg / 15 + eot / 60
    hour_angle = math.radians(15 * (solar_h - 12))

    lat = math.radians(lat_deg)
    sin_elev = (math.sin(lat) * math.sin(decl)
                + math.cos(lat) * math.cos(decl) * math.cos(hour_angle))
    elevation = math.asin(max(-1.0, min(1.0, sin_elev)))

    cos_az = ((math.sin(decl) - math.sin(elevation) * math.sin(lat))
              / max(1e-6, math.cos(elevation) * math.cos(lat)))
    azimuth = math.acos(max(-1.0, min(1.0, cos_az)))
    if hour_angle > 0:
        azimuth = 2 * math.pi - azimuth

    return math.degrees(elevation), math.degrees(azimuth)


def _poa(ghi: float, dni: float, dhi: float,
         elev_deg: float, sol_az_deg: float,
         tilt_deg: float, surface_az_deg: float) -> float:
    """Plane-of-array irradiance using isotropic sky model."""
    if elev_deg <= 0 or ghi <= 0:
        return 0.0
    tilt = math.radians(tilt_deg)
    az_diff = math.radians(sol_az_deg - surface_az_deg)
    elev = math.radians(elev_deg)
    cos_aoi = max(0.0, math.sin(elev) * math.cos(tilt)
                  + math.cos(elev) * math.sin(tilt) * math.cos(az_diff))
    beam = dni * cos_aoi
    diffuse = dhi * (1 + math.cos(tilt)) / 2
    ground = ghi * 0.2 * (1 - math.cos(tilt)) / 2
    return max(0.0, beam + diffuse + ground)


def _array_power(arr: PVArrayConfig, ghi: float, dni: float, dhi: float,
                 lat: float, lon: float, dt: datetime) -> float:
    elev, az = _solar_position(lat, lon, dt)
    poa = _poa(ghi, dni, dhi, elev, az, arr.tilt_deg, arr.azimuth_deg)
    # (POA / STC irradiance) × kWp × 1000 W/kWp × efficiency
    return max(0.0, (poa / 1000.0) * arr.kwp * 1000.0 * arr.efficiency)


def estimate_now(loc: LocationConfig, arrays: list[PVArrayConfig], weather: dict) -> float:
    """Estimate current AC PV power in Watts."""
    if not weather:
        return 0.0
    dt = datetime.now(timezone.utc)
    current = weather.get("current", {})
    ghi = float(current.get("shortwave_radiation") or 0)
    if ghi <= 0:
        return 0.0

    # Get DNI/DHI from nearest hourly slot
    hourly = weather.get("hourly", {})
    times = hourly.get("time", [])
    hour_str = dt.strftime("%Y-%m-%dT%H:00")
    try:
        idx = times.index(hour_str)
        dni = float((hourly.get("direct_normal_irradiance") or [])[idx] or 0)
        dhi = float((hourly.get("diffuse_radiation") or [])[idx] or 0)
    except (ValueError, IndexError):
        dhi = ghi * 0.2
        elev, _ = _solar_position(loc.lat, loc.lon, dt)
        cos_z = math.cos(math.radians(max(0, 90 - elev)))
        dni = max(0.0, (ghi - dhi) / max(0.01, cos_z))

    return sum(_array_power(a, ghi, dni, dhi, loc.lat, loc.lon, dt) for a in arrays)


def get_forecast(loc: LocationConfig, arrays: list[PVArrayConfig], weather: dict) -> list[dict]:
    """Hourly forecast for the next 24 h."""
    if not weather:
        return []
    hourly = weather.get("hourly", {})
    times = hourly.get("time", [])
    ghis = hourly.get("shortwave_radiation", [])
    dnis = hourly.get("direct_normal_irradiance", [])
    dhis = hourly.get("diffuse_radiation", [])

    now = datetime.now(timezone.utc)
    cutoff = now + timedelta(hours=24)
    result = []

    for i, t_str in enumerate(times):
        try:
            # Parse as naive local time → treat as UTC approx (good enough for forecast display)
            dt = datetime.fromisoformat(t_str)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            if dt < now - timedelta(hours=1) or dt > cutoff:
                continue
            ghi = float((ghis[i] if i < len(ghis) else 0) or 0)
            dni = float((dnis[i] if i < len(dnis) else 0) or 0)
            dhi = float((dhis[i] if i < len(dhis) else 0) or 0)
            solar_w = sum(_array_power(a, ghi, dni, dhi, loc.lat, loc.lon, dt) for a in arrays)
            result.append({"time": t_str, "solar_w": round(solar_w), "ghi": round(ghi)})
        except Exception:
            continue

    return result
