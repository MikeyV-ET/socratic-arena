#!/usr/bin/env bash
# launch_arena.sh -- Start all Socratic Arena components (detached from agent sessions)
#
# Usage:
#   ./launch_arena.sh [AGENT]
#   ./launch_arena.sh Q        # Start with Q as the default agent
#   ./launch_arena.sh          # Start with default (Q)
#   ./launch_arena.sh --stop   # Stop all arena processes
#
# Processes run via setsid/nohup so they are fully detached from any
# agent's grok session. This prevents their output from accumulating
# in updates.jsonl (which caused 100KB+ bloat per tool_call_update).
#
# Logs: /tmp/arena_backend.log, /tmp/arena_frontend.log, /tmp/arena_adapter.log
# PIDs: /tmp/arena_pids.txt

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$(dirname "$SCRIPT_DIR")/frontend"
AGENT="${1:-Q}"
PID_FILE="/tmp/arena_pids.txt"

# --- Stop mode ---
if [ "$1" = "--stop" ]; then
    echo "Stopping arena processes..."
    if [ -f "$PID_FILE" ]; then
        while read -r pid name; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null && echo "  Stopped $name (PID $pid)" || true
            else
                echo "  $name (PID $pid) already stopped"
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
    else
        echo "  No PID file found. Trying pkill..."
        pkill -f "uvicorn main:app.*--port 8000" 2>/dev/null || true
        pkill -f "arena_adapter.py" 2>/dev/null || true
        pkill -f "vite.*--port 5173" 2>/dev/null || true
    fi
    echo "Done."
    exit 0
fi

# --- Check for already-running processes ---
if [ -f "$PID_FILE" ]; then
    all_alive=true
    while read -r pid name; do
        if ! kill -0 "$pid" 2>/dev/null; then
            all_alive=false
            break
        fi
    done < "$PID_FILE"
    if $all_alive; then
        echo "Arena already running (PIDs in $PID_FILE). Use --stop first."
        cat "$PID_FILE"
        exit 1
    fi
    # Stale PID file, clean up
    rm -f "$PID_FILE"
fi

echo "=== Socratic Arena Launcher (detached) ==="
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:5173"
echo "Agent:    $AGENT"
echo "Logs:     /tmp/arena_*.log"
echo "==========================================="

# Clear old logs
> /tmp/arena_backend.log
> /tmp/arena_frontend.log
> /tmp/arena_adapter.log

# Start backend (detached)
echo "[1/3] Starting backend..."
cd "$SCRIPT_DIR"
setsid nohup env ARENA_AGENT="$AGENT" python3 -m uvicorn main:app \
    --host 0.0.0.0 --port 8000 \
    >> /tmp/arena_backend.log 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID backend" >> "$PID_FILE"
sleep 2

# Verify backend started
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "ERROR: Backend failed to start. Check /tmp/arena_backend.log"
    exit 1
fi

# Start frontend (detached)
echo "[2/3] Starting frontend..."
cd "$FRONTEND_DIR"
setsid nohup npx vite --host 0.0.0.0 --port 5173 \
    >> /tmp/arena_frontend.log 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID frontend" >> "$PID_FILE"
sleep 1

# Start adapter (detached)
echo "[3/3] Starting arena adapter for $AGENT..."
cd "$SCRIPT_DIR"
setsid nohup python3 arena_adapter.py \
    --agent "$AGENT" --arena-url http://localhost:8000 \
    >> /tmp/arena_adapter.log 2>&1 &
ADAPTER_PID=$!
echo "$ADAPTER_PID adapter" >> "$PID_FILE"

echo ""
echo "All components running (detached from agent session)."
echo "  Backend PID:  $BACKEND_PID  (log: /tmp/arena_backend.log)"
echo "  Frontend PID: $FRONTEND_PID  (log: /tmp/arena_frontend.log)"
echo "  Adapter PID:  $ADAPTER_PID  (log: /tmp/arena_adapter.log)"
echo ""
echo "Stop with: $0 --stop"
