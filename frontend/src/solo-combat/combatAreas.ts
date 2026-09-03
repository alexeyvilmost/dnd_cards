import type { ActiveEffectEntry } from '../mvp/contracts';
import type {
  RuleActionDefinition,
  RuleHazardDefinition,
  RuleSavingHazardDefinition,
} from '../rules-core/domain';
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

function insideEffectOf(
  tactical: Dict,
  source: SoloCombatState['world']['actors'][string] | undefined,
): CombatAreaState['insideEffect'] | undefined {
  const grant = record(tactical.inside_effect);
  if (!grant) return undefined;
  const cardNumber = grant.kind === 'grant_effect' && typeof grant.value === 'string'
    ? grant.value.trim() : '';
  if (!cardNumber.startsWith('COND-')) {
    throw new Error('Состояние зоны должно ссылаться на библиотечную карточку COND-*');
  }
  const entity = source?.grantedEffects?.[cardNumber];
  const mechanics = record(entity?.mechanics);
  const condition = record(mechanics?.condition);
  const entityId = typeof entity?.id === 'string' ? entity.id.trim() : '';
  const resolvedCard = typeof entity?.card_number === 'string' ? entity.card_number.trim() : '';
  const conditionId = typeof condition?.id === 'string' ? condition.id.trim() : '';
  if (!entityId || resolvedCard !== cardNumber || !conditionId) {
    throw new Error(`Состояние зоны «${cardNumber}» не разрешено в библиотеке эффектов`);
  }
  return {
    cardNumber,
    entityId,
    conditionId,
    name: typeof entity?.name === 'string' && entity.name.trim() ? entity.name : cardNumber,
  };
}

