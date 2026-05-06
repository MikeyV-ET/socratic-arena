#!/usr/bin/env bash
# Launch Socratic Arena (backend + frontend)
# Usage: bash launch.sh [start|stop|restart|status]

set -euo pipefail

SA_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${SA_BACKEND_PORT:-8000}"
FRONTEND_PORT="${SA_FRONTEND_PORT:-5173}"
AGENT="${SA_AGENT:-Q}"
BACKEND_LOG="/tmp/sa_backend.log"
FRONTEND_LOG="/tmp/sa_frontend.log"
ADAPTER_LOG="/tmp/sa_adapter.log"
BACKEND_PID="/tmp/sa_backend.pid"
FRONTEND_PID="/tmp/sa_frontend.pid"
ADAPTER_PID="/tmp/sa_adapter.pid"

stop_all() {
    echo "Stopping Socratic Arena..."
    for label_pid in "$BACKEND_PID:backend:uvicorn main:app" "$FRONTEND_PID:frontend:node.*vite" "$ADAPTER_PID:adapter:arena_adapter.py"; do
        pf="${label_pid%%:*}"; rest="${label_pid#*:}"; name="${rest%%:*}"; pattern="${rest#*:}"
        if [ -f "$pf" ] && kill -0 "$(cat "$pf")" 2>/dev/null; then
            kill "$(cat "$pf")" && echo "  ${name} stopped (PID $(cat "$pf"))."
        else
            pkill -f "$pattern" 2>/dev/null && echo "  ${name} stopped." || echo "  ${name} not running."
        fi
        rm -f "$pf"
    done
    # Kill anything still holding our ports (catches orphans from stale PID files)
    for port in "${BACKEND_PORT}" "${FRONTEND_PORT}"; do
        pid=$(lsof -ti :"$port" 2>/dev/null || true)
        if [ -n "$pid" ]; then
            kill $pid 2>/dev/null && echo "  killed orphan on :${port} (PID ${pid})"
        fi
    done
}

start_backend() {
    echo "Starting backend on :${BACKEND_PORT}..."
    cd "${SA_DIR}/backend"
    nohup uvicorn main:app --host 0.0.0.0 --port "${BACKEND_PORT}" --ws-max-size 20971520 > "${BACKEND_LOG}" 2>&1 &
    echo $! > "$BACKEND_PID"
    echo "  Backend PID: $! (log: ${BACKEND_LOG})"
}

start_frontend() {
    echo "Starting frontend on :${FRONTEND_PORT}..."
    cd "${SA_DIR}/frontend"
    nohup npx vite --host 0.0.0.0 --port "${FRONTEND_PORT}" > "${FRONTEND_LOG}" 2>&1 &
    echo $! > "$FRONTEND_PID"
    echo "  Frontend PID: $! (log: ${FRONTEND_LOG})"
}

start_adapter() {
    echo "Starting arena adapter for ${AGENT}..."
    cd "${SA_DIR}/backend"
    nohup python3 arena_adapter.py --agent "${AGENT}" --arena-url "http://localhost:${BACKEND_PORT}" > "${ADAPTER_LOG}" 2>&1 &
    echo $! > "$ADAPTER_PID"
    echo "  Adapter PID: $! (log: ${ADAPTER_LOG})"
}

show_status() {
    echo "Socratic Arena status:"
    for label_pid in "$BACKEND_PID:Backend:${BACKEND_PORT}" "$FRONTEND_PID:Frontend:${FRONTEND_PORT}" "$ADAPTER_PID:Adapter:${AGENT}"; do
        pf="${label_pid%%:*}"; rest="${label_pid#*:}"; name="${rest%%:*}"; info="${rest#*:}"
        if [ -f "$pf" ] && kill -0 "$(cat "$pf")" 2>/dev/null; then
            echo "  ${name}:  RUNNING (PID $(cat "$pf"), ${info})"
        else
            echo "  ${name}:  STOPPED"
        fi
    done
}

case "${1:-start}" in
    stop)
        stop_all
        ;;
    restart|start)
        stop_all
        sleep 1
        start_backend
        start_frontend
        start_adapter
        echo ""
        echo "Socratic Arena started."
        echo "  Frontend: http://localhost:${FRONTEND_PORT}"
        echo "  Backend:  http://localhost:${BACKEND_PORT}"
        echo "  Adapter:  agent=${AGENT}"
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 [start|stop|restart|status]"
        exit 1
        ;;
esac
