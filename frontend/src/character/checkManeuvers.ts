import {canonicalStringify, sha256String} from '../rules-core/determinism';
import type {ForgeCharacter} from './types';
import type {PreparedSheetAtomicWorldCommit} from './sheetAtomicWorldCommit';
import {writeRulesEngineRuntimeTurnState} from './runtime';
import type {EngineEvent} from '../mvp/contracts';
import type {Action} from '../types';
import type {CharacterContext, RuntimeState} from '../mvp/contracts';
import type {PendingChoice} from '../mechanics/collectChoices';
import {canPay} from '../engine/cost';
import {executeAction} from '../engine/execute';

type Dict = Record<string, unknown>;
export interface CheckFacts {ability?: unknown; skill?: unknown}

/** Offered only from the character's resolved action grants, never the whole catalog. */
export function availableCheckManeuvers(actions: readonly Action[], state: RuntimeState,
  rollKind: string, facts: CheckFacts): Action[] {
  if (rollKind !== 'ability_check') return [];
  return [...new Map(actions.filter(action => {
    const mechanics = action.mechanics as Dict | undefined;
    const activation = mechanics?.activation as Dict | undefined;
    const trigger = activation?.trigger as Dict | undefined;
    if (activation?.mode !== 'triggered' || !Array.isArray(trigger?.events)
      || !trigger.events.includes('ability_check_made') || !Array.isArray(trigger.eligible_checks)) return false;
    if (!trigger.eligible_checks.some(raw => {
      const filter = raw as Dict;
      return filter.ability === facts.ability && Array.isArray(filter.skills) && filter.skills.includes(facts.skill);
    })) return false;
    return Array.isArray(activation.cost) && canPay(state, activation.cost as Dict[]).ok;
  }).map(action => [action.id, action])).values()];
}

export function checkManeuverChoice(actions: readonly Action[]): PendingChoice {
  return {id: 'check_maneuver', prompt: 'Использовать приём?', count: 1, source: 'explicit', context: 'in_play',
    origin: {kind: 'other', id: 'check-maneuvers', name: 'Проверка навыка'}, recommended: ['none'],
    items: [{id: 'none', name: 'Без приёма'}, ...actions.map(action => ({id: action.id, name: action.name,
      grants: [{kind: 'grant_action', value: action.card_number || action.id}]}))]};
}

/** Preparation is speculative: persist only together with the confirmed check. */
export function prepareCheckManeuver(action: Action, ownedActions: readonly Action[], state: RuntimeState,
  character: CharacterContext, facts: CheckFacts, selfId: string) {
  if (!availableCheckManeuvers(ownedActions, state, 'ability_check', facts).some(owned => owned.id === action.id)) {
    throw Error('Этот приём недоступен для выбранной проверки.');
  }
  return executeAction(structuredClone(state), action.mechanics as Dict, {character, selfId,
    rng: () => {throw Error('Кость приёма бросается вместе с проверкой.');}});
}

/** Uses the existing atomic runtime+journal endpoint and its exact retry receipt. */
export function prepareSheetCheckCommit(input: {
  character: ForgeCharacter; state: RuntimeState; events: EngineEvent[];
  rulesContent: unknown; commandId: string; runId?: string | null;
}): PreparedSheetAtomicWorldCommit {
  const {character, state} = input;
  if (!Number.isSafeInteger(character.runtime_revision) || Number(character.runtime_revision) < 0) {
    throw Error('Обновите лист перед проверкой: отсутствует версия персонажа.');
  }
  return {worldsByCharacterId: {}, request: {
    command_id: input.commandId,
    ...(input.runId ? {roguelike_run_id: input.runId, roguelike_intent: 'camp' as const} : {}),
    ruleset_ref: {system_id: character.system_id || 'dnd5e-2024',
      release_id: `sheet:${character.ruleset_version || '2024'}:checks-v1`,
      errata_version: character.ruleset_version || '2024',
      content_hash: `sha256:${sha256String(canonicalStringify(input.rulesContent))}`},
    participants: [{character_id: character.id, expected_runtime_revision: Number(character.runtime_revision),
      patch: {resources: state.resources, active_effects: state.activeEffects,
        turn_state: writeRulesEngineRuntimeTurnState(character.turn_state, state)}}],
    events: input.events.map(payload => ({character_id: character.id, type: payload.type, payload})),
  }};
}
