"""Persistence for rule definitions (backgrounds, feats, fighting styles).

All four entity kinds share one ``battle_definitions`` table/JSON store; ``kind``
distinguishes them. The full definition document (including its ``effects`` list)
lives in ``data``; ``kind``/``name``/``source`` are mirrored to columns for
filtering.
"""

from typing import Any, Dict, List, Optional

from repo import JsonRepo

definitions = JsonRepo(
    table="battle_definitions",
    subdir="definitions",
    columns={"kind": "kind", "name": "name", "source": "source"},
)


def list_kind(kind: Optional[str] = None) -> List[Dict[str, Any]]:
    where = {"kind": kind} if kind else None
    return definitions.list(where)


def get(def_id: str) -> Optional[Dict[str, Any]]:
    return definitions.get(def_id)


def by_id_map(kind: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
    return {d["id"]: d for d in list_kind(kind)}
