# AutoCharge

Solar-optimised EV charging manager. Acts as an OCPP 1.6 Central System (server) that your wallbox connects to, and uses live weather data plus your PV specification to automatically regulate charging current so you only use solar surplus.

**No inverter connection required** — solar production is estimated from irradiance data (Open-Meteo) and your array parameters (kWp, tilt, azimuth).

<img width="1330" height="1426" alt="Bildschirmfoto 2026-03-23 um 16 48 35" src="https://github.com/user-attachments/assets/dff365f1-7251-40e1-b633-fa754bf9ce31" />
<img width="1330" height="1426" alt="Bildschirmfoto 2026-03-23 um 16 48 42" src="https://github.com/user-attachments/assets/02614ca2-cbfb-48c4-a847-5a56e4a41564" />
<img width="1330" height="1426" alt="Bildschirmfoto 2026-03-23 um 16 48 46" src="https://github.com/user-attachments/assets/01623ab4-134c-4a05-b1c6-f26b294e4a0d" />


---

## How it works

```
Open-Meteo API ──► Solar estimate (W)
                         │
                         ▼
              Buffer (configurable %)
                         │
                         ▼
Wallbox ──OCPP 1.6──► AutoCharge ──► SetChargingProfile / RemoteStart / RemoteStop
```

- **Solar mode** — charges at maximum available solar surplus, pauses when below threshold; optionally switches between 1-phase and 3-phase automatically
- **Fixed mode** — charges at a set kW (entered directly in kW, converted to amps per phase)
- **Off** — no charging commands sent

---

## Requirements

| Component | Minimum |
|-----------|---------|
| Python    | 3.12    |
| Node.js   | 20      |
| npm       | 10      |
| Docker    | 24 (optional, for deployment) |

---

## Development (local)

### First start

```bash
git clone <repo-url>
cd autocharge
bash start-dev.sh
```

This will:
1. Create a Python venv and install backend dependencies
2. Install frontend npm dependencies
3. Start backend on **http://localhost:8000** (hot-reload)
4. Start frontend on **http://localhost:5173** (Vite HMR)
5. Create `data/config.json` and `data/autocharge.db` on first run

### Restart (after crash / code change)

```bash
# Kill everything on the relevant ports
pkill -f "uvicorn main:app"; pkill -f "vite"

# Restart
bash start-dev.sh
```

Or in one line:

```bash
pkill -f "uvicorn main:app"; pkill -f "vite"; sleep 1; bash start-dev.sh
```

### Restart backend only

```bash
pkill -f "uvicorn main:app"
cd backend
CONFIG_PATH=../data/config.json DB_PATH=../data/autocharge.db \
  .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Restart frontend only

```bash
pkill -f "vite"
cd frontend
npm run dev
```

### Check what's running

```bash
lsof -i :8000   # backend
lsof -i :5173   # frontend dev server
lsof -i :9000   # OCPP WebSocket server
```

---

## Production — Docker (recommended)

### Build and start

```bash
docker compose up --build -d
```

- Frontend: **http://<server-ip>**  (port 80)
- Backend API: **http://<server-ip>:8000**
- OCPP WebSocket: **ws://<server-ip>:9000/<wallbox-id>**

Configuration and database are stored in a Docker volume (`autocharge_data`), so they survive container restarts and rebuilds.

### Update to latest code

```bash
git pull
docker compose up --build -d
```

### Stop

```bash
docker compose down
```

### Stop and wipe all data (⚠ deletes config + history)

```bash
docker compose down -v
```

### View live logs

```bash
docker compose logs -f            # all services
docker compose logs -f backend    # backend only
docker compose logs -f frontend   # nginx only
```

### Restart a single service

```bash
docker compose restart backend
docker compose restart frontend
```

### Shell into a running container

```bash
docker compose exec backend bash
docker compose exec frontend sh
```

---

## Production — without Docker

### Backend (systemd service)

Install dependencies:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create `/etc/systemd/system/autocharge-backend.service`:

```ini
[Unit]
Description=AutoCharge Backend
After=network-online.target
Wants=network-online.target

[Service]
User=<your-user>
WorkingDirectory=/opt/autocharge/backend
Environment=CONFIG_PATH=/opt/autocharge/data/config.json
Environment=DB_PATH=/opt/autocharge/data/autocharge.db
ExecStart=/opt/autocharge/backend/.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now autocharge-backend
sudo systemctl status autocharge-backend
```

### Frontend (nginx, static build)

Build:

```bash
cd frontend
npm install
npm run build          # output: frontend/dist/
```

Copy dist to nginx web root or configure nginx to serve it:

```nginx
server {
    listen 80;
    root /opt/autocharge/frontend/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
    }

    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Rebuild frontend after code changes:

```bash
cd frontend && npm run build
sudo systemctl reload nginx
```

---

## Wallbox (OCPP) setup

1. In your wallbox settings, find the **OCPP configuration** section
2. Set the **OCPP Central System URL** to:

   ```
   ws://<server-ip>:9000/<wallbox-id>
   ```

   Example: `ws://192.168.1.100:9000/wallbox1`

3. `<wallbox-id>` can be any name you choose (e.g. `wallbox1`, `gemini`, …)
4. Set OCPP protocol version to **OCPP 1.6** (OCPP 1.6-J / JSON)
5. Save and reboot the wallbox

The wallbox ID will appear under **Ladepunkte** in the UI once it connects.

> **go-e Gemini / HOME+**: Settings → OCPP → Server URL

> **Port 9000 must be reachable** from the wallbox. If AutoCharge runs on a different host than your router, make sure port 9000 is not blocked by a firewall.

---

## Configuration

All settings are available in the UI under **Einstellungen**. They are saved to `data/config.json`.

| Section | Key settings |
|---------|-------------|
| **Location** | GPS coordinates (map picker + address search), timezone |
| **PV arrays** | Name, kWp, tilt (°), azimuth (°), efficiency — add multiple arrays |
| **Charging params** | Buffer %, start/stop thresholds, min/max amps, phases, fixed kW, phase switching, go-e IP, update interval |
| **System** | Weather update interval, OCPP port |

### Azimuth reference

| Value | Direction |
|-------|-----------|
| 0°    | North     |
| 90°   | East      |
| 180°  | South (optimal in northern hemisphere) |
| 270°  | West      |

### Fixed mode

Enter the desired charging power in **kW**. The UI shows the equivalent amps at the configured phase count and 230 V, e.g. `5.52 kW ≈ 8 A @ 3×230 V`.

### Recommended buffer

Set 10–15 % buffer to account for forecast uncertainty and avoid drawing from the grid on partly cloudy days.

---

## Automatic phase switching (1↔3 phases)

Relevant for 3-phase chargers (e.g. go-e Gemini 11 kW) where you want to charge on a single phase when solar surplus is too low for 3-phase but still above the 1-phase minimum.

| Available power | Behaviour |
|-----------------|-----------|
| < 1 380 W (6 A × 1ph) | Charging paused |
| 1 380 – 4 140 W | 1-phase, up to 16 A |
| > 4 140 W (6 A × 3ph) | 3-phase, up to 16 A |

Thresholds scale with your `min_amps` setting (default 6 A).

### Enable

In **Einstellungen → Ladeparameter** turn on *Automatische Phasenumschaltung*.

Phase switching is attempted via (in order):
1. **OCPP `ChangeConfiguration(NumberOfPhases)`** — standard, few chargers support it
2. **go-e local HTTP API** (`/api/set?psm=1` / `psm=2`) — set the go-e IP in the config field that appears when switching is enabled
3. **State-only update** — works if the charger is in auto-PSM mode and follows the charging profile

A **3-minute cooldown** between switches prevents rapid toggling on fluctuating solar.

When a phase switch is needed while charging, AutoCharge automatically stops the session, switches phases, then restarts.

### go-e PSM values

