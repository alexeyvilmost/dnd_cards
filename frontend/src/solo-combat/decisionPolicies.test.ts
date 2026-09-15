import {describe, expect, it} from 'vitest';
import {decisionOfferVisible, decisionPolicyToggles} from './decisionPolicies';
import {previewAttackDefense} from '../rules-core/handler';
import {effectiveArmorClass} from '../rules-core/actorArmorClass';
import fixture from '../pages/rulesLabFixture.generated.json';
import type {ActorState, RuleActionDefinition} from '../rules-core/domain';
import type {RollLog} from '../mvp/contracts';

const roll = (outcome: RollLog['outcome'], total = 16, natural = 12): RollLog => ({
  kind: 'd20', dice: [{sides: 20, result: natural}], modifiers: [{source: 'Атака', value: total-natural}],
  total, outcome, target: {type: 'ac', value: 15}, text: '', advantage: 'none',
});
function defense(value: string, id = 'defense'): RuleActionDefinition {
  return {id, name: 'Произвольная защита', kind: 'nonSpell', sourceEntityIds: ['test'], mechanics: {
    activation: {mode: 'reaction', cost: [{resource: 'reaction', amount: 1}]},
    effects: [{resolution: 'auto', who: 'self', result: [{kind: 'modifier', applies_to: {roll: 'ac'},
      op: 'add', value, duration: {type: 'until_start_of_next_turn'}}]}],
  }};
}
describe('data-owned decision policies', () => {
  it('defaults to asking; only attacks with actual hit outcomes are suppressed', () => {
    const toggles = decisionPolicyToggles('roll_influence');
    const prefs = {[toggles[0].id]: true};
    expect(decisionOfferVisible(toggles, {}, {roll: roll('hit')})).toBe(true);
    for (const outcome of ['hit', 'crit'] as const) expect(decisionOfferVisible(toggles, prefs, {roll: roll(outcome)})).toBe(false);
    expect(decisionOfferVisible(toggles, prefs, {roll: roll('miss', 30, 1)})).toBe(true);
    expect(decisionOfferVisible(toggles, prefs, {roll: {...roll('success'), kind: 'save', target: {type: 'dc', value: 15}}})).toBe(true);
    expect(decisionOfferVisible(toggles, prefs, {})).toBe(true);
  });
  it('uses each entity’s ID and mechanics, not its name; unknown outcomes stay visible', () => {
    const a = decisionPolicyToggles('reaction', defense('+5', 'a'));
    const b = decisionPolicyToggles('reaction', defense('+2', 'b'));
    expect(a).toHaveLength(1); expect(b).toHaveLength(1);
    const prefs = {[a[0].id]: true};
    expect(decisionOfferVisible(a, prefs, {changesOutcome: false})).toBe(false);
    expect(decisionOfferVisible(b, prefs, {changesOutcome: false})).toBe(true);
    expect(decisionOfferVisible(a, prefs, {})).toBe(true); // Magic Missile / unsupported context
    expect(decisionOfferVisible(a, prefs, {changesOutcome: true})).toBe(true);
  });
  it('previews real AC projection without spending, drawing dice or mutating the actor', () => {
    const actor = structuredClone(fixture.roots.wizard.actor) as unknown as ActorState;
    actor.runtime.resources.reaction = 1;
    const before = structuredClone(actor);
    const ac = effectiveArmorClass(actor);
    const attack = {...roll('hit', ac + 2), target: {type: 'ac' as const, value: ac}};
    expect(previewAttackDefense(actor, defense('+5'), attack)).toEqual({ac: ac+5, changesOutcome: true});
    expect(previewAttackDefense(actor, defense('+2', 'second-entity'), attack)).toEqual({ac: ac+2, changesOutcome: false});
    expect(previewAttackDefense(actor, defense('+5'), {...attack, outcome: 'crit', dice: [{sides:20,result:20}]}))
      .toEqual({ac: ac+5, changesOutcome: false});
    expect(previewAttackDefense(actor, defense('1d4'), attack)).toBeUndefined();
    expect(actor).toEqual(before);
  });
});
