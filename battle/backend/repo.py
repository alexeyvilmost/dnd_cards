"""Generic JSON-document repository with a PostgreSQL backend and a file
fallback, so every battle entity (characters, spells, monsters, runs) gets the
same persistence behaviour with very little code.

Each repo maps to a table shaped as ``(id TEXT PK, <extra columns...>, data JSONB,
created_at, updated_at)``. Extra columns are extracted from the document via the
``columns`` mapping (column name -> key in the document) so they can be indexed /
filtered in SQL while the full document always lives in ``data``.

When the DB is disabled (no env / no psycopg), documents are stored as one JSON
file per id under ``<base_dir>/<subdir>/`` so local dev works without a database.
"""

from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import dbcore

_BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def gen_id() -> str:
    return uuid.uuid4().hex[:8]


class JsonRepo:
    def __init__(self, table: str, subdir: str, columns: Optional[Dict[str, str]] = None):
        """``columns`` maps SQL column name -> document key (e.g. {"level": "level"})."""
        self.table = table
        self.subdir = subdir
        self.columns = columns or {}

    # ── backend selection ──
    def backend(self) -> str:
        return "postgres" if dbcore.enabled() else "files"

    # ── file helpers ──
    def _dir(self) -> str:
        d = os.path.join(_BASE_DIR, self.subdir)
        os.makedirs(d, exist_ok=True)
        return d

    def _path(self, doc_id: str) -> str:
        return os.path.join(self._dir(), f"{doc_id}.json")

    # ── public API ──
    def save(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        doc = dict(doc)
        doc["id"] = doc.get("id") or gen_id()
        now = datetime.now(timezone.utc).isoformat()
        doc.setdefault("created_at", now)
        doc["updated_at"] = now

        if dbcore.enabled():
            return self._pg_save(doc)
        with open(self._path(doc["id"]), "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, indent=2)
        return doc

    def list(self, where: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        if dbcore.enabled():
            return self._pg_list(where)
        out: List[Dict[str, Any]] = []
        d = self._dir()
        for fn in os.listdir(d):
            if not fn.endswith(".json"):
                continue
            try:
                with open(os.path.join(d, fn), encoding="utf-8") as f:
                    doc = json.load(f)
            except (OSError, json.JSONDecodeError):
                continue
            if where and any(doc.get(k) != v for k, v in where.items()):
                continue
            out.append(doc)
        out.sort(key=lambda c: c.get("updated_at", ""), reverse=True)
        return out

    def get(self, doc_id: str) -> Optional[Dict[str, Any]]:
        if dbcore.enabled():
            return self._pg_get(doc_id)
        try:
            with open(self._path(doc_id), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return None

    def delete(self, doc_id: str) -> bool:
        if dbcore.enabled():
            return self._pg_delete(doc_id)
        try:
            os.remove(self._path(doc_id))
            return True
        except OSError:
            return False

    # ── postgres backend ──
    def _pg_save(self, doc: Dict[str, Any]) -> Dict[str, Any]:
        dbcore.run_migrations()
        cols = ["id"] + list(self.columns.keys()) + ["data"]
        placeholders = ", ".join(f"%({c})s" for c in cols)
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in self.columns.keys())
        updates = (updates + ", " if updates else "") + "data = EXCLUDED.data, updated_at = now()"
        params: Dict[str, Any] = {"id": doc["id"], "data": dbcore.Jsonb(doc)}
        for col, key in self.columns.items():
            params[col] = doc.get(key)
        sql = (
            f"INSERT INTO {self.table} ({', '.join(cols)}) VALUES ({placeholders}) "
            f"ON CONFLICT (id) DO UPDATE SET {updates} "
            f"RETURNING created_at, updated_at"
        )
        with dbcore.connect() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            row = cur.fetchone()
            conn.commit()
        doc["created_at"] = row["created_at"].isoformat()
        doc["updated_at"] = row["updated_at"].isoformat()
        return doc

    def _pg_list(self, where: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
        dbcore.run_migrations()
        sql = f"SELECT data, created_at, updated_at FROM {self.table}"
        params: Dict[str, Any] = {}
        if where:
            clauses = []
            for i, (k, v) in enumerate(where.items()):
                clauses.append(f"{k} = %(w{i})s")
                params[f"w{i}"] = v
            sql += " WHERE " + " AND ".join(clauses)
        sql += " ORDER BY updated_at DESC"
        with dbcore.connect() as conn, conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        return [self._hydrate(r) for r in rows]

    def _pg_get(self, doc_id: str) -> Optional[Dict[str, Any]]:
        dbcore.run_migrations()
        with dbcore.connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT data, created_at, updated_at FROM {self.table} WHERE id = %s",
                (doc_id,),
            )
            r = cur.fetchone()
        return self._hydrate(r) if r else None

    def _pg_delete(self, doc_id: str) -> bool:
        dbcore.run_migrations()
        with dbcore.connect() as conn, conn.cursor() as cur:
            cur.execute(f"DELETE FROM {self.table} WHERE id = %s", (doc_id,))
            deleted = cur.rowcount > 0
            conn.commit()
        return deleted

    @staticmethod
    def _hydrate(row: Dict[str, Any]) -> Dict[str, Any]:
        doc = dict(row["data"])
        doc["created_at"] = row["created_at"].isoformat()
        doc["updated_at"] = row["updated_at"].isoformat()
        return doc
