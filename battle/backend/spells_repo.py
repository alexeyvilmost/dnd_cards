"""Persistence for spells (``battle_spells``)."""

from repo import JsonRepo

spells = JsonRepo(
    table="battle_spells",
    subdir="spells",
    columns={
        "name": "name",
        "level": "level",
        "battle_ready": "battle_ready",
    },
)
