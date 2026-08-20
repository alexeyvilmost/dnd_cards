import { describeEngineEvent, formatRollBreakdown } from '../engine/events';
import type { EngineEvent, RollLog } from '../mvp/contracts';
import type { UncommittedRuleEvent } from '../rules-core/domain';
import type {
  CombatLogEntry,
  CombatLogEventRecord,
  CombatLogTone,
  SoloCombatState,
} from './types';

export interface CombatLogDetail {
  kind: 'roll' | 'damage' | 'healing' | 'event' | 'death';
  label: string;
  text: string;
  roll?: RollLog;
}

/** Preserve the event envelope instead of flattening it into localized prose. */
export function projectCombatLogRecords(
  events: readonly UncommittedRuleEvent[],
): CombatLogEventRecord[] {
  return events.flatMap<CombatLogEventRecord>((envelope): CombatLogEventRecord[] => {
    if (envelope.payload.type === 'EngineEventRecorded') {
      return [{
        kind: 'engine' as const,
        ordinal: envelope.ordinal,
        sourceActorId: envelope.sourceActorId,
        actorId: envelope.payload.actorId,
        targetIds: [...envelope.payload.targetIds],
        event: envelope.payload.event,
        ...(envelope.payload.facts ? { facts: envelope.payload.facts } : {}),
      }];
    }
    if (envelope.payload.type === 'ActorDeathAdjudicated') {
      return [{
        kind: 'death' as const,
        ordinal: envelope.ordinal,
        sourceActorId: envelope.sourceActorId,
        actorId: envelope.payload.actorId,
        targetIds: [envelope.payload.actorId],
      }];
    }
    return [];
  });
}

/** Read new records and legacy schema-v1 bare events through one API. */
export function combatLogRecords(entry: CombatLogEntry): CombatLogEventRecord[] {
  if (entry.records?.length) return entry.records;
  return (entry.events ?? []).map((event, ordinal) => ({
    kind: 'engine',
    ordinal,
    sourceActorId: entry.actorId,
    actorId: entry.actorId,
    targetIds: [],
    event,
  }));
}

function rollFromEvent(event: EngineEvent): RollLog | undefined {
  if (event.type === 'roll') return event.roll;
  if (event.type === 'damage' || event.type === 'healing' || event.type === 'damage_reduction') {
    return event.roll;
  }
  return undefined;
}

function affectedActorIds(record: CombatLogEventRecord): string[] {
  if (record.targetIds.length) return record.targetIds;
  return record.actorId !== record.sourceActorId ? [record.actorId] : [];
}

/** Classifies entries relative to the persisted player side, never actor kind or text. */
export function combatLogTone(
  entry: CombatLogEntry,
  state: Pick<SoloCombatState, 'characterId' | 'sideByActorId'>,
): CombatLogTone {
  const viewerSide = state.sideByActorId[state.characterId];
  if (!viewerSide) return 'neutral';
  const isAlly = (actorId: string) => Boolean(viewerSide)
    && state.sideByActorId[actorId] === viewerSide;
  const tones = new Set<CombatLogTone>();

  for (const record of combatLogRecords(entry)) {
    if (record.kind === 'death') {
      if (isAlly(record.actorId)) tones.add('ally-death');
      continue;
    }
    const event = record.event;
    if (!event) continue;
    const roll = rollFromEvent(event);
    if (roll?.outcome === 'crit') {
      tones.add(isAlly(record.sourceActorId) ? 'ally-critical' : 'hostile-critical');
    } else if (roll?.outcome === 'crit_miss' && isAlly(record.sourceActorId)) {
      tones.add('hostile-critical');
    }

    const targets = affectedActorIds(record);
    if (event.type === 'damage') {
      if (isAlly(record.sourceActorId) && targets.some((id) => !isAlly(id))) {
        tones.add('ally-damage');
      } else if (!isAlly(record.sourceActorId) && targets.some(isAlly)) {
        tones.add('enemy-damage');
      }
    } else if (event.type === 'healing' && targets.some(isAlly)) {
      tones.add('ally-healing');
    }
  }

  const precedence: CombatLogTone[] = [
    'ally-death',
    'hostile-critical',
    'ally-critical',
    'ally-healing',
    'enemy-damage',
    'ally-damage',
  ];
  return precedence.find((tone) => tones.has(tone)) ?? 'neutral';
}

function actorNames(
  ids: readonly string[],
  state: Pick<SoloCombatState, 'world'>,
): string {
  return ids.map((id) => state.world.actors[id]?.name ?? id).join(', ');
}

function rollLabel(event: EngineEvent, roll: RollLog): string {
  if (roll.kind === 'save') return 'Спасбросок';
  if (roll.kind === 'check') return 'Проверка характеристики';
  if (roll.kind === 'damage') return 'Бросок урона';
  if (roll.kind === 'healing') return 'Бросок лечения';
  if (roll.target?.type === 'ac') return `Атака против КЗ ${roll.target.value}`;
  if (roll.target?.type === 'dc') return `Бросок против СЛ ${roll.target.value}`;
  return event.type === 'roll' ? event.label : 'Бросок';
}

function rollDetail(event: EngineEvent, roll: RollLog): CombatLogDetail {
  return {
    kind: 'roll',
    label: rollLabel(event, roll),
    text: roll.text || formatRollBreakdown(roll),
    roll,
  };
}

/** Project one envelope into separately renderable roll and result rows. */
export function combatLogDetails(
  record: CombatLogEventRecord,
  state: Pick<SoloCombatState, 'world'>,
): CombatLogDetail[] {
  if (record.kind === 'death') {
    return [{
      kind: 'death',
      label: 'Смерть',
      text: actorNames([record.actorId], state),
    }];
  }
  const event = record.event;
  if (!event) return [];
  const targets = affectedActorIds(record);
  const targetSuffix = targets.length ? ` → ${actorNames(targets, state)}` : '';
  if (event.type === 'roll') return [rollDetail(event, event.roll)];
  if (event.type === 'damage') {
    return [
      ...(event.roll ? [rollDetail(event, event.roll)] : []),
      {
        kind: 'damage' as const,
        label: 'Урон',
        text: `${event.amount} (${event.damageType})${targetSuffix}`,
      },
    ];
  }
  if (event.type === 'healing') {
    return [
      ...(event.roll ? [rollDetail(event, event.roll)] : []),
      {
        kind: 'healing' as const,
        label: 'Лечение',
        text: `+${event.amount}${targetSuffix}`,
      },
    ];
  }
  return [{
    kind: 'event',
    label: 'Событие',
    text: `${describeEngineEvent(event)}${targetSuffix}`,
  }];
}
