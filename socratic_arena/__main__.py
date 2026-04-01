"""Entry point: python -m socratic_arena"""

import argparse
import uvicorn


def main():
    parser = argparse.ArgumentParser(description="Socratic Arena")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind to")
    parser.add_argument("--reload", action="store_true", help="Enable auto-reload")
    parser.add_argument(
        "--db",
        default=None,
        help="SQLite database path (default: ~/.socratic_arena/arena.db)",
    )
    args = parser.parse_args()

    if args.db:
        import os
        os.environ["SOCRATIC_ARENA_DB"] = args.db

    uvicorn.run(
        "socratic_arena.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


if __name__ == "__main__":
    main()