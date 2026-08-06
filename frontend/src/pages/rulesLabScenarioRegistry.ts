import type { RuleActionDefinition } from '../rules-core/domain';
import {
  RULES_LAB_ACTIONS,
  RULES_LAB_ACTOR_IDS,
  RULES_LAB_BASELINE_SESSION_CONFIG,
  RULES_LAB_BLADE_ACTIONS,
  RULES_LAB_BLADE_ACTOR_IDS,
  RULES_LAB_BLADE_SESSION_CONFIG,
  RULES_LAB_CHAIN_ACTIONS,
  RULES_LAB_CHAIN_ACTOR_IDS,
  RULES_LAB_CHAIN_SESSION_CONFIG,
  RULES_LAB_FAMILIAR_ACTIONS,
  RULES_LAB_FAMILIAR_ACTOR_IDS,
  RULES_LAB_FAMILIAR_SESSION_CONFIG,
  RULES_LAB_FIGHTER_WEAPON_CARD_ID,
  RULES_LAB_OBJECT_ID,
  RULES_LAB_PACT_EXECUTION,
  RULES_LAB_TOME_ACTIONS,
  RULES_LAB_TOME_ACTOR_IDS,
  RULES_LAB_TOME_SESSION_CONFIG,
  rulesLabAction,
  type RulesLabScenarioSessionConfig,
} from './rulesLabFixture';

export const RULES_LAB_BASELINE_SCENARIO_ID = 'baseline' as const;
export const RULES_LAB_SCENARIO_IDS = [
  RULES_LAB_BASELINE_SCENARIO_ID,
  'blade',
  'chain',
  'tome',
  'familiar',
] as const;

export type RulesLabScenarioId = typeof RULES_LAB_SCENARIO_IDS[number];

export interface RulesLabBaselineExecution {
  fighterActorId: typeof RULES_LAB_ACTOR_IDS[0];
  wizardActorId: typeof RULES_LAB_ACTOR_IDS[1];
  fighterWeaponCardId: string;
  objectId: string;
  actionForActor: (actorId: string) => RuleActionDefinition | undefined;
  footerActionIds: readonly string[];
}

interface RulesLabPactExecutionBase {
  primaryActorId: string;
  secondaryActorId: string;
  footerActionIds: readonly string[];
}

export interface RulesLabBladeExecution extends RulesLabPactExecutionBase {
  bondActionId: string;
  weaponCardId: string;
  defenderShieldActionId: string;
  defenderShieldGrantId: string;
}

export interface RulesLabChainExecution extends RulesLabPactExecutionBase {
  findFamiliarActionId: string;
  findFamiliarGrantId: string;
  familiarActionId: string;
}

export interface RulesLabTomeExecution extends RulesLabPactExecutionBase {
  initialBookObjectId: string;
  cantripActionId: string;
  cantripActionIds: readonly [string, string, string];
  ritualActionIds: readonly [string, string];
}

export interface RulesLabFamiliarExecution extends RulesLabPactExecutionBase {
  findFamiliarActionId: string;
  findFamiliarGrantId: string;
  chillTouchActionId: string;
  chillTouchGrantId: string;
  shieldActionId: string;
  shieldGrantId: string;
}

/**
 * A scenario owns fixture identities and browser-only command declarations.
 * It never owns rule execution: every mutation still goes through RulesSession.
 */
interface RulesLabScenarioDefinitionBase extends RulesLabScenarioSessionConfig {
  id: RulesLabScenarioId;
  path: `/rules-lab/${RulesLabScenarioId}`;
  title: string;
  description: string;
}

export type RulesLabScenarioDefinition = RulesLabScenarioDefinitionBase & (
  | { kind: 'baseline'; execution: RulesLabBaselineExecution }
  | { kind: 'blade'; execution: RulesLabBladeExecution }
  | { kind: 'chain'; execution: RulesLabChainExecution }
  | { kind: 'tome'; execution: RulesLabTomeExecution }
  | { kind: 'familiar'; execution: RulesLabFamiliarExecution }
);

export const RULES_LAB_BASELINE_SCENARIO: RulesLabScenarioDefinition = {
  ...RULES_LAB_BASELINE_SESSION_CONFIG,
  id: RULES_LAB_BASELINE_SCENARIO_ID,
  path: '/rules-lab/baseline',
  title: 'Базовый бой',
  description: 'Fighter и Wizard: ход, атака, проверка, спасбросок и сохраняемое решение.',
  kind: 'baseline',
  execution: {
    fighterActorId: RULES_LAB_ACTOR_IDS[0],
    wizardActorId: RULES_LAB_ACTOR_IDS[1],
    fighterWeaponCardId: RULES_LAB_FIGHTER_WEAPON_CARD_ID,
    objectId: RULES_LAB_OBJECT_ID,
    actionForActor: rulesLabAction,
    footerActionIds: RULES_LAB_ACTIONS.map((action) => action.id),
  },
};

