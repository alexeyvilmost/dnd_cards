import { createWorld, type ActorState, type GameCommand, type RuleActionDefinition, type SpatialFacts, type WorldState } from '../domain';
import { handleCommand } from '../handler';
import { createStrictRngTape, createSequentialIdFactory, type DieTapeEntry } from '../determinism';

const ruleset = { systemId: 'dnd5e-2024' as const, releaseId: 'event-queue-refactor-v1', contentHash: 'sha256:synthetic-event-queue-v1', errataVersion: '2024' };
const facts: SpatialFacts = { factsSource: 'scenario', boardRevision: 1, distanceFt: 5, relation: 'enemy', cover: 'none', lineOfSight: true };
const actor = (id: string, actionIds: string[]): ActorState => ({ id, name: id, kind: 'playerCharacter', controllerId: id, ac: 12,
  capabilities: { actionIds }, character: { abilityMods: { str: 3, dex: 0, con: 0, int: 0, wis: 0, cha: 0 }, profBonus: 2, level: 1 },
  runtime: { hp: { current: 30, max: 30, temp: 0 }, resources: { action: 1, reaction: 1, bonus_action: 1 },
    maxResources: { action: 1, reaction: 1, bonus_action: 1 }, inventory: [], equipment: {}, activeEffects: [] } });
const strike: RuleActionDefinition = { id: 'strike', name: 'Synthetic strike', kind: 'nonSpell', sourceEntityIds: ['synthetic-weapon'],
  targeting: { minTargets: 1, maxTargets: 1, rangeFt: 5, requiresLineOfSight: true, allowedRelations: ['enemy'] },
  mechanics: { activation: { mode: 'active', cost: [{ resource: 'action', amount: 1 }] },
    effects: [{ resolution: 'attack_roll', ability: 'str', attack_kind: 'melee', on_hit: [{ kind: 'damage', amount: 3, type: 'bludgeoning' }] }] } };
const reaction = (id: string, event: string, amount: number): RuleActionDefinition => ({
  id, name: id, kind: 'nonSpell', sourceEntityIds: [`${id}-source`], targeting: strike.targeting,
  mechanics: { damage_source_kind: 'item', activation: { mode: 'reaction', cost: [{ resource: 'reaction', amount: 1 }],
    trigger: { event, timing: 'after', subject: 'self' } }, effects: [{ resolution: 'auto', who: 'target', result: [{ kind: 'damage', amount, type: 'fire' }] }] },
});
export interface HandlerReplayCase {
  name: string; world: WorldState; command: GameCommand; actions: RuleActionDefinition[];
  dice: DieTapeEntry[]; ids: string[]; clock: number; result: ReturnType<typeof handleCommand>;
}

/** Synthetic inputs for an explicit write-once capture. Normal tests never regenerate expected results. */
export function recordHandlerReplayCorpus(): HandlerReplayCase[] {
  const cases: HandlerReplayCase[] = [];
  function session(name: string, actions: RuleActionDefinition[], actors: ActorState[]) {
    let world = createWorld({ id: name, ruleset, actors });
    let index = 0;
    const allActions = [strike, ...actions], catalog = { getAction: (id: string) => allActions.find(action => action.id === id) };
    const execute = (input: Record<string, unknown>, dice: DieTapeEntry[] = [], accepted = true) => {
      const command = { schemaVersion: 1, commandId: `${name}:${index++}`, expectedRevision: world.revision,
        rulesetContentHash: ruleset.contentHash, actorId: 'a', ...input } as GameCommand;
      const before = structuredClone(world), tape = createStrictRngTape(dice), ids: string[] = [], next = createSequentialIdFactory(command.commandId);
      const result = handleCommand(world, command, catalog, { rng: tape.rng, clock: () => 5, nextId: () => { const id = next(); ids.push(id); return id; } });
      if (accepted !== (result.status === 'accepted')) throw new Error(`Unexpected capture outcome ${name}/${command.type}: ${result.status}`);
      tape.assertExhausted();
      cases.push(structuredClone({ name: `${name}/${index}/${command.type}`, world: before, command, actions: allActions, dice, ids, clock: 5, result }));
      if (result.status === 'accepted') world = JSON.parse(JSON.stringify(result.nextState));
      return command;
    };
    const attack = (face = 12) => execute({ type: 'UseAction', actionId: strike.id, targetIds: ['b'], factsByTarget: { b: facts } }, [{ label: 'attack', sides: 20, value: face }]);
    const resolve = (actionId: string | null) => {
      const pending = world.pendingResolution;
      if (!pending || pending.type !== 'event_reaction') throw new Error(`Missing event decision in ${name}`);
      return execute({ type: 'ResolveDecision', actorId: pending.request.actorId, resolutionId: pending.id, requestId: pending.request.id, response: { kind: 'reaction', actionId } });
    };
    return { attack, resolve, execute, world: () => world };
  }
  for (const spec of [{ event: 'attacked', id: 'retaliate', owner: 'b', amount: 4 }, { event: 'damage_dealt', id: 'echo', owner: 'a', amount: 2 }]) {
    const action = reaction(spec.id, spec.event, spec.amount);
    const test = session(`paid-${spec.id}`, [action], [actor('a', ['strike', ...(spec.owner === 'a' ? [action.id] : [])]), actor('b', spec.owner === 'b' ? [action.id] : [])]);
    test.attack(); const accepted = test.resolve(action.id);
    test.execute({ ...accepted, expectedRevision: test.world().revision }, [], false);
  }
  const first = reaction('retaliate', 'attacked', 2), second = reaction('echo', 'damage_dealt', 3);
  const queue = session('ordered-declines', [first, second], [actor('a', ['strike', second.id]), actor('b', [first.id])]);
  queue.attack(20); queue.resolve(null); queue.resolve(null);
  for (const [index, amount] of [2, 5].entries()) {
    const counter: RuleActionDefinition = { ...strike, id: `observer-${index}`, name: `Observer ${index}`, mechanics: {
      activation: { mode: 'triggered', optional: false, cost: [], trigger: { event: 'attacked', timing: 'after', observer_range_ft: 10,
        observer_relations: ['enemy'], exclude_self_target: true, target_event: 'source' } },
      effects: [{ resolution: 'attack_roll', ability: 'str', attack_kind: 'melee', on_hit: [{ kind: 'damage', amount, type: 'piercing' }] }],
    } };
    const observer = actor('c', [counter.id]); observer.character.spatialObservations = { boardRevision: 1,
      nearby: [{ actorId: 'a', distanceFt: 5, relation: 'enemy', lineOfSight: true, canSeeTarget: true }] };
    const test = session(`automatic-${index}`, [counter], [actor('a', ['strike']), actor('b', []), observer]);
    test.execute({ type: 'UseAction', actionId: strike.id, targetIds: ['b'], factsByTarget: { b: facts } },
      [{ label: 'attack', sides: 20, value: 12 }, { label: 'counter', sides: 20, value: 11 }]);
  }
  for (const trigger of [{ requires_weapon_or_unarmed_hit: true }, { unsupported_fixture_gate: true }]) {
    const action = reaction('unowned', 'hit', 9);
    action.mechanics.activation = { mode: 'triggered', optional: false, cost: [], trigger: { event: 'hit', ...trigger } };
    session(`unowned-${Object.keys(trigger)[0]}`, [action], [actor('a', ['strike', action.id]), actor('b', [])]).attack();
  }
  return cases;
}
