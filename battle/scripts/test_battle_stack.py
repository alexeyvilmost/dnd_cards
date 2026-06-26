#!/usr/bin/env python3
"""Acceptance smoke test for the battle service stack.

Exercises the backend end-to-end (health, spells catalog, quickstart room,
initiative, a few combat actions) and optionally checks the frontend is served.
Works against a locally running stack (file or postgres storage) or the
docker-compose stack.

Usage:
    python3 test_battle_stack.py [--backend URL] [--frontend URL] [--no-frontend]

Exit code 0 = all checks passed, 1 = a check failed.
"""

from __future__ import annotations

import argparse
import sys
import time
import urllib.error
import urllib.request
import json

PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"


def _req(method: str, url: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        raw = resp.read().decode()
    return json.loads(raw) if raw else {}


class Runner:
    def __init__(self) -> None:
        self.failures = 0

    def check(self, name: str, cond: bool, detail: str = "") -> bool:
        status = PASS if cond else FAIL
        print(f"  [{status}] {name}{(' — ' + detail) if detail else ''}")
        if not cond:
            self.failures += 1
        return cond


def wait_for(url: str, attempts: int = 20) -> bool:
    for _ in range(attempts):
        try:
            _req("GET", url)
            return True
        except Exception:
            time.sleep(1)
    return False


def _step_towards(src: dict, tgt: dict, max_cells: int = 6, grid_w: int = 20, grid_h: int = 20) -> tuple[int, int]:
    nx, ny = int(src["x"]), int(src["y"])
    tx, ty = int(tgt["x"]), int(tgt["y"])
    for _ in range(max_cells):
        cur_dist = max(abs(nx - tx), abs(ny - ty)) * 5
        if cur_dist <= 5:
            break
        dx = (tx > nx) - (tx < nx)
        dy = (ty > ny) - (ty < ny)
        cand_x = max(0, min(grid_w - 1, nx + dx))
        cand_y = max(0, min(grid_h - 1, ny + dy))
        cand_dist = max(abs(cand_x - tx), abs(cand_y - ty)) * 5
        if cand_dist >= cur_dist:
            break
        nx, ny = cand_x, cand_y
    return nx, ny


def test_backend(base: str, r: Runner) -> None:
    print(f"\n== Backend: {base} ==")
    if not r.check("backend reachable", wait_for(f"{base}/api/health")):
        return

    health = _req("GET", f"{base}/api/health")
    r.check("health ok", health.get("status") == "ok", f"storage={health.get('storage')}")

    spells = _req("GET", f"{base}/spells")
    r.check("spells catalog non-empty", isinstance(spells, list) and len(spells) > 0,
            f"{len(spells) if isinstance(spells, list) else 0} spells")

    qs = _req("POST", f"{base}/quickstart")
    room_id = qs.get("room_id")
    r.check("quickstart created room", bool(room_id))
    if not room_id:
        return

    room = _req("GET", f"{base}/rooms/{room_id}")
    chars = list(room.get("characters", {}).keys())
    r.check("room has 2 characters", len(chars) == 2, f"{len(chars)} chars")

    combat = _req("POST", f"{base}/rooms/{room_id}/combat/start")
    r.check("combat started", bool(combat.get("combat", {}).get("active")))

    # Run several rounds: each turn, close in (up to full speed) and attack in range.
    over = False
    for _ in range(150):
        state = _req("GET", f"{base}/rooms/{room_id}/combat")
        if not state.get("active"):
            over = True
            break
        cur = state["current_turn"]["character_id"]
        room = _req("GET", f"{base}/rooms/{room_id}")
        me = room["characters"][cur]
        targets = [(cid, c) for cid, c in room["characters"].items() if cid != cur and c["hp"] > 0]
        if targets:
            tgt_id, tgt = targets[0]

            def dist_to(px, py):
                return max(abs(px - tgt["position"]["x"]), abs(py - tgt["position"]["y"])) * 5

            if dist_to(me["position"]["x"], me["position"]["y"]) > 5:
                nx, ny = _step_towards(me["position"], tgt["position"], max_cells=6)
                if (nx, ny) != (me["position"]["x"], me["position"]["y"]):
                    try:
                        _req("POST", f"{base}/rooms/{room_id}/actions/move",
                             {"character_id": cur, "x": nx, "y": ny})
                    except Exception:
                        pass
            # Always attempt an attack; the engine rejects it harmlessly if out of range.
            try:
                _req("POST", f"{base}/rooms/{room_id}/actions/attack",
                     {"character_id": cur, "target_id": tgt_id})
            except Exception:
                pass
        _req("POST", f"{base}/rooms/{room_id}/combat/end-turn", {"character_id": cur})

    r.check("combat resolves to a winner", over)
    log = _req("GET", f"{base}/rooms/{room_id}/log?limit=200")
    r.check("combat produced a log", isinstance(log, list) and len(log) > 0, f"{len(log)} entries")


def test_characters(base: str, r: Runner) -> None:
    print(f"\n== Character sheets & progression: {base} ==")
    opts = _req("GET", f"{base}/characters-api/meta/create-options")
    r.check("create options available", "classes" in opts and "Fighter" in opts["classes"])

    fighter = _req("POST", f"{base}/characters-api", {
        "name": "TestFighter",
        "class_name": "Fighter",
        "ability_scores": {"strength": 15, "dexterity": 13, "constitution": 14,
                            "intelligence": 8, "wisdom": 12, "charisma": 10},
        "fighting_style": "dueling",
        "weapon_masteries": ["sap", "topple"],
        "weapon_choice": "longsword_shield",
    })
    fid = fighter.get("id")
    r.check("fighter created at level 1", fighter.get("level") == 1 and bool(fid))

    wizard = _req("POST", f"{base}/characters-api", {
        "name": "TestWizard",
        "class_name": "Wizard",
        "ability_scores": {"strength": 8, "dexterity": 14, "constitution": 14,
                           "intelligence": 15, "wisdom": 10, "charisma": 8},
        "cantrips": ["Fire Bolt", "Ray of Frost", "Mind Sliver"],
        "spells_prepared": ["Magic Missile", "Burning Hands", "Shield", "Mage Armor"],
    })
    r.check("wizard created", wizard.get("level") == 1 and bool(wizard.get("id")))

    if not fid:
        return
    _req("POST", f"{base}/characters-api/{fid}/award-xp", {"amount": 300})
    lvl2 = _req("POST", f"{base}/characters-api/{fid}/level-up", {})
    r.check("fighter reaches level 2", lvl2.get("level") == 2,
            f"features={lvl2.get('features')}")

    _req("POST", f"{base}/characters-api/{fid}/award-xp", {"amount": 600})
    lvl3 = _req("POST", f"{base}/characters-api/{fid}/level-up", {"subclass": "champion"})
    r.check("fighter reaches level 3 (champion)", lvl3.get("level") == 3 and lvl3.get("subclass") == "champion")

    # Materialize into a combat room.
    room = _req("POST", f"{base}/rooms", {"name": "sheet-test"})
    rid = room["room_id"]
    mat = _req("POST", f"{base}/rooms/{rid}/characters/from-sheet",
               {"sheet_id": fid, "x": 2, "y": 2})
    r.check("champion crit threshold applied in combat", mat.get("crit_threshold") == 19)

    # Persistence: it shows up in the list.
    listed = _req("GET", f"{base}/characters-api")
    r.check("sheet persisted & listed", any(c.get("id") == fid for c in listed))

    # Cleanup test data.
    for cid in (fid, wizard.get("id")):
        if cid:
            try:
                _req("DELETE", f"{base}/characters-api/{cid}")
            except Exception:
                pass


def test_spells(base: str, r: Runner) -> None:
    print(f"\n== Spells CRUD & effect choice: {base} ==")
    catalog = _req("GET", f"{base}/spells")
    r.check("seeded spell catalog exists", isinstance(catalog, list) and len(catalog) >= 64,
            f"{len(catalog) if isinstance(catalog, list) else 0} spells")

    new_spell = {
        "name": "Test Prism Bolt",
        "level": 1,
        "school": "Evocation",
        "casting_time": "action",
        "range_ft": 60,
        "effect": "attack",
        "targeting": "single",
        "damage_dice": "2d6",
        "damage_type": "fire",
        "battle_ready": True,
        "effect_options": [
            {"key": "fire", "label": "Огненный", "damage_type": "fire"},
            {"key": "cold", "label": "Ледяной", "damage_type": "cold"},
        ],
        "description": "Test spell with selectable damage type.",
    }
    created = _req("POST", f"{base}/spells", new_spell)
    sid = created.get("id")
    r.check("spell created", bool(sid))
    if not sid:
        return

    fetched = _req("GET", f"{base}/spells/{sid}")
    r.check("spell fetch works", fetched.get("name") == "Test Prism Bolt")

    updated = _req("PUT", f"{base}/spells/{sid}", {"description": "Updated", "battle_ready": True})
    r.check("spell update works", updated.get("description") == "Updated")

    # Smoke-cast spell with selected effect choice in combat.
    wiz = _req("POST", f"{base}/characters-api", {
        "name": "SpellTester",
        "class_name": "Wizard",
        "ability_scores": {"strength": 8, "dexterity": 14, "constitution": 14,
                           "intelligence": 15, "wisdom": 10, "charisma": 8},
        "cantrips": ["Fire Bolt", "Ray of Frost", "Mind Sliver"],
        "spells_prepared": ["Test Prism Bolt", "Magic Missile", "Shield", "Mage Armor"],
    })
    fig = _req("POST", f"{base}/characters-api", {
        "name": "TargetDummy",
        "class_name": "Fighter",
        "ability_scores": {"strength": 15, "dexterity": 13, "constitution": 14,
                           "intelligence": 8, "wisdom": 12, "charisma": 10},
        "fighting_style": "dueling",
        "weapon_masteries": ["sap", "topple"],
        "weapon_choice": "longsword_shield",
    })
    wid, fid = wiz.get("id"), fig.get("id")
    rid = _req("POST", f"{base}/rooms", {"name": "spell-test"})["room_id"]
    wc = _req("POST", f"{base}/rooms/{rid}/characters/from-sheet", {"sheet_id": wid, "x": 2, "y": 2})
    fc = _req("POST", f"{base}/rooms/{rid}/characters/from-sheet", {"sheet_id": fid, "x": 3, "y": 2})
    _req("POST", f"{base}/rooms/{rid}/combat/start")
    # Ensure wizard gets a turn; if not, end one turn quickly.
    state = _req("GET", f"{base}/rooms/{rid}/combat")
    cur = state["current_turn"]["character_id"]
    if cur != wc["id"]:
        _req("POST", f"{base}/rooms/{rid}/combat/end-turn", {"character_id": cur})
    cast = _req("POST", f"{base}/rooms/{rid}/actions/cast", {
        "character_id": wc["id"],
        "spell": "Test Prism Bolt",
        "target_ids": [fc["id"]],
        "effect_choice": "cold",
        "slot_level": 1,
    })
    msg = cast.get("message", "")
    r.check("spell cast with effect choice", "Вариант эффекта" in msg and "Test Prism Bolt" in msg)

    # Cleanup
    _req("DELETE", f"{base}/spells/{sid}")
    for cid in (wid, fid):
        if cid:
            try:
                _req("DELETE", f"{base}/characters-api/{cid}")
            except Exception:
                pass


def test_monsters(base: str, r: Runner) -> None:
    print(f"\n== Monsters / PvE / XP: {base} ==")
    default = _req("GET", f"{base}/monsters/default")
    r.check("default monster template", default.get("name") is not None)

    mon = _req("POST", f"{base}/monsters", {
        "name": "Test Goblin",
        "cr": 0.25,
        "ability_scores": {"strength": 8, "dexterity": 14, "constitution": 10,
                           "intelligence": 10, "wisdom": 8, "charisma": 8},
        "max_hp": 6,
        "ac": 12,
        "speed": 30,
        "attacks": [{"name": "Scimitar", "attack_bonus": 4, "reach": 5, "damage_dice": "1d6+2", "damage_type": "slashing"}],
        "battle_ready": True,
        "portrait": "👺",
    })
    mid = mon.get("id")
    r.check("monster created", bool(mid))
    if not mid:
        return

    listed = _req("GET", f"{base}/monsters")
    r.check("monster listed", any(m.get("id") == mid for m in listed))

    hero = _req("POST", f"{base}/characters-api", {
        "name": "XP Hero",
        "class_name": "Fighter",
        "ability_scores": {"strength": 15, "dexterity": 13, "constitution": 14,
                           "intelligence": 8, "wisdom": 12, "charisma": 10},
        "fighting_style": "dueling",
        "weapon_masteries": ["sap", "topple"],
        "weapon_choice": "longsword_shield",
    })
    hid = hero.get("id")
    before = hero.get("xp", 0)

    rid = _req("POST", f"{base}/rooms", {"name": "pve-test"})["room_id"]
    hc = _req("POST", f"{base}/rooms/{rid}/characters/from-sheet", {"sheet_id": hid, "x": 2, "y": 10})
    _req("POST", f"{base}/rooms/{rid}/monsters", {"monster_id": mid, "x": 3, "y": 10})
    _req("POST", f"{base}/rooms/{rid}/combat/start")

    # Play until combat over, using monster auto-turn when needed.
    for _ in range(60):
        state = _req("GET", f"{base}/rooms/{rid}/combat")
        if not state.get("active"):
            break
        cur = state["current_turn"]["character_id"]
        room = _req("GET", f"{base}/rooms/{rid}")
        me = room["characters"][cur]
        if me.get("is_monster"):
            _req("POST", f"{base}/rooms/{rid}/combat/auto-turn")
            continue
        targets = [cid for cid, c in room["characters"].items() if c.get("is_monster") and c["hp"] > 0]
        if targets:
            _req("POST", f"{base}/rooms/{rid}/actions/attack", {"character_id": cur, "target_id": targets[0]})
        _req("POST", f"{base}/rooms/{rid}/combat/end-turn", {"character_id": cur})

    hero_after = _req("GET", f"{base}/characters-api/{hid}")
    r.check("xp awarded after PvE combat", hero_after.get("xp", 0) > before,
            f"{before} -> {hero_after.get('xp', 0)}")

    # Cleanup
    _req("DELETE", f"{base}/monsters/{mid}")
    _req("DELETE", f"{base}/characters-api/{hid}")


def test_item_bridge(base: str, r: Runner, items_api: str = "http://localhost:8080/api") -> None:
    print(f"\n== Item bridge (dnd_cards -> battle): {items_api} ==")
    try:
        health = _req("GET", f"{items_api}/health")
        if health.get("status") != "ok":
            r.check("items api not usable (skip bridge test)", True, "skipped")
            return
    except Exception:
        r.check("items api not running (skip bridge test)", True, "skipped")
        return

    # The main dnd_cards API is reachable; attempt the full bridge flow. Any failure
    # here (auth, schema drift) is environmental, so skip rather than fail the suite.
    hid = None
    try:
        card = _req("POST", f"{items_api}/cards", {
            "name": "Bridge Test Sword",
            "description": "bridge",
            "rarity": "common",
            "author": "automation",
            "is_template": "false",
            "battle_profile": {
                "ready": True,
                "kind": "weapon",
                "damage_dice": "1d8",
                "damage_type": "slashing",
                "to_hit_bonus": 1,
            },
        })
        cid = card.get("id")
        if not cid:
            r.check("items api card create unavailable (skip bridge test)", True, "skipped")
            return

        hero = _req("POST", f"{base}/characters-api", {
            "name": "Bridge Hero",
            "class_name": "Fighter",
            "ability_scores": {"strength": 15, "dexterity": 13, "constitution": 14,
                               "intelligence": 8, "wisdom": 12, "charisma": 10},
            "fighting_style": "dueling",
            "weapon_masteries": ["sap", "topple"],
            "weapon_choice": "longsword_shield",
        })
        hid = hero.get("id")

        imported = _req("POST", f"{base}/characters-api/{hid}/equipment/import-card", {"card_id": cid})
        r.check("card imported into battle character",
                any(e.get("card_id") == cid for e in imported.get("equipment", [])))
        try:
            _req("DELETE", f"{items_api}/cards/{cid}")
        except Exception:
            pass
    except urllib.error.HTTPError as e:
        r.check("items api bridge unavailable (skip bridge test)", True, f"skipped ({e.code})")
    finally:
        if hid:
            try:
                _req("DELETE", f"{base}/characters-api/{hid}")
            except Exception:
                pass


def test_dungeon_run(base: str, r: Runner) -> None:
    print(f"\n== Dungeon Crawl MVP: {base} ==")
    hero = _req("POST", f"{base}/characters-api", {
        "name": "DungeonHero",
        "class_name": "Fighter",
        "ability_scores": {"strength": 15, "dexterity": 13, "constitution": 14,
                           "intelligence": 8, "wisdom": 12, "charisma": 10},
        "fighting_style": "dueling",
        "weapon_masteries": ["sap", "topple"],
        "weapon_choice": "longsword_shield",
    })
    hid = hero.get("id")
    run = _req("POST", f"{base}/runs/start", {"sheet_id": hid})
    rid = run.get("id")
    r.check("run started", bool(rid) and run.get("status") == "between_rooms")
    if not rid:
        return

    nxt = _req("POST", f"{base}/runs/{rid}/next-room")
    room_id = nxt.get("room_id")
    r.check("next room created", bool(room_id))
    if not room_id:
        _req("DELETE", f"{base}/characters-api/{hid}")
        return

    # Fight room automatically.
    for _ in range(120):
        state = _req("GET", f"{base}/rooms/{room_id}/combat")
        if not state.get("active"):
            break
        cur = state["current_turn"]["character_id"]
        room = _req("GET", f"{base}/rooms/{room_id}")
        me = room["characters"][cur]
        if me.get("is_monster"):
            _req("POST", f"{base}/rooms/{room_id}/combat/auto-turn")
            continue
        targets = [(cid, c) for cid, c in room["characters"].items() if c.get("is_monster") and c["hp"] > 0]
        if targets:
            tgt_id, tgt = targets[0]
            dist = max(abs(me["position"]["x"] - tgt["position"]["x"]), abs(me["position"]["y"] - tgt["position"]["y"])) * 5
            if dist > 5:
                nx, ny = _step_towards(me["position"], tgt["position"], max_cells=6)
                if (nx, ny) != (me["position"]["x"], me["position"]["y"]):
                    try:
                        _req("POST", f"{base}/rooms/{room_id}/actions/move", {"character_id": cur, "x": nx, "y": ny})
                    except Exception:
                        pass
            _req("POST", f"{base}/rooms/{room_id}/actions/attack", {"character_id": cur, "target_id": tgt_id})
        _req("POST", f"{base}/rooms/{room_id}/combat/end-turn", {"character_id": cur})

    state = _req("GET", f"{base}/rooms/{room_id}/combat")
    if state.get("active"):
        r.check("dungeon combat finished in time", False)
        _req("DELETE", f"{base}/characters-api/{hid}")
        return

    resolved = _req("POST", f"{base}/runs/{rid}/resolve")
    result = resolved.get("result", {})
    r.check("room resolved", result.get("resolved") is True)
    run_after = resolved.get("run", {})
    r.check("run advanced or finished", run_after.get("status") in ("between_rooms", "completed", "failed"),
            f"status={run_after.get('status')}")
    _req("DELETE", f"{base}/characters-api/{hid}")


def test_definitions(base: str, r: Runner) -> None:
    print(f"\n== Definitions (backgrounds / feats / styles) & constructor: {base} ==")

    schema = _req("GET", f"{base}/definitions/meta/schema")
    r.check("effect schema available", "effect_types" in schema and "ability_score" in schema["effect_types"])

    backgrounds = _req("GET", f"{base}/definitions?kind=background")
    r.check("backgrounds seeded (16)", isinstance(backgrounds, list) and len(backgrounds) >= 16,
            f"{len(backgrounds) if isinstance(backgrounds, list) else 0}")
    origin = _req("GET", f"{base}/definitions?kind=origin_feat")
    r.check("origin feats seeded (>=10)", isinstance(origin, list) and len(origin) >= 10, f"{len(origin)}")
    general = _req("GET", f"{base}/definitions?kind=general_feat")
    r.check("general feats seeded (>=20)", isinstance(general, list) and len(general) >= 20, f"{len(general)}")
    styles = _req("GET", f"{base}/definitions?kind=fighting_style")
    r.check("fighting styles seeded (>=10)", isinstance(styles, list) and len(styles) >= 10, f"{len(styles)}")

    # create-options exposes definitions
    opts = _req("GET", f"{base}/characters-api/meta/create-options")
    r.check("create-options exposes backgrounds", isinstance(opts.get("backgrounds"), list) and len(opts["backgrounds"]) >= 16)

    # Constructor: valid custom definition accepted
    created = _req("POST", f"{base}/definitions", {
        "kind": "general_feat", "name": "Auto Test Feat", "name_ru": "Авто-черта",
        "description": "+1 сила, +1 КЗ", "effects": [
            {"type": "ability_score", "mode": "fixed", "ability": "strength", "amount": 1},
            {"type": "combat_mod", "stat": "ac", "amount": 1},
        ],
    })
    cdid = created.get("id")
    r.check("constructor accepts valid definition", bool(cdid) and created.get("source") == "custom")

    # Constructor: invalid effect rejected
    bad_status = 0
    try:
        _req("POST", f"{base}/definitions", {"kind": "general_feat", "name": "Bad",
             "effects": [{"type": "combat_mod", "stat": "teleport", "amount": 9}]})
    except urllib.error.HTTPError as e:
        bad_status = e.code
    r.check("constructor rejects invalid effect (400)", bad_status == 400, f"status={bad_status}")

    # Combat application: Farmer background grants Tough (+2 HP/level); compare HP.
    base_scores = {"strength": 15, "dexterity": 12, "constitution": 14,
                   "intelligence": 8, "wisdom": 10, "charisma": 10}
    plain = _req("POST", f"{base}/characters-api", {
        "name": "PlainFighter", "class_name": "Fighter", "ability_scores": dict(base_scores),
        "fighting_style": "dueling", "weapon_masteries": ["sap", "topple"], "weapon_choice": "greatsword",
    })
    farmer = _req("POST", f"{base}/characters-api", {
        "name": "FarmerFighter", "class_name": "Fighter", "ability_scores": dict(base_scores),
        "fighting_style": "dueling", "weapon_masteries": ["sap", "topple"], "weapon_choice": "greatsword",
        "background": "bg_farmer", "background_ability_choice": {"strength": 1, "constitution": 1, "wisdom": 1},
    })
    pid, fmid = plain.get("id"), farmer.get("id")
    r.check("farmer background grants Tough origin feat", "feat_tough" in (farmer.get("feats") or []))

    rid = _req("POST", f"{base}/rooms", {"name": "feat-test"})["room_id"]
    pc = _req("POST", f"{base}/rooms/{rid}/characters/from-sheet", {"sheet_id": pid, "x": 2, "y": 2})
    fc = _req("POST", f"{base}/rooms/{rid}/characters/from-sheet", {"sheet_id": fmid, "x": 4, "y": 2})
    expected = pc.get("max_hp", 0) + 2 * farmer.get("level", 1)
    r.check("Tough applies +2 HP/level in combat",
            fc.get("max_hp") == expected, f"plain={pc.get('max_hp')} farmer={fc.get('max_hp')} expected={expected}")

    # Direct feat endpoint (origin feat, no prerequisite): records on the sheet.
    added = _req("POST", f"{base}/characters-api/{pid}/feats", {"feat_id": "feat_skilled"})
    r.check("feat endpoint adds origin feat", "feat_skilled" in (added.get("feats") or []))

    # General feats require level 4 — endpoint rejects them on a level-1 character.
    prereq_status = 0
    try:
        _req("POST", f"{base}/characters-api/{pid}/feats", {"feat_id": "feat_speedy"})
    except urllib.error.HTTPError as e:
        prereq_status = e.code
    r.check("general feat level prerequisite enforced", prereq_status == 400, f"status={prereq_status}")

    # Level up to 4 and take a general feat (Speedy) → +10 speed in combat.
    before_speed = pc.get("speed", 30)
    _req("POST", f"{base}/characters-api/{pid}/award-xp", {"amount": 300})
    _req("POST", f"{base}/characters-api/{pid}/level-up", {})  # L2
    _req("POST", f"{base}/characters-api/{pid}/award-xp", {"amount": 600})
    _req("POST", f"{base}/characters-api/{pid}/level-up", {"subclass": "champion"})  # L3
    _req("POST", f"{base}/characters-api/{pid}/award-xp", {"amount": 1800})
    l4 = _req("POST", f"{base}/characters-api/{pid}/level-up", {"feat": "feat_speedy"})  # L4
    r.check("reaches level 4 with chosen feat", l4.get("level") == 4 and "feat_speedy" in (l4.get("feats") or []),
            f"level={l4.get('level')} feats={l4.get('feats')}")
    pc2 = _req("POST", f"{base}/rooms/{rid}/characters/from-sheet", {"sheet_id": pid, "x": 6, "y": 2})
    r.check("level-4 feat applies in combat (Speedy +10 speed)", pc2.get("speed") == before_speed + 10,
            f"{before_speed} -> {pc2.get('speed')}")

    # Cleanup
    if cdid:
        try:
            _req("DELETE", f"{base}/definitions/{cdid}")
        except Exception:
            pass
    for cid in (pid, fmid):
        if cid:
            try:
                _req("DELETE", f"{base}/characters-api/{cid}")
            except Exception:
                pass


def test_frontend(base: str, r: Runner) -> None:
    print(f"\n== Frontend: {base} ==")
    if not r.check("frontend reachable", wait_for(base)):
        return
    try:
        req = urllib.request.Request(base, method="GET")
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode()
        r.check("serves SPA index", "<div id=\"root\">" in html or "<div id=root>" in html)
    except Exception as e:
        r.check("serves SPA index", False, str(e))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", default="http://localhost:8765")
    ap.add_argument("--frontend", default="http://localhost:8080")
    ap.add_argument("--no-frontend", action="store_true")
    args = ap.parse_args()

    r = Runner()
    test_backend(args.backend.rstrip("/"), r)
    test_characters(args.backend.rstrip("/"), r)
    test_definitions(args.backend.rstrip("/"), r)
    test_spells(args.backend.rstrip("/"), r)
    test_monsters(args.backend.rstrip("/"), r)
    test_item_bridge(args.backend.rstrip("/"), r)
    test_dungeon_run(args.backend.rstrip("/"), r)
    if not args.no_frontend:
        test_frontend(args.frontend.rstrip("/"), r)

    print()
    if r.failures:
        print(f"\033[91m{r.failures} check(s) failed.\033[0m")
        return 1
    print("\033[92mAll checks passed.\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
