#!/usr/bin/env bash
# Launch Socratic Arena (backend + frontend)
# Usage: bash launch.sh [start|stop|restart|status]

set -euo pipefail

SA_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT="${SA_BACKEND_PORT:-8000}"
FRONTEND_PORT="${SA_FRONTEND_PORT:-5173}"
BACKEND_LOG="/tmp/sa_backend.log"
FRONTEND_LOG="/tmp/sa_frontend.log"
BACKEND_PID="/tmp/sa_backend.pid"
FRONTEND_PID="/tmp/sa_frontend.pid"

stop_all() {
    echo "Stopping Socratic Arena..."
    if [ -f "$BACKEND_PID" ] && kill -0 "$(cat "$BACKEND_PID")" 2>/dev/null; then
        kill "$(cat "$BACKEND_PID")" && echo "  Backend stopped (PID $(cat "$BACKEND_PID"))."
        rm -f "$BACKEND_PID"
    else
        pkill -f "uvicorn main:app" 2>/dev/null && echo "  Backend stopped." || echo "  Backend not running."
        rm -f "$BACKEND_PID"
    fi
    if [ -f "$FRONTEND_PID" ] && kill -0 "$(cat "$FRONTEND_PID")" 2>/dev/null; then
        kill "$(cat "$FRONTEND_PID")" && echo "  Frontend stopped (PID $(cat "$FRONTEND_PID"))."
        rm -f "$FRONTEND_PID"
    else
        pkill -f "node.*vite" 2>/dev/null && echo "  Frontend stopped." || echo "  Frontend not running."
        rm -f "$FRONTEND_PID"
    fi
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

show_status() {
    echo "Socratic Arena status:"
    if [ -f "$BACKEND_PID" ] && kill -0 "$(cat "$BACKEND_PID")" 2>/dev/null; then
        echo "  Backend:  RUNNING (PID $(cat "$BACKEND_PID"), port ${BACKEND_PORT})"
    else
        echo "  Backend:  STOPPED"
    fi
    if [ -f "$FRONTEND_PID" ] && kill -0 "$(cat "$FRONTEND_PID")" 2>/dev/null; then
        echo "  Frontend: RUNNING (PID $(cat "$FRONTEND_PID"), port ${FRONTEND_PORT})"
    else
        echo "  Frontend: STOPPED"
    fi
}

case "${1:-start}" in
    stop)
        stop_all
        ;;
    restart)
        stop_all
        sleep 1
        start_backend
        start_frontend
        echo ""
        echo "Socratic Arena restarted."
        echo "  Frontend: http://localhost:${FRONTEND_PORT}"
        echo "  Backend:  http://localhost:${BACKEND_PORT}"
        ;;
    start)
        start_backend
        start_frontend
        echo ""
        echo "Socratic Arena started."
        echo "  Frontend: http://localhost:${FRONTEND_PORT}"
        echo "  Backend:  http://localhost:${BACKEND_PORT}"
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 [start|stop|restart|status]"
        exit 1
        ;;
esac