export const RULES_LAB_BLADE_SCENARIO: RulesLabScenarioDefinition = {
  ...RULES_LAB_BLADE_SESSION_CONFIG,
  id: 'blade',
  path: '/rules-lab/blade',
  title: 'Договор клинка',
  description: 'Связь и замена оружия, Attack ledger, Харизма, психический урон и Shield continuation.',
  kind: 'blade',
  execution: {
    primaryActorId: RULES_LAB_BLADE_ACTOR_IDS[0],
    secondaryActorId: RULES_LAB_BLADE_ACTOR_IDS[1],
    ...RULES_LAB_PACT_EXECUTION.blade,
    footerActionIds: RULES_LAB_BLADE_ACTIONS.map((action) => action.id),
  },
};

export const RULES_LAB_CHAIN_SCENARIO: RulesLabScenarioDefinition = {
  ...RULES_LAB_CHAIN_SESSION_CONFIG,
  id: 'chain',
  path: '/rules-lab/chain',
  title: 'Договор цепи',
  description: 'Find Familiar без ячейки, собственный ход фамильяра и замена одной атаки его Реакцией.',
  kind: 'chain',
  execution: {
    primaryActorId: RULES_LAB_CHAIN_ACTOR_IDS[0],
    secondaryActorId: RULES_LAB_CHAIN_ACTOR_IDS[1],
    ...RULES_LAB_PACT_EXECUTION.chain,
    footerActionIds: RULES_LAB_CHAIN_ACTIONS.map((action) => action.id),
  },
};

export const RULES_LAB_TOME_SCENARIO: RulesLabScenarioDefinition = {
  ...RULES_LAB_TOME_SESSION_CONFIG,
  id: 'tome',
  path: '/rules-lab/tome',
  title: 'Договор гримуара',
  description: 'Отдых атомарно заменяет Книгу Теней и её grants; затем книга даёт проверяемый cantrip.',
  kind: 'tome',
  execution: {
    primaryActorId: RULES_LAB_TOME_ACTOR_IDS[0],
    secondaryActorId: RULES_LAB_TOME_ACTOR_IDS[1],
    ...RULES_LAB_PACT_EXECUTION.tome,
    footerActionIds: RULES_LAB_TOME_ACTIONS.map((action) => action.id),
  },
};

export const RULES_LAB_FAMILIAR_SCENARIO: RulesLabScenarioDefinition = {
  ...RULES_LAB_FAMILIAR_SESSION_CONFIG,
  id: 'familiar',
  path: '/rules-lab/familiar',
  title: 'Обретение фамильяра',
  description: 'Ритуал, отдельный summoned actor, доставка Touch-заклинания и сохраняемая реакция Shield.',
  kind: 'familiar',
  execution: {
    primaryActorId: RULES_LAB_FAMILIAR_ACTOR_IDS[0],
    secondaryActorId: RULES_LAB_FAMILIAR_ACTOR_IDS[1],
    ...RULES_LAB_PACT_EXECUTION.familiar,
    footerActionIds: RULES_LAB_FAMILIAR_ACTIONS.map((action) => action.id),
  },
};

export const RULES_LAB_SCENARIOS: readonly RulesLabScenarioDefinition[] = [
  RULES_LAB_BASELINE_SCENARIO,
  RULES_LAB_BLADE_SCENARIO,
  RULES_LAB_CHAIN_SCENARIO,
  RULES_LAB_TOME_SCENARIO,
  RULES_LAB_FAMILIAR_SCENARIO,
];

/** A registered browser route is executable only when every immutable command source exists. */
export function rulesLabScenarioCommandIssue(
  scenario: RulesLabScenarioDefinition,
): string | null {
  const actionIds = scenario.kind === 'baseline'
    ? scenario.execution.footerActionIds
    : scenario.kind === 'blade'
      ? [scenario.execution.bondActionId, scenario.execution.defenderShieldActionId]
      : scenario.kind === 'chain'
        ? [scenario.execution.findFamiliarActionId]
        : scenario.kind === 'tome'
          ? [
            scenario.execution.cantripActionId,
            ...scenario.execution.cantripActionIds,
            ...scenario.execution.ritualActionIds,
          ]
          : [
            scenario.execution.findFamiliarActionId,
            scenario.execution.chillTouchActionId,
            scenario.execution.shieldActionId,
          ];
  const missingActionId = [...new Set(actionIds)].find((id) => !scenario.catalog.getAction(id));
  if (missingActionId) return `catalog misses required action ${missingActionId}`;
  if (scenario.kind === 'blade' && !scenario.catalog.getCard?.(scenario.execution.weaponCardId)) {
    return `catalog misses required weapon Card ${scenario.execution.weaponCardId}`;
  }
  return null;
}

export function findRulesLabScenario(
  scenarioId: string | undefined,
): RulesLabScenarioDefinition | undefined {
  const requested = scenarioId ?? RULES_LAB_BASELINE_SCENARIO_ID;
  const scenario = RULES_LAB_SCENARIOS.find((candidate) => candidate.id === requested);
  return scenario && !rulesLabScenarioCommandIssue(scenario) ? scenario : undefined;
}
