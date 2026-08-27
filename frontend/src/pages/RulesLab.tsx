import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type {
  ActorState,
  GameCommand,
  PendingResolution,
  UncommittedRuleEvent,
  WorldState,
} from '../rules-core/domain';
import {
  FIND_FAMILIAR_CAST_PATH_CHOICE,
  FIND_FAMILIAR_FORM_CHOICE,
  FIND_FAMILIAR_SPIRIT_CHOICE,
} from '../rules-core/familiarRuntime';
import { SYSTEM_ACTION_IDS } from '../rules-core/systemActions';
import { PROTECTION_2024_CAPABILITY_ID } from '../rules-core/protection';
import type { PersistentRulesSession } from '../rules-session/RulesSession';
import {
  rulesLabDependenciesForScenario,
  type RulesLabDependencies,
  type RulesLabRollQueue,
  type RulesLabSessionHandle,
} from './rulesLabFixture';
import {
  RULES_LAB_BASELINE_SCENARIO_ID,
  RULES_LAB_SCENARIOS,
  findRulesLabScenario,
  type RulesLabScenarioDefinition,
} from './rulesLabScenarioRegistry';
import './RulesLab.css';

interface RulesLabProps {
  dependencies?: RulesLabDependencies;
  scenarioId?: string;
}

interface Availability {
  disabled: boolean;
  reason: string;
}

interface LabButtonProps {
  testId: string;
  label: string;
  availability: Availability;
  onClick: () => void;
  tone?: 'primary' | 'decision' | 'danger';
}

const RESOURCE_LABELS: Record<string, string> = {
  action: 'Действие',
  bonus_action: 'Бонусное действие',
  reaction: 'Реакция',
  spell_slot_1: 'Ячейка 1 уровня',
};

function commandId(world: WorldState, suffix: string): string {
  return `rules-lab:r${world.revision + 1}:${suffix}`;
}

function activeActorId(world: WorldState | null): string | null {
  if (!world || world.scene.mode !== 'encounter') return null;
  return world.scene.initiative[world.scene.activeIndex] ?? null;
}

function actorName(world: WorldState | null, actorId: string | null): string {
  return actorId && world?.actors[actorId] ? world.actors[actorId].name : '—';
}

function commonPhaseAvailability(
  world: WorldState | null,
  busy: boolean,
  needsStartedTurn: boolean,
): Availability | null {
  if (busy) return { disabled: true, reason: 'Дождитесь завершения текущей команды.' };
  if (!world) return { disabled: true, reason: 'Сначала дождитесь загрузки мира.' };
  if (world.pendingResolution) {
    return { disabled: true, reason: 'Сначала завершите открытое решение.' };
  }
  if (world.scene.mode !== 'encounter') {
    return { disabled: true, reason: 'Сначала запустите столкновение.' };
  }
  if (needsStartedTurn && !world.scene.turnStarted) {
    return { disabled: true, reason: 'Сначала начните ход активного персонажа.' };
  }
  return null;
}

function LabButton({ testId, label, availability, onClick, tone = 'primary' }: LabButtonProps) {
  const reasonId = `${testId}-reason`;
  return (
    <div className="rules-lab__button-cell">
      <button
        type="button"
        className={`rules-lab__button rules-lab__button--${tone}`}
        data-testid={testId}
        disabled={availability.disabled}
        aria-describedby={reasonId}
        onClick={onClick}
      >
        {label}
      </button>
      <p id={reasonId} className="rules-lab__button-reason" data-testid={`${testId}-reason`}>
        {availability.reason}
      </p>
    </div>
  );
}

