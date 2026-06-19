"""One-shot seed: import the bundled spell icons into the image store and link
them to spells via the document ``image`` field.

Source of truth lives in ``backend/seed/spell_icons/<key>.png`` plus
``backend/seed/icon_index.json`` ({key: english_spell_name}). Re-runnable and
idempotent; works against whichever backend is active (Postgres or files).

Usage:  python seed_images.py
"""

from __future__ import annotations

import json
import os

import images_repo
import dbcore
from spells_repo import spells

_DIR = os.path.dirname(os.path.abspath(__file__))
_SEED_DIR = os.path.join(_DIR, "seed", "spell_icons")
_INDEX = os.path.join(_DIR, "seed", "icon_index.json")


def main() -> None:
    dbcore.run_migrations()
    index = json.load(open(_INDEX, encoding="utf-8"))  # key -> English name

    all_spells = spells.list()
    by_name = {s.get("name"): s for s in all_spells}

    imported = 0
    linked = 0
    missing_file = 0
    missing_spell = []

    for key, en in index.items():
        path = os.path.join(_SEED_DIR, f"{key}.png")
        if not os.path.exists(path):
            missing_file += 1
            continue
        with open(path, "rb") as f:
            images_repo.put(key, f.read(), "image/png")
        imported += 1

        spell = by_name.get(en)
        if spell is None:
            missing_spell.append(en)
            continue
        if spell.get("image") != key:
            spell["image"] = key
            spells.save(spell)
        linked += 1

    print(f"storage backend: {spells.backend()}")
    print(f"images imported: {imported}")
    print(f"spells linked:   {linked}")
    if missing_file:
        print(f"missing png files: {missing_file}")
    if missing_spell:
        print(f"no matching spell for: {', '.join(missing_spell)}")


if __name__ == "__main__":
    main()
