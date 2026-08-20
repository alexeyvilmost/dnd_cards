import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EQUIPMENT_KITS,
  planRequiredBooks,
  planStructuralDataRepair,
  REQUIRED_BOOK_SPECS,
} from './repair-mini-mvp-structural-data.mjs';
import { MINI_MVP_MANIFEST } from './mini-mvp-manifest.mjs';

const klass = (entry) => ({
  id: entry.selector.cardNumber,
  card_number: entry.selector.cardNumber,
  name: entry.label,
  source: 'PHB 2024',
  equipment_options: {},
});

test('required PHB books are exact and idempotent', () => {
  const missing = planRequiredBooks([]);
  assert.deepEqual(missing.create.map((item) => item.key), ['spellbook', 'occultBook']);
  const cards = REQUIRED_BOOK_SPECS.map((spec, index) => ({
    id: `book-${index}`,
    name: spec.name,
    source: 'PHB 2024',
  }));
  const ready = planRequiredBooks(cards);
  assert.equal(ready.create.length, 0);
  assert.equal(ready.resolved.size, 2);
  assert.throws(() => planRequiredBooks([...cards, { ...cards[0], id: 'duplicate' }]), /duplicate/);
});

test('structural planner refuses equipment drift before overwriting it', () => {
  const classes = MINI_MVP_MANIFEST.collections.classes.map(klass);
  const equipmentCards = [...new Set(Object.values(EQUIPMENT_KITS).flatMap((kit) => (
    [kit.option_a, kit.option_b].flatMap((option) => option.items.map(([reference]) => reference))
  )).filter((reference) => reference.startsWith('CARD-')))].map((cardNumber) => ({
    id: `id:${cardNumber}`,
    card_number: cardNumber,
    name: cardNumber,
  }));
  const catalogs = {
    class: classes,
    card: [
      ...equipmentCards,
      ...REQUIRED_BOOK_SPECS.map((spec, index) => ({ id: `book-${index}`, name: spec.name, source: 'PHB 2024' })),
    ],
    race: [
      { id: 'dwarf', card_number: 'RACE-0003', name: 'Дварф', lineages: [] },
      { id: 'human', card_number: 'RACE-0002', name: 'Человек', lineages: [] },
    ],
    feat: [{ id: 'feat', card_number: 'FEAT-0009', name: 'Посвящённый в магию' }],
    spell: [{ id: 'spell', card_number: 'SPELL-0277', name: 'Разговор с животными' }],
  };
  assert.throws(() => planStructuralDataRepair(catalogs), /refusing equipment preimage/);
});

test('structural planner refuses unknown localized identity drift', () => {
  const classes = MINI_MVP_MANIFEST.collections.classes.map(klass);
  classes[0].name = 'Неизвестный';
  assert.throws(
    () => planStructuralDataRepair({ class: classes, card: [] }),
    /expected «Варвар»/,
  );
});
