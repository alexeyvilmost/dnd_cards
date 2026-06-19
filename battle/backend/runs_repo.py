"""Persistence for dungeon runs (``battle_runs``)."""

from repo import JsonRepo

runs = JsonRepo(
    table="battle_runs",
    subdir="runs",
    columns={
        "owner": "owner",
        "status": "status",
        "depth": "depth",
    },
)

