"""Shared PostgreSQL access + lightweight migration runner for the battle service.

Connection convention matches the main dnd_cards (Go) backend: prefer
``DATABASE_URL`` (Railway's Postgres plugin injects it), otherwise build from
``DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME/DB_SSLMODE``.

If neither is configured (or psycopg isn't installed), :func:`enabled` returns
False and callers fall back to file storage, so local dev works without a DB.

All battle tables use the ``battle_`` prefix and never touch the main service's
schema. Migrations are registered in :data:`MIGRATIONS` and applied idempotently
at startup via :func:`run_migrations`.
"""

from __future__ import annotations

import os
from typing import List, Optional, Tuple

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg.types.json import Jsonb  # re-exported for repositories
except Exception:  # psycopg missing -> DB disabled, file fallback used
    psycopg = None
    dict_row = None
    Jsonb = None  # type: ignore


_migrations_applied = False


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


def connect():
    """Open a new dict-row connection. Caller is responsible for closing it
    (use as a context manager)."""
    return psycopg.connect(_conninfo(), connect_timeout=10, row_factory=dict_row)


# ─── Migrations ────────────────────────────────────────────────────────────────
#
# Each entry: (version_name, SQL). Versions are applied in order; already-applied
# versions (tracked in battle_schema_migrations) are skipped. SQL must be
# idempotent-friendly (use IF NOT EXISTS where possible) so partial states heal.

MIGRATIONS: List[Tuple[str, str]] = [
    (
        "001_saved_characters",
        """
        CREATE TABLE IF NOT EXISTS battle_saved_characters (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            class_name  TEXT,
            level       INTEGER,
            data        JSONB NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """,
    ),
    (
        "002_characters",
        """
        CREATE TABLE IF NOT EXISTS battle_characters (
            id          TEXT PRIMARY KEY,
            owner       TEXT,
            name        TEXT NOT NULL,
            class_name  TEXT NOT NULL,
            level       INTEGER NOT NULL DEFAULT 1,
            xp          INTEGER NOT NULL DEFAULT 0,
            data        JSONB NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """,
    ),
    (
        "003_spells",
        """
        CREATE TABLE IF NOT EXISTS battle_spells (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            level       INTEGER NOT NULL DEFAULT 0,
            battle_ready BOOLEAN NOT NULL DEFAULT TRUE,
            data        JSONB NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX IF NOT EXISTS battle_spells_name_uidx ON battle_spells (name);
        """,
    ),
    (
        "004_monsters",
        """
        CREATE TABLE IF NOT EXISTS battle_monsters (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            cr          NUMERIC NOT NULL DEFAULT 0,
            battle_ready BOOLEAN NOT NULL DEFAULT TRUE,
            data        JSONB NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """,
    ),
    (
        "005_runs",
        """
        CREATE TABLE IF NOT EXISTS battle_runs (
            id          TEXT PRIMARY KEY,
            character_id TEXT,
            status      TEXT NOT NULL DEFAULT 'active',
            depth       INTEGER NOT NULL DEFAULT 0,
            gold        INTEGER NOT NULL DEFAULT 0,
            data        JSONB NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """,
    ),
    (
        "006_images",
        """
        CREATE TABLE IF NOT EXISTS battle_images (
            id          TEXT PRIMARY KEY,
            mime        TEXT NOT NULL,
            bytes       BYTEA NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """,
    ),
    (
        "007_definitions",
        """
        CREATE TABLE IF NOT EXISTS battle_definitions (
            id          TEXT PRIMARY KEY,
            kind        TEXT NOT NULL,
            name        TEXT NOT NULL,
            source      TEXT NOT NULL DEFAULT 'custom',
            data        JSONB NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS battle_definitions_kind_idx ON battle_definitions (kind);
        """,
    ),
    (
        # battle_runs predates the runs_repo `owner` column mapping; add it so
        # INSERTs on Postgres don't fail (file backend was unaffected).
        "008_runs_owner",
        """
        ALTER TABLE battle_runs ADD COLUMN IF NOT EXISTS owner TEXT;
        """,
    ),
]


def run_migrations(force: bool = False) -> List[str]:
    """Apply all pending migrations. Returns the list of newly applied versions.

    No-op (returns []) when the DB is disabled, so local file-backed dev is
    unaffected.
    """
    global _migrations_applied
    if not enabled():
        return []
    if _migrations_applied and not force:
        return []

    applied: List[str] = []
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS battle_schema_migrations (
                version    TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
        cur.execute("SELECT version FROM battle_schema_migrations")
        done = {r["version"] for r in cur.fetchall()}
        for version, sql in MIGRATIONS:
            if version in done:
                continue
            cur.execute(sql)
            cur.execute(
                "INSERT INTO battle_schema_migrations (version) VALUES (%s)", (version,)
            )
            applied.append(version)
        conn.commit()

    _migrations_applied = True
    return applied
