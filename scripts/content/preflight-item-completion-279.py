"""Emit reversible SQL that checks the authored item patches on a restored snapshot.

Run the generated file with psql -X -v ON_ERROR_STOP=1 against a disposable
production clone. Every statement uses PostgreSQL's real column types and
constraints; the transaction always ends with ROLLBACK.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TABLES = {'card': 'cards', 'action': 'actions', 'effect': 'effects',
          'resource': 'resources', 'spell': 'spells', 'feat': 'feats', 'monster': 'monsters'}


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def quote(value):
    return "'" + value.replace("'", "''") + "'"


def statement(kind, identity, patch, insert):
    if not patch:
        return None
    table = TABLES[kind]
    columns = list(patch)
    record = f"jsonb_populate_record(NULL::{table},{quote(json.dumps(patch, ensure_ascii=False))}::jsonb)"
    if insert:
        names = ','.join(columns)
        return f'INSERT INTO {table} ({names}) SELECT {names} FROM {record};'
    setters = ','.join(f'{name}=patch.{name}' for name in columns)
    update = f'UPDATE {table} AS target SET {setters} FROM {record} AS patch WHERE target.id={quote(identity)}::uuid;'
    return f'DO $preflight$ BEGIN {update} IF NOT FOUND THEN RAISE EXCEPTION {quote(f"Missing preflight row {kind}:{identity}")}; END IF; END $preflight$;'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, default=ROOT / 'outputs/catalog-completion-20260929')
    parser.add_argument('--output', type=Path, default=ROOT / 'outputs/catalog-completion-20260929/dml-preflight.sql')
    args = parser.parse_args()
    source = load(args.snapshot / 'catalog.json')
    source['monsters'] = load(args.snapshot / 'monsters.json')
    known = {kind: {row['id'] for row in source.get(table, [])} for kind, table in TABLES.items()}
    cards = {row['card_number']: row for row in source['cards'] if row.get('deleted_at') is None}
    lines = ['BEGIN;']
    counts = {'updates': 0, 'inserts': 0}
    for part in ('low', 'middle', 'high'):
        batch = load(ROOT / f'scripts/content/data/item-completion-{part}-20260929.json')
        for ref, review in batch.items():
            patch = dict(review.get('patch', {}))
            patch['mechanics'] = review.get('mechanics')
            lines.append(statement('card', cards[ref]['id'], patch, False))
            counts['updates'] += 1
        related = load(ROOT / f'scripts/content/data/item-completion-{part}-related-20260929.json')['entities']
        for entity in related:
            kind, identity = entity['entity_type'], entity['id']
            insert = identity not in known[kind]
            sql = statement(kind, identity, entity['patch'], insert)
            if sql:
                lines.append(sql)
                counts['inserts' if insert else 'updates'] += 1
    lines.append('ROLLBACK;')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(args.output), **counts}, ensure_ascii=False))


if __name__ == '__main__':
    main()
