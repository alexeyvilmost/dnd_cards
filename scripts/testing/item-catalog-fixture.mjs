import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const cardNumbers = ['0714', '0790', '0799', '0820', '0822', '0829', '0832', '0856', '0869', '0889', '0918', '0922', '0937'].map(value => `CARD-${value}`);
const spellId = '6da6b18d-7609-4fcd-8078-8f979c4ffdeb';
// Runtime fields only: no user, review, media, cosmetic description, or timestamp metadata.
const cardFields = ['id', 'card_number', 'name', 'type', 'slot', 'range', 'weight', 'effects', 'mastery', 'contents', 'mechanics', 'attunement', 'bonus_type', 'properties', 'bonus_value', 'damage_type', 'weapon_type', 'defense_type', 'enchant_bonus', 'related_cards', 'related_actions', 'related_effects', 'battle_profile', 'container_mode', 'requires_attunement', 'elemental_damage_type', 'elemental_damage_value'];
const spellFields = ['id', 'card_number', 'name', 'level', 'range', 'duration', 'casting_time', 'classes', 'school', 'concentration', 'mechanics'];
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const project = (row, fields) => Object.fromEntries(fields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]]));

/** Reconstruct only reviewed catalog definitions already checked into migration inputs. Never reads outputs. */
export function buildItemCatalogFixture(root = repository) {
  const paths = ['backend/migrations/data/item-completion-279/items.json', 'backend/migrations/data/catalog-audit-20260929/spells.json'];
  const sources = paths.map(file => ({path: file, bytes: readFileSync(path.join(root, file))}));
  const [items, spells] = sources.map(source => JSON.parse(source.bytes));
  const select = (source, kind, match) => {
    const rows = source.entities.filter(row => row.entity_type === kind && match(row));
    if (rows.length !== 1 || rows[0].preimage.deleted_at !== null) throw Error('Fixture definition must be a unique active catalog migration input');
    const row = rows[0];
    return {id: row.id, card_number: row.card_number, name: row.name, ...row.preimage, ...row.patch};
  };
  const cards = cardNumbers.map(number => project(select(items, 'card', row => row.card_number === number), cardFields));
  const selectedSpells = [project(select(spells, 'spell', row => row.id === spellId), spellFields)];
  return {
    cards,
    spells: selectedSpells,
    provenance: {
      schemaVersion: 1,
      purpose: 'Minimal item mechanics test inputs, not certification or a production catalog',
      projection: 'exact selected runtime fields of checked-in preimage followed by declared patch',
      sources: sources.map(source => ({path: source.path, sha256: hash(source.bytes)})),
      selections: {cards: cards.map(row => ({id: row.id, card_number: row.card_number})), spells: selectedSpells.map(row => ({id: row.id, card_number: row.card_number}))},
      fields: {cards: cardFields, spells: spellFields},
      projections: {cards: hash(JSON.stringify(cards)), spells: hash(JSON.stringify(selectedSpells))},
      supportStatusIncluded: false,
      historicalCertificatesChanged: false,
    },
  };
}
