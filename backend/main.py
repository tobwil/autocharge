"""
AutoCharge – OCPP + Solar-Estimation Backend
"""
from __future__ import annotations

# ══════════════════════════════════════════════════════════════════════════════
# Logging MUST be configured here, before ANY other import.
# Many dependencies (starlette, h11, ocpp …) call logging.basicConfig() on
# first import, which makes subsequent basicConfig calls a no-op and leaves
# the root logger at WARNING level.  By setting up here we guarantee INFO+
# is captured from the start.
# ══════════════════════════════════════════════════════════════════════════════
import collections
import logging

_log_buffer: collections.deque = collections.deque(maxlen=500)


class _BufferHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            _log_buffer.append({
                "ts": record.created,
                "level": record.levelname,
                "name": record.name,
                "msg": record.getMessage(),
            })
        except Exception:
            pass


def _setup_logging() -> None:
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    # Console handler (only once)
    if not any(isinstance(h, logging.StreamHandler) and not isinstance(h, _BufferHandler)
               for h in root.handlers):
        sh = logging.StreamHandler()
        sh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
        root.addHandler(sh)
    # Buffer handler
    if not any(isinstance(h, _BufferHandler) for h in root.handlers):
        bh = _BufferHandler()
        bh.setLevel(logging.DEBUG)
        root.addHandler(bh)


_setup_logging()

# ── Remaining imports ──────────────────────────────────────────────────────────
import asyncio
import json
import os
import signal
import socket
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from charging import compute_target
from config import AppConfig, load_config, save_config
from database import get_readings, init_db, save_reading
from ocpp_server import get_all_states, get_charger, run_ocpp_server
from solar import estimate_now, fetch_weather, get_forecast

log = logging.getLogger(__name__)


def _reattach_log_handler() -> None:
    """Uvicorn calls logging.config.dictConfig() before lifespan which can
    set propagate=False on its own loggers, cutting them off from the root
    BufferHandler.  For each such logger, add the BufferHandler directly."""
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "ocpp", "websockets"):
        lg = logging.getLogger(name)
        lg.setLevel(logging.INFO)
        # Only attach directly when propagate=False; otherwise root handler suffices.
        if not lg.propagate and not any(isinstance(h, _BufferHandler) for h in lg.handlers):
            bh = _BufferHandler()
            bh.setLevel(logging.DEBUG)
            lg.addHandler(bh)


# ── State ─────────────────────────────────────────────────────────────────────

_config: AppConfig = AppConfig()
_weather: dict = {}
_solar_w: float = 0.0
_forecast: list[dict] = []
_ws_clients: set[WebSocket] = set()
_weather_updated_at: float = 0.0
_last_phase_switch: dict[str, float] = {}  # cp_id → timestamp of last phase switch
_PHASE_SWITCH_COOLDOWN = 180  # seconds between phase switches (avoid thrashing)


# ── Background loops ──────────────────────────────────────────────────────────

async def _weather_loop() -> None:
    global _weather, _solar_w, _forecast, _weather_updated_at
    while True:
        try:
            _weather = await fetch_weather(_config.location)
            _solar_w = estimate_now(_config.location, _config.pv_arrays, _weather)
            _forecast = get_forecast(_config.location, _config.pv_arrays, _weather)
            _weather_updated_at = time.time()
            log.info("Solar estimate: %.0f W", _solar_w)
        except Exception as e:
            log.error("Weather loop: %s", e)
        await asyncio.sleep(_config.weather_interval_s)


async def _charging_loop() -> None:
    while True:
        await asyncio.sleep(_config.charging.update_interval_s)
        try:
            await _apply_charging()
        except Exception as e:
            log.error("Charging loop: %s", e)


async def _apply_charging() -> None:
    for state in get_all_states():
        cp = get_charger(state["id"])
        if not cp or not state["car_connected"]:
            continue

        target_amps, should, target_phases = compute_target(
            _solar_w, _config.charging, state["charging"]
        )
        current_phases = state.get("phases_actual", _config.charging.phases)
        need_phase_switch = (
            should
            and target_phases != current_phases
            and _config.charging.phases_switching
            and (time.time() - _last_phase_switch.get(state["id"], 0)) > _PHASE_SWITCH_COOLDOWN
        )

        if need_phase_switch and state["charging"]:
            # Stop → switch phases → restart
            log.info("Phase switch required (%d→%d ph) for %s – stopping session first",
                     current_phases, target_phases, state["id"])
            await cp.remote_stop()
            await asyncio.sleep(4)
            await cp.switch_phases(target_phases, _config.charging.goe_ip)
            _last_phase_switch[state["id"]] = time.time()
            await asyncio.sleep(1)
            await cp.set_charge_limit(target_amps)
            await asyncio.sleep(0.3)
            await cp.remote_start()

        elif should and not state["charging"]:
            if need_phase_switch:
                await cp.switch_phases(target_phases, _config.charging.goe_ip)
                _last_phase_switch[state["id"]] = time.time()
                await asyncio.sleep(1)
            await cp.set_charge_limit(target_amps)
            await asyncio.sleep(0.3)
            await cp.remote_start()

        elif should and state["charging"] and abs(target_amps - state["amp_set"]) >= 1:
            await cp.set_charge_limit(target_amps)

        elif not should and state["charging"]:
            await cp.remote_stop()


