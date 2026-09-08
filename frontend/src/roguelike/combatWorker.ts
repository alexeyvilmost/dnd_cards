import {gridDistanceFt} from '../solo-combat/tacticalGrid';
import {bindCombatWorldInputFacts} from '../solo-combat/worldInput';
import {TACTICAL_WIDTH, TACTICAL_HEIGHT} from '../solo-combat/types';
import type { DecisionResponse } from '../rules-core/domain';
import { canonicalSha256Sync } from '../rules-core/determinism';
import {
  declineAdditionalMovement, isTriggeredCombatAction, resumePendingMovement, activeActor, activateCombatBoon, advanceTurn, autoResolveSystemDecisions,
  executeCombatAction, executeCombatRemoteManipulator, moveCombatDancingLights, revealCombatMagicAura, moveActorAlongRoute, resolveD20Interrupt, resolvePlayerReaction,
  resolvePlayerShoveOutcome, resolvePlayerSavingThrow, resolveSoloCombatAlertSwap, resolveSoloCombatInterception,
  resolveSoloCombatTurnStart, resolveTriggeredCombatAction, runMonsterTurn, standActor,
} from '../solo-combat/engine';
import { isPlayerControlledCombatActor, type GridPosition, type SoloCombatState } from '../solo-combat/types';

/** Internal worker envelope. Entropy must never be copied into the public run DTO. */
export interface RoguelikeCombatEnvelope {
  schemaVersion: 1;
  artifactHash: string;
  entropy: {seed: string; cursor: number};
  state: SoloCombatState;
}

type ActionInput = Parameters<typeof executeCombatAction>[0];
export type RoguelikeCombatIntent =
  | {type: 'action'; actorId: string; actionId: string; targetIds: string[];
      choices?: ActionInput['choices']; worldPosition?: GridPosition; worldInput?: ActionInput['worldInput']}
  | {type: 'move'; actorId: string; destination: GridPosition}
  | {type: 'decline_movement'; actorId: string}
  | {type: 'stand'; actorId: string}
  | {type: 'end_turn'; actorId: string}
  | {type: 'shove_outcome'; outcome: Extract<DecisionResponse, {kind: 'shove_outcome'}>['outcome']}
  | {type: 'reaction'; response: Extract<DecisionResponse, {kind: 'reaction'}>}
  | {type: 'saving_throw'; selectedAbility?: Extract<DecisionResponse, {kind: 'roll'}>['selectedAbility']; boonEffectId?: string}
  | {type: 'd20_interrupt'; actorId: string | null}
  | {type: 'interception'; actorId: string | null}
  | {type: 'triggered_action'; actionId: string | null; choices?: Record<string, string[]>}
  | {type: 'turn_start'; targetActorId: string | null}
  | {type: 'alert_swap'; actorId: string; allyActorId: string | null}
  | {type: 'boon'; actorId: string; effectId: string;
      rollKind: 'attack_roll' | 'saving_throw' | 'ability_check'; timing: 'before_roll' | 'after_failure'}
  | {type: 'dancing_lights'; actorId: string; groupId: string; destination: GridPosition}
  | {type: 'detect_magic'; actorId: string}
  | {type: 'remote_manipulator'; actorId: string; command: Parameters<typeof executeCombatRemoteManipulator>[0]['command']}
  | {type: 'resume'};

function hasDecision(state: SoloCombatState): boolean {
  return Boolean(state.pendingAdditionalMovement || state.world.pendingResolution || state.pendingD20Interrupt || state.pendingInterception
    || state.pendingTriggeredAction || state.pendingTurnStartGrappleDamage || state.pendingAlertSwapActorIds?.length);
}

export function createRoguelikeCombatRandom(seed: string, initialCursor: number) {
  if (!seed || !Number.isSafeInteger(initialCursor) || initialCursor < 0) throw new Error('Повреждён поток случайности боя');
  let cursor = initialCursor;
  const randomValues: number[] = [];
  const rng = () => {
    if (randomValues.length >= 4096 || cursor >= Number.MAX_SAFE_INTEGER) throw new Error('Превышен бюджет бросков команды');
    const hash = canonicalSha256Sync(['roguelike-combat-v1', seed, cursor++]);
    const value = Number.parseInt(hash.slice(7, 20), 16) / 0x10000000000000;
    randomValues.push(value);
    return value;
  };
  return {rng, randomValues, get cursor() {return cursor;}};
}

/** Uses only the existing engine. Failed requests cannot mutate the envelope or
 * advance committed entropy; persistence/receipts belong to the Go transaction. */
