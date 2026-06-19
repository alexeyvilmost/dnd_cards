import os
from typing import Any, Dict, List, Optional

import hashlib

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
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
import characters_repo
import dbcore
import images_repo
import engine
import item_bridge
import monsters
import monsters_repo
import progression
import runs_repo
import spell_catalog
import spells as spellbook
import store
import dungeon
from models import EventLog, Position, Room

app = FastAPI(title="D&D 2024 Combat Engine", version="1.0.0")


@app.on_event("startup")
def _startup() -> None:
    """Apply battle_ migrations when a database is configured (no-op locally
    without a DB, where the file fallback is used)."""
    try:
        applied = dbcore.run_migrations()
        if applied:
            print(f"[battle] applied migrations: {', '.join(applied)}")
    except Exception as exc:  # never block startup on migration issues
        print(f"[battle] migration warning: {exc}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve static assets (JS data, spell icons, …) under /static/*.
# After the backend/frontend split the UI lives in battle/frontend (served by
# nginx), so the static dir is usually absent here — mount only if present, so
# the backend still works all-in-one when static/ is bundled alongside it.
_HAS_STATIC = os.path.isdir(_STATIC_DIR)
if _HAS_STATIC:
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


def _award_xp_after_combat(room: Room) -> Dict[str, int]:
    """Award XP from defeated monsters to party sheets after a victorious combat.
    Returns {sheet_id: xp_awarded}."""
    party_alive = [
        c for c in room.characters.values()
        if not c.is_monster and c.is_conscious()
    ]
    monsters_total = [c for c in room.characters.values() if c.is_monster]
    monsters_alive = [c for c in monsters_total if c.is_conscious()]
    if not monsters_total or monsters_alive or not party_alive:
        return {}

    recipients = [c for c in room.characters.values() if not c.is_monster and c.sheet_id]
    if not recipients:
        return {}

    total_xp = sum(max(0, int(getattr(m, "monster_xp", 0) or 0)) for m in monsters_total)
    if total_xp <= 0:
        return {}
    base = total_xp // len(recipients)
    rem = total_xp % len(recipients)
    awards: Dict[str, int] = {}
    for i, c in enumerate(recipients):
        gain = base + (1 if i < rem else 0)
        sheet = characters_repo.characters.get(c.sheet_id)
        if not sheet:
            continue
        sheet["xp"] = max(0, sheet.get("xp", 0) + gain)
        characters_repo.characters.save(sheet)
        awards[c.sheet_id] = gain
    return awards


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
    effect_choice: Optional[str] = None


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


class StartRunRequest(BaseModel):
    sheet_id: str


class BuyOfferRequest(BaseModel):
    offer_id: str


# ─── Room endpoints ───────────────────────────────────────────────────────────


# UI page routes — only registered in all-in-one mode (static/ bundled here).
# In the split deployment nginx (battle/frontend) serves these pages.
if _HAS_STATIC:

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


# ─── Images ───────────────────────────────────────────────────────────────────
# Binary images (spell icons, …) served from the DB/file store. Entities store an
# opaque image key in their ``image`` field and reference it as GET /images/{key}.

def _etag(version: str) -> str:
    return '"' + hashlib.md5(version.encode()).hexdigest() + '"'


@app.get("/images/{key}", tags=["images"])
def get_image(key: str, request: Request):
    res = images_repo.get(key)
    if not res:
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    data, mime, version = res
    etag = _etag(version)
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag, "Cache-Control": "public, max-age=300"})
    return Response(
        content=data,
        media_type=mime,
        headers={"ETag": etag, "Cache-Control": "public, max-age=300"},
    )


@app.post("/images", tags=["images"])
async def upload_image(file: UploadFile = File(...), key: Optional[str] = Form(None)):
    """Create or replace an image. Pass ``key`` to overwrite an existing one,
    omit it to mint a new key. Returns ``{"id": key}``."""
    data = await file.read()
    if len(data) > images_repo.MAX_BYTES:
        raise HTTPException(status_code=413, detail="Файл слишком большой (максимум 4 МБ)")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=415, detail="Допустимы только изображения")
    return images_repo.put(key or images_repo.gen_key(), data, file.content_type or "image/png")


@app.delete("/images/{key}", tags=["images"])
def delete_image(key: str):
    if not images_repo.delete(key):
        raise HTTPException(status_code=404, detail="Изображение не найдено")
    return {"deleted": key}


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


class AddFromSheetRequest(BaseModel):
    sheet_id: str
    x: int = 0
    y: int = 0
    team: str = "party"


class AddMonsterRequest(BaseModel):
    monster_id: str
    x: int = 0
    y: int = 0


