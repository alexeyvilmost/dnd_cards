import type { RollLog } from '../mvp/contracts';
import { combatActorDisplayName } from '../character/familiarLabels';
import { combatLogRecords } from './combatLog';
import type { CombatAnimationArea, CombatLogEntry, CombatLogEventRecord, GridPosition, SoloCombatState } from './types';
import { combatRelation } from './types';
import { conditionLabel } from '../engine/conditions';
import { combatAnimationAction, combatAttackPresentation, combatDamagePalette, resolveCombatAnimation, type CombatAnimationProfile } from './animationProfiles';
import {areaEffectOrigin, areaPositionsForAction, tacticalAreaGeometry} from './tacticalGrid';
import type {RuleActionDefinition} from '../rules-core/domain';

export interface CombatCue {
  actorId: string;
  text: string;
  damageType?: string;
  kind: 'damage' | 'miss' | 'effect' | 'healing';
}
export interface CombatDamagePresentation {
  amount: number;
  damageType: string;
  roll?: RollLog;
  beforeResistance?: number;
  adjustment?: 'immunity' | 'resistance' | 'vulnerability';
}
export interface CombatBeat {
  id: string;
  sourceId: string;
  audience?: 'own' | 'enemy';
  targetId?: string;
  sourceName: string;
  targetName?: string;
  actionName: string;
  actionId?: string;
  sourceEntityIds?: string[];
  entityRef?: {kind: 'action' | 'spell'; id: string};
  spellLevel?: number;
  animation?: CombatAnimationProfile;
  area?: CombatAnimationArea;
  /** Subsequent defenders retain their roll/cues without replaying a whole cast. */
  suppressAnimation?: boolean;
  /** Pure board movement is decorative and must not delay the next command. */
  blocksInput?: boolean;
  sourceEntryId?: string;
  rollKind?: 'attack' | 'save' | 'check' | 'damage' | 'healing' | 'other';
  saveGroupId?: string;
  saveRows?: CombatBeat[];
  rollerName?: string;
  rollLabel?: string;
  roll?: RollLog;
  deathSave?: {successes:number; failures:number; stable:boolean; dead:boolean};
  rollPhase?: 'before-reaction' | 'after-reaction';
  visual?: 'slashing' | 'piercing' | 'bludgeoning' | 'ranged' | 'magic';
  from?: GridPosition;
  to?: GridPosition;
  /** The impact uses a selected empty cell, independent of actor footprint. */
  targetIsPoint?: boolean;
  cues: CombatCue[];
  damage?: CombatDamagePresentation[];
}

/** Older pinned artifacts persisted the selected point but predate area FX
 * snapshots. Reuse their immutable mechanics and recorded movement endpoints.
 * If no movement history survives, current position is a decorative fallback
 * for immediate live feedback; it cannot exactly reconstruct historic origins. */
function recordedArea(state: SoloCombatState, entry: CombatLogEntry, record: CombatLogEventRecord | undefined,
  action: RuleActionDefinition | undefined, sourceId: string): CombatAnimationArea | undefined {
  if (record?.area) return record.area;
  if (!record?.targetPosition || !action) return undefined;
  const geometry = tacticalAreaGeometry(action);
  if (!geometry) return undefined;
  const history = state.log ?? [];
  const entryIndex = history.findIndex(row => row.id === entry.id);
  const movementFor = (row: CombatLogEventRecord) => row.movement && (row.kind === 'movement' ? row.actorId === sourceId
    : row.event?.type === 'movement' && (row.event.recipientActorId ?? row.targetIds[0] ?? row.actorId) === sourceId);
  const laterMovement = entryIndex >= 0 ? history.slice(entryIndex + 1).flatMap(combatLogRecords).find(movementFor) : undefined;
  const earlierMovement = entryIndex >= 0 ? history.slice(0, entryIndex).flatMap(combatLogRecords).reverse().find(movementFor) : undefined;
  const sourcePosition = laterMovement?.movement?.from ?? earlierMovement?.movement?.to ?? state.tokens[sourceId]?.position;
  if (!sourcePosition) return undefined;
  const input = {board: state, action, sourcePosition, aimPosition: record.targetPosition};
  return {geometry, sourcePosition, origin: areaEffectOrigin(input), aim: record.targetPosition, cells: areaPositionsForAction(input)};
}

