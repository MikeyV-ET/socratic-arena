"""Whiteboard storage — CRUD for Excalidraw-format drawings."""

import json
import time
import uuid
import logging
from pathlib import Path
from fastapi import APIRouter
from starlette.responses import JSONResponse

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/whiteboards", tags=["whiteboards"])

DATA_DIR = Path(__file__).parent / "data" / "whiteboards"
DATA_DIR.mkdir(parents=True, exist_ok=True)

def _meta_path(wb_id: str) -> Path:
    return DATA_DIR / f"{wb_id}.meta.json"

def _data_path(wb_id: str) -> Path:
    return DATA_DIR / f"{wb_id}.json"

def _read_meta(wb_id: str) -> dict | None:
    p = _meta_path(wb_id)
    if not p.exists():
        return None
    return json.loads(p.read_text())

def _list_all() -> list[dict]:
    metas = []
    for f in sorted(DATA_DIR.glob("*.meta.json")):
        try:
            metas.append(json.loads(f.read_text()))
        except Exception:
            pass
    metas.sort(key=lambda m: m.get("updated_at", 0), reverse=True)
    return metas


@router.get("")
async def list_whiteboards():
    return _list_all()


@router.post("")
async def create_whiteboard(body: dict):
    wb_id = str(uuid.uuid4())
    now = time.time()
    meta = {
        "id": wb_id,
        "title": body.get("title", "Untitled"),
        "created_at": now,
        "updated_at": now,
    }
    _meta_path(wb_id).write_text(json.dumps(meta))
    _data_path(wb_id).write_text(json.dumps({"elements": [], "appState": {}, "files": {}}))
    return meta


@router.get("/{wb_id}")
async def get_whiteboard(wb_id: str):
    meta = _read_meta(wb_id)
    if not meta:
        return JSONResponse({"error": "not found"}, status_code=404)
    dp = _data_path(wb_id)
    data = json.loads(dp.read_text()) if dp.exists() else {"elements": [], "appState": {}, "files": {}}
    return {**meta, **data}


@router.put("/{wb_id}")
async def update_whiteboard(wb_id: str, body: dict):
    meta = _read_meta(wb_id)
    if not meta:
        return JSONResponse({"error": "not found"}, status_code=404)
    meta["updated_at"] = time.time()
    _meta_path(wb_id).write_text(json.dumps(meta))
    # Merge incoming data
    dp = _data_path(wb_id)
    existing = json.loads(dp.read_text()) if dp.exists() else {}
    if "elements" in body:
        existing["elements"] = body["elements"]
    if "appState" in body:
        existing["appState"] = body["appState"]
    if "files" in body:
        existing["files"] = body["files"]
    dp.write_text(json.dumps(existing))
    return meta


@router.delete("/{wb_id}")
async def delete_whiteboard(wb_id: str):
    meta = _read_meta(wb_id)
    if not meta:
        return JSONResponse({"error": "not found"}, status_code=404)
    _meta_path(wb_id).unlink(missing_ok=True)
    _data_path(wb_id).unlink(missing_ok=True)
    return {"ok": True}


@router.post("/{wb_id}/elements")
async def add_elements(wb_id: str, body: dict):
    """Agent API: add elements to a whiteboard programmatically.

    Body: {"elements": [...excalidraw elements...]}
    Each element needs at minimum: type, x, y, width, height.
    Missing id/version fields are auto-filled.
    """
    meta = _read_meta(wb_id)
    if not meta:
        return JSONResponse({"error": "not found"}, status_code=404)
    dp = _data_path(wb_id)
    data = json.loads(dp.read_text()) if dp.exists() else {"elements": [], "appState": {}, "files": {}}
    new_elements = body.get("elements", [])
    for el in new_elements:
        if "id" not in el:
            el["id"] = str(uuid.uuid4())[:8]
        if "version" not in el:
            el["version"] = 1
        if "versionNonce" not in el:
            el["versionNonce"] = int(time.time() * 1000) % 2**31
        el.setdefault("isDeleted", False)
        el.setdefault("fillStyle", "solid")
        el.setdefault("strokeWidth", 2)
        el.setdefault("strokeStyle", "solid")
        el.setdefault("roughness", 1)
        el.setdefault("opacity", 100)
        el.setdefault("angle", 0)
        el.setdefault("strokeColor", "#1e1e1e")
        el.setdefault("backgroundColor", "transparent")
        el.setdefault("seed", int(time.time() * 1000) % 2**31)
        el.setdefault("groupIds", [])
        el.setdefault("boundElements", None)
        el.setdefault("updated", int(time.time() * 1000))
        el.setdefault("link", None)
        el.setdefault("locked", False)
    data["elements"].extend(new_elements)
    dp.write_text(json.dumps(data))
    meta["updated_at"] = time.time()
    _meta_path(wb_id).write_text(json.dumps(meta))
    return {"added": len(new_elements), "total": len(data["elements"])}