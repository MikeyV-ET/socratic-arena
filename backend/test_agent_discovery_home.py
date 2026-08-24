"""Nested agents.json homes must appear in SA discovery (Squiggy/Lenny)."""
import json
import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND))


@pytest.fixture
def catalog_env(tmp_path, monkeypatch):
    agents_home = tmp_path / "agents"
    agents_home.mkdir()
    # flat stub that would fool old discovery if AGENTS.md present without real home
    stub = agents_home / "Squiggy"
    (stub / "asdaaas").mkdir(parents=True)
    # real nested home
    nested = tmp_path / "LeviSmith" / "Squiggy"
    (nested / "asdaaas").mkdir(parents=True)
    (nested / "AGENTS.md").write_text("# Squiggy\n")
    (nested / "asdaaas" / "health.json").write_text(json.dumps({
        "status": "active", "totalTokens": 1000, "contextWindow": 500000,
    }))
    cat = {
        "agents": {
            "Squiggy": {"home": str(nested), "session": "sess-nested"},
            "FlatOnly": {"home": str(agents_home / "FlatOnly")},
        }
    }
    # FlatOnly incomplete — no asdaaas
    cfg_path = tmp_path / "agents.json"
    cfg_path.write_text(json.dumps(cat))

    monkeypatch.setenv("SA_AGENTS_HOME", str(agents_home))
    monkeypatch.setenv("SA_AGENTS_JSON", str(cfg_path))
    # reload config module
    for mod in list(sys.modules):
        if mod in ("config", "main") or mod.startswith("config"):
            del sys.modules[mod]
    import config as cfg
    import importlib
    importlib.reload(cfg)
    return {"cfg": cfg, "nested": nested, "stub": stub, "agents_home": agents_home}


def test_catalog_home_nested(catalog_env):
    cfg = catalog_env["cfg"]
    assert cfg.catalog_agent_home("Squiggy") == catalog_env["nested"]
    cat = cfg.load_agents_catalog()
    assert "Squiggy" in cat


def test_resolve_prefers_catalog_over_stub(catalog_env, monkeypatch):
    cfg = catalog_env["cfg"]
    # Import main helpers with patched config
    import importlib
    import main as main_mod
    # main already imported config at load — force rebind
    main_mod.AGENTS_HOME = cfg.AGENTS_HOME
    main_mod.load_agents_catalog = cfg.load_agents_catalog
    main_mod.catalog_agent_home = cfg.catalog_agent_home
    main_mod.EXTRA_AGENT_DIRS = []
    resolved = main_mod._resolve_agent_dir("Squiggy")
    assert resolved == catalog_env["nested"]
    assert resolved != catalog_env["stub"]


def test_listable_nested_not_stub(catalog_env):
    import main as main_mod
    assert main_mod._agent_dir_is_listable(catalog_env["nested"]) is True
    assert main_mod._agent_dir_is_listable(catalog_env["stub"]) is False
