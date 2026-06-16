"""In-memory state store (MVP). Replace with DB layer later."""

from typing import Dict, List, Optional

from models import Room

_rooms: Dict[str, Room] = {}


def get_room(room_id: str) -> Optional[Room]:
    return _rooms.get(room_id)


def save_room(room: Room) -> None:
    _rooms[room.id] = room


def delete_room(room_id: str) -> bool:
    if room_id in _rooms:
        del _rooms[room_id]
        return True
    return False


def list_rooms() -> List[Dict]:
    return [
        {
            "id": r.id,
            "name": r.name,
            "characters": len(r.characters),
            "combat_active": r.combat.active,
        }
        for r in _rooms.values()
    ]
