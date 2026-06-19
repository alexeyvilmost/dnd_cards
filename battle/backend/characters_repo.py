"""Persistence for character sheets (``battle_characters``)."""

from repo import JsonRepo

characters = JsonRepo(
    table="battle_characters",
    subdir="characters",
    columns={
        "owner": "owner",
        "name": "name",
        "class_name": "class_name",
        "level": "level",
        "xp": "xp",
    },
)
