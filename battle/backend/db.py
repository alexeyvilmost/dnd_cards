"""PostgreSQL persistence for saved character *templates*.

Thin wrapper over :mod:`dbcore` (shared connection + migrations). The
``battle_saved_characters`` table is created by migration ``001_saved_characters``.
Kept as a separate module for backwards compatibility with ``char_storage``.
"""

from typing import Dict, List, Optional

import dbcore

TABLE = "battle_saved_characters"


def enabled() -> bool:
    return dbcore.enabled()


def init() -> None:
    """Ensure schema is migrated (idempotent)."""
    dbcore.run_migrations()


def save_character(template: Dict) -> Dict:
    init()
    char_id = template["id"]
    with dbcore.connect() as conn, conn.cursor() as cur:
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
                "data": dbcore.Jsonb(template),
            },
        )
        row = cur.fetchone()
        conn.commit()
    template["created_at"] = row["created_at"].isoformat()
    template["updated_at"] = row["updated_at"].isoformat()
    return template


def list_characters() -> List[Dict]:
    init()
    with dbcore.connect() as conn, conn.cursor() as cur:
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
    with dbcore.connect() as conn, conn.cursor() as cur:
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
    with dbcore.connect() as conn, conn.cursor() as cur:
        cur.execute(f"DELETE FROM {TABLE} WHERE id = %s", (char_id,))
        deleted = cur.rowcount > 0
        conn.commit()
    return deleted