| `psm` | Meaning |
|-------|---------|
| 0 | Auto (charger decides) |
| 1 | Force 1-phase |
| 2 | Force 3-phase |

---

## Data sources

- **Weather / irradiance**: [Open-Meteo](https://open-meteo.com) — free, no API key required, updated every 15 min by default
- **Solar calculation**: Pure-Python PV model (solar geometry + isotropic sky model), no external libraries
- **Map / geocoding**: [OpenStreetMap](https://www.openstreetmap.org) / [Nominatim](https://nominatim.openstreetmap.org)

---

## Project structure

```
autocharge/
├── backend/
│   ├── main.py           # FastAPI app, background loops, REST + WebSocket
│   ├── config.py         # Pydantic models, config load/save
│   ├── charging.py       # Solar charging algorithm
│   ├── ocpp_server.py    # OCPP 1.6 Central System
│   ├── solar.py          # Weather fetch + PV power estimation
│   ├── database.py       # SQLite history (aiosqlite)
│   └── requirements.txt
├── frontend/
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.tsx   # Live stats, mode selector, forecast
│       │   ├── Chargers.tsx    # OCPP charger details + manual control
│       │   ├── History.tsx     # Power history chart
│       │   ├── Config.tsx      # Settings form
│       │   └── Logs.tsx        # Live backend log viewer
│       └── components/
│           ├── Layout.tsx      # Nav, dark/light toggle, shutdown
│           └── MapPicker.tsx   # Leaflet map for location
├── Dockerfile.backend
├── Dockerfile.frontend
├── docker-compose.yml
├── nginx.conf
├── start-dev.sh          # One-command dev start
└── data/                 # config.json + autocharge.db (gitignored)
```

---

## Ports

| Port | Service |
|------|---------|
| 80   | Frontend (production / Docker) |
| 5173 | Frontend (dev, Vite) |
| 8000 | Backend API + WebSocket |
| 9000 | OCPP WebSocket server (wallbox connects here) |

---

## Troubleshooting

**Frontend not accessible**
```bash
pkill -f "uvicorn main:app"; pkill -f "vite"; sleep 1; bash start-dev.sh
```

**Wallbox not appearing in UI**
- Check the OCPP URL includes the wallbox ID: `ws://ip:9000/wallbox1` not `ws://ip:9000`
- Verify port 9000 is reachable: `telnet <server-ip> 9000`
- Check **Logs** tab in the UI for connection events

**kWh counter shows 0**
- AutoCharge sets an energy baseline from the first MeterValues message after connection. If no MeterValues arrive within 30 s, check that your wallbox has `MeterValueSampleInterval` enabled (AutoCharge sends this automatically after BootNotification).

**Solar estimate seems wrong**
- Double-check azimuth (180° = facing south in northern hemisphere) and tilt
- Verify the GPS location is correct on the map
- Check weather data age in the Dashboard — if stale, the backend may have lost internet access

**Docker: frontend can't reach backend**
- The backend runs with `network_mode: host`; the frontend nginx uses `host.docker.internal` to reach it
- On Linux, `extra_hosts: host.docker.internal:host-gateway` is set in `docker-compose.yml` — requires Docker Engine ≥ 20.10

**View backend logs (Docker)**
```bash
docker compose logs -f backend
```

**View backend logs (dev)**
Open the **Logs** tab in the UI — all backend log messages appear there in real time.

**Current (A) shows 0.0 in the charger card**
Some chargers (including go-e) send only per-phase `Current.Import` values (L1/L2/L3) without an aggregate. AutoCharge reads the L1 value in that case and auto-detects the active phase count from the number of phases carrying current (> 0.5 A).

**Phase switching not working**
- Make sure the go-e IP is entered in the config (Settings → Ladeparameter)
- Check the Logs tab for `go-e phase switch` messages
- If the charger is in auto-PSM mode already, disable phase switching in AutoCharge and let the charger handle it
- Phase switches only happen in solar mode, not fixed or off
