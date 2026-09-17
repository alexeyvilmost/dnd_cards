import type { RollLog } from '../mvp/contracts';
import { combatActorDisplayName } from '../character/familiarLabels';
import { combatLogRecords } from './combatLog';
import type { CombatLogEntry, GridPosition, SoloCombatState } from './types';
import { combatRelation } from './types';
import { attackRangeFromEffect, weaponContext } from '../engine/weapon';
import { conditionLabel } from '../engine/conditions';

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
  sourceEntryId?: string;
  rollKind?: 'attack' | 'save' | 'check';
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
  cues: CombatCue[];
  damage?: CombatDamagePresentation[];
}

export function presentCombatEntries(state: SoloCombatState, entries: CombatLogEntry[]): CombatBeat[] {
  const beats: CombatBeat[] = [];
  const name = (id: string) => state.world.actors[id] ? combatActorDisplayName(state.world.actors[id]) : 'Участник';
  for (const entry of entries) {
    const sourceName = entry.actorNames?.[entry.actorId] ?? name(entry.actorId);
    const action = [...state.catalogActions].sort((a,b) => b.name.length - a.name.length)
      .find(row => entry.text.startsWith(`${sourceName}: ${row.name}:`));
    const actionName = action?.name ?? 'Атака';
    let current: CombatBeat | undefined;
    const makeBeat = (ordinal: number, sourceId: string, targetId?: string): CombatBeat => ({
      id: `${entry.id}:${ordinal}`, sourceId, targetId, sourceName: name(sourceId),
      audience: combatRelation(state, state.characterId, sourceId) === 'enemy' ? 'enemy' : 'own',
      targetName: targetId ? name(targetId) : undefined, actionName,
      actionId: action?.id,
      sourceEntryId: entry.id, visual: action?.kind === 'spell' ? 'magic' : undefined,
      from: state.tokens[sourceId]?.position, to: targetId ? state.tokens[targetId]?.position : undefined, cues: [], damage: [],
    });
    for (const record of combatLogRecords(entry)) {
      const event = record.event;
      if (!event) continue;
      if (event.type === 'roll' && event.roll.kind === 'save') {
        // Inline legacy saves are emitted in the caster's trace. Deferred
        // canonical saves are emitted in the defender's own trace instead.
        const inline = event.label === 'Спасбросок' && record.targetIds.length > 0;
        const defenderId = inline ? record.targetIds[0] : record.actorId;
        const effectSourceId = inline ? record.sourceActorId : record.targetIds[0] ?? record.sourceActorId;
        current = makeBeat(record.ordinal, effectSourceId, defenderId);
        current.rollKind = 'save'; current.roll = event.roll;
        current.rollerName = name(defenderId); current.rollLabel = event.label;
        // Keep the action owner's display preference: an enemy's save against
        // the player's breath is still part of the player's action.
        const saveAction = state.catalogActions.find(row=>event.label.startsWith(`${row.name}:`));
        current.actionId = saveAction?.id ?? action?.id;
        current.actionName = saveAction?.name ?? (event.label.includes(': спасбросок') ? event.label.split(': спасбросок')[0] : action?.name ?? 'Спасбросок');
        const history = state.log ?? entries;
        const historyIndex = history.findIndex(row => row.id === entry.id);
        const origin = history.slice(0, historyIndex + 1).reverse().find(row => row.round === entry.round
          && row.actorId === effectSourceId && row.text.startsWith(`${name(effectSourceId)}: ${current!.actionName}:`));
        current.saveGroupId = origin?.id ?? entry.id;
        current.visual = 'magic';
        current.cues.push({actorId:defenderId,kind:'effect',text:`Спасбросок: ${event.roll.outcome==='success'?'успех':'провал'} (${event.roll.total})`});
        beats.push(current); continue;
      }
      if (event.type === 'roll' && event.roll.target?.type === 'ac') {
        current = makeBeat(record.ordinal, record.sourceActorId, record.targetIds[0]);
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
        const attackAction = previousAttack ? state.catalogActions.find(row => previousAttack.text.startsWith(`${name(record.sourceActorId)}: ${row.name}:`)) : action;
        current.actionName = attackAction?.name ?? actionName;
        current.actionId = attackAction?.id ?? action?.id;
        const source = state.world.actors[record.sourceActorId];
        const effects = attackAction?.mechanics.effects as Record<string, unknown>[] | undefined;
        const attack = effects?.find(effect => effect.resolution === 'attack_roll');
        const hand = attack?.hand === 'off' ? 'off' : 'main';
        const ranged = source && attack && attackRangeFromEffect(attack, hand, source.character, source.runtime.equipment) === 'ranged';
        const payload = (attack?.on_hit as Record<string, unknown>[] | undefined)?.find(row => row.kind === 'damage');
        const weapon = source ? weaponContext(source.character, hand, source.runtime.equipment, source.runtime) : null;
        const damageType = payload?.type === 'weapon' ? weapon?.damageType : payload?.type;
        current.visual = ranged && attackAction?.kind !== 'spell' ? 'ranged'
          : ['slashing', 'piercing', 'bludgeoning'].includes(String(damageType)) ? damageType as CombatBeat['visual']
            : attackAction?.kind === 'spell' ? 'magic' : 'bludgeoning';
        if (current.rollPhase === 'before-reaction') current.visual = undefined;
        if (['miss', 'crit_miss'].includes(event.roll.outcome ?? '') && current.targetId) {
          current.cues.push({actorId: current.targetId, text: `Промах (${event.roll.total})`, kind: 'miss'});
        }
        beats.push(current);
        continue;
      }
      const targets = record.targetIds.length ? record.targetIds : [record.actorId];
      let cues: CombatCue[] = [];
      if (event.type === 'damage') cues = targets.map(actorId => ({actorId, text: String(event.amount), damageType: event.damageType, kind: 'damage'}));
      if (event.type === 'healing') cues = targets.map(actorId => ({actorId, text: `+${event.amount}`, damageType: 'healing', kind: 'healing'}));
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
        current = makeBeat(record.ordinal, record.sourceActorId, targets[0]); beats.push(current);
      }
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
    if (action && (action.id === state.dashActionId || (action.mechanics.activation as Record<string, unknown>)?.counts_as === 'dash')) {
      if (!current) { current = makeBeat(-1, entry.actorId); beats.push(current); }
      if (!current.cues.some(cue => cue.text.includes('Рывок'))) current.cues.push({actorId: entry.actorId, text: 'Рывок', kind: 'effect'});
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
