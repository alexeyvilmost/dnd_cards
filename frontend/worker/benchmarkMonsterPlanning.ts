/** Offline planning benchmark. Reads a private replay baseline, never contacts
 * the service. Synthetic board density measures only the planner, not combat
 * balance or the time to persist a complete server command. */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { createMonsterRouteRiskEvaluator, monsterRouteOpportunityRisk } from '../src/solo-combat/engine';
import { planMonsterTurn } from '../src/solo-combat/monsterAi';
import type { SoloCombatState } from '../src/solo-combat/types';

const [path, iterationsText = '100'] = process.argv.slice(2);
const iterations = Number(iterationsText);
if (!path || !Number.isInteger(iterations) || iterations < 1 || iterations > 1000) throw Error('Expected private replay path and 1–1000 iterations');
const replay = JSON.parse(readFileSync(path, 'utf8'));
const baseline = replay[0]?.baseline?.state as SoloCombatState;
if (!baseline?.world || !baseline.characterId) throw Error('Replay has no baseline');
const source = Object.values(baseline.world.actors).find(actor => actor.kind === 'monster');
if (!source) throw Error('Baseline has no monster');

for (const count of [1, 3, 6]) {
  const state = structuredClone(baseline);
  const target = state.characterId;
  const targetActor = state.world.actors[target];
  targetActor.runtime.resources.reaction = 1;
  state.world.actors = { [target]: targetActor };
  state.tokens = { [target]: { ...state.tokens[target], position: { x: 4, y: 4 } } };
  const monsters = Array.from({ length: count }, (_, index) => {
    const id = `planning-benchmark:${index}`;
    const actor = { ...structuredClone(source), id };
    state.world.actors[id] = actor;
    state.tokens[id] = { ...baseline.tokens[source.id], actorId: id, position: { x: 5 + index % 3, y: 4 + Math.floor(index / 3) } };
    state.sideByActorId[id] = baseline.sideByActorId[source.id];
    state.monsterActionIds[id] = [...baseline.monsterActionIds[source.id]];
    state.movementRemainingFt[id] = 30;
    return actor;
  });
  const run = (cached: boolean) => monsters.map(monster => planMonsterTurn(
    state, monster, target, 60, 20, cached ? createMonsterRouteRiskEvaluator(state, monster.id)
      : (origin, route) => monsterRouteOpportunityRisk(state, monster.id, origin, route),
  ));
  const expected = run(false);
  if (!isDeepStrictEqual(expected, run(true))) throw Error('Optimization changed a selected route');
  const samples = (cached: boolean) => {
    const values: number[] = [];
    for (let index = 0; index < iterations; index++) {
      const start = performance.now();
      const result = run(cached);
      values.push(performance.now() - start);
      if (!isDeepStrictEqual(expected, result)) throw Error('Planner is not deterministic');
    }
    values.sort((a, b) => a - b);
    return { meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
      p95Ms: values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)] };
  };
  console.log(JSON.stringify({ monsters: count, iterations, uncached: samples(false), cached: samples(true),
    identicalPlans: true, scope: 'synthetic board density, planner only' }));
}
