/** Offline diagnostic only. Input is a private, dependency-complete initialization
 * snapshot. Never writes to the service or modifies a saved player's run.
 * This deliberately narrow policy supports melee fighters with Second Wind and
 * Action Surge; unsupported decisions fail rather than count as a combat loss.
 */
import {readFileSync} from 'node:fs';
import {initializeRoguelikeCombat} from '../src/roguelike/combatInitialization';
import {stepRoguelikeCombat, type RoguelikeCombatIntent} from '../src/roguelike/combatWorker';
import {canStandActor} from '../src/solo-combat/engine';
import {gridDistanceFt, reachableRoutes} from '../src/solo-combat/tacticalGrid';

const [inputPath, repetitions = '100', counts = '1,2,3'] = process.argv.slice(2);
if (!inputPath) throw Error('Usage: bundled-balance.cjs private-input.json repetitions quantities');
const base = JSON.parse(readFileSync(inputPath, 'utf8'));
const runs = Number(repetitions);
if (!Number.isInteger(runs) || runs < 1 || runs > 10000 || base.roster.length !== 1) throw Error('Invalid diagnostic bounds');
const hash = `sha256:${'a'.repeat(64)}`;

async function main() {
  for (const count of counts.split(',').map(Number)) {
    if (!Number.isInteger(count) || count < 1 || count > 3) throw Error('Invalid quantity');
    let wins = 0, rounds = 0, remainingHP = 0;
    for (let seed = 0; seed < runs; seed++) {
      const input = structuredClone(base);
      input.seed = `roguelike-balance-v1:${seed}`;
      input.roster[0].quantity = count;
      const initial = await initializeRoguelikeCombat(input, hash);
      if (initial.status !== 'ready') throw Error('Incomplete diagnostic catalog');
      let envelope = initial.envelope;
      for (let steps = 0; envelope.state.outcome === 'active'; steps++) {
        if (steps >= 500) throw Error(`Policy stalled: quantity ${count}, seed ${seed}`);
        const s = envelope.state, id = s.characterId, actor = s.world.actors[id];
        const step = (intent: RoguelikeCombatIntent) => { envelope = stepRoguelikeCombat(envelope, intent, hash).envelope; };
        if (s.pendingTriggeredAction) { step({type: 'triggered_action', actionId: null}); continue; }
        if (s.pendingAdditionalMovement) { step({type: 'decline_movement', actorId: id}); continue; }
        if (s.world.pendingResolution || s.pendingD20Interrupt || s.pendingInterception || s.pendingTurnStartGrappleDamage || s.pendingAlertSwapActorIds?.length) {
          throw Error(`Unsupported policy decision: quantity ${count}, seed ${seed}`);
        }
        if (s.world.scene.mode !== 'encounter' || s.world.scene.initiative[s.world.scene.activeIndex] !== id) throw Error('Unsettled opponent turn');
        const actions = s.catalogActions.filter(a => s.playerActionIds.includes(a.id));
        const use = (name: string, targetIds: string[] = [id]) => {
          const action = actions.find(a => a.name === name);
          if (!action) throw Error(`Missing policy action: ${name}`);
          step({type: 'action', actorId: id, actionId: action.id, targetIds});
        };
        const resources = actor.runtime.resources;
        const hp = actor.runtime.hp;
        if (hp.max - hp.current >= 8 && resources.bonus_action > 0 && resources['uses_ACT-second-wind'] > 0) { use('Второе дыхание'); continue; }
        // Only use potions already present in the supplied snapshot.
        const potion = actions.find(a => a.name === 'Малое зелье лечения');
        if (hp.current * 2 <= hp.max && resources.bonus_action > 0 && potion) {
          try { step({type: 'action', actorId: id, actionId: potion.id, targetIds: []}); continue; }
          catch (error) { if (!/InsufficientResources|предмет|экземпляр|количеств|ресурс/i.test(String(error))) throw error; }
        }
        if (canStandActor(s, id)) { step({type: 'stand', actorId: id}); continue; }
        const origin = s.tokens[id].position;
        const enemies = Object.values(s.world.actors).filter(a => a.id !== id && a.runtime.hp.current > 0)
          .sort((a, b) => gridDistanceFt(origin, s.tokens[a.id].position) - gridDistanceFt(origin, s.tokens[b.id].position)
            || a.runtime.hp.current - b.runtime.hp.current || a.id.localeCompare(b.id));
        const enemy = enemies[0];
        if (!enemy) throw Error('Active encounter without opponents');
        const distance = gridDistanceFt(origin, s.tokens[enemy.id].position);
        if (distance <= 5 && (resources.action > 0 || resources.action_surge_action > 0)) { use('Рукопашная атака оружием', [enemy.id]); continue; }
        if (distance <= 5 && resources['uses_ACT-action-surge'] > 0) { use('Всплеск действий'); continue; }
        if (distance > 5) {
          const routes = reachableRoutes(s, id, s.movementRemainingFt[id] ?? 0)
            .filter(r => gridDistanceFt(r.destination, s.tokens[enemy.id].position) < distance)
            .sort((a, b) => gridDistanceFt(a.destination, s.tokens[enemy.id].position) - gridDistanceFt(b.destination, s.tokens[enemy.id].position)
              || a.costFt - b.costFt || a.destination.y - b.destination.y || a.destination.x - b.destination.x);
          if (routes.length) { step({type: 'move', actorId: id, destination: routes[0].destination}); continue; }
        }
        step({type: 'end_turn', actorId: id});
      }
      if (envelope.state.outcome === 'victory') wins++;
      rounds += envelope.state.world.scene.mode === 'encounter' ? envelope.state.world.scene.round : 0;
      remainingHP += envelope.state.world.actors[envelope.state.characterId].runtime.hp.current;
    }
    console.log(JSON.stringify({quantity: count, runs, wins, winRate: wins / runs, meanRounds: rounds / runs, meanRemainingHP: remainingHP / runs,
      policy: 'melee-focus-second-wind-surge-owned-potions-v1', scope: 'single supplied build, not whole fighter balance acceptance'}));
  }
}
main().catch(error => { console.error(String(error)); process.exitCode = 1; });