@app.post("/rooms/{room_id}/characters/from-sheet", tags=["characters"])
def add_character_from_sheet(room_id: str, req: AddFromSheetRequest):
    room = _room_or_404(room_id)
    if room.combat.active:
        raise HTTPException(400, "Cannot add characters while combat is active.")
    sheet = characters_repo.characters.get(req.sheet_id)
    if not sheet:
        raise HTTPException(404, f"Character sheet '{req.sheet_id}' not found.")
    char = progression.build_combat_character(
        sheet, position=Position(x=req.x, y=req.y), team=req.team
    )
    room.characters[char.id] = char
    store.save_room(room)
    return char


@app.post("/rooms/{room_id}/monsters", tags=["characters"])
def add_monster_to_room(room_id: str, req: AddMonsterRequest):
    room = _room_or_404(room_id)
    if room.combat.active:
        raise HTTPException(400, "Cannot add monsters while combat is active.")
    mon = monsters_repo.monsters.get(req.monster_id)
    if not mon:
        raise HTTPException(404, f"Monster '{req.monster_id}' not found.")
    char = monsters.to_combat_character(mon, position=Position(x=req.x, y=req.y))
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


# ─── Character sheets (persistent, with progression) ──────────────────────────


class AwardXpRequest(BaseModel):
    amount: int


class ImportCardRequest(BaseModel):
    card_id: str


def _char_or_404(char_id: str) -> Dict:
    sheet = characters_repo.characters.get(char_id)
    if not sheet:
        raise HTTPException(404, "Character not found.")
    return sheet


def _run_or_404(run_id: str) -> Dict:
    run = runs_repo.runs.get(run_id)
    if not run:
        raise HTTPException(404, "Run not found.")
    return run


def _char_view(sheet: Dict) -> Dict:
    """Augment a sheet with computed progression info for the UI."""
    out = dict(sheet)
    out["level_progress"] = {
        "xp": sheet.get("xp", 0),
        "level": sheet.get("level", 1),
        "xp_to_next": progression.xp_to_next(sheet.get("xp", 0), sheet.get("level", 1)),
        "can_level_up": progression.level_up_options(sheet).get("can_level_up", False),
    }
    return out


@app.get("/characters-api", tags=["sheets"])
def list_sheets():
    return [_char_view(s) for s in characters_repo.characters.list()]


@app.get("/characters-api/meta/create-options", tags=["sheets"])
def character_create_options():
    return progression.create_options()


@app.post("/characters-api", tags=["sheets"])
def create_sheet(payload: Dict[str, Any]):
    try:
        sheet = progression.new_sheet(payload)
    except ValueError as e:
        raise HTTPException(400, str(e))
    saved = characters_repo.characters.save(sheet)
    return _char_view(saved)


@app.get("/characters-api/{char_id}", tags=["sheets"])
def get_sheet(char_id: str):
    return _char_view(_char_or_404(char_id))


@app.put("/characters-api/{char_id}", tags=["sheets"])
def update_sheet(char_id: str, payload: Dict[str, Any]):
    sheet = _char_or_404(char_id)
    editable = [
        "name", "portrait", "background", "skill_proficiencies",
        "fighting_style", "weapon_masteries", "weapon_choice",
        "cantrips", "spells_prepared", "gold", "equipment",
    ]
    for k in editable:
        if k in payload:
            sheet[k] = payload[k]
    # Ability scores only editable at level 1 (validate point-buy).
    if "ability_scores" in payload and sheet.get("level", 1) == 1:
        err = progression.validate_point_buy(payload["ability_scores"])
        if err:
            raise HTTPException(400, err)
        sheet["ability_scores"] = payload["ability_scores"]
    saved = characters_repo.characters.save(sheet)
    return _char_view(saved)


@app.delete("/characters-api/{char_id}", tags=["sheets"])
def delete_sheet(char_id: str):
    if not characters_repo.characters.delete(char_id):
        raise HTTPException(404, "Character not found.")
    return {"message": "Deleted."}


@app.get("/characters-api/{char_id}/level-up/options", tags=["sheets"])
def get_level_up_options(char_id: str):
    return progression.level_up_options(_char_or_404(char_id))


@app.post("/characters-api/{char_id}/level-up", tags=["sheets"])
def do_level_up(char_id: str, choices: Dict[str, Any]):
    sheet = _char_or_404(char_id)
    try:
        sheet = progression.apply_level_up(sheet, choices or {})
    except ValueError as e:
        raise HTTPException(400, str(e))
    saved = characters_repo.characters.save(sheet)
    return _char_view(saved)


