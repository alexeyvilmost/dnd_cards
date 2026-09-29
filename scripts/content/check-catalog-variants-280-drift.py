"""Generate a read-only live preimage check for the guarded 280 manifest.

The SQL reports counts and public refs only. It never reads passwords, writes
catalog rows, or applies migration 280; run it before a production release.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'backend/migrations/data/catalog-variants-280/entities.json'
SNAPSHOT = ROOT / 'outputs/catalog-completion-20260929/catalog.json'
OUTPUT = ROOT / 'outputs/catalog-completion-20260929/prod-drift-280.sql'
TABLES = {'spell': 'spells', 'action': 'actions'}


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def main():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    snapshot = json.loads(SNAPSHOT.read_text(encoding='utf-8'))
    source = {kind: {row['id']: row for row in snapshot[table]}
              for kind, table in TABLES.items()}
    rows = []
    for entry in manifest['entities']:
        kind, identity = entry['entity_type'], entry['id']
        if kind not in TABLES:
            raise SystemExit(f'Unknown 280 entity kind: {kind}')
        before = source[kind].get(identity)
        if entry['preimage'] is not None and before is None:
            raise SystemExit(f'Missing source snapshot identity: {kind}:{identity}')
        rows.append({'kind': kind, 'id': identity, 'ref': entry['card_number'],
                     'preimage': entry['preimage'],
                     'description_pair': [before.get('description'), before.get('detailed_description')]
                     if before else None})
    if len(rows) != len({(row['kind'], row['id']) for row in rows}):
        raise SystemExit('Duplicate 280 identity')
    branches = []
    for kind, table in TABLES.items():
        branches.append(f"""SELECT m.kind,m.id,m.ref,m.preimage,m.description_pair,
          COALESCE(jsonb_agg(to_jsonb(t)) FILTER (WHERE t.id IS NOT NULL),'[]'::jsonb) AS matches
          FROM manifest m LEFT JOIN {table} t ON (t.id=m.id::uuid OR t.card_number=m.ref)
          WHERE m.kind={quote(kind)} GROUP BY m.kind,m.id,m.ref,m.preimage,m.description_pair""")
    sql = f"""BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH manifest AS (
  SELECT * FROM jsonb_to_recordset({quote(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))}::jsonb)
    AS row(kind text,id text,ref text,preimage jsonb,description_pair jsonb)
), matches AS (
  {' UNION ALL '.join(branches)}
), drift AS (
  SELECT kind,id,ref,
    CASE WHEN preimage IS NULL AND jsonb_array_length(matches)>0 THEN 'insert_collision'
      WHEN preimage IS NOT NULL AND jsonb_array_length(matches)<>1 THEN 'missing_or_ambiguous_identity'
      WHEN preimage IS NOT NULL AND (matches->0->>'id'<>id OR matches->0->>'card_number'<>ref) THEN 'identity_drift'
      WHEN preimage IS NOT NULL AND matches->0->'deleted_at'<>'null'::jsonb THEN 'deleted_identity'
      WHEN preimage IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_each(preimage) AS field
        WHERE (matches->0->field.key) IS DISTINCT FROM field.value
      ) THEN 'preimage_drift'
      WHEN preimage IS NOT NULL AND jsonb_build_array(matches->0->'description',matches->0->'detailed_description')
        IS DISTINCT FROM description_pair THEN 'description_drift'
      ELSE NULL END AS reason
  FROM matches
)
SELECT jsonb_build_object(
  'manifest_rows',(SELECT count(*) FROM manifest),
  'patches',(SELECT count(*) FROM manifest WHERE preimage IS NOT NULL),
  'inserts',(SELECT count(*) FROM manifest WHERE preimage IS NULL),
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
