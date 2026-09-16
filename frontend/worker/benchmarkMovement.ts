/** Offline measurements only. An isolated copy never writes back to a run. */
import {readFileSync} from 'node:fs';
import {reachableRoutes} from '../src/solo-combat/tacticalGrid';
import {moveActorAlongRoute} from '../src/solo-combat/engine';
import {stepRoguelikeCombat} from '../src/roguelike/combatWorker';
import {projectRoguelikeCombatPatch} from '../src/roguelike/combatInitialization';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const state = input.envelope.state;
const actorId = state.characterId;
// No player decisions or opponents turn are simulated by this route benchmark.
state.world.scene.activeIndex = state.world.scene.initiative.indexOf(actorId);
state.world.pendingResolution = null;
for (const key of Object.keys(state)) if (key.startsWith('pending') || key === 'playerMovement') delete state[key];
state.world.actors[actorId].runtime.hp.current = state.world.actors[actorId].runtime.hp.max;
state.outcome = 'active';
state.movementRemainingFt[actorId] = 60;
const routes = reachableRoutes(state, actorId, 60);
const measure = (name: string, run: () => unknown) => {
  const times = [];
  for (let n = 0; n < 25; n++) {const start = performance.now(); run(); times.push(performance.now() - start);}
  times.sort((a,b) => a-b);
  console.log(JSON.stringify({name, medianMs: times[12], p95Ms: times[23]}));
};
for (const cost of [5, 30]) {
  const route = routes.find(r => r.costFt === cost);
  if (!route) continue;
  measure(`movement-${cost}`, () => moveActorAlongRoute({state: structuredClone(state), actorId, destination: route.destination, rng: () => .5}));
  measure(`worker-${cost}`, () => {
    const result = stepRoguelikeCombat(input.envelope, {type:'move',actorId,destination:route.destination}, input.envelope.artifactHash);
    JSON.stringify(projectRoguelikeCombatPatch(result.envelope, input.character));
  });
}