async def _push_loop() -> None:
    while True:
        await asyncio.sleep(5)
        if not _ws_clients:
            continue
        payload = json.dumps(_build_state())
        dead = set()
        for ws in list(_ws_clients):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        _ws_clients.difference_update(dead)


async def _history_loop() -> None:
    while True:
        await asyncio.sleep(60)
        try:
            ev_w = sum(s["power_w"] for s in get_all_states())
            available_w = max(0.0, _solar_w * (1.0 - _config.charging.buffer_fraction))
            await save_reading(_solar_w, available_w, ev_w, _config.charging.mode)
        except Exception as e:
            log.error("History loop: %s", e)


def _build_state() -> dict:
    chargers = get_all_states()
    ev_w = sum(s["power_w"] for s in chargers)
    buf = _config.charging.buffer_fraction
    available_w = max(0.0, _solar_w * (1.0 - buf))
    now = time.time()
    return {
        "ts": int(now),
        "solar_estimate_w": round(_solar_w),
        "available_for_ev_w": round(available_w),
        "ev_power_w": round(ev_w),
        "charging_mode": _config.charging.mode,
        "fixed_kw": _config.charging.fixed_kw,
        "phases": _config.charging.phases,
        "buffer_fraction": buf,
        "chargers": chargers,
        "forecast": _forecast[:24],
        "ocpp_port": _config.ocpp_port,
        "weather_updated_at": _weather_updated_at,
        "weather_next_at": (_weather_updated_at + _config.weather_interval_s
                            if _weather_updated_at else 0),
    }


# ── App lifecycle ─────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _config
    _reattach_log_handler()
    log.info("AutoCharge starting up")
    _config = load_config()
    await init_db()
    asyncio.create_task(run_ocpp_server(_config.ocpp_port))
    asyncio.create_task(_weather_loop())
    asyncio.create_task(_charging_loop())
    asyncio.create_task(_push_loop())
    asyncio.create_task(_history_loop())
    yield
    log.info("AutoCharge shutting down")


app = FastAPI(title="AutoCharge", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── REST endpoints ────────────────────────────────────────────────────────────

@app.get("/api/state")
async def get_state():
    return _build_state()


@app.get("/api/config")
async def get_config():
    return _config.model_dump()


@app.post("/api/config")
async def post_config(body: dict):
    global _config
    try:
        valid = {k: v for k, v in body.items() if k in AppConfig.model_fields}
        _config = AppConfig(**valid)
        save_config(_config)
        return {"ok": True}
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=422)


@app.post("/api/mode/{mode}")
async def set_mode(mode: str, kw: float = 0.0):
    if mode not in ("off", "solar", "fixed"):
        return JSONResponse({"error": "invalid mode"}, status_code=400)
    _config.charging.mode = mode
    if mode == "fixed" and kw > 0:
        _config.charging.fixed_kw = round(kw, 2)
    save_config(_config)
    asyncio.create_task(_apply_charging())
    return {"ok": True, "mode": mode, "fixed_kw": _config.charging.fixed_kw}


@app.get("/api/logs")
async def get_logs():
    return list(_log_buffer)


@app.get("/api/network-info")
async def network_info():
    ips: list[str] = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return {"ips": ips, "ocpp_port": _config.ocpp_port}


@app.get("/api/history")
async def history(hours: int = 24):
    return await get_readings(hours)


@app.post("/api/charger/{cp_id}/start")
async def charger_start(cp_id: str):
    cp = get_charger(cp_id)
    if not cp:
        return JSONResponse({"error": "not found"}, status_code=404)
    # Set charge limit before starting (use current solar or fixed config)
    target_amps, _ = compute_target(_solar_w, _config.charging, False)
    if target_amps < _config.charging.min_amps:
        target_amps = _config.charging.min_amps
    await cp.set_charge_limit(float(target_amps))
    await asyncio.sleep(0.2)
    ok = await cp.remote_start()
    log.info("Manual start %s: amps=%d ok=%s", cp_id, target_amps, ok)
    return {"ok": ok}


@app.post("/api/charger/{cp_id}/stop")
async def charger_stop(cp_id: str):
    cp = get_charger(cp_id)
    if not cp:
        return JSONResponse({"error": "not found"}, status_code=404)
    ok = await cp.remote_stop()
    log.info("Manual stop %s: ok=%s", cp_id, ok)
    return {"ok": ok}


@app.post("/api/charger/{cp_id}/limit/{amps}")
async def charger_limit(cp_id: str, amps: int):
    cp = get_charger(cp_id)
    if not cp:
        return JSONResponse({"error": "not found"}, status_code=404)
    return {"ok": await cp.set_charge_limit(float(amps))}


@app.post("/api/shutdown")
async def shutdown():
    log.info("Shutdown requested via API")
    os.kill(os.getpid(), signal.SIGTERM)
    return {"ok": True}


# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    _ws_clients.add(ws)
    try:
        await ws.send_text(json.dumps(_build_state()))
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        _ws_clients.discard(ws)


# ── Serve frontend (production build) ─────────────────────────────────────────

_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_frontend_dist):
    from fastapi.responses import FileResponse
    app.mount("/assets", StaticFiles(directory=os.path.join(_frontend_dist, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        return FileResponse(os.path.join(_frontend_dist, "index.html"))
