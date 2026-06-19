"""Binary image storage for battle entities (spell icons, …).

Mirrors the JsonRepo dual-backend philosophy: when the DB is configured the
bytes live in the ``battle_images`` table (Postgres ``BYTEA``); otherwise they
fall back to one file per key under ``backend/data/images/`` so local dev works
without a database.

Images are addressed by an opaque ``key`` (stored on the owning document as its
``image`` field). Reads return ``(bytes, mime, version)`` where ``version`` is a
change token (DB ``updated_at`` or file mtime) used for ETag-based caching.
"""

from __future__ import annotations

import glob
import mimetypes
import os
import uuid
from typing import List, Optional, Tuple

import dbcore

_BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "images")

# mime -> extension for the file fallback
_EXT = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/svg+xml": ".svg",
}

MAX_BYTES = 4_000_000  # 4 MB upload cap


def gen_key() -> str:
    return "img_" + uuid.uuid4().hex[:12]


def _dir() -> str:
    os.makedirs(_BASE_DIR, exist_ok=True)
    return _BASE_DIR


def put(key: str, data: bytes, mime: str) -> dict:
    """Create or replace the image stored under ``key``."""
    mime = mime or "image/png"
    if dbcore.enabled():
        with dbcore.connect() as conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO battle_images (id, mime, bytes, updated_at)
                VALUES (%s, %s, %s, now())
                ON CONFLICT (id) DO UPDATE
                    SET mime = EXCLUDED.mime, bytes = EXCLUDED.bytes, updated_at = now()
                """,
                (key, mime, data),
            )
            conn.commit()
    else:
        # drop any previous extension variants for this key, then write fresh
        for f in glob.glob(os.path.join(_dir(), key + ".*")):
            os.remove(f)
        with open(os.path.join(_dir(), key + _EXT.get(mime, ".bin")), "wb") as f:
            f.write(data)
    return {"id": key, "mime": mime}


def get(key: str) -> Optional[Tuple[bytes, str, str]]:
    """Return ``(bytes, mime, version)`` or ``None`` if missing."""
    if dbcore.enabled():
        with dbcore.connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT mime, bytes, updated_at FROM battle_images WHERE id = %s", (key,))
            row = cur.fetchone()
            if not row:
                return None
            return bytes(row["bytes"]), row["mime"], str(row["updated_at"])
    matches = sorted(glob.glob(os.path.join(_dir(), key + ".*")))
    if not matches:
        return None
    path = matches[0]
    mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
    with open(path, "rb") as f:
        return f.read(), mime, str(os.path.getmtime(path))


def delete(key: str) -> bool:
    if dbcore.enabled():
        with dbcore.connect() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM battle_images WHERE id = %s", (key,))
            deleted = cur.rowcount > 0
            conn.commit()
            return deleted
    found = False
    for f in glob.glob(os.path.join(_dir(), key + ".*")):
        os.remove(f)
        found = True
    return found


def list_keys() -> List[str]:
    if dbcore.enabled():
        with dbcore.connect() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM battle_images ORDER BY id")
            return [r["id"] for r in cur.fetchall()]
    return sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(os.path.join(_dir(), "*")))
