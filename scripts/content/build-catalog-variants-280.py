"""Combine independently reviewed 280 manifests into one guarded migration input."""
from hashlib import sha256
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'outputs/catalog-completion-20260929/catalog.json'
DEST = ROOT / 'backend/migrations/data/catalog-variants-280/entities.json'
MANIFESTS = [
    ROOT / 'scripts/content/data/spell-variants-280.json',
    ROOT / 'scripts/content/data/action-variants-280.json',
    ROOT / 'scripts/content/data/multitarget-spells-280.json',
]
COMMON = set('name name_en description detailed_description mechanics related_actions related_effects related_cards type rarity is_extended'.split())
COLUMNS = {
    'spell': set('area level range damage ritual school classes duration heal_dice resources is_healing subclasses casting_time save_outcome concentration material_text component_verbal component_somatic component_material upcast_description'.split()),
    'action': set('price script weight properties distance recharge resource action_type recharge_custom'.split()),
}
INSERT = set('id card_number author source image_url deleted_at'.split())
ALLOWED_STATUS = {'not_verified', 'verified_partial', 'not_tested', 'narrative',
                  'partial_narrative_not_verified', 'partial_narrative_verified_partial'}

def digest(row):
    value = [row.get('description'), row.get('detailed_description')]
    return sha256(json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf8')).hexdigest()

source = json.loads(SOURCE.read_text(encoding='utf8'))
by_id = {kind: {row['id']: row for row in source[table]}
         for kind, table in [('spell', 'spells'), ('action', 'actions')]}
entries, ids, refs = [], set(), set()
for path in MANIFESTS:
    if not path.is_file():
        raise SystemExit(f'Missing independent 280 manifest: {path}')
    rows = json.loads(path.read_text(encoding='utf8'))
    if not isinstance(rows, list) or not rows:
        raise SystemExit(f'Empty 280 manifest: {path}')
    for row in rows:
        kind, entity_id, ref = row['entity_type'], row['id'], row['card_number']
        if kind not in COLUMNS or (kind, entity_id) in ids or (kind, ref) in refs:
            raise SystemExit(f'Duplicate/invalid 280 identity: {kind}:{ref}')
        ids.add((kind, entity_id)); refs.add((kind, ref))
        review = row.get('review')
        if not isinstance(review, dict) or review.get('status') not in ALLOWED_STATUS:
            raise SystemExit(f'{ref}: missing/invalid review')
        before = by_id[kind].get(entity_id)
        if row.get('preimage') is None:
            if before or any(x.get('card_number') == ref for x in by_id[kind].values()):
                raise SystemExit(f'{ref}: insert already exists in fresh snapshot')
            patch = {key: value for key, value in row['patch'].items()
                     if key in COMMON | COLUMNS[kind] | INSERT}
            if patch.get('id') != entity_id or patch.get('card_number') != ref or patch.get('name') != row['name']:
                raise SystemExit(f'{ref}: insert identity differs')
            if len(ref) > 50:
                raise SystemExit(f'{ref}: reference is too long for catalog table')
            description_hash = digest(patch)
        else:
            if not before or before.get('deleted_at') is not None or before.get('card_number') != ref:
                raise SystemExit(f'{ref}: patch has no exact active snapshot identity')
            if row['preimage'] != {'mechanics': before['mechanics']}:
                raise SystemExit(f'{ref}: mechanic preimage drifted from fresh snapshot')
            patch = row['patch']
            if set(patch) != {'mechanics'}:
                raise SystemExit(f'{ref}: parent patch must only change guarded mechanics')
            description_hash = digest(before)
        if row.get('description_sha256') not in (None, description_hash):
            raise SystemExit(f'{ref}: description digest differs')
        entries.append({**{key: row[key] for key in ('entity_type', 'id', 'card_number', 'name')},
                        'description_sha256': description_hash,
                        'preimage': row.get('preimage'), 'patch': patch,
                        'review': review})

manifest = {'schema_version': 1, 'audit_id': 'catalog-variants-multitarget-20260929',
            'source_snapshot_sha256': sha256(SOURCE.read_bytes()).hexdigest(),
            'entities': sorted(entries, key=lambda row: (row['entity_type'], row['id']))}
DEST.parent.mkdir(parents=True, exist_ok=True)
DEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(f'{len(entries)} guarded 280 rows -> {DEST}')
