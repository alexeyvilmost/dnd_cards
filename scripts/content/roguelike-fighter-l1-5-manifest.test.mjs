import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROGUELIKE_FIGHTER_MANIFEST as manifest,
  flattenRoguelikeFighterManifest,
  validateRoguelikeFighterManifest,
} from './roguelike-fighter-l1-5-manifest.mjs';

const cards = collection => manifest.collections[collection].map(entry => entry.selector.cardNumber);

test('pins the Fighter union independently of database readiness', () => {
  assert.deepEqual(validateRoguelikeFighterManifest(), []);
  assert.equal(flattenRoguelikeFighterManifest().length, 240);
  assert.deepEqual(cards('classes'), ['CLASS-warrior']);
  assert.deepEqual(cards('subclasses').sort(), ['fighter_battle_master', 'fighter_champion', 'fighter_eldritch_knight', 'fighter_psi_warrior']);
  assert.equal(cards('maneuvers').length, 20);
  assert.equal(manifest.collections.masteries.length, 8);
  assert.equal(manifest.evidencePolicy.rootPresenceIsCertification, false);
  assert.equal(manifest.evidencePolicy.respectChoicePrerequisites, true);
});

test('includes feat and species spell routes without opening other class spell lists', () => {
  for (const card of ['SPELL-0287', 'SPELL-0223', 'SPELL-0183', 'SPELL-0187', 'hellish_rebuke', 'SPELL-0241']) {
    assert.ok(cards('firstLevelSpells').includes(card), `${card} is reachable`);
  }
  for (const card of ['SPELL-0164', 'SPELL-0189', 'SPELL-0247', 'SPELL-0254', 'SPELL-0283']) {
    assert.ok(!cards('firstLevelSpells').includes(card), `${card} has no legal Fighter route`);
  }
  for (const card of ['SPELL-0205', 'SPELL-0226', 'SPELL-0315']) assert.ok(!cards('cantrips').includes(card));
  assert.deepEqual(cards('secondLevelSpells').sort(), ['SPELL-0231', 'SPELL-0239', 'darkness', 'hold_person',
    'misty_step', 'pass_without_trace', 'ray_of_enfeeblement'].sort());
  assert.equal(manifest.collections.thirdLevelSpells, undefined);
});

test('does not silently shrink required content when a collection is incomplete', () => {
  const changed = structuredClone(manifest);
  changed.collections.subclasses.pop();
  changed.collections.cantrips.pop();
  assert.deepEqual(validateRoguelikeFighterManifest(changed), ['subclasses: expected 4', 'cantrips: expected 31']);
});

test('rejects duplicate roots and changing the class-level scope', () => {
  const changed = structuredClone(manifest);
  changed.collections.maneuvers[1] = changed.collections.maneuvers[0];
  changed.maxCharacterLevel = 6;
  assert.deepEqual(validateRoguelikeFighterManifest(changed), ['scope', 'duplicate identity']);
});