export function presentCombatEntries(state: SoloCombatState, entries: CombatLogEntry[]): CombatBeat[] {
  const beats: CombatBeat[] = [];
  const playedAreas = new Set<string>();
  const name = (id: string) => state.world.actors[id] ? combatActorDisplayName(state.world.actors[id]) : 'Участник';
  for (const entry of entries) {
    const records = combatLogRecords(entry);
    const declaration = records.find(record => record.kind === 'action') ?? records.find(record => record.actionId);
    const sourceName = entry.actorNames?.[entry.actorId] ?? name(entry.actorId);
    // Text matching is exclusively the adapter for historical logs that predate
    // declaration records. New entries use stable entity provenance.
    const action = declaration?.actionId ? combatAnimationAction(state, declaration)
      : [...state.catalogActions].sort((a,b) => b.name.length - a.name.length)
      .find(row => entry.text.startsWith(`${sourceName}: ${row.name}:`));
    const actionName = action?.name ?? 'Атака';
    let current: CombatBeat | undefined;
    const entryBeats: CombatBeat[] = [];
    const makeBeat = (ordinal: number, sourceId: string, targetId?: string, record?: CombatLogEventRecord): CombatBeat => {
      const metadata = record?.actionId ? record : declaration;
      const definition = metadata?.actionId ? combatAnimationAction(state, metadata) : action;
      const ownDeclaration = [...records].reverse().find(row => row.kind === 'action' && row.ordinal <= ordinal
        && row.sourceActorId === sourceId && row.actionId === metadata?.actionId) ?? declaration;
      const presentation = definition ? state.actionPresentation?.[definition.id] : undefined;
      const targetPosition = record?.targetPosition ?? ownDeclaration?.targetPosition;
      const area = record?.area ?? recordedArea(state, entry, ownDeclaration, definition, sourceId);
      return {
      id: `${entry.id}:${ordinal}`, sourceId, targetId, sourceName: entry.actorNames?.[sourceId] ?? name(sourceId),
      audience: combatRelation(state, state.characterId, sourceId) === 'enemy' ? 'enemy' : 'own',
      targetName: targetId ? entry.actorNames?.[targetId] ?? name(targetId) : undefined, actionName: definition?.name ?? actionName,
      actionId: metadata?.actionId ?? definition?.id,
      sourceEntityIds: metadata?.sourceEntityIds ?? (definition?.sourceEntityIds ? [...definition.sourceEntityIds] : undefined),
      entityRef: presentation?.entityId && presentation.entityType
        ? {id: presentation.entityId, kind: presentation.entityType}
        : definition ? {id: definition.kind === 'spell' ? definition.spell?.entityId ?? definition.id : definition.id,
          kind: definition.kind === 'spell' ? 'spell' : 'action'} : undefined,
      spellLevel: metadata?.spell?.castLevel ?? (definition?.kind === 'spell' ? definition.spell?.level ?? 0 : undefined),
      sourceEntryId: entry.id, visual: definition?.kind === 'spell' ? 'magic' : undefined,
      animation: definition || metadata?.sourceEntityIds ? resolveCombatAnimation(definition, {sourceEntityIds: metadata?.sourceEntityIds}) : undefined,
      area,
      from: area?.sourcePosition ?? state.tokens[sourceId]?.position,
      ...(targetPosition && !metadata?.targetIds.length ? {targetIsPoint: true} : {}),
      to: targetPosition && !metadata?.targetIds.length ? targetPosition
        : (targetId ? state.tokens[targetId]?.position : undefined) ?? targetPosition,
      cues: [], damage: [],
    }; };
    const push = (beat: CombatBeat) => {
      if (beat.area) {
        const key = beat.saveGroupId ?? beat.sourceEntryId ?? beat.id;
        if (playedAreas.has(key)) beat.suppressAnimation = true;
        playedAreas.add(key);
      }
      beats.push(beat); entryBeats.push(beat);
    };
    for (const record of records) {
      if (record.kind === 'death') {
        const death = makeBeat(record.ordinal, record.sourceActorId, record.actorId, record);
        death.area = undefined;
        death.animation = resolveCombatAnimation(undefined, {event: 'death'});
        death.cues.push({actorId: record.actorId, text: 'Погибает', kind: 'effect'});
        push(death); continue;
      }
      if (record.kind === 'movement' && record.movement) {
        const movement = makeBeat(record.ordinal, record.actorId, record.actorId, record);
        movement.area = undefined;
        movement.from = record.movement.from; movement.to = record.movement.to;
        movement.actionName = 'Перемещение';
        movement.animation = resolveCombatAnimation(undefined, {event: 'movement'});
        movement.blocksInput = false;
        push(movement); continue;
      }
      const event = record.event;
      if (!event) continue;
      if (event.type === 'turn_started') {
        const actorId = record.actorId;
        const actorName = entry.actorNames?.[actorId] ?? name(actorId);
        push({id: `${entry.id}:${record.ordinal}`, sourceEntryId: entry.id, sourceId: actorId, targetId: actorId,
          sourceName: actorName, targetName: actorName, actionName: 'Начало хода',
          audience: combatRelation(state, state.characterId, actorId) === 'enemy' ? 'enemy' : 'own',
          from: state.tokens[actorId]?.position, to: state.tokens[actorId]?.position,
          animation: resolveCombatAnimation(undefined, {event: event.type}), blocksInput: false, cues: []});
        continue;
      }
      if (event.type === 'roll' && event.roll.kind === 'save') {
        // Inline legacy saves are emitted in the caster's trace. Deferred
        // canonical saves are emitted in the defender's own trace instead.
        const inline = event.label === 'Спасбросок' && record.targetIds.length > 0;
        const defenderId = inline ? record.targetIds[0] : record.actorId;
        const effectSourceId = inline ? record.sourceActorId : record.targetIds[0] ?? record.sourceActorId;
        current = makeBeat(record.ordinal, effectSourceId, defenderId, record);
        current.rollKind = 'save'; current.roll = event.roll;
        current.rollerName = name(defenderId); current.rollLabel = event.label;
        // Keep the action owner's display preference: an enemy's save against
        // the player's breath is still part of the player's action.
        const structuredActionId = record.actionId ?? declaration?.actionId;
        const saveAction = structuredActionId ? combatAnimationAction(state, record.actionId ? record : declaration)
          : state.catalogActions.find(row=>event.label.startsWith(`${row.name}:`));
        current.actionId = saveAction?.id ?? action?.id;
        current.actionName = saveAction?.name ?? (event.label.includes(': спасбросок') ? event.label.split(': спасбросок')[0] : action?.name ?? 'Спасбросок');
        const history = state.log ?? entries;
        const historyIndex = history.findIndex(row => row.id === entry.id);
        const origin = history.slice(0, historyIndex + 1).reverse().find(row => row.round === entry.round
          && row.actorId === effectSourceId && (row.records?.some(item => item.kind === 'action' && item.actionId === current!.actionId)
            || (!row.records?.some(item => item.actionId) && row.text.startsWith(`${name(effectSourceId)}: ${current!.actionName}:`))));
        current.saveGroupId = origin?.id ?? entry.id;
        const originalDeclaration = origin?.records?.find(row => row.kind === 'action' && row.actionId === current!.actionId);
        current.area = origin ? recordedArea(state, origin, originalDeclaration, saveAction, effectSourceId) ?? current.area : current.area;
        if (current.area) {
          current.from = current.area.sourcePosition;
          current.to = current.area.aim;
          const originIndex = history.findIndex(row => row.id === origin?.id);
          current.suppressAnimation = history.slice(originIndex + 1, historyIndex).some(row => row.records?.some(item =>
            item.actionId === current!.actionId && item.event?.type === 'roll' && item.event.roll.kind === 'save'));
        }
        current.visual = 'magic';
        current.animation = resolveCombatAnimation(saveAction, {visual: 'magic'});
        current.cues.push({actorId:defenderId,kind:'effect',text:`Спасбросок: ${event.roll.outcome==='success'?'успех':'провал'} (${event.roll.total})`});
        push(current); continue;
      }
      if (event.type === 'roll' && event.roll.target?.type === 'ac') {
        current = makeBeat(record.ordinal, record.sourceActorId, record.targetIds[0], record);
        current.roll = event.roll;
        if (event.label === 'Атака — до реакции') current.rollPhase = 'before-reaction';
        if (event.label === 'Атака — после реакции') current.rollPhase = 'after-reaction';
        const history = state.log ?? [];
        const resumesReaction = current.rollPhase === 'after-reaction'
          || (!action && current.rollPhase !== 'before-reaction' && entry.text.includes(': Разрешение реакции/спасброска:'));
        const previousAttack = resumesReaction ? history.slice(0, history.findIndex(row => row.id === entry.id)).reverse().find(row =>
          row.round === entry.round && combatLogRecords(row).some(previous => previous.sourceActorId === record.sourceActorId
            && previous.targetIds[0] === record.targetIds[0] && previous.event?.type === 'roll'
            && previous.event.label === 'Атака — до реакции'
            && JSON.stringify(previous.event.roll.dice) === JSON.stringify(event.roll.dice))) : undefined;
        if (previousAttack) current.rollPhase = 'after-reaction';
        const previousRecord = previousAttack?.records?.find(item => item.event?.type === 'roll' && item.event.roll.target?.type === 'ac');
        const attackAction = combatAnimationAction(state, record) ?? combatAnimationAction(state, previousRecord)
          ?? (previousAttack ? state.catalogActions.find(row => previousAttack.text.startsWith(`${name(record.sourceActorId)}: ${row.name}:`)) : action);
        current.actionName = attackAction?.name ?? actionName;
        current.actionId = attackAction?.id ?? action?.id;
        const captured = record.attackPresentation ?? previousRecord?.attackPresentation
          ?? combatAttackPresentation(attackAction, state.world.actors[record.sourceActorId], previousRecord ?? record);
        current.visual = captured.visual ?? 'bludgeoning';
        current.animation = resolveCombatAnimation(attackAction, {...captured, visual: current.visual,
          outcome: event.roll.outcome, rollPhase: current.rollPhase,
          sourceEntityIds: record.sourceEntityIds ?? previousRecord?.sourceEntityIds});
        if (current.rollPhase === 'before-reaction') {current.visual = undefined; current.animation = undefined;}
        if (current.rollPhase !== 'before-reaction' && ['miss', 'crit_miss'].includes(event.roll.outcome ?? '') && current.targetId) {
          current.cues.push({actorId: current.targetId, text: `Промах (${event.roll.total})`, kind: 'miss'});
        }
        push(current);
        continue;
      }
      if (event.type === 'roll' && event.roll.kind === 'check') {
        current = makeBeat(record.ordinal, record.sourceActorId, record.targetIds[0], record);
        current.roll = event.roll; current.rollKind = 'check'; current.rollLabel = event.label;
        // Failed stealth still depicts an attempted action, never a successful
        // disappearance. The decision is the recorded outcome, not current HP
        // or an inferred condition name.
        if (current.animation?.primitive === 'hide' && event.roll.outcome !== 'success') {
          current.animation = resolveCombatAnimation(undefined, {event: 'world_interaction'});
        }
        push(current); continue;
      }
      const targets = record.targetIds.length ? record.targetIds : [record.actorId];
      let cues: CombatCue[] = [];
      if (event.type === 'damage') cues = targets.map(actorId => ({actorId, text: String(event.amount), damageType: event.damageType, kind: 'damage'}));
      if (event.type === 'healing') cues = targets.map(actorId => ({actorId, text: `+${event.amount}`, damageType: 'healing', kind: 'healing'}));
      if (event.type === 'temp_hp') cues = targets.map(actorId => ({actorId, text: `+${event.amount} врем. HP`, kind: 'healing'}));
      if (event.type === 'stabilized') cues = targets.map(actorId => ({actorId, text: 'Стабилизирован', kind: 'healing'}));
      if (event.type === 'effect_expired') cues = targets.map(actorId => ({actorId, text: `${event.name}: завершено`, kind: 'effect'}));
      if (event.type === 'condition_immune') cues = targets.map(actorId => ({actorId, text: `Иммунитет: ${conditionLabel(event.condition)}`, kind: 'effect'}));
      if (event.type === 'damage_reduction' && event.amount > 0) cues = targets.map(actorId => ({actorId, text: `−${event.amount} урона`, kind: 'effect'}));
      if (event.type === 'resource_restored' && event.amount > 0) cues = [{actorId: record.actorId, text: `+${event.amount}`, kind: 'healing'}];
      if (event.type === 'world_interaction' || event.type === 'communication') cues = [{actorId: record.targetIds[0] ?? record.actorId, text: action?.name ?? 'Взаимодействие', kind: 'effect'}];
      if (event.type === 'movement') cues = [{actorId: event.recipientActorId ?? targets[0], text: event.mode === 'additional' ? 'Дополнительное перемещение' : 'Перемещение', kind: 'effect'}];
      if (event.type === 'effect_applied') {
        const origin = event.sourceAction ?? (action && event.name.startsWith(`${action.name} — `) ? action.name : undefined);
        const prefix = origin ? `${origin} — ` : '';
        const effectName = prefix && event.name.startsWith(prefix) ? event.name.slice(prefix.length) : event.name;
        cues = [event.ownerActorId ?? targets[0]].filter(Boolean).map(actorId => ({actorId,
          text: `${effectName}${origin && origin !== effectName ? ` (${origin})` : ''}`, kind: 'effect'}));
      }
      if (event.type === 'condition_applied') cues = targets.map(actorId => ({actorId, text: conditionLabel(event.condition), kind: 'effect'}));
      if (!cues.length) continue;
      if (!current || (event.type === 'damage' && current.targetId !== targets[0])) {
        current = makeBeat(record.ordinal, record.sourceActorId, cues[0]?.actorId ?? targets[0], record);
        const definition = state.catalogActions.find(row => row.id === current!.actionId);
        current.animation = resolveCombatAnimation(definition, {event: event.type, visual: current.visual,
          ...(event.type === 'damage' ? {damageType: event.damageType} : {})});
        if (record.movement) {current.from = record.movement.from; current.to = record.movement.to;}
        push(current);
      }
      if (event.type === 'damage' && current.animation) current.animation = combatDamagePalette(current.animation, event.damageType);
      if (event.type === 'damage') current.damage!.push({
        amount: event.amount,
        damageType: event.damageType,
        ...(event.roll ? {roll: event.roll} : {}),
        ...(event.calculation ? {
          beforeResistance: event.calculation.beforeResistance,
          adjustment: event.calculation.adjustments.at(-1)?.level,
        } : {}),
      });
      for (const cue of cues) {
        if (cue.kind !== 'effect' || !current.cues.some(old => old.actorId === cue.actorId && old.text === cue.text && old.kind === cue.kind)) current.cues.push(cue);
      }
      if (event.type === 'damage' && current.visual !== 'ranged' && ['slashing', 'piercing', 'bludgeoning'].includes(event.damageType)) current.visual = event.damageType as CombatBeat['visual'];
    }
    const pending = state.world.pendingResolution;
    const awaitingResolution = pending && 'actionId' in pending && pending.actionId === action?.id;
    const history = state.log ?? entries;
    const declaredArea = recordedArea(state, entry, declaration, action, entry.actorId);
    const deferredAreaResult = declaredArea && history.slice(history.findIndex(row => row.id === entry.id) + 1)
      .some(row => row.round === entry.round && row.records?.some(record => record.actionId === action?.id
        && record.event?.type === 'roll' && record.event.roll.kind === 'save'));
    if (!entryBeats.length && action && !awaitingResolution && !deferredAreaResult && !records.some(record => record.event?.type === 'execution_cancelled')) {
      current = makeBeat(declaration?.ordinal ?? -1, declaration?.sourceActorId ?? entry.actorId, declaration?.targetIds[0]);
      current.cues.push({actorId: current.targetId ?? current.sourceId, text: action.name, kind: 'effect'});
      push(current);
    }
  }
  return beats;
}

/** Group only one committed application of an effect; never merge repeated casts. */
export function groupCombatSaveBeats(beats: CombatBeat[]): CombatBeat[] {
  const grouped: CombatBeat[] = [];
  for (const beat of beats) {
    const previous = grouped.at(-1);
    const rows = previous?.saveRows ?? (previous ? [previous] : []);
    if (beat.rollKind === 'save' && previous?.rollKind === 'save' && beat.saveGroupId
      && beat.saveGroupId === previous.saveGroupId && beat.sourceId === previous.sourceId
      && beat.actionName === previous.actionName && !rows.some(row => row.targetId === beat.targetId)) {
      grouped[grouped.length - 1] = { ...previous, saveRows: [...rows, ...(beat.saveRows ?? [beat])], cues: [...previous.cues, ...beat.cues] };
    } else grouped.push(beat);
  }
  return grouped;
}