@app.post("/characters-api/{char_id}/award-xp", tags=["sheets"])
def award_xp(char_id: str, req: AwardXpRequest):
    sheet = _char_or_404(char_id)
    sheet["xp"] = max(0, sheet.get("xp", 0) + req.amount)
    saved = characters_repo.characters.save(sheet)
    view = _char_view(saved)
    view["awarded"] = req.amount
    return view


@app.post("/characters-api/{char_id}/equipment/import-card", tags=["sheets"])
def import_equipment_card(char_id: str, req: ImportCardRequest):
    sheet = _char_or_404(char_id)
    try:
        stats = item_bridge.fetch_battle_stats(req.card_id)
    except item_bridge.ItemBridgeError as e:
        raise HTTPException(502, f"Не удалось получить данные предмета: {e}")

    equipment = sheet.setdefault("equipment", [])
    # replace existing entry for this card
    equipment = [e for e in equipment if e.get("card_id") != req.card_id]
    equipment.append(stats)
    sheet["equipment"] = equipment
    saved = characters_repo.characters.save(sheet)
    out = _char_view(saved)
    out["imported_item"] = stats
    return out


@app.delete("/characters-api/{char_id}/equipment/{card_id}", tags=["sheets"])
def remove_equipment_card(char_id: str, card_id: str):
    sheet = _char_or_404(char_id)
    equipment = sheet.setdefault("equipment", [])
    before = len(equipment)
    sheet["equipment"] = [e for e in equipment if e.get("card_id") != card_id]
    if len(sheet["equipment"]) == before:
        raise HTTPException(404, "Item not equipped.")
    saved = characters_repo.characters.save(sheet)
    return _char_view(saved)


# ─── Dungeon Crawl runs ───────────────────────────────────────────────────────


@app.get("/runs", tags=["runs"])
def list_runs():
    return runs_repo.runs.list()


@app.post("/runs/start", tags=["runs"])
def start_run(req: StartRunRequest):
    sheet = _char_or_404(req.sheet_id)
    run = dungeon.new_run(sheet)
    run["shop_offers"] = dungeon.build_shop_offers()
    saved = runs_repo.runs.save(run)
    return saved


@app.get("/runs/{run_id}", tags=["runs"])
def get_run(run_id: str):
    return _run_or_404(run_id)


@app.post("/runs/{run_id}/next-room", tags=["runs"])
def run_next_room(run_id: str):
    run = _run_or_404(run_id)
    if run.get("status") not in ("between_rooms",):
        raise HTTPException(400, f"Run status must be 'between_rooms', got {run.get('status')}")
    sheet = _char_or_404(run["sheet_id"])
    room = dungeon.create_next_room(run, sheet)
    logs = engine.start_combat(room)
    for log in logs:
        room.log.append(log)
    store.save_room(room)
    run["status"] = "in_combat"
    run["current_room_id"] = room.id
    run["room_start_xp"] = int(sheet.get("xp", 0))
    saved = runs_repo.runs.save(run)
    return {"run": saved, "room_id": room.id}


@app.post("/runs/{run_id}/resolve", tags=["runs"])
def resolve_run_room(run_id: str):
    run = _run_or_404(run_id)
    if run.get("status") != "in_combat" or not run.get("current_room_id"):
        raise HTTPException(400, "Run is not in combat.")
    room = _room_or_404(run["current_room_id"])
    if room.combat.active:
        raise HTTPException(400, "Combat still active.")
    sheet = _char_or_404(run["sheet_id"])
    result = dungeon.resolve_room(
        run,
        room,
        xp_before=int(run.get("room_start_xp", 0)),
        xp_after=int(sheet.get("xp", 0)),
    )
    saved = runs_repo.runs.save(run)
    return {"run": saved, "result": result}


@app.get("/runs/{run_id}/shop", tags=["runs"])
def get_run_shop(run_id: str):
    run = _run_or_404(run_id)
    if run.get("status") not in ("between_rooms",):
        raise HTTPException(400, "Shop available only between rooms.")
    return {"gold": run.get("gold", 0), "offers": run.get("shop_offers", [])}


