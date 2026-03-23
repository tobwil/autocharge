#!/bin/bash
# Entwicklungs-Start: Backend + Frontend gleichzeitig
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installiere Backend-Abhängigkeiten..."
cd "$ROOT/backend"
python3 -m venv .venv 2>/dev/null || true
source .venv/bin/activate
pip install -q -r requirements.txt

echo "==> Installiere Frontend-Abhängigkeiten..."
cd "$ROOT/frontend"
npm install --silent

echo ""
echo "==> Starte Backend auf http://localhost:8000"
echo "==> Starte Frontend auf http://localhost:5173"
echo ""

# Backend im Hintergrund
cd "$ROOT/backend"
CONFIG_PATH="$ROOT/data/config.json" DB_PATH="$ROOT/data/autocharge.db" \
  .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Frontend
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo "Backend PID: $BACKEND_PID  |  Frontend PID: $FRONTEND_PID"
echo "Beende mit Ctrl+C"

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