function hazardOf(input: {
  action: RuleActionDefinition;
  payload: Dict;
  state: SoloCombatState;
  sourceActorId: string;
  identitySuffix?: string;
}): RuleHazardDefinition | undefined {
  const tactical = record(input.payload.tactical);
  const automaticEffects = Array.isArray(tactical?.auto_effects)
    ? tactical.auto_effects as Dict[] : [];
  const source = input.state.world.actors[input.sourceActorId];
  if (automaticEffects.length > 0) {
    return {
      id: stableHazardId(input.sourceActorId, `${input.action.id}${input.identitySuffix ?? ''}`),
      name: input.action.name,
      sourceKind: 'environment',
      sourceEntityIds: [...input.action.sourceEntityIds],
      resolution: 'automatic',
      effects: automaticEffects,
      grantedEffects: { ...(source?.grantedEffects ?? {}) },
    };
  }
  const save = record(tactical?.save);
  const ability = String(save?.ability ?? '');
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
    id: stableHazardId(input.sourceActorId, `${input.action.id}${input.identitySuffix ?? ''}`),
    name: input.action.name,
    sourceKind: 'environment',
    sourceEntityIds: [...input.action.sourceEntityIds],
    resolution: 'save',
    save: { ability: ability as RuleSavingHazardDefinition['save']['ability'], dc },
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
  const insideEffect = insideEffectOf(tactical, input.state.world.actors[input.sourceActorId]);
  const endTurnSave = record(tactical.end_turn_save);
  const endTurnHazard = endTurnSave ? hazardOf({
    action: input.action,
    payload: {
      tactical: {
        save: { ability: endTurnSave.ability, dc: endTurnSave.dc },
        on_failure: endTurnSave.on_failure,
        on_success: endTurnSave.on_success,
      },
    },
    state: input.state,
    sourceActorId: input.sourceActorId,
    identitySuffix: ':end-turn',
  }) : undefined;
  const declaredTriggers = strings(tactical.triggers).filter((event): event is CombatAreaEvent => (
    ['created', 'enter', 'exit', 'move', 'start_turn', 'end_turn'].includes(event)
  ));
  const triggers = endTurnHazard && !declaredTriggers.includes('end_turn')
    ? [...declaredTriggers, 'end_turn' as const]
    : declaredTriggers;
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
    triggers,
    difficultTerrain: tactical.difficult_terrain === true,
    lightlyObscured: tactical.lightly_obscured === true,
    heavilyObscured: tactical.heavily_obscured === true,
    blocksVerbalComponents: tactical.blocks_verbal_components === true,
    damageImmunities: strings(tactical.damage_immunities),
    ...(insideEffect ? { insideEffect } : {}),
    ...(typeof tactical.notice === 'string' ? { notice: tactical.notice } : {}),
  };
  const hazard = hazardOf({
    action: input.action, payload,
    state: input.state, sourceActorId: input.sourceActorId,
  });
  return {
    ...area,
    ...(hazard ? { hazard } : {}),
    ...(endTurnHazard ? { eventHazards: { end_turn: endTurnHazard } } : {}),
  };
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
  occurrencesByArea: Readonly<Record<string, number>> = {},
): SoloCombatState {
  const key = turnKey(state);
  const queued = [...(state.pendingCombatAreaTriggers ?? [])];
  const areas = { ...(state.combatAreas ?? {}) };
  for (const area of Object.values(areas)) {
    if (areaIds && !areaIds.includes(area.id)) continue;
    if ((!area.hazard && !area.eventHazards?.[event] && !area.notice) || !area.triggers.includes(event)) continue;
    const triggered = new Set(area.triggeredTurnKeys ?? []);
    for (const actorId of actorIds) {
      const token = state.tokens[actorId];
      if (!token || (!assumeMembership && event !== 'exit' && !areaContains(area, token.position))) continue;
      const occurrences = Math.max(1, Math.floor(occurrencesByArea[area.id] ?? 1));
      for (let occurrence = 0; occurrence < occurrences; occurrence += 1) {
        const movementIdentity = event === 'move' ? `:${state.boardRevision}:${occurrence}` : '';
        const dedupe = `${actorId}:${event}:${key}${movementIdentity}`;
        if (triggered.has(dedupe)) continue;
        triggered.add(dedupe);
        queued.push({ areaId: area.id, actorId, event, turnKey: key, occurrence });
      }
    }
    areas[area.id] = { ...area, triggeredTurnKeys: [...triggered].slice(-96) };
  }
  return { ...state, combatAreas: areas, pendingCombatAreaTriggers: queued };
}

function areaConditionEffect(area: CombatAreaState, actorId: string): ActiveEffectEntry {
  const effect = area.insideEffect!;
  return {
    id: `combat-area:${area.id}:condition:${actorId}`,
    name: effect.name,
    mechanics: {
      kind: 'condition', value: effect.conditionId, op: 'apply', area_id: area.id,
      source_entity_id: effect.entityId,
    },
    expiry: 'manual',
    source: area.name,
    entityRef: { kind: 'effect', id: effect.entityId, cardNumber: effect.cardNumber },
    ownerId: actorId,
    sourceId: area.sourceActorId,
  };
}

function areaDamageImmunityEffect(
  area: CombatAreaState,
  actorId: string,
  damageType: string,
): ActiveEffectEntry {
  return {
    id: `combat-area:${area.id}:immunity:${damageType}:${actorId}`,
    name: `${area.name}: иммунитет (${damageType})`,
    mechanics: {
      kind: 'resistance', damage_type: damageType, value: 'immunity', area_id: area.id,
      source_entity_ids: [...area.sourceEntityIds],
    },
    expiry: 'manual',
    source: area.name,
    ownerId: actorId,
    sourceId: `environment:combat-area:${area.id}`,
  };
}

