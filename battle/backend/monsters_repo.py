"""Persistence for monsters (``battle_monsters``)."""

from repo import JsonRepo

monsters = JsonRepo(
    table="battle_monsters",
    subdir="monsters",
    columns={
        "name": "name",
        "cr": "cr",
        "battle_ready": "battle_ready",
    },
)