export function stepRoguelikeCombat(
  envelope: RoguelikeCombatEnvelope,
  intent: RoguelikeCombatIntent,
  artifactHash: string,
): {envelope: RoguelikeCombatEnvelope; randomValues: number[]} {
  if (envelope.schemaVersion !== 1 || !/^sha256:[a-f0-9]{64}$/.test(artifactHash)
    || envelope.artifactHash !== artifactHash) throw new Error('Несовместимая версия правил боя');
  if (!envelope.entropy.seed || !Number.isSafeInteger(envelope.entropy.cursor) || envelope.entropy.cursor < 0) {
    throw new Error('Повреждён поток случайности боя');
  }
  const random = createRoguelikeCombatRandom(envelope.entropy.seed, envelope.entropy.cursor);
  const {rng, randomValues} = random;
  let state = structuredClone(envelope.state);
  if (state.outcome !== 'active') throw new Error('Бой уже завершён');
  const requireOwned = (actorId: string) => {
    if (!isPlayerControlledCombatActor(state, actorId)) throw new Error('Нельзя управлять этим участником боя');
  };
  if ('actorId' in intent && intent.actorId !== null) requireOwned(intent.actorId);
  const proactive = new Set(['action', 'move', 'stand', 'end_turn', 'dancing_lights', 'detect_magic', 'remote_manipulator', 'boon']);
  const additionalMove = intent.type === 'move' && state.pendingAdditionalMovement?.actorId === intent.actorId;
  if (proactive.has(intent.type) && 'actorId' in intent
    && (hasDecision(additionalMove ? {...state, pendingAdditionalMovement: undefined} : state)
      || state.playerMovement || state.pendingReachEntry || (!additionalMove && activeActor(state).id !== intent.actorId))) {
    throw new Error('Сначала завершите текущее решение или дождитесь своего хода');
  }
  switch (intent.type) {
    case 'action': {
      const requestedAction = state.catalogActions.find(row => row.id === intent.actionId);
      if (requestedAction && isTriggeredCombatAction(requestedAction)) throw new Error('Способность доступна только после соответствующего события');
      let worldInput = intent.worldInput;
      if (intent.worldPosition) {
        const position = intent.worldPosition;
        if (!Number.isInteger(position.x) || !Number.isInteger(position.y) || position.x < 0 || position.y < 0
          || position.x >= TACTICAL_WIDTH || position.y >= TACTICAL_HEIGHT) throw new Error('Клетка вне поля боя');
        const source = state.tokens[intent.actorId]?.position;
        if (!source) throw new Error('Участник отсутствует на поле');
        const distanceFt = gridDistanceFt(source, position);
        const action = state.catalogActions.find(row => row.id === intent.actionId);
        if (action?.targeting?.rangeFt !== undefined && distanceFt > action.targeting.rangeFt) throw new Error('Цель вне дальности');
        if (worldInput) worldInput = bindCombatWorldInputFacts(worldInput,
          {factsSource: 'board', boardRevision: state.boardRevision, distanceFt, lineOfSight: true});
      } else if (worldInput) throw new Error('Для взаимодействия нужна клетка поля');
      state = executeCombatAction({state, actorId: intent.actorId, actionId: intent.actionId,
        targetIds: intent.targetIds, choices: intent.choices, worldPosition: intent.worldPosition, worldInput, rng});
      break;
    }
    case 'move': state = moveActorAlongRoute({state, actorId: intent.actorId, destination: intent.destination, rng}); break;
    case 'decline_movement':
      if (state.pendingAdditionalMovement?.actorId !== intent.actorId) throw new Error('Нет ожидающего перемещения участника');
      state = declineAdditionalMovement(state); break;
    case 'stand': state = standActor(state, intent.actorId); break;
    case 'end_turn':
      if (hasDecision(state) || activeActor(state).id !== intent.actorId) throw new Error('Сначала завершите текущее решение');
      state = advanceTurn(state, rng);
      break;
    case 'shove_outcome': state = resolvePlayerShoveOutcome(state, intent.outcome, rng); break;
    case 'reaction': state = resolvePlayerReaction(state, intent.response, rng); break;
    case 'saving_throw':
      if (state.world.pendingResolution?.request.type !== 'saving_throw') throw new Error('Нет ожидающего спасброска');
      requireOwned(state.world.pendingResolution.request.actorId);
      state = resolvePlayerSavingThrow(state, {kind: 'roll', roll: {mode: 'system'},
        selectedAbility: intent.selectedAbility, boonEffectId: intent.boonEffectId}, rng);
      break;
    case 'd20_interrupt': state = resolveD20Interrupt(state, intent.actorId, rng); break;
    case 'interception': state = resolveSoloCombatInterception(state, intent.actorId, rng); break;
    case 'triggered_action':
      if (!state.pendingTriggeredAction) throw new Error('Нет ожидающей способности');
      requireOwned(state.pendingTriggeredAction.sourceActorId);
      state = resolveTriggeredCombatAction(state, intent.actionId, rng, intent.choices);
      break;
    case 'turn_start':
      if (!state.pendingTurnStartGrappleDamage) throw new Error('Нет ожидающего выбора в начале хода');
      requireOwned(state.pendingTurnStartGrappleDamage.actorId);
      state = resolveSoloCombatTurnStart(state, intent.targetActorId, rng);
      break;
    case 'alert_swap': state = resolveSoloCombatAlertSwap(state, intent.actorId, intent.allyActorId, rng); break;
    case 'boon': state = activateCombatBoon(state, intent.actorId, intent.effectId, intent.rollKind, intent.timing, rng); break;
    case 'dancing_lights': state = moveCombatDancingLights({state, actorId: intent.actorId, groupId: intent.groupId, destination: intent.destination, rng}); break;
    case 'detect_magic': state = revealCombatMagicAura({state, actorId: intent.actorId, rng}); break;
    case 'remote_manipulator': state = executeCombatRemoteManipulator({state, actorId: intent.actorId, command: intent.command}); break;
    case 'resume': break;
    default: throw new Error('Неизвестная команда боя');
  }
  state = resumePendingMovement(autoResolveSystemDecisions(state, rng), rng);
  let turns = 0;
  while (state.outcome === 'active' && !hasDecision(state) && !isPlayerControlledCombatActor(state, activeActor(state).id)) {
    if (++turns > 64) throw new Error('Превышен бюджет ходов ИИ');
    const before = state;
    state = runMonsterTurn(state, rng);
    if (canonicalSha256Sync(state) === canonicalSha256Sync(before)) throw new Error('ИИ не смог завершить ход');
  }
  return {envelope: {...envelope, entropy: {...envelope.entropy, cursor: random.cursor}, state}, randomValues};
}
