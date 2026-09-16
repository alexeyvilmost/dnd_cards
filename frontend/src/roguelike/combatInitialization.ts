import type {Action, PassiveEffect} from '../types';
import type {ForgeCharacter} from '../character/types';
import type {Monster} from '../monsters/types';
import {runtimeInventoryPayload} from '../character/runtime';
import {createSoloCombatState} from '../solo-combat/engine';
import {writeDedicatedCombatTurnState} from '../solo-combat/turnState';
import {prepareRoguelikeCombatParticipant, type FrozenCombatCatalog} from './combatCatalog';
import {createRoguelikeCombatRandom, stepRoguelikeCombat, type RoguelikeCombatEnvelope} from './combatWorker';

export interface RoguelikeCombatInitialization {
  character: ForgeCharacter;
  characters?: ForgeCharacter[];
  catalog: FrozenCombatCatalog;
  basicActionIds: string[];
  monsters: {version: 1; monsters: Monster[]; actions: Action[]; effects: PassiveEffect[]};
  roster: Array<{monster_id: string; quantity: number}>;
  seed: string;
  initiativeManeuverActionId?: string;
  mapIndex?: number;
  mapSeed?: number;
}

export async function initializeRoguelikeCombat(input: RoguelikeCombatInitialization, artifactHash: string) {
  if (!/^sha256:[a-f0-9]{64}$/.test(artifactHash) || input.monsters.version !== 1) throw new Error('Несовместимая версия каталога');
  if (!input.roster.length || input.roster.length > 8) throw new Error('Некорректный состав столкновения');
  const seen = new Set<string>();
  const selected = input.roster.map(entry => {
    const monster = input.monsters.monsters.find(row => row.id === entry.monster_id);
    if (!monster || seen.has(monster.id) || !Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > (input.characters?.length ? 24 : 8)) {
      throw new Error('Некорректный участник столкновения');
    }
    seen.add(monster.id);
    return {monster, quantity: entry.quantity};
  });
  const characters = input.characters ?? [input.character];
  if (!characters.length || characters.length > 6 || characters[0].id !== input.character.id
    || new Set(characters.map(c=>c.id)).size!==characters.length) throw new Error('Некорректная группа');
  if (input.roster.reduce((sum, entry) => sum + entry.quantity, 0) > Math.min(24,8*characters.length)) throw new Error('Слишком много противников');
  const participants=await Promise.all(characters.map(character=>prepareRoguelikeCombatParticipant(character,input.catalog,input.basicActionIds)));
  const needs=participants.flatMap(p=>p.status==='needs_content'?p.needs:[]);
  if(needs.length)return {status:'needs_content' as const,needs};
  const prepared=participants[0];if(prepared.status!=='ready')return prepared;
  const allies=participants.slice(1).flatMap(p=>p.status==='ready'?[p.participant]:[]);
  const random = createRoguelikeCombatRandom(input.seed, 0);
  const state = await createSoloCombatState({character: input.character, participant: prepared.participant,
    selected, actions: [...input.monsters.actions, ...input.catalog.entities.action],
    effects: input.monsters.effects, rng: random.rng, mapIndex: input.mapIndex, mapSeed:input.mapSeed, allies,
    ...(input.initiativeManeuverActionId ? {initiativeManeuverActionIds: {[input.character.id]: input.initiativeManeuverActionId}} : {})});
  const envelope: RoguelikeCombatEnvelope = {schemaVersion: 1, artifactHash,
    entropy: {seed: input.seed, cursor: random.cursor}, state};
  const settled = state.outcome === 'active'
    ? stepRoguelikeCombat(envelope, {type: 'resume'}, artifactHash)
    : {envelope, randomValues: [] as number[]};
  return {status: 'ready' as const, ...settled, contentManifestHash: prepared.contentManifestHash,
    randomValues: [...random.randomValues, ...settled.randomValues]};
}

/** Atomic mirrors for every controlled sheet; one authoritative envelope. */
export function projectRoguelikePartyCombatPatch(envelope:RoguelikeCombatEnvelope,characters:ForgeCharacter[]) {
  const ids=envelope.state.controlledCharacterIds??[envelope.state.characterId];
  if (characters.length!==ids.length || new Set(characters.map(c=>c.id)).size!==ids.length
    || characters.some(c=>!ids.includes(c.id)))throw Error('Состав группы не совпадает с боем');
  const revisions=Object.fromEntries(characters.map(c=>[c.id,Number(c.runtime_revision)+1]));
  if(Object.values(revisions).some(r=>!Number.isSafeInteger(r)||r<1))throw Error('Некорректная ревизия персонажа');
  const state={...envelope.state,participantRuntimeRevisions:revisions,runtimeRevision:revisions[envelope.state.characterId]};
  const patches=Object.fromEntries(characters.map(character=>{
    const actor=state.world.actors[character.id];if(!actor)throw Error('Участник отсутствует');
    return [character.id,{current_hp:actor.runtime.hp.current,resources:actor.runtime.resources,max_resources:actor.runtime.maxResources,
      active_effects:actor.runtime.activeEffects,inventory_items:runtimeInventoryPayload(actor.runtime),equipment:actor.runtime.equipment,
      turn_state:writeDedicatedCombatTurnState(character.turn_state,actor.runtime,state,{actorId:character.id,includeSnapshot:character.id===state.characterId}),runtime_revision:revisions[character.id]}];
  }));
  return {envelope:{...envelope,state},patch:patches[state.characterId],patches};
}

/** Same character projection as the dedicated battle page; called only after
 * trusted execution. The caller commits this and the private envelope together. */
export function projectRoguelikeCombatPatch(envelope: RoguelikeCombatEnvelope, character: ForgeCharacter) {
  const actor = envelope.state.world.actors[character.id];
  if (!actor || envelope.state.characterId !== character.id) throw new Error('Чужой персонаж в снимке боя');
  const runtimeRevision = Number(character.runtime_revision) + 1;
  if (!Number.isSafeInteger(runtimeRevision) || runtimeRevision < 1) throw new Error('Некорректная ревизия персонажа');
  const state = {...envelope.state, runtimeRevision,
    participantRuntimeRevisions: {...envelope.state.participantRuntimeRevisions, [character.id]: runtimeRevision}};
  return {envelope: {...envelope, state}, patch: {
    current_hp: actor.runtime.hp.current, resources: actor.runtime.resources, max_resources: actor.runtime.maxResources,
    active_effects: actor.runtime.activeEffects, inventory_items: runtimeInventoryPayload(actor.runtime),
    equipment: actor.runtime.equipment, turn_state: writeDedicatedCombatTurnState(character.turn_state, actor.runtime, state),
    runtime_revision: runtimeRevision,
  }};
}
