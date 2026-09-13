import type { RollLog } from '../mvp/contracts';
import { combatActorDisplayName } from '../character/familiarLabels';
import { combatLogRecords } from './combatLog';
import type { CombatLogEntry, GridPosition, SoloCombatState } from './types';
import { attackRangeFromEffect, weaponContext } from '../engine/weapon';
import { conditionLabel } from '../engine/conditions';

export interface CombatCue {
  actorId: string;
  text: string;
  damageType?: string;
  kind: 'damage' | 'miss' | 'effect' | 'healing';
}
export interface CombatBeat {
  id: string;
  sourceId: string;
  targetId?: string;
  sourceName: string;
  targetName?: string;
  actionName: string;
  roll?: RollLog;
  rollPhase?: 'before-reaction' | 'after-reaction';
  visual?: 'slashing' | 'piercing' | 'bludgeoning' | 'ranged' | 'magic';
  from?: GridPosition;
  to?: GridPosition;
  cues: CombatCue[];
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
      targetName: targetId ? name(targetId) : undefined, actionName,
      from: state.tokens[sourceId]?.position, to: targetId ? state.tokens[targetId]?.position : undefined, cues: [],
    });
    for (const record of combatLogRecords(entry)) {
      const event = record.event;
      if (!event) continue;
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
          current.cues.push({actorId: current.targetId, text: 'Промах', kind: 'miss'});
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
      if (!current) { current = makeBeat(record.ordinal, record.sourceActorId, targets[0]); beats.push(current); }
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
