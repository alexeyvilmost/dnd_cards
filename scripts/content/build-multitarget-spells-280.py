"""Guarded 280 manifest: active spells with independently selected target slots.

The content snapshot is data provenance only. Runtime targeting and attack
resolution are generic; no spell/card identities are consulted there.
"""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'outputs/catalog-completion-20260929/spells.json'
DEST = ROOT / 'scripts/content/data/multitarget-spells-280.json'
ROWS = {row['card_number']: row for row in json.loads(SOURCE.read_text(encoding='utf8'))
        if row.get('deleted_at') is None}

# One more *distinct creature* per higher slot. Rows with choice variants are
# owned by build-spell-variants-280.mjs and deliberately excluded here.
UPCAST_ONE = (
    'SPELL-0274',  # Jump
    'SPELL-0163',  # Bless, three at base level
    'hold_monster',
    'hold_person',
    'SPELL-0199',  # Tasha's Hideous Laughter
    'SPELL-0181',  # Heroism
    'SPELL-0251',  # Charm Person
    'freedom_of_movement',
    'SPELL-0258',  # Spider Climb
    'banishment',
    'SPELL-0193',  # Animal Friendship
    'SPELL-0267',  # Bane, three at base level
    'SPELL-0231',  # Invisibility
    'charm_monster',
    'longstrider',
    'gaseous_form',
    'fly',
)
BASE_MULTI = {
    'SPELL-0226': (1, 1),  # Eldritch Blast: rays scale by character level
    'SPELL-0255': (3, 3),  # Scorching Ray: exactly three attack slots
    'steel_wind_strike': (1, 5),
    'chain_lightning': (1, 4),
}

def patch_targeting(ref, mechanic):
    target = mechanic['targeting']
    target['shape'] = 'multiple'
    if ref in UPCAST_ONE or ref == 'chain_lightning' or ref == 'SPELL-0255':
        target['additional_target_slots_per_spell_slot_above_base'] = 1
    if ref in BASE_MULTI:
        target['min_targets'], target['max_targets'] = BASE_MULTI[ref]
    if ref == 'chain_lightning':
        target['additional_targets_within_ft_of_first'] = 30
    if ref == 'SPELL-0255':
        target['allow_repeat_targets'] = True
        # Higher slots create another ray; each ray still deals 2d6.
        for effect in mechanic['effects']:
            if effect.get('resolution') == 'attack_roll':
                for damage in effect.get('on_hit', []):
                    damage.pop('scaling', None)
    if ref == 'SPELL-0226':
        target.update({
            'domain': 'actor', 'actor_targets': True, 'min_targets': 1,
            'max_targets': 1, 'range_ft': 120, 'requires_line_of_sight': True,
            'allowed_relations': ['self', 'ally', 'enemy', 'neutral'],
            'allow_repeat_targets': True,
            'target_slots_by_character_level': {'1': 1, '5': 2, '11': 3, '17': 4},
        })
        # Each beam remains 1d10; the number of attacks changes instead.
        for effect in mechanic['effects']:
            if effect.get('resolution') == 'attack_roll':
                for damage in effect.get('on_hit', []):
                    damage.pop('scaling', None)

def review(ref):
    details = {
        'SPELL-0226': 'По уровням персонажа 1/5/11/17 создаётся 1/2/3/4 отдельных луча по 1к10; цель можно повторить.',
        'SPELL-0255': 'Каждый луч — отдельная дальнобойная атака 2к6; одну цель можно выбрать повторно.',
        'steel_wind_strike': 'Каждое из максимум пяти существ получает отдельную атаку 6к10.',
        'chain_lightning': 'Дополнительные цели находятся не дальше 30 футов от первой; при повышении уровня добавляется одна.',
    }
    limitations = []
    if ref == 'steel_wind_strike': limitations = ['Телепортация после атак остаётся нарративным выбором до задания точки на поле.']
    evidence = ['Свежий production snapshot 2026-09-29; описание и upcast_description сущности.']
    if ref == 'SPELL-0226':
        evidence = ['Свежий production snapshot 2026-09-29;',
                    'SRD 5.2.1: https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf']
    return {
        'status': 'not_verified',
        'summary': details.get(ref, 'Число отдельных целей определяется исходным и повышенным уровнем ячейки.'),
        'implemented': ['Контракт выбора целей хранится в данных; авторитетный движок проверяет количество и геометрию.'],
        'tested': [],
        'limitations': limitations,
        'evidence': evidence,
    }

entries = []
for ref in sorted(set(UPCAST_ONE) | set(BASE_MULTI)):
    row = ROWS[ref]
    before = deepcopy(row['mechanics'])
    after = deepcopy(before)
    patch_targeting(ref, after)
    if before == after:
        raise SystemExit(f'{ref}: no mechanics change')
    description = [row.get('description'), row.get('detailed_description')]
    digest = sha256(json.dumps(description, ensure_ascii=False, separators=(',', ':')).encode('utf8')).hexdigest()
    entries.append({
        'entity_type': 'spell', 'id': row['id'], 'card_number': ref,
        'name': row['name'], 'description_sha256': digest,
        'preimage': {'mechanics': before}, 'patch': {'mechanics': after},
        'review': review(ref),
    })
DEST.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(f'{len(entries)} multi-target spell patches -> {DEST}')
