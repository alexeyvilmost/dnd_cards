import os
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_STATIC_DIR = os.path.join(_BASE_DIR, "static")

# Optional: load a local battle/.env for development (real env, e.g. Railway's
# injected DATABASE_URL, always takes precedence and is never overridden).
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(_BASE_DIR, ".env"), override=False)
except Exception:
    pass


def _static(path: str) -> str:
    """Absolute path inside the static folder (independent of cwd)."""
    return os.path.join(_STATIC_DIR, path)

import char_storage
import engine
import spells as spellbook
import store
from models import EventLog, Position, Room

app = FastAPI(title="D&D 2024 Combat Engine", version="0.1.0-mvp")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static assets (JS data, spell icons, …) under /static/*
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _room_or_404(room_id: str) -> Room:
    room = store.get_room(room_id)
    if not room:
        raise HTTPException(404, f"Room '{room_id}' not found.")
    return room


def _require_active_combat(room: Room) -> None:
    if not room.combat.active:
        raise HTTPException(400, "No combat in progress. POST /rooms/{id}/combat/start first.")


def _require_turn(room: Room, char_id: str) -> None:
    _require_active_combat(room)
    char = room.characters.get(char_id)
    if not char:
        raise HTTPException(404, f"Character '{char_id}' not found.")
    current = room.combat.current_character_id()
    if current != char_id:
        current_name = room.characters[current].name if current else "unknown"
        raise HTTPException(400, f"It's {current_name}'s turn, not {char.name}'s.")


def _log(room: Room, char_name: str, message: str, rolls: Dict = {}) -> None:
    room.log.append(
        EventLog(round=room.combat.round, turn_char=char_name, message=message, rolls=rolls)
    )


# ─── Request models ───────────────────────────────────────────────────────────


class CreateRoomRequest(BaseModel):
    name: str = "Battle Room"


class AddCharacterRequest(BaseModel):
    name: str
    class_name: str = "Fighter"          # "Fighter" | "Wizard"
    level: int = 1                        # 1–4
    preset: str = "longsword_shield"     # Fighter weapon: "longsword_shield" | "greatsword"
    x: int = 0
    y: int = 0
    ability_scores: Optional[Dict[str, int]] = None
    cantrips: Optional[List[str]] = None
    spells: Optional[List[str]] = None
    background: Optional[str] = None
    portrait: Optional[str] = None


class SavedCharacterRequest(BaseModel):
    """Template persisted to disk for reuse across battles."""
    id: Optional[str] = None
    name: str
    class_name: str = "Fighter"
    race: Optional[str] = None
    level: int = 1
    preset: str = "longsword_shield"
    ability_scores: Optional[Dict[str, int]] = None
    cantrips: Optional[List[str]] = None
    spells: Optional[List[str]] = None
    background: Optional[str] = None
    portrait: Optional[str] = None
    skill_proficiencies: Optional[List[str]] = None
    notes: Optional[str] = None


class AddFromSavedRequest(BaseModel):
    saved_id: str
    x: int = 0
    y: int = 0


class CastSpellRequest(BaseModel):
    character_id: str
    spell: str
    target_ids: List[str] = []
    slot_level: Optional[int] = None
    point: Optional[Dict[str, int]] = None  # {"x":..,"y":..} for area/teleport


class CharacterRequest(BaseModel):
    character_id: str


class TargetRequest(BaseModel):
    character_id: str
    target_id: str


class MoveRequest(BaseModel):
    character_id: str
    x: int
    y: int


class ReadyRequest(BaseModel):
    character_id: str
    trigger: str
    action_type: str
    target_id: Optional[str] = None
    params: Dict[str, Any] = {}


class ShoveRequest(BaseModel):
    character_id: str
    target_id: str
    mode: str = "prone"  # "prone" | "push"


# ─── Room endpoints ───────────────────────────────────────────────────────────


@app.get("/", include_in_schema=False)
def serve_ui():
    return FileResponse(_static("index.html"))


@app.get("/characters", include_in_schema=False)
def serve_catalog():
    """Character catalog + detailed character sheet (separate from the battle UI)."""
    return FileResponse(_static("characters.html"))


@app.get("/spellbook", include_in_schema=False)
def serve_spellbook():
    """Spell reference (справочник) — all spells that have icons."""
    return FileResponse(_static("spellbook.html"))


@app.get("/api", tags=["meta"])
def root():
    return {
        "service": "D&D 2024 Combat Engine",
        "version": "0.1.0-mvp",
        "quickstart": "POST /quickstart  →  room with 2 fighters ready to fight",
        "docs": "/docs",
    }


@app.get("/api/health", tags=["meta"])
def health():
    """Health check for Railway / load balancers."""
    return {"status": "ok", "service": "battle_backend", "storage": char_storage.backend()}


@app.post("/rooms", tags=["rooms"])
def create_room(req: CreateRoomRequest):
    room = Room(name=req.name)
    store.save_room(room)
    return {"room_id": room.id, "name": room.name}


@app.get("/rooms", tags=["rooms"])
def list_rooms():
    return store.list_rooms()


@app.get("/rooms/{room_id}", tags=["rooms"])
def get_room(room_id: str):
    return _room_or_404(room_id)


@app.delete("/rooms/{room_id}", tags=["rooms"])
def delete_room(room_id: str):
    if not store.delete_room(room_id):
        raise HTTPException(404, "Room not found.")
    return {"message": "Room deleted."}


# ─── Character endpoints ──────────────────────────────────────────────────────


@app.post("/rooms/{room_id}/characters", tags=["characters"])
def add_character(room_id: str, req: AddCharacterRequest):
    room = _room_or_404(room_id)
    if room.combat.active:
        raise HTTPException(400, "Cannot add characters while combat is active.")
    if req.class_name not in ("Fighter", "Wizard"):
        raise HTTPException(400, "class_name must be 'Fighter' or 'Wizard'.")
    if req.class_name == "Fighter" and req.preset not in ("longsword_shield", "greatsword"):
        raise HTTPException(400, "preset must be 'longsword_shield' or 'greatsword'.")

    char = engine.create_character(
        name=req.name,
        class_name=req.class_name,
        level=req.level,
        position=Position(x=req.x, y=req.y),
        ability_scores=req.ability_scores,
        weapon_choice=req.preset,
        cantrips=req.cantrips,
        spells=req.spells,
        background=req.background,
        portrait=req.portrait,
    )
    room.characters[char.id] = char
    store.save_room(room)
    return char


@app.post("/rooms/{room_id}/characters/from-saved", tags=["characters"])
def add_character_from_saved(room_id: str, req: AddFromSavedRequest):
    room = _room_or_404(room_id)
    if room.combat.active:
        raise HTTPException(400, "Cannot add characters while combat is active.")
    tpl = char_storage.get_character(req.saved_id)
    if not tpl:
        raise HTTPException(404, f"Saved character '{req.saved_id}' not found.")

    char = engine.create_character(
        name=tpl["name"],
        class_name=tpl.get("class_name", "Fighter"),
        level=tpl.get("level", 1),
        position=Position(x=req.x, y=req.y),
        ability_scores=tpl.get("ability_scores"),
        weapon_choice=tpl.get("preset", "longsword_shield"),
        cantrips=tpl.get("cantrips"),
        spells=tpl.get("spells"),
        background=tpl.get("background"),
        portrait=tpl.get("portrait"),
        saved_id=tpl["id"],
    )
    room.characters[char.id] = char
    store.save_room(room)
    return char


# ─── Saved character library (file-backed) ────────────────────────────────────


@app.post("/saved-characters", tags=["saved"])
def save_character(req: SavedCharacterRequest):
    tpl = char_storage.save_character(req.model_dump(exclude_none=True))
    return tpl


@app.get("/saved-characters", tags=["saved"])
def list_saved_characters():
    return char_storage.list_characters()


@app.get("/saved-characters/{char_id}", tags=["saved"])
def get_saved_character(char_id: str):
    tpl = char_storage.get_character(char_id)
    if not tpl:
        raise HTTPException(404, "Saved character not found.")
    return tpl


@app.delete("/saved-characters/{char_id}", tags=["saved"])
def delete_saved_character(char_id: str):
    if not char_storage.delete_character(char_id):
        raise HTTPException(404, "Saved character not found.")
    return {"message": "Deleted."}


@app.get("/spells", tags=["meta"])
def list_spells():
    """Full catalog of cantrips and level 1–2 spells for character creation/UI."""
    return spellbook.catalog()


@app.get("/rooms/{room_id}/characters/{char_id}", tags=["characters"])
def get_character(room_id: str, char_id: str):
    room = _room_or_404(room_id)
    char = room.characters.get(char_id)
    if not char:
        raise HTTPException(404, "Character not found.")
    return char


# ─── Combat management ────────────────────────────────────────────────────────


@app.post("/rooms/{room_id}/combat/start", tags=["combat"])
def start_combat(room_id: str):
    room = _room_or_404(room_id)
    if room.combat.active:
        raise HTTPException(400, "Combat is already active.")
    if len(room.characters) < 2:
        raise HTTPException(400, "Need at least 2 characters to start combat.")

    logs = engine.start_combat(room)
    for log in logs:
        room.log.append(log)
    store.save_room(room)

    current_id = room.combat.current_character_id()
    current = room.characters[current_id]
    return {
        "combat": room.combat,
        "logs": [l.message for l in logs],
        "first_turn": {
            "character_id": current_id,
            "character_name": current.name,
            "hp": current.hp,
            "ac": current.ac,
        },
    }


@app.get("/rooms/{room_id}/combat", tags=["combat"])
def get_combat(room_id: str):
    room = _room_or_404(room_id)
    if not room.combat.active:
        return {"active": False, "message": "No combat in progress."}

    current_id = room.combat.current_character_id()
    current = room.characters[current_id]

    return {
        "active": True,
        "round": room.combat.round,
        "initiative_order": [
            {"id": cid, "name": room.characters[cid].name, "initiative": room.characters[cid].initiative}
            for cid in room.combat.initiative_order
        ],
        "current_turn": {
            "character_id": current_id,
            "character_name": current.name,
            "hp": f"{current.hp}/{current.max_hp}",
            "ac": current.ac,
            "position": current.position,
            "conditions": current.conditions,
            "movement_remaining_ft": current.movement_remaining(),
            "resources": {
                "action": not current.turn_state.action_used,
                "bonus_action": not current.turn_state.bonus_action_used,
                "reaction": not current.turn_state.reaction_used,
                "second_wind": not current.resources.second_wind_used,
            },
        },
        "all_characters": {
            cid: {
                "name": c.name,
                "hp": f"{c.hp}/{c.max_hp}",
                "ac": c.ac,
                "position": c.position,
                "conditions": c.conditions,
                "conscious": c.is_conscious(),
            }
            for cid, c in room.characters.items()
        },
    }


@app.post("/rooms/{room_id}/combat/end-turn", tags=["combat"])
def end_turn(room_id: str, req: CharacterRequest):
    room = _room_or_404(room_id)
    _require_active_combat(room)
    char = room.characters.get(req.character_id)
    if not char:
        raise HTTPException(404, "Character not found.")

    result = engine.end_turn(room, req.character_id)
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


# ─── Action endpoints ─────────────────────────────────────────────────────────


@app.post("/rooms/{room_id}/actions/move", tags=["actions"])
def move(room_id: str, req: MoveRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.move_character(room, req.character_id, req.x, req.y)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/attack", tags=["actions"])
def attack(room_id: str, req: TargetRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_attack(room, req.character_id, req.target_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/dash", tags=["actions"])
def dash(room_id: str, req: CharacterRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_dash(room, req.character_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/disengage", tags=["actions"])
def disengage(room_id: str, req: CharacterRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_disengage(room, req.character_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/dodge", tags=["actions"])
def dodge(room_id: str, req: CharacterRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_dodge(room, req.character_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/hide", tags=["actions"])
def hide(room_id: str, req: CharacterRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_hide(room, req.character_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/search", tags=["actions"])
def search(room_id: str, req: CharacterRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_search(room, req.character_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/help", tags=["actions"])
def help_action(room_id: str, req: TargetRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_help(room, req.character_id, req.target_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/ready", tags=["actions"])
def ready(room_id: str, req: ReadyRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_ready(
        room, req.character_id, req.trigger, req.action_type, req.target_id, req.params
    )
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/shove", tags=["actions"])
def shove(room_id: str, req: ShoveRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_shove(room, req.character_id, req.target_id, req.mode)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/grapple", tags=["actions"])
def grapple(room_id: str, req: TargetRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_grapple(room, req.character_id, req.target_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/escape-grapple", tags=["actions"])
def escape_grapple(room_id: str, req: CharacterRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_escape_grapple(room, req.character_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/second-wind", tags=["actions"])
def second_wind(room_id: str, req: CharacterRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.bonus_second_wind(room, req.character_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/action-surge", tags=["actions"])
def action_surge(room_id: str, req: CharacterRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.action_surge(room, req.character_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/cast", tags=["actions"])
def cast_spell(room_id: str, req: CastSpellRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.cast_spell(
        room,
        req.character_id,
        req.spell,
        target_ids=req.target_ids,
        slot_level=req.slot_level,
        point=req.point,
    )
    char = room.characters[req.character_id]
    # Misty Step teleport: move the caster to the chosen point
    if result.get("success") and req.spell == "Misty Step" and req.point:
        tx, ty = req.point.get("x"), req.point.get("y")
        if (
            tx is not None and ty is not None
            and 0 <= tx < room.grid_width and 0 <= ty < room.grid_height
            and not any(
                o.id != char.id and o.is_conscious() and o.position.x == tx and o.position.y == ty
                for o in room.characters.values()
            )
        ):
            char.position = Position(x=tx, y=ty)
            result["effects"].append(f"{char.name} reappears at ({tx},{ty}).")
            result["message"] = " | ".join(result["effects"])
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/actions/two-weapon-attack", tags=["actions"])
def two_weapon_attack(room_id: str, req: TargetRequest):
    room = _room_or_404(room_id)
    _require_turn(room, req.character_id)
    result = engine.bonus_two_weapon_attack(room, req.character_id, req.target_id)
    char = room.characters[req.character_id]
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


# ─── Utility endpoints ────────────────────────────────────────────────────────


@app.get("/rooms/{room_id}/log", tags=["utility"])
def get_log(room_id: str, limit: int = 50):
    room = _room_or_404(room_id)
    return room.log[-limit:]


@app.post("/rooms/{room_id}/combat/short-rest", tags=["utility"])
def short_rest(room_id: str):
    """End combat and recover short-rest resources (Second Wind)."""
    room = _room_or_404(room_id)
    room.combat.active = False
    for char in room.characters.values():
        char.resources.second_wind_used = False
        char.action_surge_used = 0
        # Wizards recover one slot on a short rest via Arcane Recovery (simplified: lowest level)
        for lvl in sorted(char.spell_slots_max):
            if char.spell_slots.get(lvl, 0) < char.spell_slots_max[lvl]:
                char.spell_slots[lvl] = char.spell_slots.get(lvl, 0) + 1
                break
        # Spend hit dice to recover HP (simplified: auto-roll all remaining)
        if char.resources.hit_dice_remaining > 0 and char.hp < char.max_hp:
            import random
            heal, _ = engine.roll_dice("1d10") if False else (random.randint(1, 10), [])
            heal += char.ability_scores.mod("constitution")
            char.hp = min(char.max_hp, char.hp + max(1, heal))
            char.resources.hit_dice_remaining -= 1
    store.save_room(room)
    return {"message": "Short rest complete. Second Wind restored.", "characters": {
        cid: {"name": c.name, "hp": f"{c.hp}/{c.max_hp}"} for cid, c in room.characters.items()
    }}


# ─── Quick-start ──────────────────────────────────────────────────────────────


@app.post("/quickstart", tags=["meta"])
def quickstart():
    """
    One-shot: creates a room with two level-1 Fighters 75ft apart, ready for combat.

    Fighter A — Aldric: Longsword + Shield (AC 18), Dueling style, SAP + TOPPLE masteries
    Fighter B — Bren:   Greatsword (AC 16), Great Weapon Fighting, GRAZE + CLEAVE masteries
    """
    room = Room(name="Arena — Two Fighters")

    aldric = engine.create_fighter_1("Aldric", Position(x=2, y=10), "longsword_shield")
    bren = engine.create_fighter_1("Bren", Position(x=17, y=10), "greatsword")

    room.characters[aldric.id] = aldric
    room.characters[bren.id] = bren
    store.save_room(room)

    return {
        "room_id": room.id,
        "description": (
            "Two level-1 Fighters stand 75ft apart on a 20×20 grid (100ft × 100ft). "
            "They must close the distance before they can trade blows."
        ),
        "fighters": {
            aldric.id: {
                "name": "Aldric",
                "preset": "longsword_shield",
                "weapon": "Longsword (1d8+5 slashing)",
                "ac": 18,
                "hp": "12/12",
                "fighting_style": "Dueling (+2 damage)",
                "weapon_masteries": ["SAP (hit → target disadv on next attack)", "TOPPLE (hit → STR save or prone)"],
                "position": {"x": 2, "y": 10, "note": "10ft,50ft on map"},
                "second_wind": "1d10+1 HP (bonus action, once per short rest)",
            },
            bren.id: {
                "name": "Bren",
                "preset": "greatsword",
                "weapon": "Greatsword (2d6+3 slashing, reroll 1s/2s)",
                "ac": 16,
                "hp": "12/12",
                "fighting_style": "Great Weapon Fighting (reroll 1s and 2s on damage)",
                "weapon_masteries": ["GRAZE (miss → STR mod damage anyway)", "CLEAVE (hit → free attack vs adjacent foe)"],
                "position": {"x": 17, "y": 10, "note": "85ft,50ft on map"},
                "second_wind": "1d10+1 HP (bonus action, once per short rest)",
            },
        },
        "grid": "20×20 squares, 5ft per square. Diagonal movement = 5ft (Chebyshev).",
        "next_steps": [
            f"POST /rooms/{room.id}/combat/start        — roll initiative, begin combat",
            f"POST /rooms/{room.id}/actions/move        — {{character_id, x, y}}",
            f"POST /rooms/{room.id}/actions/attack      — {{character_id, target_id}}",
            f"POST /rooms/{room.id}/actions/dash        — {{character_id}}",
            f"POST /rooms/{room.id}/actions/disengage   — {{character_id}}",
            f"POST /rooms/{room.id}/actions/dodge       — {{character_id}}",
            f"POST /rooms/{room.id}/actions/hide        — {{character_id}}",
            f"POST /rooms/{room.id}/actions/shove       — {{character_id, target_id, mode}}",
            f"POST /rooms/{room.id}/actions/grapple     — {{character_id, target_id}}",
            f"POST /rooms/{room.id}/actions/second-wind — {{character_id}}  (bonus action)",
            f"POST /rooms/{room.id}/combat/end-turn     — {{character_id}}",
            f"GET  /rooms/{room.id}/combat              — current state & whose turn it is",
        ],
    }
