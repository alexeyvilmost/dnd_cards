import type {RuleHazardDefinition} from '../rules-core/domain';
import {conditionLabel} from '../engine/conditions';
import {getDamageLabel} from '../utils/damageTypes';
import {enteredAndExitedAreas, queueCombatAreaEvent} from './combatAreas';
import {magicAreaSuppressed} from './combatAntimagic';
import {combatRelation, type CombatAreaEvent, type CombatAreaState, type GridPosition, type SoloCombatState} from './types';

const movementEvents: CombatAreaEvent[] = ['move', 'enter', 'exit'];
const triggerLabels: Record<CombatAreaEvent, string> = {created:'при создании',enter:'при входе',exit:'при выходе',move:'за каждые 5 фт. движения',start_turn:'в начале хода',end_turn:'в конце хода'};

function consequences(payloads: Record<string, unknown>[]): string[] {
  return payloads.flatMap(row => {
    if (row.kind === 'damage') {
      const amount = typeof row.dice === 'string' ? row.dice.replace(/d/gi,'к')
        : typeof row.amount === 'number' ? String(row.amount) : 'урон';
      const damage = typeof row.type === 'string' ? getDamageLabel(row.type) : undefined;
      return [`${amount} урона${damage ? ` (${damage})` : ''}`];
    }
    if (row.kind === 'condition' && row.op !== 'remove' && typeof row.value === 'string') return [conditionLabel(row.value)];
    return typeof row.description === 'string' ? [row.description] : [];
  });
}

export function combatHazardLines(hazard: RuleHazardDefinition): string[] {
  if (hazard.resolution === 'automatic') {
    const effects = consequences(hazard.effects);
    return effects.length ? effects : ['Воздействие области без спасброска'];
  }
  const failure = consequences(hazard.onFailure), success = consequences(hazard.onSuccess ?? []);
  return [`Спасбросок ${hazard.save.ability.toUpperCase()} СЛ ${hazard.save.dc}`,
    ...failure.map(line => `При провале: ${line}`), ...success.map(line => `При успехе: ${line}`)];
}

/** Descriptions come from the same immutable hazards the worker executes. */
export function combatAreaHazardLines(area: CombatAreaState, event?: CombatAreaEvent): string[] {
  const hazards = event ? [area.eventHazards?.[event] ?? area.hazard]
    : [area.hazard, ...Object.values(area.eventHazards ?? {})];
  return [...new Set(hazards.flatMap(hazard => hazard ? combatHazardLines(hazard) : []))];
}

export function movementHazardAreas(state: SoloCombatState, actorId: string): CombatAreaState[] {
  return Object.values(state.combatAreas ?? {}).filter(area => {
    if (!movementEvents.some(event => area.triggers.includes(event) && (area.eventHazards?.[event] ?? area.hazard))) return false;
    if (area.sourceAnchored && area.sourceActorId === actorId) return false;
    const relation = combatRelation(state, area.sourceActorId, actorId);
    if (area.recipients === 'enemies' && relation !== 'enemy') return false;
    if (area.recipients === 'allies' && relation !== 'ally' && relation !== 'self') return false;
    return area.cells.some(position => !magicAreaSuppressed(state, area, position, actorId));
  });
}

/** Read-only queue projection reuses membership, recipients, per-turn limits and
 * suppression. It neither executes the consequences nor changes the live world. */
export function previewMovementHazards(state: SoloCombatState, actorId: string, path: GridPosition[]): {area:CombatAreaState;lines:string[]}[] {
  let from = state.tokens[actorId]?.position;
  if (!from || !path.length) return [];
  let projected: SoloCombatState = {...state, pendingCombatAreaTriggers: []};
  const warnings = new Map<string, {area:CombatAreaState;lines:string[]}>();
  for (const to of path) {
    const crossed = enteredAndExitedAreas(projected, from, to, actorId);
    projected = {...projected, boardRevision:(projected.boardRevision ?? 0) + 1,
      tokens:{...projected.tokens,[actorId]:{...projected.tokens[actorId],position:to}}};
    const before = projected.pendingCombatAreaTriggers?.length ?? 0;
    projected = queueCombatAreaEvent(projected,'move',[actorId],Object.keys(crossed.movementOccurrences),true,crossed.movementOccurrences);
    projected = queueCombatAreaEvent(projected,'enter',[actorId],crossed.entered,true);
    projected = queueCombatAreaEvent(projected,'exit',[actorId],crossed.exited);
    for (const trigger of projected.pendingCombatAreaTriggers?.slice(before) ?? []) {
      const area = projected.combatAreas?.[trigger.areaId];
      if (!area || !(area.eventHazards?.[trigger.event] ?? area.hazard)) continue;
      const lines = [...combatAreaHazardLines(area, trigger.event), triggerLabels[trigger.event]];
      const previous = warnings.get(area.id);
      warnings.set(area.id, {area,lines:[...new Set([...(previous?.lines ?? []),...lines])]});
    }
    from = to;
  }
  return [...warnings.values()];
}