/** Synchronize area-owned conditions and defenses whose lifetime is membership. */
export function reconcileInsideAreaConditions(state: SoloCombatState): SoloCombatState {
  const areas = Object.values(state.combatAreas ?? {}).filter((area) => (
    area.insideEffect || area.damageImmunities?.length
  ));
  const activeAreaSources = new Set(Object.keys(state.combatAreas ?? {}).map((areaId) => (
    `environment:combat-area:${areaId}`
  )));
  const hazardAreaBySource = new Map<string, CombatAreaState>(Object.values(state.combatAreas ?? {}).flatMap((area) => (
    area.hazard ? [[`environment:${area.hazard.id}`, area] as const] : []
  )));
  let changed = false;
  const actors = Object.fromEntries(Object.entries(state.world.actors).map(([actorId, actor]) => {
    const required = areas.filter((area) => {
      const token = state.tokens[actorId];
      return token && areaContains(area, token.position);
    });
    const requiredIds = new Set(required.flatMap((area) => [
      ...(area.insideEffect ? [`combat-area:${area.id}:condition:${actorId}`] : []),
      ...(area.damageImmunities ?? []).map((damageType) => (
        `combat-area:${area.id}:immunity:${damageType}:${actorId}`
      )),
    ]));
    let activeEffects = actor.runtime.activeEffects.filter((effect) => {
      if ((effect.mechanics as Dict).area_linked === true
        && effect.sourceId?.startsWith('environment:combat-area:')
        && !activeAreaSources.has(effect.sourceId)
        && !hazardAreaBySource.has(effect.sourceId)) return false;
      if ((effect.mechanics as Dict).area_linked === true && effect.sourceId) {
        const sourceArea = hazardAreaBySource.get(effect.sourceId);
        const token = state.tokens[actorId];
        if (sourceArea && (!token || !areaContains(sourceArea, token.position))) return false;
      }
      const areaId = (effect.mechanics as Dict).area_id;
      return typeof areaId !== 'string' || requiredIds.has(effect.id);
    });
    for (const area of required) {
      if (area.insideEffect) {
        const id = `combat-area:${area.id}:condition:${actorId}`;
        if (!activeEffects.some((effect) => effect.id === id)) {
          activeEffects = [...activeEffects, areaConditionEffect(area, actorId)];
        }
      }
      for (const damageType of area.damageImmunities ?? []) {
        const id = `combat-area:${area.id}:immunity:${damageType}:${actorId}`;
        if (!activeEffects.some((effect) => effect.id === id)) {
          activeEffects = [...activeEffects, areaDamageImmunityEffect(area, actorId, damageType)];
        }
      }
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
): { entered: string[]; exited: string[]; movementOccurrences: Record<string, number> } {
  const areas = Object.values(state.combatAreas ?? {});
  const traversed = movementCells(from, to);
  return {
    entered: areas.filter((area) => !areaContains(area, from)
      && traversed.some((cell) => areaContains(area, cell))).map((area) => area.id),
    exited: areas.filter((area) => areaContains(area, from) && !areaContains(area, to)).map((area) => area.id),
    movementOccurrences: Object.fromEntries(areas.flatMap((area) => {
      const count = traversed.filter((cell) => !samePosition(cell, from) && areaContains(area, cell)).length;
      return count > 0 ? [[area.id, count]] : [];
    })),
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
  return Object.values(state.combatAreas ?? {}).flatMap((area) => [
    ...(area.hazard ? [area.hazard] : []),
    ...Object.values(area.eventHazards ?? {}).filter((hazard): hazard is RuleHazardDefinition => Boolean(hazard)),
  ]);
}

export function pendingTriggerForArea(
  state: SoloCombatState,
): { trigger: PendingCombatAreaTrigger; area: CombatAreaState; hazard?: RuleHazardDefinition } | null {
  const trigger = state.pendingCombatAreaTriggers?.[0];
  if (!trigger) return null;
  const area = state.combatAreas?.[trigger.areaId];
  const hazard = area?.eventHazards?.[trigger.event] ?? area?.hazard;
  return area ? { trigger, area, ...(hazard ? { hazard } : {}) } : null;
}
