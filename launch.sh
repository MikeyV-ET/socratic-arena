#!/usr/bin/env bash
# Launch Socratic Arena (backend + frontend)
# Usage: bash launch.sh [--dev] [start|stop|restart|status]
# Profiles: prod (8000/5173, default), dev (8002/5175)
# Override ports: SA_BACKEND_PORT=9000 SA_FRONTEND_PORT=9001 bash launch.sh start

set -euo pipefail

SA_DIR="$(cd "$(dirname "$0")" && pwd)"

# Parse --dev flag
SA_PROFILE="${SA_PROFILE:-prod}"
ARGS=()
for arg in "$@"; do
    case "$arg" in
        --dev) SA_PROFILE="dev" ;;
        --prod) SA_PROFILE="prod" ;;
        *) ARGS+=("$arg") ;;
    esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"
case "$SA_PROFILE" in
    prod) _DEF_BACKEND=8000; _DEF_FRONTEND=5173 ;;
    dev)  _DEF_BACKEND=8002; _DEF_FRONTEND=5175 ;;
    *)    echo "Unknown profile: $SA_PROFILE (use prod or dev)"; exit 1 ;;
esac
BACKEND_PORT="${SA_BACKEND_PORT:-$_DEF_BACKEND}"
FRONTEND_PORT="${SA_FRONTEND_PORT:-$_DEF_FRONTEND}"
AGENT="${SA_AGENT:-Q}"

# Per-profile file paths so prod and dev don't collide
BACKEND_LOG="/tmp/sa_${SA_PROFILE}_backend.log"
FRONTEND_LOG="/tmp/sa_${SA_PROFILE}_frontend.log"
ADAPTER_LOG="/tmp/sa_${SA_PROFILE}_adapter.log"
WATCHDOG_LOG="/tmp/sa_${SA_PROFILE}_watchdog.log"
BACKEND_PID="/tmp/sa_${SA_PROFILE}_backend.pid"
FRONTEND_PID="/tmp/sa_${SA_PROFILE}_frontend.pid"
ADAPTER_PID="/tmp/sa_${SA_PROFILE}_adapter.pid"
WATCHDOG_PID="/tmp/sa_${SA_PROFILE}_watchdog.pid"
BREADCRUMB="/tmp/sa_${SA_PROFILE}.json"

# Timestamp prefix for log lines
ts_pipe() { while IFS= read -r line; do printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$line"; done; }

stop_all() {
    echo "Stopping Socratic Arena..."
    # Kill watchdog first so it doesn't restart things we're stopping
    if [ -f "$WATCHDOG_PID" ] && kill -0 "$(cat "$WATCHDOG_PID")" 2>/dev/null; then
        kill "$(cat "$WATCHDOG_PID")" 2>/dev/null; echo "  watchdog stopped."
    fi
    rm -f "$WATCHDOG_PID"
    for label_pid in "$BACKEND_PID:backend" "$FRONTEND_PID:frontend" "$ADAPTER_PID:adapter"; do
        pf="${label_pid%%:*}"; name="${label_pid#*:}"
        if [ -f "$pf" ] && kill -0 "$(cat "$pf")" 2>/dev/null; then
            kill "$(cat "$pf")" && echo "  ${name} stopped."
        else
            echo "  ${name} not running."
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
    rm -f "$BREADCRUMB"
}

start_backend() {
    echo "Starting backend on :${BACKEND_PORT}..."
    cd "${SA_DIR}/backend"
    nohup uvicorn main:app --host 0.0.0.0 --port "${BACKEND_PORT}" \
        --ws-max-size 20971520 --log-level info \
        2>&1 | ts_pipe > "${BACKEND_LOG}" &
    echo $! > "$BACKEND_PID"
    echo "  Backend PID: $! (log: ${BACKEND_LOG})"
}

start_frontend() {
    echo "Starting frontend on :${FRONTEND_PORT}..."
    cd "${SA_DIR}/frontend"
    SA_BACKEND_PORT="${BACKEND_PORT}" nohup npx vite --host 0.0.0.0 --port "${FRONTEND_PORT}" \
        2>&1 | ts_pipe > "${FRONTEND_LOG}" &
    echo $! > "$FRONTEND_PID"
    echo "  Frontend PID: $! (log: ${FRONTEND_LOG})"
}

start_adapter() {
    echo "Starting arena adapter for ${AGENT}..."
    cd "${SA_DIR}/backend"
    nohup python3 -u arena_adapter.py --agent "${AGENT}" \
        --arena-url "http://localhost:${BACKEND_PORT}" \
        2>&1 | ts_pipe > "${ADAPTER_LOG}" &
    echo $! > "$ADAPTER_PID"
    echo "  Adapter PID: $! (log: ${ADAPTER_LOG})"
}

start_watchdog() {
    # Background watchdog: checks every 30s, logs unexpected exits
    (
        while true; do
            sleep 30
            for label_pid in "$BACKEND_PID:backend" "$FRONTEND_PID:frontend" "$ADAPTER_PID:adapter"; do
                pf="${label_pid%%:*}"; name="${label_pid#*:}"
                if [ -f "$pf" ]; then
                    pid=$(cat "$pf")
                    if ! kill -0 "$pid" 2>/dev/null; then
                        wait "$pid" 2>/dev/null; rc=$?
                        echo "$(date '+%Y-%m-%d %H:%M:%S') CRASH ${name} (PID ${pid}) exited with code ${rc}" >> "$WATCHDOG_LOG"
                        rm -f "$pf"
                    fi
                fi
            done
        done
    ) &
    echo $! > "$WATCHDOG_PID"
}

show_status() {
    echo "Socratic Arena status:"
    for label_pid in "$BACKEND_PID:Backend:${BACKEND_PORT}" "$FRONTEND_PID:Frontend:${FRONTEND_PORT}" "$ADAPTER_PID:Adapter:${AGENT}" "$WATCHDOG_PID:Watchdog:monitor"; do
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
        start_watchdog
        # Write breadcrumb for test/tool discovery
        cat > "$BREADCRUMB" <<EOF
{"profile":"${SA_PROFILE}","backend":${BACKEND_PORT},"frontend":${FRONTEND_PORT},"agent":"${AGENT}","pid":$$}
EOF
        echo ""
        echo "Socratic Arena started (profile=${SA_PROFILE})."
        echo "  Frontend: http://localhost:${FRONTEND_PORT}"
        echo "  Backend:  http://localhost:${BACKEND_PORT}"
        echo "  Adapter:  agent=${AGENT}"
        echo "  Breadcrumb: ${BREADCRUMB}"
        ;;
    status)
        show_status
        ;;
    *)
        echo "Usage: $0 [start|stop|restart|status]"
        exit 1
        ;;
esac
