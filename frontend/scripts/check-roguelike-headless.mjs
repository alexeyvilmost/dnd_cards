import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const temporary = await mkdtemp(path.join(tmpdir(), 'roguelike-headless-'));
try {
  const outfile = path.join(temporary, 'engine.cjs');
  const result = await build({
    stdin: { contents: `export * from './src/solo-combat/engine'; export * from './src/roguelike/combatWorker'; export * from './src/roguelike/combatCatalog'; export * from './src/roguelike/combatInitialization'; export {createWorld} from './src/rules-core/domain';`,
      resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile, metafile: true,
  });
  const forbidden = Object.keys(result.metafile.inputs).filter((name) =>
    /node_modules\/(react|react-dom)\//.test(name)
    || /^src\/api\//.test(name)
    || name === 'src/character/api.ts'
    || name === 'src/utils/resources.ts');
  assert.deepEqual(forbidden, [], 'rules bundle imports UI or HTTP transport');
  const engine = createRequire(import.meta.url)(outfile);
  const fixture = JSON.parse(await readFile('src/pages/rulesLabFixture.generated.json', 'utf8'));
  const actor = structuredClone(fixture.roots.magicInitiateFighter.actor);
  actor.runtime.hp = {current: 100, max: 100, temp: 0};
  actor.runtime.resources.reaction = 0;
  actor.ac = 10;
  const actions = fixture.roots.magicInitiateFighter.actions;
  const character = {id: actor.id, name: actor.name, user_id: 'headless-test', access_mode: 'owner',
    system_id: 'dnd5e-2024', ruleset_version: '2024', runtime_revision: 0,
    current_hp: 100, max_hp: 100, resources: actor.runtime.resources,
    max_resources: actor.runtime.maxResources, active_effects: actor.runtime.activeEffects,
    turn_state: {}, initiative_bonus: 20, speed: 30};
  const participant = {character, canonical: {actorId: actor.id,
    world: engine.createWorld({id: 'headless-test', ruleset: fixture.source.ruleset, actors: [actor]}),
    actions, catalog: {getAction: id => actions.find(action => action.id === id), listActions: () => actions},
    cards: [], resourceBindings: {}, actionFor: () => {throw Error('unexpected sheet-only lookup');}}};
  const attack = {id: 'headless-slam', name: 'Slam', mechanics: {
    activation: {mode: 'active', cost: [{resource: 'action', amount: 1}]},
    targeting: {domain: 'actor', actor_targets: true, shape: 'single', min_targets: 1, max_targets: 1,
      range_ft: 5, requires_line_of_sight: true, allowed_relations: ['enemy']},
    effects: [{resolution: 'attack_roll', ability: 'str', attack_kind: 'weapon_melee',
      attack_bonus_override: 4, vs: 'ac', on_hit: [{kind: 'damage', amount: 3, type: 'bludgeoning'}]}],
  }};
  const monster = {id: 'headless-monster', slug: 'headless', name: 'Training enemy',
    size: 'medium', creature_type: 'humanoid', armor_class: 10, max_hp: 10, speed: 30,
    initiative_bonus: 0, proficiency_bonus: 2,
    abilities: {str: 14, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
    action_ids: [attack.id], effect_ids: [], ai: {strategy: 'tactical'}};
  let state = await engine.createSoloCombatState({character, participant,
    selected: [{monster, quantity: 1}], actions: [attack], effects: [], rng: () => 0.5});
  const monsterId = Object.values(state.world.actors).find(entry => entry.kind === 'monster').id;
  state.tokens[actor.id].position = {x: 4, y: 4};
  state.tokens[monsterId].position = {x: 5, y: 4};
  state = engine.runMonsterTurn(engine.advanceTurn(state), () => 0.5);
  assert.equal(state.world.actors[actor.id].runtime.hp.current, 97);
  assert.equal(state.outcome, 'active');
  const pinned = JSON.parse(await readFile('src/roguelike/pinnedFighter.fixture.json', 'utf8'));
  const hash = `sha256:${'a'.repeat(64)}`;
  const initialized = await engine.initializeRoguelikeCombat({...pinned,
    seed: 'headless-initialization', monsters: {version: 1, monsters: [monster], actions: [attack], effects: []},
    roster: [{monster_id: monster.id, quantity: 1}]}, hash);
  assert.equal(initialized.status, 'ready');
  assert.equal(initialized.envelope.entropy.cursor, initialized.randomValues.length);
  const projected = engine.projectRoguelikeCombatPatch(initialized.envelope, pinned.character);
  assert.equal(projected.patch.runtime_revision, pinned.character.runtime_revision + 1);
  console.log('Headless rules gate: no React/API imports; setup and a real monster turn passed in Node.');
} finally {
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(tmpdir()));
  assert.ok(path.basename(temporary).startsWith('roguelike-headless-'));
  await rm(temporary, {recursive: true, force: true});
}
