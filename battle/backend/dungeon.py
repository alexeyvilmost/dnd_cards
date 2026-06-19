"""Dungeon Crawl MVP orchestration."""

from __future__ import annotations

import random
from typing import Any, Dict, List

import item_bridge
import monsters
import monsters_repo
import progression
import store
from models import Position, Room

MAX_DEPTH = 3


def new_run(sheet: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "owner": sheet.get("owner"),
        "sheet_id": sheet["id"],
        "sheet_name": sheet["name"],
        "status": "between_rooms",  # between_rooms | in_combat | completed | failed
        "depth": 1,
        "max_depth": MAX_DEPTH,
        "gold": int(sheet.get("gold", 0)),
        "xp_total": 0,
        "current_room_id": None,
        "room_start_xp": int(sheet.get("xp", 0)),
        "last_result": None,
        "shop_offers": [],
    }


def build_shop_offers(limit: int = 3) -> List[Dict[str, Any]]:
    """Try to fetch real items from dnd_cards API; fallback to empty list."""
    import requests

    try:
        r = requests.get(f"{item_bridge.ITEMS_API_BASE.rstrip('/')}/cards?limit=30", timeout=8)
        if r.status_code >= 400:
            return []
        cards = r.json().get("cards", [])
        offers = []
        for c in cards:
            # Prefer cards that already have battle_profile.
            bp = c.get("battle_profile") or {}
            if bp and bp.get("ready", True):
                offers.append(
                    {
                        "offer_id": c["id"],
                        "card_id": c["id"],
                        "name": c.get("name", "Item"),
                        "cost": _price_to_gold(c.get("price")),
                    }
                )
            if len(offers) >= limit:
                break
        return offers[:limit]
    except Exception:
        return []


def _price_to_gold(price: Any) -> int:
    try:
        n = int(price)
        return max(10, min(500, n))
    except Exception:
        return 50


def create_next_room(run: Dict[str, Any], sheet: Dict[str, Any]) -> Room:
    room = Room(name=f"Dungeon depth {run['depth']}")
    hero = progression.build_combat_character(sheet, position=Position(x=2, y=10), team="party")
    room.characters[hero.id] = hero

    depth = int(run["depth"])
    enemy_count = min(1 + depth // 2, 3)
    base_monsters = monsters_repo.monsters.list()
    if not base_monsters:
        base_monsters = [monsters.default_monster_doc()]

    for i in range(enemy_count):
        src = random.choice(base_monsters)
        mon = dict(src)
        mon["name"] = f"{src.get('name', 'Monster')} #{i+1}"
        # Scale HP a bit by depth for progression.
        mon["max_hp"] = int(mon.get("max_hp", 6)) + (depth - 1) * 4
        mon["xp"] = int(mon.get("xp") or monsters.xp_for_cr(float(mon.get("cr", 0)))) + (depth - 1) * 25
        c = monsters.to_combat_character(mon, position=Position(x=16 - i, y=9 + i))
        room.characters[c.id] = c

    store.save_room(room)
    return room


def resolve_room(run: Dict[str, Any], room: Room, xp_before: int, xp_after: int) -> Dict[str, Any]:
    party_alive = [c for c in room.characters.values() if not c.is_monster and c.is_conscious()]
    monsters_alive = [c for c in room.characters.values() if c.is_monster and c.is_conscious()]
    if monsters_alive:
        return {"resolved": False, "reason": "combat_not_over"}

    if not party_alive:
        run["status"] = "failed"
        run["last_result"] = {"outcome": "defeat"}
        return {"resolved": True, "outcome": "defeat"}

    gained = max(0, int(xp_after) - int(xp_before))
    reward_gold = 20 * int(run["depth"])
    run["gold"] = int(run.get("gold", 0)) + reward_gold
    run["xp_total"] = int(run.get("xp_total", 0)) + gained
    run["last_result"] = {"outcome": "victory", "xp_gained": gained, "gold_gained": reward_gold}

    run["depth"] = int(run["depth"]) + 1
    run["current_room_id"] = None
    if run["depth"] > int(run.get("max_depth", MAX_DEPTH)):
        run["status"] = "completed"
    else:
        run["status"] = "between_rooms"
        run["shop_offers"] = build_shop_offers()
    return {"resolved": True, "outcome": "victory", "xp_gained": gained, "gold_gained": reward_gold}

