"""Emit a read-only PostgreSQL comparison of migration 279 against live catalog rows.

The generated SQL contains only public catalog identities and guarded preimages.
Run via psql stdin; the result contains aggregate drift counts and at most 50 refs.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'backend/migrations/data/item-completion-279/items.json'
OUTPUT = ROOT / 'outputs/catalog-completion-20260929/prod-drift-279.sql'
TABLES = {
    'card': ('cards', 'card_number'),
    'action': ('actions', 'card_number'),
    'effect': ('effects', 'card_number'),
    'spell': ('spells', 'card_number'),
    'feat': ('feats', 'card_number'),
    'resource': ('resources', 'resource_id'),
    'monster': ('monsters', 'slug'),
}


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    source = json.loads(MANIFEST.read_text(encoding='utf-8'))
    rows = [{'kind': e['entity_type'], 'id': e['id'], 'ref': e['card_number'],
             'preimage': e.get('preimage')} for e in source['entities'] + source.get('guards', [])]
    if len(rows) != len({(r['kind'], r['id']) for r in rows}):
        raise SystemExit('Duplicate manifest identity')
    unknown = set(r['kind'] for r in rows) - set(TABLES)
    if unknown:
        raise SystemExit(f'Unknown entities: {sorted(unknown)}')
    branches = []
    for kind, (table, ref) in TABLES.items():
        branches.append(f"""SELECT m.kind,m.id,m.ref,m.preimage,
          COALESCE(jsonb_agg(to_jsonb(t)) FILTER (WHERE t.id IS NOT NULL),'[]'::jsonb) AS matches
          FROM manifest m LEFT JOIN {table} t ON (t.id=m.id::uuid OR t.{ref}=m.ref)
          WHERE m.kind={quote(kind)} GROUP BY m.kind,m.id,m.ref,m.preimage""")
    sql = f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH manifest AS (
  SELECT * FROM jsonb_to_recordset({quote(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))}::jsonb)
    AS row(kind text,id text,ref text,preimage jsonb)
), matches AS (
  {' UNION ALL '.join(branches)}
), drift AS (
  SELECT kind,id,ref,
    CASE WHEN preimage IS NULL AND jsonb_array_length(matches)>0 THEN 'insert_collision'
      WHEN preimage IS NOT NULL AND jsonb_array_length(matches)<>1 THEN 'missing_or_ambiguous_identity'
      WHEN preimage IS NOT NULL AND (matches->0->>'id'<>id OR
        CASE kind WHEN 'resource' THEN matches->0->>'resource_id'
          WHEN 'monster' THEN matches->0->>'slug'
          ELSE matches->0->>'card_number' END <> ref) THEN 'identity_drift'
      WHEN preimage IS NOT NULL AND matches->0->'deleted_at'<>'null'::jsonb THEN 'deleted_identity'
      WHEN preimage IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_each(preimage) AS field
        WHERE (matches->0->field.key) IS DISTINCT FROM field.value
      ) THEN 'preimage_drift'
      ELSE NULL END AS reason
  FROM matches
)
SELECT jsonb_build_object(
  'active_cards',(SELECT count(*) FROM cards WHERE deleted_at IS NULL),
  'expected_active_cards',{source['expected_active_cards']},
  'manifest_rows',(SELECT count(*) FROM manifest),
  'drift_count',(SELECT count(*) FROM drift WHERE reason IS NOT NULL),
  'samples',(SELECT COALESCE(jsonb_agg(to_jsonb(sample)),'[]'::jsonb)
    FROM (SELECT kind,ref,reason FROM drift WHERE reason IS NOT NULL ORDER BY kind,ref LIMIT 50) sample)
)::text;
COMMIT;
"""
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(sql, encoding='utf-8')
    print(json.dumps({'output': str(OUTPUT), 'rows': len(rows)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