@app.post("/runs/{run_id}/shop/buy", tags=["runs"])
def buy_shop_item(run_id: str, req: BuyOfferRequest):
    run = _run_or_404(run_id)
    if run.get("status") not in ("between_rooms",):
        raise HTTPException(400, "Shop available only between rooms.")
    offers = run.get("shop_offers", [])
    offer = next((o for o in offers if o.get("offer_id") == req.offer_id), None)
    if not offer:
        raise HTTPException(404, "Offer not found.")
    cost = int(offer.get("cost", 0))
    if int(run.get("gold", 0)) < cost:
        raise HTTPException(400, "Not enough gold.")
    run["gold"] = int(run.get("gold", 0)) - cost
    # Equip purchased item to sheet if it is a card offer.
    card_id = offer.get("card_id")
    if card_id:
        sheet = _char_or_404(run["sheet_id"])
        stats = item_bridge.fetch_battle_stats(card_id)
        equipment = sheet.setdefault("equipment", [])
        equipment = [e for e in equipment if e.get("card_id") != card_id]
        equipment.append(stats)
        sheet["equipment"] = equipment
        characters_repo.characters.save(sheet)
    run["shop_offers"] = [o for o in offers if o.get("offer_id") != req.offer_id]
    saved = runs_repo.runs.save(run)
    return {"run": saved, "purchased": offer}


@app.get("/spells", tags=["spells"])
def list_spells():
    """Spell catalog from the store (seeded from the in-code catalog on first run)."""
    return spell_catalog.list_spells()


@app.get("/spells/{spell_id}", tags=["spells"])
def get_spell_doc(spell_id: str):
    doc = spell_catalog.get_doc(spell_id)
    if not doc:
        raise HTTPException(404, "Spell not found.")
    return doc


@app.post("/spells", tags=["spells"])
def create_spell(payload: Dict[str, Any]):
    try:
        return spell_catalog.create_spell(payload)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.put("/spells/{spell_id}", tags=["spells"])
def update_spell(spell_id: str, payload: Dict[str, Any]):
    try:
        return spell_catalog.update_spell(spell_id, payload)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/spells/{spell_id}", tags=["spells"])
def delete_spell(spell_id: str):
    if not spell_catalog.delete_spell(spell_id):
        raise HTTPException(404, "Spell not found.")
    return {"message": "Deleted."}


# ─── Monsters / bestiary ─────────────────────────────────────────────────────


def _monster_or_404(monster_id: str) -> Dict:
    m = monsters_repo.monsters.get(monster_id)
    if not m:
        raise HTTPException(404, "Monster not found.")
    return m


@app.get("/monsters", tags=["monsters"])
def list_monsters():
    return monsters_repo.monsters.list()


@app.get("/monsters/default", tags=["monsters"])
def default_monster():
    return monsters.default_monster_doc()


@app.get("/monsters/{monster_id}", tags=["monsters"])
def get_monster(monster_id: str):
    return _monster_or_404(monster_id)


@app.post("/monsters", tags=["monsters"])
def create_monster(payload: Dict[str, Any]):
    ok, err = monsters.validate_monster(payload)
    if not ok:
        raise HTTPException(400, err)
    payload = dict(payload)
    payload.setdefault("xp", monsters.xp_for_cr(float(payload.get("cr", 0))))
    return monsters_repo.monsters.save(payload)


@app.put("/monsters/{monster_id}", tags=["monsters"])
def update_monster(monster_id: str, payload: Dict[str, Any]):
    existing = _monster_or_404(monster_id)
    merged = {**existing, **payload}
    ok, err = monsters.validate_monster(merged)
    if not ok:
        raise HTTPException(400, err)
    merged["id"] = monster_id
    merged.setdefault("xp", monsters.xp_for_cr(float(merged.get("cr", 0))))
    return monsters_repo.monsters.save(merged)


@app.delete("/monsters/{monster_id}", tags=["monsters"])
def delete_monster(monster_id: str):
    if not monsters_repo.monsters.delete(monster_id):
        raise HTTPException(404, "Monster not found.")
    return {"message": "Deleted."}


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
    if result.get("combat_over"):
        awards = _award_xp_after_combat(room)
        if awards:
            result["xp_awards"] = awards
    _log(room, char.name, result["message"])
    store.save_room(room)
    return result


@app.post("/rooms/{room_id}/combat/auto-turn", tags=["combat"])
def auto_turn(room_id: str):
    """Auto-play one or more monster turns (for PvE)."""
    room = _room_or_404(room_id)
    _require_active_combat(room)
    cid = room.combat.current_character_id()
    cur = room.characters.get(cid) if cid else None
    if not cur or not cur.is_monster:
        return {"acted": False, "message": "Current turn is not a monster."}

    res = monsters.auto_turn(room, cid)
    _log(room, cur.name, res.get("message", "Monster acted."))
    # If combat ended during auto-turn, apply XP.
    if not room.combat.active:
        awards = _award_xp_after_combat(room)
        if awards:
            res["xp_awards"] = awards
    store.save_room(room)
    return res


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
        effect_choice=req.effect_choice,
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
