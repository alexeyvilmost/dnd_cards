#!/usr/bin/env python3
"""Local destructive-on-clone HTTP acceptance test for the roguelike run API."""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid


BASE_URL = os.environ.get("ROGUELIKE_E2E_URL", "http://127.0.0.1:18081/api").rstrip("/")
DB_NAME = os.environ.get("ROGUELIKE_E2E_DB", "")
DB_CONTAINER = os.environ.get("ROGUELIKE_E2E_DB_CONTAINER", "dnd_cards_db_level3_local")
SOURCE_CHARACTER_ID = os.environ.get(
    "ROGUELIKE_E2E_SOURCE_CHARACTER",
    "3467070b-eb46-461c-85f9-3211373052db",
)


def api(method: str, path: str, body=None, token: str | None = None, headers=None, expected=200):
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    raw = None if body is None else json.dumps(body, separators=(",", ":")).encode()
    request = urllib.request.Request(f"{BASE_URL}{path}", data=raw, headers=request_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            status = response.status
            payload = json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        status = error.code
        payload = json.loads(error.read() or b"{}")
    if status != expected:
        raise AssertionError(f"{method} {path}: expected {expected}, got {status}: {payload}")
    return payload


def sql(statement: str) -> str:
    if not DB_NAME:
        raise RuntimeError("ROGUELIKE_E2E_DB must name the disposable cloned database")
    result = subprocess.run(
        ["docker", "exec", DB_CONTAINER, "psql", "-U", "postgres", "-d", DB_NAME, "-At", "-c", statement],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.stdout.strip()


def count_item(character: dict, card_id: str) -> int:
    return sum(int(row.get("qty", 0)) for row in character.get("inventory_items") or [] if row.get("card_id") == card_id)


def main() -> None:
    suffix = f"{int(time.time())}{uuid.uuid4().hex[:5]}"
    username = f"roguee2e{suffix}"
    password = "RogueE2E!2026"
    api("POST", "/auth/register", {
        "username": username,
        "email": f"{username}@example.invalid",
        "password": password,
        "display_name": "Roguelike E2E",
    }, expected=201)
    login = api("POST", "/auth/login", {"username": username, "password": password})
    token, user_id = login["token"], login["user"]["id"]
    sql(
        f"UPDATE characters_v3 SET user_id='{user_id}',current_hp=GREATEST(1,max_hp-1),"
        f"resources='{{\"action\":0}}'::jsonb,"
        f"active_effects='[{{\"id\":\"e2e-transient\",\"name\":\"Transient\"}}]'::jsonb,"
        f"turn_state='{{\"solo_combat_v1\":{{\"outcome\":\"defeat\"}},\"temp_hp\":5}}'::jsonb "
        f"WHERE id='{SOURCE_CHARACTER_ID}'"
    )

    created = api("POST", "/roguelike/runs", {"source_character_id": SOURCE_CHARACTER_ID}, token, expected=201)["run"]
    run_id, character_id = created["id"], created["character_id"]
    assert created["status"] == "active" and created["phase"] == "camp"
    assert created["supplies"] == 1 and created["character"]["character_type"] == "dungeon_crawl"
    assert created["character"]["current_hp"] == created["character"]["max_hp"]
    assert created["character"]["resources"] == created["character"]["max_resources"]
    assert not (created["character"].get("active_effects") or [])
    assert not (created["character"].get("turn_state") or {})
    assert len(created["shop"]["offers"]) == 5 and len(created["shop"]["staples"]) == 4
    numbers = {offer["card_number"] for offer in created["shop"]["offers"]}
    consumables = {"CARD-0791", "CARD-0815", "CARD-0714", "CARD-0840"}
    assert numbers & consumables, f"shelf lacks consumable: {numbers}"
    assert numbers - consumables, f"shelf lacks equipment: {numbers}"
    assert any(row["qty"] >= 1 for row in created["character"]["inventory_items"])
    listed = api("GET", "/roguelike/runs", token=token)["runs"]
    assert any(candidate["id"] == run_id for candidate in listed)

    sql(
        f"UPDATE roguelike_runs SET gold=500 WHERE id='{run_id}'; "
        f"UPDATE characters_v3 SET currency=jsonb_set(COALESCE(currency,'{{}}'::jsonb), '{{gold}}', '500'::jsonb, true) "
        f"WHERE id='{character_id}'"
    )
    run = api("GET", f"/roguelike/runs/{run_id}", token=token)["run"]

    stale = {
        "command_id": str(uuid.uuid4()), "expected_revision": run["revision"] + 10,
        "type": "pin", "payload": {"offer_id": run["shop"]["offers"][0]["id"]},
    }
    conflict = api("POST", f"/roguelike/runs/{run_id}/commands", stale, token, expected=409)
    assert conflict["code"] == "run_revision_conflict"

    pinned = run["shop"]["offers"][0]
    pin_command_id = str(uuid.uuid4())
    pin_body = {
        "command_id": pin_command_id, "expected_revision": run["revision"],
        "type": "pin", "payload": {"offer_id": pinned["id"]},
    }
    first_pin = api("POST", f"/roguelike/runs/{run_id}/commands", pin_body, token)["run"]
    replayed_pin = api("POST", f"/roguelike/runs/{run_id}/commands", pin_body, token)["run"]
    assert replayed_pin["revision"] == first_pin["revision"] and replayed_pin["gold"] == first_pin["gold"]
    changed_replay = {**pin_body, "payload": {"offer_id": "different"}}
    reuse = api("POST", f"/roguelike/runs/{run_id}/commands", changed_replay, token, expected=409)
    assert reuse["code"] == "command_id_reused"
    run = first_pin

    def command(command_type: str, payload=None):
        nonlocal run
        response = api("POST", f"/roguelike/runs/{run_id}/commands", {
            "command_id": str(uuid.uuid4()), "expected_revision": run["revision"],
            "type": command_type, "payload": payload or {},
        }, token)
        run = response["run"]
        return run

    command("refresh_shop")
    assert run["paid_refresh_count"] == 1
    assert run["shop"]["pinned_offer_id"] == pinned["id"]
    assert any(offer["id"] == pinned["id"] and offer["pinned"] for offer in run["shop"]["offers"])
    command("buy", {"offer_id": "staple:supplies"})
    potion_offer = next(offer for offer in run["shop"]["staples"] if offer.get("card_number") == "CARD-0839")
    command("buy", {"offer_id": potion_offer["id"]})
    assert run["supplies"] == 2 and count_item(run["character"], potion_offer["card_id"]) >= 2

    unauthorized = api("PATCH", f"/characters-v3/{character_id}/runtime", {
        "current_hp": min(run["character"]["max_hp"], run["character"]["current_hp"] + 1),
    }, token, expected=409)
    assert unauthorized["code"] == "roguelike_authority_required"

    equipment = dict(run["character"].get("equipment") or {})
    occupied = next(((slot, card_id) for slot, card_id in equipment.items() if card_id), None)
    if occupied:
        slot, card_id = occupied
        equipment[slot] = None
        for candidate_slot, candidate_id in list(equipment.items()):
            if candidate_slot != slot and candidate_id == card_id and {slot, candidate_slot} <= {"main_hand", "off_hand"}:
                equipment[candidate_slot] = None
        inventory = [dict(row) for row in run["character"].get("inventory_items") or []]
        row = next((item for item in inventory if item["card_id"] == card_id and not item.get("container_id")), None)
        if row:
            row["qty"] += 1
        else:
            inventory.append({"card_id": card_id, "qty": 1})
        patched = api("PATCH", f"/characters-v3/{character_id}/runtime", {
            "expected_runtime_revision": run["character"]["runtime_revision"],
            "current_hp": run["character"]["current_hp"], "max_hp": run["character"]["max_hp"],
            "equipment": equipment, "inventory_items": inventory,
        }, token, headers={"X-Roguelike-Run-ID": run_id, "X-Roguelike-Intent": "camp"})
        assert patched["equipment"][slot] is None
        run = api("GET", f"/roguelike/runs/{run_id}", token=token)["run"]

    current_hp = max(1, run["character"]["max_hp"] - 5)
    sql(f"UPDATE characters_v3 SET current_hp={current_hp} WHERE id='{character_id}'")
    run = api("GET", f"/roguelike/runs/{run_id}", token=token)["run"]
    rested_resources = dict(run["character"]["max_resources"])
    rested_resources["action_surge_action"] = 0
    rested_resources["quickened_spell_action"] = 0
    command("long_rest", {"runtime": {
        "current_hp": run["character"]["max_hp"],
        "resources": rested_resources,
        "active_effects": run["character"].get("active_effects") or [],
        "turn_state": run["character"].get("turn_state") or {},
    }})
    assert run["supplies"] == 1 and run["character"]["current_hp"] == run["character"]["max_hp"]
    before_clock = run["game_clock_hours"]
    command("short_rest", {"runtime": {
        "current_hp": run["character"]["current_hp"],
        "resources": run["character"]["resources"],
        "active_effects": run["character"].get("active_effects") or [],
        "turn_state": run["character"].get("turn_state") or {},
    }, "hit_die_rolls": []})
    assert run["game_clock_hours"] == before_clock + 1

    sql(f"UPDATE characters_v3 SET current_hp=GREATEST(1,max_hp-6) WHERE id='{character_id}'")
    run = api("GET", f"/roguelike/runs/{run_id}", token=token)["run"]
    potion_before = count_item(run["character"], potion_offer["card_id"])
    hp_before = run["character"]["current_hp"]
    command("use_item", {"card_id": potion_offer["card_id"]})
    assert count_item(run["character"], potion_offer["card_id"]) == potion_before - 1
    assert run["character"]["current_hp"] > hp_before

    command("start_encounter")
    assert run["phase"] == "combat" and run["encounter"]["xp_total"] > 0
    sql(
        f"UPDATE characters_v3 SET turn_state=jsonb_set(COALESCE(turn_state,'{{}}'::jsonb), "
        f"'{{solo_combat_v1}}', '{{\"outcome\":\"victory\"}}'::jsonb, true) WHERE id='{character_id}'"
    )
    command("complete_encounter")
    assert run["phase"] == "camp" and run["encounters_won"] == 1 and run["experience"] > 0
    assert run["shop"]["pinned_offer_id"] == pinned["id"]

    sql(f"UPDATE roguelike_runs SET experience=300 WHERE id='{run_id}'")
    run = api("GET", f"/roguelike/runs/{run_id}", token=token)["run"]
    character = dict(run["character"])
    character["level"] = 2
    class_levels = dict(character.get("class_levels") or {})
    class_levels[character["class_id"]] = 2
    character["class_levels"] = class_levels
    upgraded = api("PUT", f"/characters-v3/{character_id}", character, token, headers={
        "X-Roguelike-Run-ID": run_id, "X-Roguelike-Intent": "level_up",
    })
    run = api("GET", f"/roguelike/runs/{run_id}", token=token)["run"]
    assert run["pending_level"] == 2 and upgraded["level"] == 2
    api("PATCH", f"/characters-v3/{character_id}/runtime", {
        "expected_runtime_revision": upgraded["runtime_revision"],
    }, token, headers={"X-Roguelike-Run-ID": run_id, "X-Roguelike-Intent": "level_up"})
    command("confirm_level_up")
    assert not run.get("pending_level") and run["character"]["level"] == 2

    command("start_encounter")
    sql(
        f"UPDATE characters_v3 SET turn_state=jsonb_set(COALESCE(turn_state,'{{}}'::jsonb), "
        f"'{{solo_combat_v1}}', '{{\"outcome\":\"defeat\"}}'::jsonb, true) WHERE id='{character_id}'"
    )
    command("complete_encounter")
    assert run["status"] == "defeat" and run["phase"] == "ended"
    command("retry")
    assert run["status"] == "active" and run["phase"] == "camp" and run["attempt"] == 2
    assert run["experience"] == 300 and run["character"]["level"] == 2

    sql(
        f"UPDATE roguelike_runs SET experience=14000,pending_level=0,status='active',phase='camp' WHERE id='{run_id}'; "
        f"UPDATE characters_v3 SET level=5,class_levels=jsonb_set(COALESCE(class_levels,'{{}}'::jsonb), "
        f"ARRAY[class_id::text], '5'::jsonb, true) WHERE id='{character_id}'"
    )
    run = api("GET", f"/roguelike/runs/{run_id}", token=token)["run"]
    command("victory")
    assert run["status"] == "victory" and run["phase"] == "ended"

    print(json.dumps({
        "status": "PASS", "run_id": run_id, "character_id": character_id,
        "final_revision": run["revision"], "attempts": run["attempt"],
        "checks": [
            "create/list/get", "shelf categories", "revision conflict", "idempotent receipt",
            "receipt payload mismatch", "pin/paid/free refresh", "staples", "camp guard/equipment",
            "long/short rest", "potion", "victory reward", "level-up confirmation",
            "defeat/checkpoint retry", "claim victory",
        ],
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
