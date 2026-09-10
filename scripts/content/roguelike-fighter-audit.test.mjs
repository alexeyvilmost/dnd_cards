import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCertificationIndex, dependencySnapshot} from './certification-hash.mjs';
import {auditRoguelikeFighterCatalog, projectFighterCoverageEntity} from './roguelike-fighter-audit.mjs';

test('a missing catalog never shrinks or certifies the required scope', () => {
  const audit = auditRoguelikeFighterCatalog({});
  assert.equal(audit.summary.roots, 240);
  assert.equal(audit.summary.ruleContracts, 8);
  assert.equal(audit.issues.filter(issue => issue.kind === 'missing').length, 232);
  assert.equal(audit.mechanicalAcceptanceComplete, false);
});

test('duplicate card identities remain a visible failure', () => {
  const audit = auditRoguelikeFighterCatalog({class: [
    {id: 'one', card_number: 'CLASS-warrior'}, {id: 'two', card_number: 'CLASS-warrior'},
  ]});
  assert.ok(audit.issues.some(issue => issue.kind === 'duplicate' && issue.cardNumber === 'CLASS-warrior'));
});

test('scopes progression before traversal and does not grant a spell-list class', () => {
  const root = {id: 'fighter', card_number: 'CLASS-warrior', level_progression: {
    1: {effects: ['early']}, 5: {effects: ['fifth']}, 6: {effects: ['sixth']},
  }};
  const index = buildCertificationIndex({class: [root, {id: 'wizard', card_number: 'CLASS-wizard',
    level_progression: {1: {effects: ['wizard-feature']}}, related_effects: ['wizard-feature']}],
  effect: [{id: 'early', mechanics: {spell_list_class_id: 'wizard'}}, {id: 'fifth'}, {id: 'sixth'}, {id: 'wizard-feature'}]});
  const before = structuredClone(root);
  const refs = dependencySnapshot(root, 'class', index, {projectEntity: projectFighterCoverageEntity}).map(ref => ref.identity).sort();
  assert.deepEqual(refs, ['class:wizard', 'effect:early', 'effect:fifth']);
  assert.deepEqual(root, before);
});

test('rejects unknown progression rather than silently omitting its features', () => {
  assert.throws(() => projectFighterCoverageEntity({card_number: 'CLASS-warrior', level_progression: {future: []}}, 'class'), /Unrecognized progression/);
});
