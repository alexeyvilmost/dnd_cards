"""Bridge to the main dnd_cards item API."""

from __future__ import annotations

import os
from typing import Any, Dict, List

import requests

ITEMS_API_BASE = os.getenv("ITEMS_API_BASE", "http://localhost:8080/api")


class ItemBridgeError(RuntimeError):
    pass


def _url(path: str) -> str:
    return f"{ITEMS_API_BASE.rstrip('/')}/{path.lstrip('/')}"


def fetch_battle_stats(card_id: str) -> Dict[str, Any]:
    try:
        r = requests.get(_url(f"cards/{card_id}/battle-stats"), timeout=8)
        if r.status_code >= 400:
            raise ItemBridgeError(f"items api error: {r.status_code} {r.text}")
        return r.json()
    except requests.RequestException as e:
        raise ItemBridgeError(str(e)) from e


def fetch_batch_battle_stats(card_ids: List[str]) -> List[Dict[str, Any]]:
    try:
        r = requests.post(_url("cards/battle-stats"), json={"card_ids": card_ids}, timeout=10)
        if r.status_code >= 400:
            raise ItemBridgeError(f"items api error: {r.status_code} {r.text}")
        data = r.json()
        return data.get("items", [])
    except requests.RequestException as e:
        raise ItemBridgeError(str(e)) from e

