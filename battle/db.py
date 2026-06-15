"""PostgreSQL persistence for the battle service.

Connection follows the same convention as the main dnd_cards (Go) backend:
prefer ``DATABASE_URL`` (Railway's Postgres plugin injects it), otherwise build
from ``DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME/DB_SSLMODE``.

If neither is configured (or psycopg isn't installed), ``enabled()`` returns
False and the caller falls back to file storage — so local dev works without a DB.

Saved characters live in their own table (``battle_saved_characters``); the
main service's schema is never touched.
"""

import os
from typing import Dict, List, Optional

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb
except Exception:  # psycopg missing → DB disabled, file fallback used
    psycopg = None


TABLE = "battle_saved_characters"
_initialized = False


def _conninfo() -> Optional[str]:
    url = os.getenv("DATABASE_URL")
    if url:
        return url
    host = os.getenv("DB_HOST")
    if not host:
        return None
    return (
        f"host={host} "
        f"port={os.getenv('DB_PORT', '5432')} "
        f"user={os.getenv('DB_USER', 'postgres')} "
        f"password={os.getenv('DB_PASSWORD', '')} "
        f"dbname={os.getenv('DB_NAME', 'postgres')} "
        f"sslmode={os.getenv('DB_SSLMODE', 'require')}"
    )


def enabled() -> bool:
    return psycopg is not None and _conninfo() is not None


def _connect():
    return psycopg.connect(_conninfo(), connect_timeout=10, row_factory=dict_row)


def init() -> None:
    """Create the battle table once (idempotent)."""
    global _initialized
    if _initialized:
        return
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {TABLE} (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                class_name  TEXT,
                level       INTEGER,
                data        JSONB NOT NULL,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        conn.commit()
    _initialized = True


def save_character(template: Dict) -> Dict:
    init()
    char_id = template["id"]
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO {TABLE} (id, name, class_name, level, data, created_at, updated_at)
            VALUES (%(id)s, %(name)s, %(class_name)s, %(level)s, %(data)s, now(), now())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                class_name = EXCLUDED.class_name,
                level = EXCLUDED.level,
                data = EXCLUDED.data,
                updated_at = now()
            RETURNING created_at, updated_at
            """,
            {
                "id": char_id,
                "name": template.get("name"),
                "class_name": template.get("class_name"),
                "level": template.get("level"),
                "data": Jsonb(template),
            },
        )
        row = cur.fetchone()
        conn.commit()
    template["created_at"] = row["created_at"].isoformat()
    template["updated_at"] = row["updated_at"].isoformat()
    return template


def list_characters() -> List[Dict]:
    init()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT data, created_at, updated_at FROM {TABLE} ORDER BY updated_at DESC")
        rows = cur.fetchall()
    out = []
    for r in rows:
        tpl = dict(r["data"])
        tpl["created_at"] = r["created_at"].isoformat()
        tpl["updated_at"] = r["updated_at"].isoformat()
        out.append(tpl)
    return out


def get_character(char_id: str) -> Optional[Dict]:
    init()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT data, created_at, updated_at FROM {TABLE} WHERE id = %s", (char_id,))
        r = cur.fetchone()
    if not r:
        return None
    tpl = dict(r["data"])
    tpl["created_at"] = r["created_at"].isoformat()
    tpl["updated_at"] = r["updated_at"].isoformat()
    return tpl


def delete_character(char_id: str) -> bool:
    init()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"DELETE FROM {TABLE} WHERE id = %s", (char_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted
