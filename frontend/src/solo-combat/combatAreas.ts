import type { ActiveEffectEntry } from '../mvp/contracts';
import { conditionEffectEntityRef, conditionLabel } from '../engine/conditions';
import type { RuleActionDefinition, RuleHazardDefinition } from '../rules-core/domain';
import { areaPositionsForAction, samePosition } from './tacticalGrid';
import type {
  CombatAreaEvent,
  CombatAreaState,
  GridPosition,
  PendingCombatAreaTrigger,
  SoloCombatState,
} from './types';

type Dict = Record<string, unknown>;

function record(value: unknown): Dict | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : null;
}

function selectedPayloads(value: unknown, choices: Readonly<Record<string, readonly string[]>>): Dict[] {
  if (Array.isArray(value)) return value.flatMap((item) => selectedPayloads(item, choices));
  const row = record(value);
  if (!row) return [];
  if (row.kind === 'choice' && typeof row.id === 'string') {
    const selected = new Set(choices[row.id] ?? []);
    const items = Array.isArray(record(row.options)?.items) ? record(row.options)!.items as unknown[] : [];
    return items.flatMap((item) => {
      const option = record(item);
      return option && selected.has(String(option.id ?? ''))
        ? selectedPayloads(option.grants, choices) : [];
    });
  }
  return [row, ...Object.entries(row).flatMap(([key, nested]) => (
    key === 'options' ? [] : selectedPayloads(nested, choices)
  ))];
}

