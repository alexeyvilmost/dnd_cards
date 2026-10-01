import type {ActorState} from '../rules-core/domain';
import type {EngineEvent} from '../mvp/contracts';
import type {CombatBeat} from './presentation';
import type {CombatLogEntry, CombatLogEventRecord, GridPosition, SoloCombatState} from './types';
import {combatLogRecords} from './combatLog';

export type CombatPresentationPhase = 'start' | 'impact' | 'end';
export type CombatPresentationChange =
  | {phase: 'start'; kind: 'movement'; actorId: string; position: GridPosition}
  | {phase: 'start'; kind: 'turn'; actorId: string; round: number}
  | {phase: 'impact'; kind: 'health'; actorId: string; event: Extract<EngineEvent, {type: 'damage' | 'healing' | 'temp_hp'}>}
  | {phase: 'impact'; kind: 'runtime'; actorId: string; patch: NonNullable<CombatLogEventRecord['runtimePatch']>}
  | {phase: 'impact'; kind: 'actor'; actor: ActorState}
  | {phase: 'end'; kind: 'log'; entry: CombatLogEntry};

/** A live-only view plan over already committed records. It never executes a
 * rule, rolls a die, writes a command or reconstructs historical authority. */
export function addCombatPresentationChanges(state: SoloCombatState, entries: CombatLogEntry[], beats: CombatBeat[]): CombatBeat[] {
  const planned = beats.map(beat => ({...beat, presentationChanges: [] as CombatPresentationChange[]}));
  const lastAffected = new Map<string, CombatBeat>();
  for (const entry of entries) {
    const rows = planned.filter(beat => beat.sourceEntryId === entry.id);
    if (!rows.length) continue;
    const entryAffected = new Map<string, CombatBeat>();
    for (const record of combatLogRecords(entry)) {
      const beat = [...rows].reverse().find(row => (row.sourceOrdinal ?? -1) <= record.ordinal);
      if (!beat) continue;
      const changes = beat.presentationChanges!;
      const movementActorId = record.kind === 'movement' ? record.actorId
        : record.event?.type === 'movement' ? record.event.recipientActorId ?? record.targetIds[0] ?? record.actorId : undefined;
      if (movementActorId && record.movement) changes.push({phase: 'start', kind: 'movement', actorId: movementActorId, position: record.movement.to});
      if (record.event?.type === 'turn_started') {
        changes.push({phase: 'start', kind: 'turn', actorId: record.actorId, round: entry.round});
      }
      const event = record.event;
      if (event?.type === 'damage' || event?.type === 'healing' || event?.type === 'temp_hp') {
        const targets = record.targetIds.length ? record.targetIds : [record.actorId];
        for (const actorId of targets) {
          changes.push({phase: 'impact', kind: 'health', actorId, event});
          lastAffected.set(actorId, beat);
          entryAffected.set(actorId, beat);
        }
      } else if (record.kind === 'death' || event?.type === 'effect_applied' || event?.type === 'condition_applied'
        || event?.type === 'effect_expired' || event?.type === 'stabilized') {
        const targets = event?.type === 'effect_applied' && event.ownerActorId ? [event.ownerActorId]
          : record.targetIds.length ? record.targetIds : [record.actorId];
        for (const actorId of targets) {lastAffected.set(actorId, beat); entryAffected.set(actorId, beat);}
      }
    }
    // Rule handlers may emit their exact runtime patch before their readable
    // engine trace. Associate it with that actor's completed application within
    // this entry, and apply it after the packet captions, regardless of envelope
    // ordering. A prefix patch must never disappear or be subtracted twice.
    for (const record of combatLogRecords(entry)) if (record.runtimePatch) {
      const beat = entryAffected.get(record.actorId)
        ?? [...rows].reverse().find(row => row.targetId === record.actorId || row.sourceId === record.actorId)
        ?? rows.at(-1)!;
      beat.presentationChanges!.push({phase: 'impact', kind: 'runtime', actorId: record.actorId, patch: record.runtimePatch});
      lastAffected.set(record.actorId, beat);
    }
    rows.at(-1)!.presentationChanges.push({phase: 'end', kind: 'log', entry});
  }
  // Recorded amounts describe ordinary intermediate HP changes. The last
  // checkpoint always uses the exact committed actor (survival, max-HP changes,
  // death and effect cleanup included), rather than implementing those rules here.
  for (const [actorId, beat] of lastAffected) {
    const actor = state.world.actors[actorId];
    if (actor) beat.presentationChanges!.push({phase: 'impact', kind: 'actor', actor});
  }
  return planned;
}

/** Keep authoritative catalog/decision metadata current while holding only the
 * visible board, participant state, turn and journal during a live sequence. */
export function combatPresentationView(authoritative: SoloCombatState, visible: SoloCombatState): SoloCombatState {
  if (!authoritative.world || !visible.world) return authoritative;
  return {...authoritative, tokens: visible.tokens, initiative: visible.initiative,
    sideByActorId: visible.sideByActorId, actorPresentation: visible.actorPresentation,
    log: visible.log, outcome: visible.outcome,
    world: {...authoritative.world, scene: visible.world.scene, actors: visible.world.actors}};
}

export function applyCombatPresentationPhase(state: SoloCombatState, beat: CombatBeat, phase: CombatPresentationPhase): SoloCombatState {
  let current = state;
  for (const row of beat.saveRows ?? [beat]) for (const change of row.presentationChanges ?? []) {
    if (change.phase !== phase || !current.world) continue;
    if (change.kind === 'movement') {
      const token = current.tokens[change.actorId];
      if (token) current = {...current, tokens: {...current.tokens, [change.actorId]: {...token, position: change.position}}};
    } else if (change.kind === 'turn') {
      const scene = current.world.scene;
      if (scene.mode === 'encounter') {
        const activeIndex = scene.initiative.indexOf(change.actorId);
        if (activeIndex >= 0) current = {...current, world: {...current.world,
          scene: {...scene, activeIndex, round: change.round, turnStarted: true}}};
      }
    } else if (change.kind === 'health') {
      const actor = current.world.actors[change.actorId];
      if (!actor) continue;
      const hp = {...actor.runtime.hp};
      const amount = Math.max(0, change.event.amount);
      if (change.event.type === 'damage') {
        const absorbed = Math.min(hp.temp, amount);
        hp.temp -= absorbed;
        hp.current = Math.max(0, hp.current - (amount - absorbed));
      } else if (change.event.type === 'healing') hp.current = Math.min(hp.max, hp.current + amount);
      else hp.temp = Math.max(hp.temp, amount);
      current = {...current, world: {...current.world, actors: {...current.world.actors,
        [actor.id]: {...actor, runtime: {...actor.runtime, hp}}}}};
    } else if (change.kind === 'runtime') {
      const actor = current.world.actors[change.actorId];
      if (actor) current = {...current, world: {...current.world, actors: {...current.world.actors,
        [actor.id]: {...actor, runtime: {...actor.runtime, ...change.patch}}}}};
    } else if (change.kind === 'actor') {
      current = {...current, world: {...current.world, actors: {...current.world.actors, [change.actor.id]: change.actor}}};
    } else if (!current.log.some(entry => entry.id === change.entry.id)) current = {...current, log: [...current.log, change.entry]};
  }
  return current;
}