function RulesLabScenarioNav({ activeScenarioId }: { activeScenarioId?: string }) {
  return (
    <nav
      className="rules-lab__scenario-nav"
      aria-label="Сценарии Rules Session Lab"
      data-testid="rules-lab-scenario-nav"
    >
      <span>Сценарий</span>
      <ul>
        {RULES_LAB_SCENARIOS.map((scenario) => (
          <li key={scenario.id}>
            <a
              href={scenario.path}
              aria-current={scenario.id === activeScenarioId ? 'page' : undefined}
              data-testid={`rules-lab-scenario-${scenario.id}`}
            >
              {scenario.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function UnknownRulesLabScenario({ scenarioId }: { scenarioId: string }) {
  return (
    <main className="rules-lab" data-testid="rules-lab-unknown-scenario">
      <RulesLabScenarioNav />
      <section className="rules-lab__unknown" aria-labelledby="rules-lab-unknown-title">
        <p className="rules-lab__eyebrow">D&amp;D 2024 · acceptance adapter</p>
        <h1 id="rules-lab-unknown-title">Неизвестный сценарий</h1>
        <div className="rules-lab__alert" role="alert" data-testid="rules-lab-error">
          Сценарий «{scenarioId}» не зарегистрирован. Локальный мир не открыт и не изменён.
        </div>
        <a className="rules-lab__unknown-link" href="/rules-lab/baseline" data-testid="rules-lab-open-baseline">
          Открыть базовый сценарий
        </a>
      </section>
    </main>
  );
}

function effectLabel(effect: ActorState['runtime']['activeEffects'][number]): string {
  const mechanics = effect.mechanics as Record<string, unknown>;
  const value = typeof mechanics.value === 'string' ? mechanics.value : null;
  const duration = effect.roundsLeft == null ? '' : ` · ${effect.roundsLeft} раунд.`;
  return `${effect.name || value || 'Безымянный эффект'}${duration}`;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported exhaustive value: ${JSON.stringify(value)}`);
}

function resolutionDecisionActorId(resolution: PendingResolution): string {
  switch (resolution.type) {
    case 'target_save':
    case 'attack_reaction':
    case 'damage_reaction':
    case 'unarmed_save':
    case 'shove_outcome':
    case 'magic_missile_reaction':
    case 'mastery_save':
    case 'hazard_save':
      return resolution.targetActorId;
    case 'protection_reaction':
      return resolution.request.actorId;
    case 'escape_grapple':
    case 'concentration_save':
      return resolution.actorId;
    default:
      return assertNever(resolution);
  }
}

function summarizeEvent(event: UncommittedRuleEvent, world: WorldState | null): string {
  const payload = event.payload;
  switch (payload.type) {
    case 'CommandCommitted':
      return `Команда ${payload.commandId} зафиксирована · rev ${payload.revision}`;
    case 'SceneSet':
      return payload.scene.mode === 'encounter'
        ? `Сцена: раунд ${payload.scene.round}, активен ${payload.scene.initiative[payload.scene.activeIndex]}`
        : 'Сцена переведена в исследование';
    case 'ActorRuntimePatched':
      return `${payload.actorId}: состояние изменено (${payload.reason})`;
    case 'ActorDeathAdjudicated':
      return `${actorName(world, payload.actorId)}: смерть подтверждена явным фактом ${payload.factId}`;
    case 'EquipmentChanged':
      return `${payload.actorId}: надет доспех ${payload.cardId}`;
    case 'ActionDeclared': {
      const actor = world?.actors[payload.actorId]?.name ?? payload.actorId;
      const targetNames = payload.targetIds.map((id) => world?.actors[id]?.name ?? id).join(', ');
      const spell = payload.spell ? ` · уровень ${payload.spell.castLevel}` : '';
      return `${actor}: ${payload.actionKind === 'spell' ? 'заклинание' : 'действие'} ${payload.actionId}${spell}${targetNames ? ` → ${targetNames}` : ''}`;
    }
    case 'ResolutionOpened': {
      const decisionActorId = resolutionDecisionActorId(payload.resolution);
      return `Открыто решение ${payload.resolution.type} для ${decisionActorId}`;
    }
    case 'ResolutionClosed':
      return `Решение ${payload.resolutionId} закрыто`;
    case 'DecisionRecorded':
      return `${payload.actorId}: решение записано`;
    case 'AttackActionStarted':
      return `${actorName(world, payload.attackAction.actorId)}: Attack action ${payload.attackAction.id} начат`;
    case 'AttackEntryCommitted':
      return `Attack action ${payload.attackActionId}: атака ${payload.entry.ordinal} (${payload.entry.kind}) зафиксирована`;
    case 'AttackActionBlocked':
      return `Attack action ${payload.attackActionId}: ожидает решения ${payload.resolutionId}`;
    case 'AttackActionUnblocked':
      return `Attack action ${payload.attackActionId}: решение ${payload.resolutionId} завершено`;
    case 'AttackActionClosed':
      return `Attack action ${payload.attackActionId}: завершён (${payload.reason})`;
    case 'GrappleApplied':
      return `${actorName(world, payload.grapple.grapplerActorId)} удерживает ${actorName(world, payload.grapple.targetActorId)}`;
    case 'GrappleEnded':
      return `Захват ${payload.grappleId} завершён (${payload.reason})`;
    case 'ShoveApplied':
      return `${actorName(world, payload.sourceActorId)} толкает ${actorName(world, payload.targetActorId)} (${payload.outcome})`;
    case 'ConcentrationSet':
      return `${payload.concentration.sourceActorId}: концентрация ${payload.concentration.id} начата`;
    case 'ConcentrationCleared':
      return `${payload.sourceActorId}: концентрация ${payload.concentrationId} завершена (${payload.reason})`;
    case 'FamiliarActorUpserted':
      return `${actorName(world, payload.ownerActorId)}: фамильяр ${payload.actor.name} призван или изменён`;
    case 'FamiliarStateChanged':
      return `${actorName(world, payload.ownerActorId)}: состояние фамильяра изменено (${payload.reason})`;
    case 'FamiliarActorRemoved':
      return `${actorName(world, payload.ownerActorId)}: фамильяр распущен навсегда`;
    case 'ProtectionEffectActivated':
      return `${actorName(world, payload.effect.protectorActorId)} защищает ${actorName(world, payload.effect.protectedTargetActorId)} до начала своего следующего хода`;
    case 'ProtectionEffectEnded':
      return `Protection для ${actorName(world, payload.protectedTargetActorId)} завершён (${payload.reason})`;
    case 'PactTomeRestCompleted':
      return `${actorName(world, payload.actorId)}: Книга Теней создана после ${payload.rest === 'short' ? 'короткого' : 'длительного'} отдыха`;
    case 'PactTomeOwnerDied':
      return `${actorName(world, payload.actorId)}: Книга Теней исчезла после подтверждённой смерти владельца`;
    case 'PactBladeBonded':
      return `${actorName(world, payload.actorId)}: договорное оружие ${payload.activeBlade.weaponObject.id} связано`;
    case 'PactBladeAttackProjected':
      return `${actorName(world, payload.actorId)}: атака договорным оружием ${payload.weaponObjectId} подготовлена`;
    case 'PactBladeDistanceAdvanced':
      return `${actorName(world, payload.actorId)}: дистанция до договорного оружия обновлена${payload.bondEnded ? '; связь завершена' : ''}`;
    case 'PactBladeEndedOnOwnerDeath':
      return `${actorName(world, payload.actorId)}: связь с договорным оружием завершена после смерти владельца`;
    case 'PactBladeMaterialFocusProjected':
      return `${actorName(world, payload.actorId)}: договорное оружие ${payload.weaponObjectId} использовано как материальный фокус`;
    case 'WorldObjectMutationRecorded': {
      const mutation = payload.event;
      const objectId = mutation.type === 'WorldObjectCreated' ? mutation.object.id : mutation.objectId;
      return `Объект ${objectId}: ${mutation.type}`;
    }
    case 'EngineEventRecorded': {
      const engineEvent = payload.event;
      const sourceName = actorName(world, payload.actorId);
      const affectedNames = payload.targetIds
        .filter((targetId) => targetId !== payload.actorId)
        .map((targetId) => actorName(world, targetId));
      const affectedPrefix = affectedNames.length
        ? `${sourceName} → ${affectedNames.join(', ')}`
        : sourceName;
      switch (engineEvent.type) {
        case 'roll':
          return `${sourceName}: ${engineEvent.label} — ${engineEvent.roll.text}`;
        case 'damage':
          return `${affectedPrefix}: урон ${engineEvent.amount} (${engineEvent.damageType})`;
        case 'healing':
          return `${affectedPrefix}: лечение ${engineEvent.amount}`;
        case 'resource_spent':
          return `${sourceName}: потрачен ${engineEvent.resource}, осталось ${engineEvent.remaining}`;
        case 'condition_applied':
          return `${affectedPrefix}: состояние ${engineEvent.condition}`;
        case 'movement':
          return `${affectedPrefix}: перемещение ${engineEvent.mode} ${engineEvent.distanceFt} фт`;
        case 'effect_applied':
          return `${affectedPrefix}: эффект ${engineEvent.name}`;
        case 'turn_started':
          return `${sourceName}: ход начат`;
        case 'turn_ended':
          return `${sourceName}: ход завершён`;
        case 'narrative':
          return engineEvent.text;
        default:
          return `${affectedPrefix}: событие ${engineEvent.type}`;
      }
    }
    default:
      return assertNever(payload);
  }
}

function ActorCard({
  actor,
  isActive,
  testIdPrefix = 'rules-lab-actor',
}: {
  actor: ActorState;
  isActive: boolean;
  testIdPrefix?: 'rules-lab-actor' | 'rules-lab-summoned';
}) {
  const resources = Object.entries(actor.runtime.resources).sort(([left], [right]) => left.localeCompare(right));
  return (
    <article
      className={`rules-lab__actor${isActive ? ' rules-lab__actor--active' : ''}`}
      data-testid={`${testIdPrefix}-${actor.id}`}
      aria-label={`${actor.name}, ${actor.kind}`}
    >
      <div className="rules-lab__actor-heading">
        <div>
          <p className="rules-lab__actor-kind">{actor.kind} · {actor.id}</p>
          <h3>{actor.name}</h3>
        </div>
        {isActive && <span className="rules-lab__active-pill">Активен</span>}
      </div>

      <dl className="rules-lab__vitals">
        <div>
          <dt>HP</dt>
          <dd data-testid={`rules-lab-hp-${actor.id}`}>{actor.runtime.hp.current}/{actor.runtime.hp.max}</dd>
        </div>
        <div>
          <dt>Временные HP</dt>
          <dd>{actor.runtime.hp.temp}</dd>
        </div>
        <div>
          <dt>КД</dt>
          <dd>{actor.ac ?? '—'}</dd>
        </div>
      </dl>

      <div className="rules-lab__actor-section">
        <h4>Ресурсы</h4>
        <ul className="rules-lab__resource-list" data-testid={`rules-lab-resources-${actor.id}`}>
          {resources.map(([resource, value]) => (
            <li key={resource}>
              <span>{RESOURCE_LABELS[resource] ?? resource}</span>
              <strong>{value}/{actor.runtime.maxResources[resource] ?? value}</strong>
            </li>
          ))}
        </ul>
      </div>

      <div className="rules-lab__actor-section">
        <h4>Эффекты</h4>
        <ul className="rules-lab__effect-list" data-testid={`rules-lab-effects-${actor.id}`}>
          {actor.runtime.activeEffects.length
            ? actor.runtime.activeEffects.map((effect) => <li key={effect.id}>{effectLabel(effect)}</li>)
            : <li className="rules-lab__muted">Нет активных эффектов</li>}
        </ul>
      </div>
    </article>
  );
}

function RulesLabScenarioScreen({
  scenario,
  dependencies: injectedDependencies,
}: {
  scenario: RulesLabScenarioDefinition;
  dependencies?: RulesLabDependencies;
}) {
  const dependencies = useMemo(
    () => injectedDependencies ?? rulesLabDependenciesForScenario(scenario),
    [injectedDependencies, scenario],
  );
  const [world, setWorld] = useState<WorldState | null>(null);
  const [session, setSession] = useState<PersistentRulesSession | null>(null);
  const [rollQueue, setRollQueue] = useState<RulesLabRollQueue | null>(null);
  const [events, setEvents] = useState<UncommittedRuleEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('Загружаем локальный мир…');
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const handleRef = useRef<RulesLabSessionHandle | null>(null);
  const resetMessageRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let openedHandle: RulesLabSessionHandle | undefined;
    setLoading(true);
    setError(null);

    void dependencies.open().then((handle) => {
      openedHandle = handle;
      if (cancelled) {
        void handle.close();
        return;
      }
      handleRef.current = handle;
      const restored = handle.session.getState();
      setSession(handle.session);
      setRollQueue(handle.rollQueue);
      setWorld(restored);
      setEvents(handle.initialEvents);
      setLoading(false);
      setMessage(resetMessageRef.current
        ? 'Лабораторный мир сброшен и создан заново.'
        : restored.revision > 0
          ? `Мир восстановлен из IndexedDB на ревизии ${restored.revision}.`
          : 'Чистый лабораторный мир готов.');
      resetMessageRef.current = false;
      unsubscribe = handle.session.subscribe((nextWorld, committedEvents) => {
        setWorld(nextWorld);
        setEvents((current) => [...current, ...committedEvents]);
      });
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setLoading(false);
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть лабораторный мир.');
      setMessage('Лабораторный мир недоступен.');
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (openedHandle) void openedHandle.close();
      if (handleRef.current === openedHandle) handleRef.current = null;
    };
  }, [dependencies, generation]);

  const currentActor = activeActorId(world);
  const currentActorState = currentActor ? world?.actors[currentActor] : undefined;
  const { execution } = scenario;
  const baselineExecution = scenario.kind === 'baseline' ? scenario.execution : null;
  const bladeExecution = scenario.kind === 'blade' ? scenario.execution : null;
  const chainExecution = scenario.kind === 'chain' ? scenario.execution : null;
  const tomeExecution = scenario.kind === 'tome' ? scenario.execution : null;
  const familiarExecution = scenario.kind === 'familiar' ? scenario.execution : null;
  const primaryActorId = scenario.playerActorIds[0];
  const secondaryActorId = scenario.playerActorIds[1];
  const currentAction = baselineExecution && currentActor
    ? baselineExecution.actionForActor(currentActor)
    : undefined;
  const currentAttackWeaponName = baselineExecution && currentActorState
    ? currentActorState.character.equippedCards?.find((card) => (
      card.id === baselineExecution.fighterWeaponCardId
    ))?.name
    : undefined;
  const currentAttackAction = currentActor && world
    ? Object.values(world.attackActions).find((attackAction) => (
      attackAction.actorId === currentActor && attackAction.status === 'open'
    ))
    : undefined;
  const encounter = world?.scene.mode === 'encounter' ? world.scene : null;
  const pending = world?.pendingResolution ?? null;
  const familiarActor = world
    ? Object.values(world.actors).find((actor) => (
      actor.kind === 'summonedActor' && actor.familiarState?.ownerActorId === primaryActorId
    ))
    : undefined;
  const primaryAttackAction = world
    ? Object.values(world.attackActions).find((attackAction) => (
      attackAction.actorId === primaryActorId && attackAction.status === 'open'
    ))
    : undefined;

  const run = useCallback(async (
    createCommand: (state: WorldState) => GameCommand,
    successMessage: string,
  ) => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await session.dispatch(createCommand(session.getState()));
      if (result.status === 'rejected') {
        setError(`${result.code}: ${result.message}`);
        setMessage('Команда отклонена движком; сохранённое состояние не изменилось.');
      } else {
        setMessage(`${successMessage} Ревизия ${result.nextState.revision}.`);
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Не удалось выполнить команду.');
      setMessage('Команда не выполнена.');
    } finally {
      setBusy(false);
    }
  }, [busy, session]);

  const startEncounter = () => void run((state) => ({
    schemaVersion: 1,
    type: 'StartEncounter',
    commandId: commandId(state, 'start-encounter'),
    expectedRevision: state.revision,
    rulesetContentHash: state.ruleset.contentHash,
    actorId: primaryActorId,
    initiative: [
      primaryActorId,
      ...Object.values(state.actors)
        .filter((actor) => actor.kind === 'summonedActor')
        .map((actor) => actor.id),
      secondaryActorId,
    ],
  }), 'Столкновение начато.');

  const startTurn = () => void run((state) => {
    const actorId = activeActorId(state) ?? primaryActorId;
    return {
      schemaVersion: 1,
      type: 'StartTurn',
      commandId: commandId(state, 'start-turn'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId,
    };
  }, 'Ход начат.');

  const useBaselineAction = () => void run((state) => {
    if (!baselineExecution) throw new Error('Baseline command is unavailable in this scenario.');
    const actorId = activeActorId(state) ?? baselineExecution.fighterActorId;
    const targetId = actorId === baselineExecution.fighterActorId
      ? baselineExecution.wizardActorId
      : baselineExecution.fighterActorId;
    if (actorId === baselineExecution.fighterActorId) {
      const attackAction = Object.values(state.attackActions).find((candidate) => (
        candidate.actorId === actorId && candidate.status === 'open'
      ));
      if (!attackAction) {
        return {
          schemaVersion: 1,
          type: 'BeginAttackAction',
          commandId: commandId(state, 'begin-attack'),
          expectedRevision: state.revision,
          rulesetContentHash: state.ruleset.contentHash,
          actorId,
        };
      }
      return {
        schemaVersion: 1,
        type: 'PerformWeaponAttack',
        commandId: commandId(state, 'weapon-attack'),
        expectedRevision: state.revision,
        rulesetContentHash: state.ruleset.contentHash,
        actorId,
        attackActionId: attackAction.id,
        weaponCardId: baselineExecution.fighterWeaponCardId,
        targetActorId: targetId,
        facts: {
          factsSource: 'scenario',
          boardRevision: state.revision,
          distanceFt: 5,
          lineOfSight: true,
          cover: 'none',
          relation: 'enemy',
        },
      };
    }
    const action = baselineExecution.actionForActor(actorId);
    return {
      schemaVersion: 1,
      type: 'UseAction',
      commandId: commandId(state, 'use-action'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId,
      actionId: action?.id ?? '',
      targetIds: [targetId],
      factsByTarget: {
        [targetId]: {
          factsSource: 'scenario',
          boardRevision: state.revision,
          distanceFt: action?.targeting?.rangeFt ?? 5,
          lineOfSight: true,
          cover: 'none',
          relation: 'enemy',
        },
      },
      ...(action?.kind === 'spell' ? { spell: { baseLevel: action.spell.level } } : {}),
      ...(actorId === baselineExecution.wizardActorId ? {
        worldInput: {
          type: 'area_objects' as const,
          factsByObject: {
            [baselineExecution.objectId]: {
              factsSource: 'scenario' as const,
              boardRevision: state.revision,
              distanceFt: 10,
              lineOfSight: true,
              entirelyInArea: true,
            },
          },
        },
      } : {}),
    };
  }, 'Действие принято.');

  const bondPactBlade = () => void run((state) => {
    if (!bladeExecution) throw new Error('Pact Blade command is unavailable.');
    return {
      schemaVersion: 1,
      type: 'BondPactBlade',
      commandId: commandId(state, 'pact-blade-bond'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: bladeExecution.primaryActorId,
      mode: 'conjure',
      weaponCardId: bladeExecution.weaponCardId,
      hand: 'main_hand',
    };
  }, 'Договорное оружие создано; предыдущая связь заменена атомарно.');

  const beginPrimaryAttack = () => void run((state) => ({
    schemaVersion: 1,
    type: 'BeginAttackAction',
    commandId: commandId(state, 'pact-begin-attack'),
    expectedRevision: state.revision,
    rulesetContentHash: state.ruleset.contentHash,
    actorId: primaryActorId,
  }), 'Attack action открыт.');

  const performPactBladeAttack = () => void run((state) => {
    if (!bladeExecution) throw new Error('Pact Blade attack is unavailable.');
    const actor = state.actors[bladeExecution.primaryActorId];
    const bond = actor?.warlockPacts?.blade?.activeBond;
    const attackAction = Object.values(state.attackActions).find((entry) => (
      entry.actorId === bladeExecution.primaryActorId && entry.status === 'open'
    ));
    if (!bond || !attackAction) throw new Error('Сначала свяжите оружие и откройте Attack action.');
    return {
      schemaVersion: 1,
      type: 'PerformWeaponAttack',
      commandId: commandId(state, 'pact-blade-attack'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: bladeExecution.primaryActorId,
      attackActionId: attackAction.id,
      weaponCardId: bladeExecution.weaponCardId,
      weaponObjectId: bond.weaponObjectId,
      pactBlade: { abilityChoice: 'cha', damageType: 'psychic' },
      targetActorId: bladeExecution.secondaryActorId,
      facts: {
        factsSource: 'scenario',
        boardRevision: state.revision,
        distanceFt: 5,
        lineOfSight: true,
        cover: 'none',
        relation: 'enemy',
      },
    };
  }, 'Pact Blade attack подготовлена: Харизма и психический урон принадлежат continuation.');

  const summonPactChainFamiliar = () => void run((state) => {
    if (!chainExecution) throw new Error('Pact Chain command is unavailable.');
    return {
      schemaVersion: 1,
      type: 'UseAction',
      commandId: commandId(state, 'pact-chain-summon'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: chainExecution.primaryActorId,
      actionId: chainExecution.findFamiliarActionId,
      targetIds: [],
      spell: {
        baseLevel: 1,
        grantId: chainExecution.findFamiliarGrantId,
        mode: 'normal',
      },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fiend',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'pact_chain_magic_action',
      },
    };
  }, 'Pact Chain фамильяр призван без расхода ячейки.');

  const performPactChainAttack = () => void run((state) => {
    if (!chainExecution) throw new Error('Pact Chain attack is unavailable.');
    const familiar = Object.values(state.actors).find((actor) => (
      actor.kind === 'summonedActor'
        && actor.familiarState?.ownerActorId === chainExecution.primaryActorId
    ));
    const attackAction = Object.values(state.attackActions).find((entry) => (
      entry.actorId === chainExecution.primaryActorId && entry.status === 'open'
    ));
    if (!familiar || !attackAction) throw new Error('Сначала призовите фамильяра и откройте Attack action.');
    return {
      schemaVersion: 1,
      type: 'PerformPactChainFamiliarAttack',
      commandId: commandId(state, 'pact-chain-attack'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: chainExecution.primaryActorId,
      attackActionId: attackAction.id,
      familiarActorId: familiar.id,
      familiarActionId: chainExecution.familiarActionId,
      targetActorId: chainExecution.secondaryActorId,
      facts: {
        factsSource: 'scenario',
        boardRevision: state.revision,
        distanceFt: 5,
        lineOfSight: true,
        cover: 'none',
        relation: 'enemy',
      },
    };
  }, 'Одна атака владельца заменена атакой фамильяра с расходом его Реакции.');

  const replacePactTome = () => void run((state) => {
    if (!tomeExecution) throw new Error('Pact Tome command is unavailable.');
    return {
      schemaVersion: 1,
      type: 'TakeShortRest',
      commandId: commandId(state, 'pact-tome-rest'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: tomeExecution.primaryActorId,
      decisions: [],
      pactTome: {
        bookObjectId: `rules-lab:pact-tome:book:r${state.revision + 1}`,
        cantripActionIds: [...tomeExecution.cantripActionIds],
        ritualActionIds: [...tomeExecution.ritualActionIds],
      },
    };
  }, 'Короткий отдых завершён; Книга Теней и её grants заменены.');

  const castPactTomeCantrip = () => void run((state) => {
    if (!tomeExecution) throw new Error('Pact Tome spell is unavailable.');
    const actor = state.actors[tomeExecution.primaryActorId];
    const grant = actor?.spellcastingAccess?.grants.find((candidate) => (
      candidate.actionId === tomeExecution.cantripActionId
        && candidate.sourceId === actor.warlockPacts?.tome?.tome.bookObjectId
    ));
    if (!grant) throw new Error('Активная Книга Теней не даёт выбранный cantrip.');
    return {
      schemaVersion: 1,
      type: 'UseAction',
      commandId: commandId(state, 'pact-tome-cantrip'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: tomeExecution.primaryActorId,
      actionId: tomeExecution.cantripActionId,
      targetIds: [tomeExecution.secondaryActorId],
      factsByTarget: {
        [tomeExecution.secondaryActorId]: {
          factsSource: 'scenario', boardRevision: state.revision, distanceFt: 30,
          lineOfSight: true, cover: 'none', relation: 'enemy',
        },
      },
      spell: { baseLevel: 0, grantId: grant.grantId, mode: 'normal' },
    };
  }, 'Cantrip из активной Книги Теней объявлен.');

  const castFindFamiliarRitual = () => void run((state) => {
    if (!familiarExecution) throw new Error('Find Familiar ritual is unavailable.');
    return {
      schemaVersion: 1,
      type: 'UseAction',
      commandId: commandId(state, 'find-familiar-ritual'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: familiarExecution.primaryActorId,
      actionId: familiarExecution.findFamiliarActionId,
      targetIds: [],
      spell: { baseLevel: 1, grantId: familiarExecution.findFamiliarGrantId, mode: 'ritual' },
      choices: {
        [FIND_FAMILIAR_FORM_CHOICE]: 'owl',
        [FIND_FAMILIAR_SPIRIT_CHOICE]: 'fey',
        [FIND_FAMILIAR_CAST_PATH_CHOICE]: 'ritual',
      },
    };
  }, 'Find Familiar завершён как ритуал; фамильяр сохранён отдельным actor.');

  const deliverTouchSpell = () => void run((state) => {
    if (!familiarExecution) throw new Error('Familiar delivery is unavailable.');
    const familiar = Object.values(state.actors).find((actor) => (
      actor.kind === 'summonedActor'
        && actor.familiarState?.ownerActorId === familiarExecution.primaryActorId
    ));
    if (!familiar) throw new Error('Сначала завершите ритуал Find Familiar.');
    return {
      schemaVersion: 1,
      type: 'DeliverTouchSpellThroughFamiliar',
      commandId: commandId(state, 'familiar-touch-spell'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: familiarExecution.primaryActorId,
      familiarActorId: familiar.id,
      spellActionId: familiarExecution.chillTouchActionId,
      targetActorId: familiarExecution.secondaryActorId,
      ownerToFamiliarFacts: {
        factsSource: 'scenario', boardRevision: state.revision, distanceFt: 80, lineOfSight: false,
      },
      familiarToTargetFacts: {
        factsSource: 'scenario', boardRevision: state.revision, distanceFt: 5,
        lineOfSight: true, cover: 'none', relation: 'enemy',
      },
      spell: { baseLevel: 0, grantId: familiarExecution.chillTouchGrantId, mode: 'normal' },
    };
  }, 'Фамильяр потратил Реакцию и стал точкой доставки Touch-заклинания.');

  const abilityCheck = () => void run((state) => {
    const actorId = activeActorId(state) ?? primaryActorId;
    return {
      schemaVersion: 1,
      type: 'AbilityCheck',
      commandId: commandId(state, 'ability-check'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId,
      ability: actorId === primaryActorId ? (scenario.kind === 'baseline' ? 'str' : 'cha') : 'int',
      skill: actorId === primaryActorId ? (scenario.kind === 'baseline' ? 'athletics' : 'arcana') : 'arcana',
      dc: 13,
    };
  }, 'Проверка характеристики выполнена.');

  const savingThrow = () => void run((state) => {
    const actorId = activeActorId(state) ?? primaryActorId;
    return {
      schemaVersion: 1,
      type: 'SavingThrow',
      commandId: commandId(state, 'saving-throw'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId,
      ability: actorId === primaryActorId ? 'con' : 'wis',
      dc: 13,
    };
  }, 'Спасбросок выполнен.');

  const endTurn = () => void run((state) => ({
    schemaVersion: 1,
    type: 'EndTurn',
    commandId: commandId(state, 'end-turn'),
    expectedRevision: state.revision,
    rulesetContentHash: state.ruleset.contentHash,
    actorId: activeActorId(state) ?? primaryActorId,
  }), 'Ход завершён.');

  const resolveSave = (die: number) => void run((state) => {
    const resolution = state.pendingResolution;
    if (!resolution || resolution.type !== 'target_save') {
      throw new Error('Нет ожидающего целевого спасброска для обработки.');
    }
    return {
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: commandId(state, `resolve-d${die}`),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: resolution.targetActorId,
      resolutionId: resolution.id,
      requestId: resolution.request.id,
      response: { kind: 'roll', roll: { mode: 'manual', dice: [{ sides: 20, value: die }] } },
    };
  }, `Решение закрыто явным d20=${die}.`);

  const resolveProtection = (use: boolean) => void run((state) => {
    const resolution = state.pendingResolution;
    if (!resolution || resolution.type !== 'protection_reaction') {
      throw new Error('Нет ожидающей реакции Protection для обработки.');
    }
    return {
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: commandId(state, use ? 'use-protection' : 'decline-protection'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: resolution.request.actorId,
      resolutionId: resolution.id,
      requestId: resolution.request.id,
      response: {
        kind: 'reaction',
        actionId: use ? PROTECTION_2024_CAPABILITY_ID : null,
      },
    };
  }, use ? 'Protection применён до броска атаки.' : 'Protection отклонён; атака продолжена.');

  const resolveAttackReaction = (use: boolean) => void run((state) => {
    const resolution = state.pendingResolution;
    if (!resolution || resolution.type !== 'attack_reaction') {
      throw new Error('Нет ожидающей реакции на атаку для обработки.');
    }
    const option = use ? resolution.request.options[0] : undefined;
    if (use && !option) throw new Error('Движок не предложил допустимую реакцию.');
    const spellSource = option?.spellSources?.[0];
    return {
      schemaVersion: 1,
      type: 'ResolveDecision',
      commandId: commandId(state, use ? 'use-attack-reaction' : 'decline-attack-reaction'),
      expectedRevision: state.revision,
      rulesetContentHash: state.ruleset.contentHash,
      actorId: resolution.request.actorId,
      resolutionId: resolution.id,
      requestId: resolution.request.id,
      response: {
        kind: 'reaction',
        actionId: option?.actionId ?? null,
        ...(spellSource ? { spell: { grantId: spellSource.grantId, mode: 'normal' as const } } : {}),
      },
    };
  }, use ? 'Реакция Shield применена; continuation завершена.' : 'Реакция отклонена; continuation завершена.');

  const reset = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(`Удаляем только ${scenario.worldId}…`);
    try {
      await handleRef.current?.close();
      handleRef.current = null;
      await dependencies.reset();
      resetMessageRef.current = true;
      setSession(null);
      setRollQueue(null);
      setWorld(null);
      setEvents([]);
      setGeneration((value) => value + 1);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сбросить лабораторный мир.');
      setMessage('Сброс не выполнен.');
    } finally {
      setBusy(false);
    }
  };

  const startEncounterAvailability: Availability = loading || busy
    ? { disabled: true, reason: loading ? 'Мир ещё загружается.' : 'Дождитесь завершения текущей команды.' }
    : !world
      ? { disabled: true, reason: 'Мир не открыт; устраните ошибку или выполните сброс.' }
      : world.scene.mode === 'encounter'
        ? { disabled: true, reason: 'Столкновение уже идёт.' }
        : world.pendingResolution
          ? { disabled: true, reason: 'Сначала завершите открытое решение.' }
        : { disabled: false, reason: 'Создаст явную инициативу двух PC и присутствующего фамильяра.' };

  const startTurnBase = commonPhaseAvailability(world, busy || loading, false);
  const startTurnAvailability: Availability = startTurnBase
    ?? (encounter?.turnStarted
      ? { disabled: true, reason: 'Ход активного персонажа уже начат.' }
      : { disabled: false, reason: `Восстановит ресурсы начала хода для ${actorName(world, currentActor)}.` });

  const activePhaseIssue = commonPhaseAvailability(world, busy || loading, true);
  const actionAvailability: Availability = !baselineExecution
    ? { disabled: true, reason: 'Базовая команда доступна только в baseline-сценарии.' }
    : activePhaseIssue
      ?? (currentActor === baselineExecution.fighterActorId && currentAttackAction
        ? currentAttackAction.blockedByResolutionId
          ? { disabled: true, reason: 'Attack action ожидает завершения решения.' }
          : currentAttackAction.sequence.attacksRemaining < 1
            ? { disabled: true, reason: 'В Attack action не осталось атак.' }
            : {
              disabled: false,
              reason: 'Выполнит одну атаку экипированным боевым посохом из канонического Attack ledger.',
            }
        : (currentActorState?.runtime.resources.action ?? 0) < 1
        ? { disabled: true, reason: 'Ресурс «Действие» уже потрачен в этом ходу.' }
        : currentActor === baselineExecution.wizardActorId && (currentActorState?.runtime.resources.spell_slot_1 ?? 0) < 1
          ? { disabled: true, reason: 'У волшебника нет ячейки 1 уровня.' }
          : {
            disabled: false,
            reason: currentActor === baselineExecution.wizardActorId
              ? 'Сотворит реальную «Волну грома» из compiled Wizard root и откроет спасбросок Телосложения бойца.'
              : 'Потратит Действие и создаст сохраняемый Attack ledger с числом атак из compiled actor profile.',
          });
  const primaryTurnIssue: Availability | null = activePhaseIssue
    ?? (currentActor !== primaryActorId
      ? { disabled: true, reason: `Команда принадлежит ${actorName(world, primaryActorId)}.` }
      : null);
  const primaryActionIssue: Availability | null = primaryTurnIssue
    ?? ((world?.actors[primaryActorId]?.runtime.resources.action ?? 0) < 1
      ? { disabled: true, reason: 'Ресурс «Действие» уже потрачен.' }
      : null);
  const explorationIssue: Availability | null = busy || loading
    ? { disabled: true, reason: 'Дождитесь загрузки или завершения команды.' }
    : !world
      ? { disabled: true, reason: 'Мир не открыт.' }
      : world.pendingResolution
        ? { disabled: true, reason: 'Сначала завершите открытое решение.' }
        : world.scene.mode !== 'exploration'
          ? { disabled: true, reason: 'Команда выполняется в режиме исследования.' }
          : null;
  const bladeBondAvailability: Availability = scenario.kind !== 'blade'
    ? { disabled: true, reason: 'Не сценарий Pact Blade.' }
    : primaryTurnIssue
      ?? ((world?.actors[primaryActorId]?.runtime.resources.bonus_action ?? 0) < 1
        ? { disabled: true, reason: 'Бонусное действие уже потрачено.' }
        : { disabled: false, reason: 'Создаст новый item-object и атомарно завершит предыдущую связь.' });
  const beginAttackAvailability: Availability = !['blade', 'chain'].includes(scenario.kind)
    ? { disabled: true, reason: 'Attack ledger не требуется этому сценарию.' }
    : primaryActionIssue
      ?? (primaryAttackAction
        ? { disabled: true, reason: 'Attack action уже открыт.' }
        : { disabled: false, reason: 'Потратит Действие и откроет канонический Attack ledger.' });
  const bladeAttackAvailability: Availability = scenario.kind !== 'blade'
    ? { disabled: true, reason: 'Не сценарий Pact Blade.' }
    : primaryTurnIssue
      ?? (!world?.actors[primaryActorId]?.warlockPacts?.blade?.activeBond
        ? { disabled: true, reason: 'Сначала свяжите договорное оружие.' }
        : !primaryAttackAction
          ? { disabled: true, reason: 'Сначала откройте Attack action.' }
          : { disabled: false, reason: 'Атакует с Харизмой и психическим уроном; Shield решается отдельно.' });
  const chainSummonAvailability: Availability = scenario.kind !== 'chain'
    ? { disabled: true, reason: 'Не сценарий Pact Chain.' }
    : primaryActionIssue
      ?? (familiarActor
        ? { disabled: true, reason: 'Фамильяр уже присутствует.' }
        : { disabled: false, reason: 'Сотворит invocation-granted Find Familiar без ячейки.' });
  const chainAttackAvailability: Availability = scenario.kind !== 'chain'
    ? { disabled: true, reason: 'Не сценарий Pact Chain.' }
    : primaryTurnIssue
      ?? (!familiarActor
        ? { disabled: true, reason: 'Сначала призовите фамильяра.' }
        : !primaryAttackAction
          ? { disabled: true, reason: 'Сначала откройте Attack action.' }
          : (familiarActor.runtime.resources.reaction ?? 0) < 1
            ? { disabled: true, reason: 'Реакция фамильяра уже потрачена.' }
            : { disabled: false, reason: 'Заменит ровно одну атаку и потратит Реакцию фамильяра.' });
  const tomeRestAvailability: Availability = scenario.kind !== 'tome'
    ? { disabled: true, reason: 'Не сценарий Pact Tome.' }
    : explorationIssue ?? { disabled: false, reason: 'Заменит объект книги и пять source-scoped grants.' };
  const tomeCantripAvailability: Availability = scenario.kind !== 'tome'
    ? { disabled: true, reason: 'Не сценарий Pact Tome.' }
    : primaryActionIssue ?? { disabled: false, reason: 'Сотворит cantrip только через grant активной книги.' };
  const familiarRitualAvailability: Availability = scenario.kind !== 'familiar'
    ? { disabled: true, reason: 'Не сценарий Find Familiar.' }
    : explorationIssue
      ?? (familiarActor
        ? { disabled: true, reason: 'Фамильяр уже присутствует.' }
        : { disabled: false, reason: 'Ритуал не расходует ячейку, но расходует материальный ресурс.' });
  const familiarDeliveryAvailability: Availability = scenario.kind !== 'familiar'
    ? { disabled: true, reason: 'Не сценарий Find Familiar.' }
    : primaryActionIssue
      ?? (!familiarActor
        ? { disabled: true, reason: 'Сначала призовите фамильяра.' }
        : (familiarActor.runtime.resources.reaction ?? 0) < 1
          ? { disabled: true, reason: 'У фамильяра нет Реакции.' }
          : { disabled: false, reason: 'Потратит Действие владельца и Реакцию фамильяра.' });
  const checkAvailability: Availability = activePhaseIssue
    ?? { disabled: false, reason: 'Использует следующий явно показанный d20 против СЛ 13.' };
  const saveAvailability: Availability = activePhaseIssue
    ?? { disabled: false, reason: 'Использует следующий явно показанный d20 против СЛ 13.' };
  const endTurnAvailability: Availability = activePhaseIssue
    ?? { disabled: false, reason: 'Передаст инициативу следующему персонажу.' };

  const pendingTargetSave = pending?.type === 'target_save' ? pending : null;
  const pendingProtection = pending?.type === 'protection_reaction' ? pending : null;
  const pendingAttackReaction = pending?.type === 'attack_reaction' ? pending : null;
  const decisionAvailability: Availability = busy || loading
    ? { disabled: true, reason: 'Дождитесь завершения текущей команды.' }
    : pendingTargetSave
      ? { disabled: false, reason: 'Явный ручной бросок; детерминированная очередь не расходуется.' }
      : { disabled: true, reason: 'Нет ожидающего решения по спасброску цели.' };
  const protectionDecisionAvailability: Availability = busy || loading
    ? { disabled: true, reason: 'Дождитесь завершения текущей команды.' }
    : pendingProtection
      ? { disabled: false, reason: 'Решение принимается до броска атаки; RNG ещё не расходовался.' }
      : { disabled: true, reason: 'Нет ожидающей предбросковой реакции Protection.' };
  const attackReactionAvailability: Availability = busy || loading
    ? { disabled: true, reason: 'Дождитесь завершения текущей команды.' }
    : pendingAttackReaction
      ? { disabled: false, reason: 'Продолжит сериализованную атаку ровно один раз.' }
      : { disabled: true, reason: 'Нет ожидающей реакции на атаку.' };
  const resetAvailability: Availability = busy || loading
    ? { disabled: true, reason: loading ? 'Дождитесь открытия локального хранилища.' : 'Дождитесь завершения текущей операции.' }
    : { disabled: false, reason: `Удалит только мир ${scenario.worldId} и его события.` };

  const visibleEvents = useMemo(() => events.slice(-10).reverse(), [events]);
  const queuePreview = rollQueue?.peek(6) ?? [];
  const actors = world
    ? scenario.playerActorIds.map((id) => world.actors[id]).filter((actor): actor is ActorState => actor != null)
    : [];
  const summonedActors = world
    ? Object.values(world.actors).filter((actor) => actor.kind === 'summonedActor')
    : [];

  return (
    <main className="rules-lab" data-testid="rules-lab-page">
      <header className="rules-lab__hero">
        <div>
          <p className="rules-lab__eyebrow">D&amp;D 2024 · публичный acceptance adapter</p>
          <h1>Rules Session Lab</h1>
          <p className="rules-lab__lede">
            {scenario.description} Изолированный мир не использует API; все принятые команды атомарно
            сохраняются в IndexedDB, а перезагрузка продолжает тот же сценарий.
          </p>
        </div>
        <div className="rules-lab__identity" aria-label="Идентификаторы fixture">
          <span>{scenario.ruleset.releaseId}</span>
          <code>{scenario.worldId}</code>
        </div>
      </header>

      <RulesLabScenarioNav activeScenarioId={scenario.id} />

      <div
        className="rules-lab__live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="rules-lab-live-status"
      >
        {message}
      </div>
      {error && <div className="rules-lab__alert" role="alert" data-testid="rules-lab-error">{error}</div>}

      <section className="rules-lab__overview" aria-labelledby="rules-lab-overview-title">
        <div className="rules-lab__section-heading">
          <div>
            <p className="rules-lab__kicker">Проекция мира</p>
            <h2 id="rules-lab-overview-title">Текущее состояние</h2>
          </div>
          <span className={`rules-lab__storage${loading ? ' rules-lab__storage--loading' : ''}`}>
            {loading ? 'Открываем IndexedDB' : 'IndexedDB подключена'}
          </span>
        </div>
        <dl className="rules-lab__stats">
          <div><dt>Режим</dt><dd data-testid="rules-lab-scene-mode">{world?.scene.mode ?? 'загрузка'}</dd></div>
          <div><dt>Раунд</dt><dd data-testid="rules-lab-round">{encounter?.round ?? '—'}</dd></div>
          <div><dt>Активный</dt><dd data-testid="rules-lab-active-actor">{actorName(world, currentActor)}</dd></div>
          <div><dt>Ход</dt><dd data-testid="rules-lab-turn-state">{encounter ? (encounter.turnStarted ? 'идёт' : 'не начат') : '—'}</dd></div>
          <div><dt>Ревизия</dt><dd data-testid="rules-lab-revision">{world?.revision ?? '—'}</dd></div>
          <div><dt>Pending</dt><dd data-testid="rules-lab-pending-state">{pending ? pending.type : 'нет'}</dd></div>
          <div>
            <dt>Attack ledger</dt>
            <dd data-testid="rules-lab-attack-state">
              {currentAttackAction
                ? `${currentAttackAction.sequence.attacksRemaining}/${currentAttackAction.sequence.totalAttacks}`
                : 'нет'}
            </dd>
          </div>
          <div>
            <dt>{scenario.kind === 'baseline' ? 'Объект в кубе' : 'Состояние сценария'}</dt>
            <dd data-testid="rules-lab-object-state">
              {scenario.kind === 'baseline'
                ? world?.objects[scenario.execution.objectId]?.displacementFt
                  ? `сдвинут на ${world.objects[scenario.execution.objectId].displacementFt} фт.`
                  : 'не сдвинут'
                : scenario.kind === 'blade'
                  ? world?.actors[scenario.execution.primaryActorId]?.warlockPacts?.blade?.activeBond
                    ? `связано: ${world.actors[scenario.execution.primaryActorId].warlockPacts?.blade?.activeBond?.weaponObjectId}`
                    : 'оружие не связано'
                  : scenario.kind === 'chain'
                    ? familiarActor
                      ? `фамильяр: ${familiarActor.id}`
                      : 'фамильяр не призван'
                    : scenario.kind === 'tome'
                      ? `книга: ${world?.actors[scenario.execution.primaryActorId]?.warlockPacts?.tome?.tome.bookObjectId ?? 'нет'}`
                      : familiarActor
                        ? `фамильяр: ${familiarActor.id}`
                        : 'фамильяр не призван'}
            </dd>
          </div>
        </dl>
        {scenario.kind === 'blade' && (
          <p className="rules-lab__scenario-state" data-testid="rules-lab-blade-state">
            {world?.actors[scenario.execution.primaryActorId]?.warlockPacts?.blade?.activeBond
              ? `Pact Blade · ${world.actors[scenario.execution.primaryActorId].warlockPacts?.blade?.activeBond?.weaponObjectId}`
              : 'Pact Blade · связь отсутствует'}
          </p>
        )}
        {scenario.kind === 'chain' && (
          <p className="rules-lab__scenario-state" data-testid="rules-lab-chain-state">
            {familiarActor
              ? `Pact Chain · ${familiarActor.name} · reaction ${familiarActor.runtime.resources.reaction ?? 0}`
              : 'Pact Chain · фамильяр отсутствует'}
          </p>
        )}
        {scenario.kind === 'tome' && (
          <p className="rules-lab__scenario-state" data-testid="rules-lab-tome-state">
            {world?.actors[scenario.execution.primaryActorId]?.warlockPacts?.tome?.tome.bookObjectId ?? 'Книга отсутствует'}
            {' · grants '}
            {world?.actors[scenario.execution.primaryActorId]?.warlockPacts?.tome?.tome.spellGrantIds.length ?? 0}
          </p>
        )}
        {scenario.kind === 'familiar' && (
          <p className="rules-lab__scenario-state" data-testid="rules-lab-familiar-state">
            {familiarActor
              ? `${familiarActor.name} · ${familiarActor.familiarState?.presence} · reaction ${familiarActor.runtime.resources.reaction ?? 0}`
              : 'Фамильяр отсутствует'}
          </p>
        )}
      </section>

      <section className="rules-lab__actors" aria-labelledby="rules-lab-actors-title">
        <div className="rules-lab__section-heading">
          <div>
            <p className="rules-lab__kicker">Ровно два игровых персонажа</p>
            <h2 id="rules-lab-actors-title">Тестовые персонажи</h2>
          </div>
        </div>
        <div
          className="rules-lab__actor-grid"
          data-testid="rules-lab-actors"
          aria-label="Игровые персонажи"
        >
          {actors.map((actor) => <ActorCard key={actor.id} actor={actor} isActive={actor.id === currentActor} />)}
          {!actors.length && <p className="rules-lab__muted">Персонажи появятся после открытия мира.</p>}
        </div>
      </section>

      {summonedActors.length > 0 && (
        <section className="rules-lab__actors" aria-labelledby="rules-lab-summoned-title">
          <div className="rules-lab__section-heading">
            <div>
              <p className="rules-lab__kicker">Не входит в пару playerCharacter</p>
              <h2 id="rules-lab-summoned-title">Призванное существо</h2>
            </div>
          </div>
          <div
            className="rules-lab__actor-grid rules-lab__actor-grid--summoned"
            data-testid="rules-lab-summoned-actors"
          >
            {summonedActors.map((actor) => (
              <ActorCard
                key={actor.id}
                actor={actor}
                isActive={actor.id === currentActor}
                testIdPrefix="rules-lab-summoned"
              />
            ))}
          </div>
        </section>
      )}

      <div className="rules-lab__workbench">
        <section className="rules-lab__panel" aria-labelledby="rules-lab-controls-title">
          <div className="rules-lab__section-heading">
            <div>
              <p className="rules-lab__kicker">Команды RulesSession</p>
              <h2 id="rules-lab-controls-title">Сценарий</h2>
            </div>
          </div>
          <div className="rules-lab__controls">
            {scenario.kind === 'tome' && (
              <LabButton testId="rules-lab-tome-rest" label="1. Короткий отдых и новая книга" availability={tomeRestAvailability} onClick={replacePactTome} />
            )}
            {scenario.kind === 'familiar' && (
              <LabButton testId="rules-lab-familiar-ritual" label="1. Ритуал Find Familiar" availability={familiarRitualAvailability} onClick={castFindFamiliarRitual} />
            )}
            <LabButton testId="rules-lab-start-encounter" label="1. Начать столкновение" availability={startEncounterAvailability} onClick={startEncounter} />
            <LabButton testId="rules-lab-start-turn" label="2. Начать активный ход" availability={startTurnAvailability} onClick={startTurn} />
            {scenario.kind === 'baseline' && (
              <LabButton
                testId="rules-lab-action"
                label={currentActor === scenario.execution.fighterActorId
                  ? currentAttackAction
                    ? `Атака: ${currentAttackWeaponName ?? 'оружие'}`
                    : 'Действие: Attack'
                  : `Действие: ${currentAction?.name ?? '—'}`}
                availability={actionAvailability}
                onClick={useBaselineAction}
              />
            )}
            {scenario.kind === 'blade' && (
              <>
                <LabButton testId="rules-lab-blade-bond" label="Связать или заменить оружие" availability={bladeBondAvailability} onClick={bondPactBlade} />
                <LabButton testId="rules-lab-pact-begin-attack" label="Действие: Attack" availability={beginAttackAvailability} onClick={beginPrimaryAttack} />
                <LabButton testId="rules-lab-blade-attack" label="Атака: CHA · psychic" availability={bladeAttackAvailability} onClick={performPactBladeAttack} />
              </>
            )}
            {scenario.kind === 'chain' && (
              <>
                <LabButton testId="rules-lab-chain-summon" label="Призвать Pact Chain фамильяра" availability={chainSummonAvailability} onClick={summonPactChainFamiliar} />
                <LabButton testId="rules-lab-pact-begin-attack" label="Действие: Attack" availability={beginAttackAvailability} onClick={beginPrimaryAttack} />
                <LabButton testId="rules-lab-chain-attack" label="Заменить атаку: когти совы" availability={chainAttackAvailability} onClick={performPactChainAttack} />
              </>
            )}
            {scenario.kind === 'tome' && (
              <LabButton testId="rules-lab-tome-cantrip" label="Cantrip из Книги Теней" availability={tomeCantripAvailability} onClick={castPactTomeCantrip} />
            )}
            {scenario.kind === 'familiar' && (
              <LabButton testId="rules-lab-familiar-deliver" label="Доставить Chill Touch фамильяром" availability={familiarDeliveryAvailability} onClick={deliverTouchSpell} />
            )}
            <LabButton testId="rules-lab-check" label="Проверка навыка · СЛ 13" availability={checkAvailability} onClick={abilityCheck} />
            <LabButton testId="rules-lab-save" label="Спасбросок · СЛ 13" availability={saveAvailability} onClick={savingThrow} />
            <LabButton testId="rules-lab-end-turn" label="Завершить ход" availability={endTurnAvailability} onClick={endTurn} />
          </div>
        </section>

        <aside className="rules-lab__panel rules-lab__panel--queue" aria-labelledby="rules-lab-queue-title">
          <div className="rules-lab__section-heading">
            <div>
              <p className="rules-lab__kicker">Без скрытой случайности</p>
              <h2 id="rules-lab-queue-title">Очередь бросков</h2>
            </div>
            <span className="rules-lab__counter">использовано: {rollQueue?.consumedThisSession() ?? 0}</span>
          </div>
          <p className="rules-lab__helper">Проверка и самостоятельный спасбросок берут первый d20 слева.</p>
          <ol className="rules-lab__dice" data-testid="rules-lab-roll-queue" aria-label="Следующие детерминированные результаты d20">
            {queuePreview.map((roll, index) => (
              <li key={roll.ordinal} className={index === 0 ? 'rules-lab__die--next' : ''}>
                <span>d{roll.sides}</span>
                <strong>{roll.value}</strong>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <section className={`rules-lab__pending${pending ? ' rules-lab__pending--open' : ''}`} aria-labelledby="rules-lab-pending-title">
        <div>
          <p className="rules-lab__kicker">Decision boundary</p>
          <h2 id="rules-lab-pending-title">Ожидающее решение</h2>
          {pendingTargetSave ? (
            <p data-testid="rules-lab-pending-detail">
              {actorName(world, pendingTargetSave.targetActorId)} бросает {pendingTargetSave.request.ability.toUpperCase()}
              {' '}против СЛ {pendingTargetSave.request.dc}. Источник: {actorName(world, pendingTargetSave.sourceActorId)}.
            </p>
          ) : pendingProtection ? (
            <p data-testid="rules-lab-pending-detail">
              {actorName(world, pendingProtection.request.actorId)} может защитить {actorName(world, pendingProtection.targetActorId)}.
              {' '}Решение принимается до броска атаки {actorName(world, pendingProtection.sourceActorId)}; щит, видимость и дистанция уже проверены движком.
            </p>
          ) : pendingAttackReaction ? (
            <p data-testid="rules-lab-pending-detail">
              {actorName(world, pendingAttackReaction.request.actorId)} отвечает на атаку
              {' '}{actorName(world, pendingAttackReaction.sourceActorId)}. Доступно реакций:
              {' '}{pendingAttackReaction.request.options.map((option) => option.label).join(', ') || 'только отказ'}.
            </p>
          ) : (
            <p data-testid="rules-lab-pending-detail">Нет открытого решения. Действия сценария откроют его только через rules-core.</p>
          )}
        </div>
        <div className="rules-lab__decision-buttons">
          <LabButton testId="rules-lab-resolve-fail" label="Ответить d20 = 5" availability={decisionAvailability} onClick={() => resolveSave(5)} tone="decision" />
          <LabButton testId="rules-lab-resolve-success" label="Ответить d20 = 18" availability={decisionAvailability} onClick={() => resolveSave(18)} tone="decision" />
          <LabButton testId="rules-lab-protection-use" label="Применить Protection" availability={protectionDecisionAvailability} onClick={() => resolveProtection(true)} tone="decision" />
          <LabButton testId="rules-lab-protection-decline" label="Отклонить Protection" availability={protectionDecisionAvailability} onClick={() => resolveProtection(false)} tone="decision" />
          <LabButton testId="rules-lab-reaction-use" label="Применить предложенную реакцию" availability={attackReactionAvailability} onClick={() => resolveAttackReaction(true)} tone="decision" />
          <LabButton testId="rules-lab-reaction-decline" label="Отклонить реакцию" availability={attackReactionAvailability} onClick={() => resolveAttackReaction(false)} tone="decision" />
        </div>
      </section>

      <div className="rules-lab__bottom-grid">
        <section className="rules-lab__panel" aria-labelledby="rules-lab-events-title">
          <div className="rules-lab__section-heading">
            <div>
              <p className="rules-lab__kicker">Persisted event trace</p>
              <h2 id="rules-lab-events-title">Последние события</h2>
            </div>
            <span className="rules-lab__counter" data-testid="rules-lab-event-count">{events.length}</span>
          </div>
          <ol className="rules-lab__event-list" data-testid="rules-lab-events">
            {visibleEvents.length
              ? visibleEvents.map((event, index) => (
                <li key={`${events.length - index}:${event.ordinal}`}>{summarizeEvent(event, world)}</li>
              ))
              : <li className="rules-lab__muted">Команды ещё не фиксировались.</li>}
          </ol>
        </section>

        <section className="rules-lab__panel rules-lab__reset" aria-labelledby="rules-lab-reset-title">
          <div>
            <p className="rules-lab__kicker">Контролируемая очистка</p>
            <h2 id="rules-lab-reset-title">Начать заново</h2>
            <p>Соседние миры и другие базы приложения не затрагиваются.</p>
          </div>
          <LabButton testId="rules-lab-reset" label="Сбросить только rules-lab" availability={resetAvailability} onClick={() => void reset()} tone="danger" />
        </section>
      </div>

      <footer className="rules-lab__footer">
        Fixture: {SYSTEM_ACTION_IDS.attack} · {SYSTEM_ACTION_IDS.weaponAttack} · {execution.footerActionIds.join(' · ')}
      </footer>
    </main>
  );
}

export function RulesLab({
  dependencies,
  scenarioId = RULES_LAB_BASELINE_SCENARIO_ID,
}: RulesLabProps) {
  const scenario = findRulesLabScenario(scenarioId);
  if (!scenario) return <UnknownRulesLabScenario scenarioId={scenarioId} />;
  return <RulesLabScenarioScreen scenario={scenario} dependencies={dependencies} />;
}

/** Router-only shell; the named RulesLab component remains mountable without a Router in jsdom. */
function RulesLabRoute() {
  const { scenarioId } = useParams<{ scenarioId?: string }>();
  return <RulesLab scenarioId={scenarioId ?? RULES_LAB_BASELINE_SCENARIO_ID} />;
}

export default RulesLabRoute;