export function worldZonePayload(
  action: RuleActionDefinition,
  choices: Readonly<Record<string, readonly string[]>> = {},
): Dict | null {
  const zones = selectedPayloads(action.mechanics, choices).filter((payload) => payload.kind === 'world_zone');
  // Several mutually exclusive choice branches need the chosen branch as an
  // explicit input; never guess the first localized option.
  return zones.length === 1 ? zones[0] : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function durationOf(action: RuleActionDefinition, payload: Dict): CombatAreaState['duration'] {
  const duration = record(payload.duration) ?? {};
  if (action.concentration || duration.concentration === true) return { type: 'concentration' };
  if (duration.type === 'rounds' && Number.isInteger(duration.amount) && Number(duration.amount) > 0) {
    return { type: 'rounds', roundsLeft: Number(duration.amount) };
  }
  return { type: 'permanent' };
}

function stableHazardId(sourceActorId: string, actionId: string): string {
  const raw = `${sourceActorId}:${actionId}`;
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const readable = raw.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 100);
  return `combat-area:${readable}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function hazardOf(input: {
  action: RuleActionDefinition;
  payload: Dict;
  state: SoloCombatState;
  sourceActorId: string;
}): RuleHazardDefinition | undefined {
  const tactical = record(input.payload.tactical);
  const save = record(tactical?.save);
  const ability = String(save?.ability ?? '');
  const source = input.state.world.actors[input.sourceActorId];
  const spellAbility = source?.spellcastingAccess?.grants.find((grant) => (
    grant.actionId === input.action.id
  ))?.spellcastingAbility ?? source?.character.spellcastingAbility;
  const dc = save?.dc === 'spell_save_dc' && source && spellAbility
    ? 8 + source.character.profBonus + (source.character.abilityMods[spellAbility] ?? 0)
    : Number(save?.dc);
  const onFailure = Array.isArray(tactical?.on_failure)
    ? tactical!.on_failure as Dict[] : [];
  if (!['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(ability)
    || !Number.isInteger(dc) || dc < 1 || onFailure.length === 0) return undefined;
  return {
    id: stableHazardId(input.sourceActorId, input.action.id),
    name: input.action.name,
    sourceKind: 'environment',
    sourceEntityIds: [...input.action.sourceEntityIds],
    save: { ability: ability as RuleHazardDefinition['save']['ability'], dc },
    onFailure,
    onSuccess: Array.isArray(tactical?.on_success) ? tactical!.on_success as Dict[] : [],
    grantedEffects: { ...(source.grantedEffects ?? {}) },
  };
}

export function createCombatArea(input: {
  state: SoloCombatState;
  action: RuleActionDefinition;
  sourceActorId: string;
  origin: GridPosition;
  choices?: Readonly<Record<string, readonly string[]>>;
}): CombatAreaState | null {
  const payload = worldZonePayload(input.action, input.choices);
  if (!payload) return null;
  const sourcePosition = input.state.tokens[input.sourceActorId]?.position;
  if (!sourcePosition) throw new Error('У создателя зоны нет токена на поле');
  const cells = areaPositionsForAction({
    action: input.action,
    sourcePosition,
    aimPosition: input.origin,
  });
  if (!cells.length) throw new Error(`У «${input.action.name}» нет исполнимой геометрии области`);
  const id = `${input.sourceActorId}:${input.action.id}:${input.state.world.revision}`;
  const tactical = record(payload.tactical) ?? {};
  const area: CombatAreaState = {
    id,
    name: input.action.name,
    zoneType: String(payload.zone_type ?? 'area'),
    sourceActorId: input.sourceActorId,
    sourceActionId: input.action.id,
    sourceEntityIds: [...input.action.sourceEntityIds],
    origin: { ...input.origin },
    cells,
    duration: durationOf(input.action, payload),
    triggers: strings(tactical.triggers).filter((event): event is CombatAreaEvent => (
      ['created', 'enter', 'exit', 'start_turn', 'end_turn'].includes(event)
    )),
    difficultTerrain: tactical.difficult_terrain === true,
    heavilyObscured: tactical.heavily_obscured === true,
    ...(typeof tactical.inside_condition === 'string'
      ? { insideCondition: tactical.inside_condition } : {}),
    ...(typeof tactical.notice === 'string' ? { notice: tactical.notice } : {}),
  };
  const hazard = hazardOf({
    action: input.action, payload,
    state: input.state, sourceActorId: input.sourceActorId,
  });
  return { ...area, ...(hazard ? {
    hazard,
  } : {}) };
}

export function areaContains(area: CombatAreaState, position: GridPosition): boolean {
  return area.cells.some((cell) => samePosition(cell, position));
}

export function turnKey(state: SoloCombatState): string {
  const scene = state.world.scene;
  return scene.mode === 'encounter'
    ? `${scene.round}:${scene.activeIndex}:${scene.initiative[scene.activeIndex] ?? ''}`
    : `exploration:${state.world.revision}`;
}

export function queueCombatAreaEvent(
  state: SoloCombatState,
  event: CombatAreaEvent,
  actorIds: readonly string[],
  areaIds?: readonly string[],
  assumeMembership = false,
): SoloCombatState {
  const key = turnKey(state);
  const queued = [...(state.pendingCombatAreaTriggers ?? [])];
  const areas = { ...(state.combatAreas ?? {}) };
  for (const area of Object.values(areas)) {
    if (areaIds && !areaIds.includes(area.id)) continue;
    if ((!area.hazard && !area.notice) || !area.triggers.includes(event)) continue;
    const triggered = new Set(area.triggeredTurnKeys ?? []);
    for (const actorId of actorIds) {
      const token = state.tokens[actorId];
      if (!token || (!assumeMembership && event !== 'exit' && !areaContains(area, token.position))) continue;
      const dedupe = `${actorId}:${event}:${key}`;
      if (triggered.has(dedupe)) continue;
      triggered.add(dedupe);
      queued.push({ areaId: area.id, actorId, event, turnKey: key });
    }
    areas[area.id] = { ...area, triggeredTurnKeys: [...triggered].slice(-96) };
  }
  return { ...state, combatAreas: areas, pendingCombatAreaTriggers: queued };
}

function areaConditionEffect(area: CombatAreaState, actorId: string): ActiveEffectEntry {
  const condition = area.insideCondition!;
  const entityRef = conditionEffectEntityRef(condition);
  if (!entityRef) throw new Error(`Состояние зоны «${condition}» отсутствует в библиотеке эффектов`);
  return {
    id: `combat-area:${area.id}:condition:${actorId}`,
    name: conditionLabel(condition),
    mechanics: {
      kind: 'condition', value: condition, op: 'apply', area_id: area.id,
      source_entity_id: entityRef.id,
    },
    expiry: 'manual',
    source: area.name,
    entityRef,
    ownerId: actorId,
    sourceId: area.sourceActorId,
  };
}

/** Synchronize no-save conditions whose exact lifetime is membership in an area. */
export function reconcileInsideAreaConditions(state: SoloCombatState): SoloCombatState {
  const areas = Object.values(state.combatAreas ?? {}).filter((area) => area.insideCondition);
  const activeAreaSources = new Set(Object.keys(state.combatAreas ?? {}).map((areaId) => (
    `environment:combat-area:${areaId}`
  )));
  let changed = false;
  const actors = Object.fromEntries(Object.entries(state.world.actors).map(([actorId, actor]) => {
    const required = areas.filter((area) => {
      const token = state.tokens[actorId];
      return token && areaContains(area, token.position);
    });
    const requiredIds = new Set(required.map((area) => `combat-area:${area.id}:condition:${actorId}`));
    let activeEffects = actor.runtime.activeEffects.filter((effect) => {
      if ((effect.mechanics as Dict).area_linked === true
        && effect.sourceId?.startsWith('environment:combat-area:')
        && !activeAreaSources.has(effect.sourceId)) return false;
      const areaId = (effect.mechanics as Dict).area_id;
      return typeof areaId !== 'string' || requiredIds.has(effect.id);
    });
    for (const area of required) {
      const id = `combat-area:${area.id}:condition:${actorId}`;
      if (!activeEffects.some((effect) => effect.id === id)) activeEffects = [...activeEffects, areaConditionEffect(area, actorId)];
    }
    if (activeEffects.length !== actor.runtime.activeEffects.length
      || activeEffects.some((effect, index) => effect !== actor.runtime.activeEffects[index])) changed = true;
    return [actorId, { ...actor, runtime: { ...actor.runtime, activeEffects } }];
  }));
  return changed ? { ...state, world: { ...state.world, actors } } : state;
}

export function removeInactiveCombatAreas(state: SoloCombatState): SoloCombatState {
  const retained = Object.fromEntries(Object.entries(state.combatAreas ?? {}).filter(([, area]) => {
    if (area.duration.type !== 'concentration') return true;
    return state.world.concentrations[area.sourceActorId]?.actionId === area.sourceActionId;
  }));
  return reconcileInsideAreaConditions({ ...state, combatAreas: retained });
}

export function decrementSourceAreas(state: SoloCombatState, sourceActorId: string): SoloCombatState {
  const areas: Record<string, CombatAreaState> = {};
  for (const [id, area] of Object.entries(state.combatAreas ?? {})) {
    if (area.sourceActorId !== sourceActorId || area.duration.type !== 'rounds') {
      areas[id] = area;
      continue;
    }
    const roundsLeft = area.duration.roundsLeft - 1;
    if (roundsLeft > 0) areas[id] = { ...area, duration: { type: 'rounds', roundsLeft } };
  }
  return reconcileInsideAreaConditions({ ...state, combatAreas: areas });
}

export function movementCostThroughAreas(
  state: SoloCombatState,
  from: GridPosition,
  to: GridPosition,
  baseFeet: number,
): number {
  const difficult = Object.values(state.combatAreas ?? {}).some((area) => (
    area.difficultTerrain && movementCells(from, to).some((cell) => areaContains(area, cell))
  ));
  return difficult ? baseFeet * 2 : baseFeet;
}

export function enteredAndExitedAreas(
  state: SoloCombatState,
  from: GridPosition,
  to: GridPosition,
): { entered: string[]; exited: string[] } {
  const areas = Object.values(state.combatAreas ?? {});
  const traversed = movementCells(from, to);
  return {
    entered: areas.filter((area) => !areaContains(area, from)
      && traversed.some((cell) => areaContains(area, cell))).map((area) => area.id),
    exited: areas.filter((area) => areaContains(area, from) && !areaContains(area, to)).map((area) => area.id),
  };
}

function movementCells(from: GridPosition, to: GridPosition): GridPosition[] {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const ratio = steps === 0 ? 0 : index / steps;
    return {
      x: Math.round(from.x + (to.x - from.x) * ratio),
      y: Math.round(from.y + (to.y - from.y) * ratio),
    };
  });
}

export function hazardCatalog(state: Pick<SoloCombatState, 'combatAreas'>): RuleHazardDefinition[] {
  return Object.values(state.combatAreas ?? {}).flatMap((area) => area.hazard ? [area.hazard] : []);
}

export function pendingTriggerForArea(
  state: SoloCombatState,
): { trigger: PendingCombatAreaTrigger; area: CombatAreaState; hazard?: RuleHazardDefinition } | null {
  const trigger = state.pendingCombatAreaTriggers?.[0];
  if (!trigger) return null;
  const area = state.combatAreas?.[trigger.areaId];
  return area ? { trigger, area, ...(area.hazard ? { hazard: area.hazard } : {}) } : null;
}
