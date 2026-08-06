import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1ChoiceVariant,
  compileMicroMvpL1ChoiceVariants,
  type CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import {
  readProdSnapshotCatalogs,
  type SnapshotCatalogs,
} from '../../canon/prodSnapshotL1Fixtures';
import { materializeMicroMvpL1ContentPatch } from '../../canon/declarativeMechanicsPatch';
import { SKILL_ABILITY } from '../../character/rules/foundation';
import { armorClassValue } from '../../engine/ac';
import { actionUsesKey } from '../../engine/actionUses';
import { collectModifiers } from '../../engine/modifiers';
import type { Card } from '../../types';
import { effectiveSenses } from '../dwarfTraits';
import type {
  Ability,
  ActionWorldInput,
  ActorState,
  RuleActionDefinition,
  RuleHazardDefinition,
  SpatialFacts,
  UncommittedRuleEvent,
} from '../domain';
import {
  compileMicroMvpAcceptanceCorpus,
  type CompiledMicroMvpAcceptanceCorpus,
} from './compiledMicroMvpAcceptanceCorpus';
import {
  cloneRuntimeValue,
  createCompiledRuntimeScenarioFoundation,
  extendCompiledRuntimeProvider,
  runCompiledRuntimeScenario,
  type CompiledRuntimeScenarioFoundation,
} from './compiledMicroMvpSpeciesFeatStyleRuntime';
import {
  COMPILED_MICRO_MVP_RUNTIME_UNCOVERED,
  COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_EVIDENCE,
} from './compiledMicroMvpSpeciesFeatStyleRuntimeEvidence';
import type { ScenarioSpec, ScenarioStep } from './scenario';

type JsonRecord = Record<string, unknown>;

const CLASS = {
  fighter: 'CLASS-warrior',
  wizard: 'CLASS-wizard',
} as const;

const SPECIES = {
  human: 'RACE-0002',
  dwarf: 'RACE-0003',
  elf: 'RACE-0004',
  dragonborn: 'RACE-0008',
} as const;

const FEAT = {
  alert: 'FEAT-0001',
  tough: 'FEAT-0005',
  skilled: 'FEAT-0008',
  magicInitiate: 'FEAT-0009',
  archery: 'FEAT-0063',
  defense: 'FEAT-0056',
} as const;

const SELF_FACTS: SpatialFacts = {
  factsSource: 'scenario', boardRevision: 1, distanceFt: 0,
  lineOfSight: true, cover: 'none', relation: 'self',
};

const ENEMY_FACTS: SpatialFacts = {
  factsSource: 'scenario', boardRevision: 1, distanceFt: 30,
  lineOfSight: true, cover: 'none', relation: 'enemy',
};

const MAGICAL_SLEEP: RuleActionDefinition = {
  id: 'scenario.probe.magical-sleep',
  name: 'Magical Sleep Probe',
  kind: 'nonSpell',
  sourceEntityIds: ['scenario:probe:magical-sleep'],
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'auto', who: 'target', result: [{
        kind: 'condition', value: 'unconscious',
        causeTags: ['spell', 'magical', 'sleep'],
        duration: { type: 'rounds', amount: 10 },
      }],
    }],
  },
  targeting: {
    minTargets: 1, maxTargets: 1, rangeFt: 60,
    requiresLineOfSight: true, allowedRelations: ['enemy'],
  },
};

const CHARM_HAZARD: RuleHazardDefinition = {
  id: 'scenario.hazard.charm',
  name: 'Charm Save Probe',
  sourceKind: 'system',
  sourceEntityIds: ['scenario:hazard:charm'],
  save: { ability: 'wis', dc: 10 },
  onFailure: [{
    kind: 'condition', value: 'charmed', op: 'apply',
    duration: { type: 'rounds', amount: 1 },
  }],
  onSuccess: [],
};

const POISON_SAVE_PROBE: RuleActionDefinition = {
  id: 'scenario.probe.poison-save',
  name: 'Poison Resilience Probe',
  kind: 'nonSpell',
  sourceEntityIds: ['scenario:probe:poison-save'],
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'save', who: 'target', ability: 'con', dc: '30',
      on_fail: [
        { kind: 'damage', dice: '1d6', type: 'poison', ability: 'none' },
        {
          kind: 'condition', value: 'poisoned', op: 'apply',
          duration: { type: 'rounds', amount: 1 },
        },
      ],
      on_success: [],
    }],
  },
  targeting: {
    minTargets: 1, maxTargets: 1, rangeFt: 30,
    requiresLineOfSight: true, allowedRelations: ['enemy'],
  },
};

const FIRE_PROBE: RuleActionDefinition = {
  id: 'scenario.probe.fire-damage',
  name: 'Fire Resistance Probe',
  kind: 'nonSpell',
  sourceEntityIds: ['scenario:probe:fire-damage'],
  mechanics: {
    activation: { mode: 'active', cost: [{ resource: 'action' }] },
    effects: [{
      resolution: 'auto', who: 'target',
      result: [{ kind: 'damage', dice: '1d10', type: 'fire' }],
    }],
  },
  targeting: {
    minTargets: 1, maxTargets: 1, rangeFt: 60,
    requiresLineOfSight: true, allowedRelations: ['enemy'],
  },
};

let corpus: CompiledMicroMvpAcceptanceCorpus;
let catalogs: SnapshotCatalogs;
let human: CompiledMicroMvpL1Root;
let highElf: CompiledMicroMvpL1Root;
let dwarf: CompiledMicroMvpL1Root;
let dragonborn: CompiledMicroMvpL1Root;
let alert: CompiledMicroMvpL1Root;
let magicInitiate: CompiledMicroMvpL1Root;
let skilled: CompiledMicroMvpL1Root;
let archery: CompiledMicroMvpL1Root;
let defense: CompiledMicroMvpL1Root;
let scenarioIndex = 0;

function required<T>(value: T | undefined | null, label: string): T {
  if (value == null) throw new Error(`Missing compiled runtime fixture: ${label}`);
  return value;
}

function rootFor(input: {
  classCard?: string;
  speciesCard?: string;
  originFeatCard?: string;
  backgroundCard?: string;
  lineageCard?: string;
}): CompiledMicroMvpL1Root {
  return required(corpus.compiled.roots.find((root) => (
    (!input.classCard || root.matrixCase.klass.card_number === input.classCard)
      && (!input.speciesCard || root.matrixCase.species.card_number === input.speciesCard)
      && (!input.originFeatCard || root.matrixCase.originFeat.card_number === input.originFeatCard)
      && (!input.backgroundCard || root.matrixCase.background.card_number === input.backgroundCard)
      && (!input.lineageCard || root.speciesAudit.lineageCardNumber === input.lineageCard)
  )), JSON.stringify(input));
}

function decision(root: CompiledMicroMvpL1Root, suffix: string) {
  return required(
    root.decisions.find((candidate) => candidate.choiceId.endsWith(`:${suffix}`)),
    `${root.stableKey}:${suffix}:decision`,
  );
}

function pendingChoice(root: CompiledMicroMvpL1Root, suffix: string) {
  return required(
    root.assembled.pendingChoices.find((candidate) => candidate.id.endsWith(`:${suffix}`)),
    `${root.stableKey}:${suffix}:choice`,
  );
}

function foundation(root: CompiledMicroMvpL1Root, label: string) {
  return createCompiledRuntimeScenarioFoundation({
    corpus, root, index: scenarioIndex++, idPrefix: `compiled-runtime-${label}`,
  });
}

function assertion(id: string, path: string, value: unknown) {
  return { id, type: 'equals' as const, path, value };
}

function skillAbility(skill: string, fallback: Ability): Ability {
  const ability = SKILL_ABILITY[skill];
  return ability === 'str' || ability === 'dex' || ability === 'con'
    || ability === 'int' || ability === 'wis' || ability === 'cha'
    ? ability
    : fallback;
}

function withRolls(
  spec: ScenarioSpec,
  input: {
    prefix?: ScenarioSpec['rollTape'];
    suffix?: ScenarioSpec['rollTape'];
  },
): ScenarioSpec {
  return {
    ...spec,
    rollTape: [
      ...(input.prefix ?? []),
      ...(spec.rollTape ?? []),
      ...(input.suffix ?? []),
    ],
  };
}

function addCapability(actor: ActorState, actionId: string): ActorState {
  return {
    ...actor,
    capabilities: {
      ...actor.capabilities,
      actionIds: [...new Set([...actor.capabilities.actionIds, actionId])],
    },
  };
}

function initiativeSwapSpec(
  foundationValue: CompiledRuntimeScenarioFoundation,
  prelude: readonly ScenarioStep[] = [],
): ScenarioSpec {
  const base = cloneRuntimeValue(foundationValue.spec);
  const [startEncounter, ...remaining] = base.steps;
  if (startEncounter?.do !== 'startEncounter') throw new Error('Common trace must start the encounter explicitly');
  const reversedStart: ScenarioStep = {
    ...startEncounter,
    assertions: startEncounter.assertions.map((item) => (
      item.type === 'equals' && item.path === 'scene.initiative'
        ? { ...item, value: ['support', 'subject'] }
        : item
    )),
  };
  const supportController = foundationValue.acceptance.support.actor.controllerId;
  return {
    ...base,
    initiative: ['support', 'subject'],
    steps: [
      ...prelude,
      reversedStart,
      {
        do: 'swapInitiative', actor: 'subject', ally: 'support',
        facts: {
          factsSource: 'scenario', boardRevision: 2, relation: 'ally', willing: true,
          confirmedByControllerId: supportController,
        },
        assertions: [assertion(
          `${base.id}:MECHANIC-ALERT-SWAP`,
          'scene.initiative',
          ['subject', 'support'],
        )],
      },
      ...remaining,
    ],
  };
}

function engineEvents(runEvents: readonly UncommittedRuleEvent[]) {
  return runEvents.flatMap((entry) => (
    entry.payload.type === 'EngineEventRecorded'
      ? [{ entry, event: entry.payload.event, facts: entry.payload.facts }]
      : []
  ));
}

function checkRollFor(events: readonly UncommittedRuleEvent[], skill: string) {
  return required(engineEvents(events).find(({ event }) => (
    event.type === 'roll'
      && event.roll.kind === 'check'
      && event.label === `Проверка (${skill})`
  ))?.event, `${skill}:runtime check`);
}

function actionDeclaration(events: readonly UncommittedRuleEvent[], actionId: string) {
  return required(events.find((entry) => (
    entry.payload.type === 'ActionDeclared' && entry.payload.actionId === actionId
  )), `${actionId}:declaration`);
}

function spellStep(input: {
  id: string;
  action: Extract<RuleActionDefinition, { kind: 'spell' }>;
  grantId: string;
  sourceId?: string;
  ability?: Ability;
  worldInput?: ActionWorldInput;
  preferFreeUse?: boolean;
}): ScenarioStep {
  const needsTarget = (input.action.targeting?.minTargets ?? 0) > 0;
  return {
    do: 'use', actor: 'subject', actionId: input.action.id, actionKind: 'spell',
    targets: needsTarget ? ['subject'] : [],
    factsByTarget: needsTarget ? { subject: SELF_FACTS } : {},
    spell: {
      baseLevel: input.action.spell.level,
      grantId: input.grantId,
      ...(input.preferFreeUse === undefined ? {} : { preferFreeUse: input.preferFreeUse }),
    },
    ...(input.worldInput ? { worldInput: input.worldInput } : {}),
    assertions: [{
      id: input.id,
      type: 'event',
      match: {
        payloadType: 'ActionDeclared', actorId: 'subject',
        payloadSubset: {
          actionId: input.action.id,
          ...(input.sourceId || input.ability ? {
            spell: {
              grantId: input.grantId,
              ...(input.sourceId ? { sourceId: input.sourceId } : {}),
              ...(input.ability ? { spellcastingAbility: input.ability } : {}),
            },
          } : {}),
        },
      },
      exactly: 1,
    }],
  };
}

function withEquippedWeapons(actor: ActorState, main: Card, off: Card): ActorState {
  return {
    ...actor,
    character: {
      ...actor.character,
      equippedCards: [main, off],
      knownCards: [main, off],
    },
    runtime: {
      ...actor.runtime,
      equipment: { ...actor.runtime.equipment, main_hand: main.id, off_hand: off.id },
      inventory: [{ cardId: main.id, qty: 1 }, { cardId: off.id, qty: 1 }],
    },
  };
}

beforeAll(async () => {
  corpus = await compileMicroMvpAcceptanceCorpus();
  catalogs = materializeMicroMvpL1ContentPatch(readProdSnapshotCatalogs()).catalogs;

  const featId = (cardNumber: string) => required(
    catalogs.feats.find((candidate) => candidate.card_number === cardNumber),
    cardNumber,
  ).id;

  const humanBase = rootFor({
    classCard: CLASS.fighter, speciesCard: SPECIES.human,
    backgroundCard: 'BG-0012', originFeatCard: FEAT.tough,
  });
  human = await compileMicroMvpL1ChoiceVariant({
    stableKey: humanBase.stableKey,
    overrides: { human_feat: [featId(FEAT.alert)] },
  });

  const highElfBase = rootFor({
    speciesCard: SPECIES.elf, lineageCard: 'sub-high_elf',
  });
  highElf = await compileMicroMvpL1ChoiceVariant({
    stableKey: highElfBase.stableKey,
    overrides: { elf_lineage_spellcasting_ability: ['cha'] },
  });

  dwarf = rootFor({
    classCard: CLASS.fighter, speciesCard: SPECIES.dwarf,
    backgroundCard: 'BG-0012', originFeatCard: FEAT.tough,
  });
  dragonborn = rootFor({
    speciesCard: SPECIES.dragonborn, lineageCard: 'sub-red',
  });
  alert = rootFor({
    classCard: CLASS.fighter, speciesCard: SPECIES.dwarf,
    backgroundCard: 'BG-0012', originFeatCard: FEAT.alert,
  });

  const falseLife = required(
    catalogs.spells.find((spell) => spell.card_number === 'false_life'),
    'False Life',
  );
  const magicBase = rootFor({
    classCard: CLASS.fighter, speciesCard: SPECIES.dwarf,
    backgroundCard: 'BG-0012', originFeatCard: FEAT.magicInitiate,
  });
  magicInitiate = await compileMicroMvpL1ChoiceVariant({
    stableKey: magicBase.stableKey,
    overrides: { magic_initiate_wizard_level_1: [falseLife.id] },
  });

  const skilledBase = rootFor({
    classCard: CLASS.fighter, speciesCard: SPECIES.dwarf,
    backgroundCard: 'BG-0012', originFeatCard: FEAT.skilled,
  });
  const skilledChoice = pendingChoice(skilledBase, 'feat_skilled');
  const skilledDecision = decision(skilledBase, 'feat_skilled');
  const grantedSkills = new Set(skilledBase.ruleState.appliedGrants
    .filter((grant) => grant.choiceId === skilledDecision.choiceId && grant.kind === 'skill')
    .map((grant) => grant.value));
  const baselineSkills = new Set(skilledBase.ruleState.proficiencies.skills
    .filter((skill) => !grantedSkills.has(skill)));
  const skilledOptions = ((skilledChoice.options as JsonRecord | undefined)?.items ?? []) as
    Array<{ id: string }>;
  const threeSkills = skilledOptions
    .map((item) => item.id)
    .filter((id) => id.startsWith('skill:') && !baselineSkills.has(id.slice('skill:'.length)))
    .slice(0, 3);
  if (threeSkills.length !== 3) throw new Error('Skilled needs three legal skill probes');
  skilled = await compileMicroMvpL1ChoiceVariant({
    stableKey: skilledBase.stableKey,
    overrides: { feat_skilled: threeSkills },
  });

  const styleBase = dwarf.stableKey;
  [archery, defense] = await compileMicroMvpL1ChoiceVariants([
    { stableKey: styleBase, overrides: { fighter_fighting_style: [featId(FEAT.archery)] } },
    { stableKey: styleBase, overrides: { fighter_fighting_style: [featId(FEAT.defense)] } },
  ]);
}, 60_000);

describe('compiled species, Origin feat, and Fighting Style runtime scenarios', () => {
  it('exports only honestly executable runtime links with no stale uncovered gaps', () => {
    const links = COMPILED_MICRO_MVP_SPECIES_FEAT_STYLE_RUNTIME_EVIDENCE
      .flatMap((registration) => registration.links);
    expect(links).toHaveLength(14);
    expect(new Set(links.map((link) => `${link.entityId}:${link.obligationId}`)).size).toBe(14);
    expect(COMPILED_MICRO_MVP_RUNTIME_UNCOVERED).toEqual([]);
  });

  it('executes the complete Human runtime package inside one compiled two-PC chronology', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-RUNTIME-HUMAN-01' },
  }, () => {
    const runtime = foundation(human, 'human-complete');
    const selectedSkill = decision(human, 'human_skill').optionIds[0];
    const ability = skillAbility(selectedSkill, 'str');
    const restStep: ScenarioStep = {
      do: 'longRest', actor: 'subject', durationHours: 8,
      assertions: [
        assertion(`${runtime.spec.id}:MECHANIC-RESOURCEFUL`, 'actors.subject.runtime.resources.heroic_inspiration', 1),
        {
          id: `${runtime.spec.id}:MECHANIC-RESOURCEFUL-TRIGGER`, type: 'event',
          match: { engineEventType: 'narrative', actorId: 'subject' }, minimum: 1,
        },
      ],
    };
    let spec = initiativeSwapSpec(runtime, [restStep]);
    spec = {
      ...spec,
      steps: spec.steps.map((step) => step.do === 'abilityCheck'
        ? { ...step, ability, skill: selectedSkill }
        : step),
    };
    const provider = extendCompiledRuntimeProvider({
      foundation: runtime,
      subject: (actor) => ({
        ...actor,
        runtime: {
          ...actor.runtime,
          resources: { ...actor.runtime.resources, heroic_inspiration: 0 },
        },
      }),
    });
    const run = runCompiledRuntimeScenario({ foundation: runtime, spec, provider });

    expect(run.initialState.actors.subject.runtime.resources.heroic_inspiration).toBe(0);
    expect(run.finalState.actors.subject.runtime.resources.heroic_inspiration).toBe(1);
    const skillRoll = checkRollFor(run.events, selectedSkill);
    if (skillRoll.type !== 'roll') throw new Error('Human Skillful did not produce a roll');
    expect(skillRoll.roll.modifiers).toContainEqual({
      value: human.actor.character.profBonus, source: 'БМ',
    });
    const humanFeat = decision(human, 'human_feat').optionIds[0];
    const productFeat = human.assembled.feats.find((feat) => (
      feat.id === human.matrixCase.originFeat.id
    ));
    if (!productFeat?.repeatable) {
      expect(humanFeat).not.toBe(human.matrixCase.originFeat.id);
    }
    expect(actionDeclaration(run.events, 'core.action.hide')).toBeDefined();
    if (run.finalState.scene.mode !== 'encounter') throw new Error('Human chronology left encounter mode');
    expect(run.finalState.scene.initiativeSwapActorIds).toEqual(['subject']);
  });

  it('executes the complete Elf runtime package inside one compiled two-PC chronology', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-RUNTIME-ELF-01' },
  }, () => {
    const runtime = foundation(highElf, 'elf-complete');
    if (runtime.acceptance.support.matrixCase.species.card_number === SPECIES.elf) {
      throw new Error('Elf Trance comparison requires a non-Elf compiled support PC');
    }
    const keenSkill = decision(highElf, 'elf_skill').optionIds[0];
    const keenAbility = skillAbility(keenSkill, 'wis');
    const lineageGrant = required(highElf.actor.spellcastingAccess?.grants.find((grant) => (
      grant.sourceId === highElf.speciesAudit.lineageId && grant.level === 0
    )), 'High Elf lineage grant');
    const lineageAction = required(highElf.rulesActions.find((candidate): candidate is Extract<
      RuleActionDefinition, { kind: 'spell' }
    > => candidate.kind === 'spell' && candidate.id === lineageGrant.actionId), 'High Elf lineage action');
    const prelude: ScenarioStep[] = [
      {
        do: 'longRest', actor: 'subject', durationHours: 4,
        assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-ELF-TRANCE`,
          'actors.subject.runtime.resources.reaction', 1,
        )],
      },
      {
        do: 'longRest', actor: 'support', durationHours: 4,
        expectedResult: { status: 'rejected', code: 'InvalidFacts' },
        assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-NONELF-REST-UNCHANGED`,
          'actors.support.runtime.resources.reaction',
          runtime.acceptance.support.actor.runtime.resources.reaction,
        )],
      },
      {
        do: 'use', actor: 'support', actionId: MAGICAL_SLEEP.id, actionKind: 'nonSpell',
        targets: ['subject'], factsByTarget: { subject: ENEMY_FACTS },
        assertions: [
          {
            id: `${runtime.spec.id}:MECHANIC-SLEEP-IMMUNE`,
            type: 'condition', actor: 'subject', condition: 'unconscious', present: false,
          },
          {
            id: `${runtime.spec.id}:MECHANIC-SLEEP-IMMUNE-EVENT`, type: 'event',
            match: { engineEventType: 'condition_immune' }, exactly: 1,
          },
        ],
      },
      {
        do: 'triggerHazard', actor: 'subject', hazardId: CHARM_HAZARD.id, targetActor: 'subject',
        assertions: [{
          id: `${runtime.spec.id}:MECHANIC-FEY-SAVE-OPEN`, type: 'pending', pendingType: 'hazard_save',
        }],
      },
      {
        do: 'resolveDecision', actor: 'subject', roll: { mode: 'system' },
        assertions: [{
          id: `${runtime.spec.id}:MECHANIC-FEY-ADVANTAGE`, type: 'event',
          match: { engineEventType: 'roll', actorId: 'subject', roll: { kind: 'save' } }, exactly: 1,
        }],
      },
    ];
    let spec = cloneRuntimeValue(runtime.spec);
    spec = {
      ...spec,
      steps: [
        ...prelude,
        ...spec.steps.map((step) => step.do === 'abilityCheck'
          ? { ...step, ability: keenAbility, skill: keenSkill }
          : step),
        { do: 'startTurn', actor: 'subject', assertions: [assertion(
          `${spec.id}:MECHANIC-ELF-LINEAGE-TURN`, 'scene.turnStarted', true,
        )] },
        spellStep({
          id: `${spec.id}:MECHANIC-ELF-LINEAGE-CAST`,
          action: lineageAction,
          grantId: lineageGrant.grantId,
          sourceId: highElf.speciesAudit.lineageId,
          ability: 'cha',
          worldInput: {
            type: 'prestidigitation',
            option: {
              kind: 'sensory_effect', description: 'A harmless shower of sparks',
              facts: { factsSource: 'scenario', boardRevision: 7, distanceFt: 5, lineOfSight: true },
            },
          },
        }),
        { do: 'endTurn', actor: 'subject', assertions: [{
          id: `${spec.id}:MECHANIC-ELF-LINEAGE-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
      ],
    };
    spec = withRolls(spec, {
      prefix: [
        { label: 'Elf Fey Ancestry advantage 1', sides: 20, value: 5 },
        { label: 'Elf Fey Ancestry advantage 2', sides: 20, value: 15 },
      ],
    });
    const provider = extendCompiledRuntimeProvider({
      foundation: runtime,
      subject: (actor) => ({
        ...actor,
        runtime: {
          ...actor.runtime,
          resources: { ...actor.runtime.resources, reaction: 0 },
        },
      }),
      support: (actor) => addCapability(actor, MAGICAL_SLEEP.id),
      actions: [MAGICAL_SLEEP],
      hazards: [CHARM_HAZARD],
    });
    const run = runCompiledRuntimeScenario({
      foundation: runtime, spec, provider, expectedRejections: 1,
    });

    const feySave = required(engineEvents(run.events).find(({ event }) => (
      event.type === 'roll' && event.roll.kind === 'save' && event.label.includes('Charm Save Probe')
    )), 'Fey Ancestry save');
    if (feySave.event.type !== 'roll') throw new Error('Fey save did not roll');
    expect(feySave.event.roll.advantage).toBe('advantage');
    const skillRoll = checkRollFor(run.events, keenSkill);
    if (skillRoll.type !== 'roll') throw new Error('Keen Senses did not produce a check');
    expect(skillRoll.roll.modifiers).toContainEqual({
      value: highElf.actor.character.profBonus, source: 'БМ',
    });
    expect(effectiveSenses({
      build: highElf.ruleState.senses,
      runtime: run.finalState.actors.subject.runtime,
    })).toContainEqual(expect.objectContaining({ sense: 'darkvision', range: 60 }));
    expect(run.finalState.actors.subject.traits?.restProfile).toMatchObject({
      longRestHours: 4, sleepRequired: false,
    });
  });

  it('casts an Elf lineage cantrip with its persisted ability inside one compiled two-PC chronology', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-RUNTIME-ELF-LINEAGE-SPELL-01' },
  }, () => {
    const runtime = foundation(highElf, 'elf-lineage-ability');
    const grant = required(highElf.actor.spellcastingAccess?.grants.find((candidate) => (
      candidate.sourceId === highElf.speciesAudit.lineageId && candidate.level === 0
    )), 'High Elf lineage grant');
    const action = required(highElf.rulesActions.find((candidate): candidate is Extract<
      RuleActionDefinition, { kind: 'spell' }
    > => candidate.kind === 'spell' && candidate.id === grant.actionId), 'High Elf lineage action');
    const spec: ScenarioSpec = {
      ...runtime.spec,
      steps: [
        ...runtime.spec.steps,
        { do: 'startTurn', actor: 'subject', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-LINEAGE-ABILITY-TURN`, 'scene.turnStarted', true,
        )] },
        spellStep({
          id: `${runtime.spec.id}:MECHANIC-LINEAGE-ABILITY-CAST`,
          action,
          grantId: grant.grantId,
          sourceId: highElf.speciesAudit.lineageId,
          ability: 'cha',
          worldInput: {
            type: 'prestidigitation',
            option: {
              kind: 'sensory_effect', description: 'A harmless shower of sparks',
              facts: { factsSource: 'scenario', boardRevision: 8, distanceFt: 5, lineOfSight: true },
            },
          },
        }),
        { do: 'endTurn', actor: 'subject', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-LINEAGE-ABILITY-END`, type: 'event',
          eventType: 'turn_ended', exactly: 1,
        }] },
      ],
    };
    const run = runCompiledRuntimeScenario({ foundation: runtime, spec });
    const declaration = actionDeclaration(run.events, action.id);
    expect(declaration.payload).toMatchObject({
      type: 'ActionDeclared',
      spell: {
        grantId: grant.grantId,
        sourceId: highElf.speciesAudit.lineageId,
        spellcastingAbility: 'cha',
        payment: { kind: 'none' },
      },
    });
  });

  it('executes the complete Dwarf runtime package inside one compiled two-PC chronology', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-RUNTIME-DWARF-01' },
  }, () => {
    const runtime = foundation(dwarf, 'dwarf-complete');
    const stoneEffect = required(dwarf.assembled.effects.find(({ effect }) => (
      effect.card_number === 'RE-dwarf-4'
    ))?.effect, 'Stonecunning effect');
    const stoneAction = required(dwarf.rulesActions.find((candidate) => (
      candidate.sourceEntityIds.includes(stoneEffect.id)
    )), 'Stonecunning action');
    const usesKey = actionUsesKey(stoneEffect.card_number);
    let spec: ScenarioSpec = {
      ...runtime.spec,
      steps: [
        ...runtime.spec.steps,
        { do: 'startTurn', actor: 'subject', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-STONE-TURN`, 'scene.turnStarted', true,
        )] },
        {
          do: 'use', actor: 'subject', actionId: stoneAction.id, actionKind: 'nonSpell',
          targets: ['subject'],
          factsByTarget: {
            subject: {
              ...SELF_FACTS,
              stonework: { material: 'stone', stoneForm: 'worked', contact: 'touching_surface' },
            },
          },
          assertions: [
            assertion(`${runtime.spec.id}:MECHANIC-STONE-USES`, `actors.subject.runtime.resources.${usesKey}`, 1),
            {
              id: `${runtime.spec.id}:MECHANIC-STONE-DECLARED`, type: 'event',
              match: {
                payloadType: 'ActionDeclared', actorId: 'subject',
                includesObligationIds: stoneAction.sourceEntityIds.map((id) => `entity:${id}`),
              }, exactly: 1,
            },
          ],
        },
        { do: 'checkpointReload', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-STONE-CHECKPOINT`,
          `actors.subject.runtime.resources.${usesKey}`, 1,
        )] },
        { do: 'endTurn', actor: 'subject', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-DWARF-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
        { do: 'startTurn', actor: 'support', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-POISON-PROBE-TURN`, 'scene.turnStarted', true,
        )] },
        {
          do: 'use', actor: 'support', actionId: POISON_SAVE_PROBE.id,
          actionKind: 'nonSpell', targets: ['subject'],
          factsByTarget: { subject: ENEMY_FACTS },
          assertions: [{
            id: `${runtime.spec.id}:MECHANIC-POISON-SAVE-OPEN`, type: 'pending', pendingType: 'target_save',
          }],
        },
        {
          do: 'resolveDecision', actor: 'subject', roll: { mode: 'system' },
          assertions: [{
            id: `${runtime.spec.id}:MECHANIC-POISON-SAVE`, type: 'event',
            match: { engineEventType: 'roll', actorId: 'subject', roll: { kind: 'save', outcome: 'fail' } },
            exactly: 1,
          }],
        },
        { do: 'endTurn', actor: 'support', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-POISON-PROBE-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
      ],
    };
    spec = withRolls(spec, { suffix: [
      { label: 'Dwarven Resilience advantage 1', sides: 20, value: 1 },
      { label: 'Dwarven Resilience advantage 2', sides: 20, value: 2 },
      { label: 'Dwarven poison damage', sides: 6, value: 6 },
    ] });
    const provider = extendCompiledRuntimeProvider({
      foundation: runtime,
      support: (actor) => addCapability(actor, POISON_SAVE_PROBE.id),
      actions: [POISON_SAVE_PROBE],
    });
    const run = runCompiledRuntimeScenario({ foundation: runtime, spec, provider });

    const stoneSense = run.finalState.actors.subject.runtime.activeEffects.find((effect) => (
      (effect.mechanics as JsonRecord).sense === 'tremorsense'
    ));
    expect(stoneSense).toMatchObject({
      roundsLeft: 100,
      mechanics: expect.objectContaining({
        kind: 'grant_sense', sense: 'tremorsense', range: 60,
        sourceEntityIds: [stoneEffect.id, stoneEffect.card_number],
      }),
    });
    const poisonSave = required(engineEvents(run.events).find(({ entry, event }) => (
      event.type === 'roll' && event.roll.kind === 'save'
        && event.label.includes('Спасбросок')
        && entry.obligationIds.includes(`entity:${POISON_SAVE_PROBE.sourceEntityIds[0]}`)
    )), 'Dwarven Resilience save');
    if (poisonSave.event.type !== 'roll') throw new Error('Dwarf poison save did not roll');
    expect(poisonSave.event.roll.advantage).toBe('advantage');
    const poisonDamage = required(engineEvents(run.events).find(({ event }) => (
      event.type === 'damage' && event.damageType === 'poison'
    )), 'Dwarf poison damage');
    expect(poisonDamage.event).toMatchObject({ type: 'damage', amount: 3, damageType: 'poison' });
    expect(poisonDamage.facts).toMatchObject({
      damageAdjustments: [expect.objectContaining({
        damageType: 'poison', adjustment: 'resistance',
      })],
    });
    expect(dwarf.ruleState.senses).toContainEqual({ sense: 'darkvision', range: 120 });
  });

  it('executes Breath Weapon and ancestry resistance inside one compiled two-PC chronology', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-RUNTIME-DRAGONBORN-01' },
  }, () => {
    const runtime = foundation(dragonborn, 'dragonborn-complete');
    const breathEntityId = required(dragonborn.assembled.subrace?.related_actions?.[0], 'Red Breath entity');
    const breathEntity = required(dragonborn.assembled.actions.find(({ action }) => (
      action.id === breathEntityId
    ))?.action, 'Red Breath action entity');
    const breath = required(dragonborn.rulesActions.find((candidate) => (
      candidate.sourceEntityIds.includes(breathEntityId)
    )), 'Red Breath compiled action');
    const usesKey = actionUsesKey(breathEntity.card_number);
    const hpBeforeFire = dragonborn.actor.runtime.hp.current - 5;
    let spec: ScenarioSpec = {
      ...runtime.spec,
      steps: [
        ...runtime.spec.steps,
        { do: 'startTurn', actor: 'subject', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-BREATH-TURN`, 'scene.turnStarted', true,
        )] },
        {
          do: 'attackReplacement', actor: 'subject', actionId: breath.id,
          targets: ['support'], factsByTarget: { support: { ...ENEMY_FACTS, distanceFt: 10 } },
          assertions: [
            { id: `${runtime.spec.id}:MECHANIC-BREATH-SAVE-OPEN`, type: 'pending', pendingType: 'target_save' },
            assertion(`${runtime.spec.id}:MECHANIC-BREATH-USES`, `actors.subject.runtime.resources.${usesKey}`, 1),
          ],
        },
        { do: 'checkpointReload', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-BREATH-CHECKPOINT`, type: 'pending', pendingType: 'target_save',
        }] },
        {
          do: 'resolveDecision', actor: 'support',
          roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] },
          assertions: [{
            id: `${runtime.spec.id}:MECHANIC-BREATH-SAVE`, type: 'event',
            match: { engineEventType: 'roll', actorId: 'support', roll: { kind: 'save', outcome: 'fail' } },
            exactly: 1,
          }],
        },
        { do: 'endTurn', actor: 'subject', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-BREATH-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
        { do: 'startTurn', actor: 'support', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-FIRE-PROBE-TURN`, 'scene.turnStarted', true,
        )] },
        {
          do: 'use', actor: 'support', actionId: FIRE_PROBE.id, actionKind: 'nonSpell',
          targets: ['subject'], factsByTarget: { subject: ENEMY_FACTS },
          assertions: [assertion(
            `${runtime.spec.id}:MECHANIC-FIRE-RESISTANCE`,
            'actors.subject.runtime.hp.current', hpBeforeFire - 5,
          )],
        },
        { do: 'endTurn', actor: 'support', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-FIRE-PROBE-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
      ],
    };
    spec = withRolls(spec, { suffix: [
      { label: 'Red Breath damage', sides: 10, value: 10 },
      { label: 'Red ancestry resistance probe', sides: 10, value: 10 },
    ] });
    const provider = extendCompiledRuntimeProvider({
      foundation: runtime,
      support: (actor) => addCapability(actor, FIRE_PROBE.id),
      actions: [FIRE_PROBE],
    });
    const run = runCompiledRuntimeScenario({ foundation: runtime, spec, provider });

    expect(breath.attackReplacement).toEqual({
      replacementKey: 'dragonborn:breath-weapon', replacesAttacks: 1,
      totalAttacks: 1, oncePerAttackAction: true,
    });
    const declaration = actionDeclaration(run.events, breath.id);
    expect(declaration.payload).toMatchObject({
      type: 'ActionDeclared',
      facts: {
        attackEntryOrdinal: 1,
        authoritativeAttacksPerAction: 1,
        replacementPolicy: { replacesAttacks: 1, oncePerAttackAction: true },
      },
    });
    expect(Object.values(run.finalState.attackActions)).toContainEqual(expect.objectContaining({
      actorId: 'subject', status: 'completed',
      sequence: expect.objectContaining({ attacksRemaining: 0 }),
    }));
    const fireAdjustment = required(engineEvents(run.events).find(({ event }) => (
      event.type === 'narrative'
        && event.damageAdjustment?.damageType === 'fire'
        && event.damageAdjustment.adjustment === 'resistance'
    )), 'Dragonborn fire resistance event');
    if (fireAdjustment.event.type !== 'narrative') throw new Error('Fire adjustment was not narrated');
    expect(fireAdjustment.event.damageAdjustment).toMatchObject({
      damageType: 'fire', before: 10, after: 5, adjustment: 'resistance',
      sourceEntityIds: expect.arrayContaining([
        dragonborn.assembled.subrace?.related_effects?.[0],
      ]),
    });
    expect(dragonborn.assembled.effects.map(({ effect }) => effect.card_number))
      .not.toContain('RE-dragonborn-4');
  });

  it('executes Alert initiative bonus and immediate swap inside one compiled two-PC chronology', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-RUNTIME-ALERT-01' },
  }, () => {
    const runtime = foundation(alert, 'alert-complete');
    const spec = initiativeSwapSpec(runtime);
    const run = runCompiledRuntimeScenario({ foundation: runtime, spec });
    if (run.finalState.scene.mode !== 'encounter') throw new Error('Alert chronology left encounter mode');
    expect(run.finalState.scene.initiativeSwapActorIds).toEqual(['subject']);
    const trace = required(run.events.find((event) => (
      event.payload.type === 'EngineEventRecorded'
        && event.obligationIds.includes('system:initiative-swap')
    )), 'Alert swap trace');
    expect(trace.obligationIds).toEqual(expect.arrayContaining([
      'entity:FEAT-0001', 'entity:EFF-alert',
    ]));
    const initiative = collectModifiers(
      run.finalState.actors.subject.runtime,
      run.finalState.actors.subject.passives ?? [],
      {
        roll: 'initiative',
        formulaCtx: { profBonus: run.finalState.actors.subject.character.profBonus },
      },
    );
    expect(initiative.modifiers).toEqual([{
      value: alert.actor.character.profBonus, source: 'Бонус мастерства',
    }]);
    expect(collectModifiers(
      run.finalState.actors.subject.runtime,
      run.finalState.actors.subject.passives ?? [],
      { roll: 'damage', formulaCtx: { profBonus: alert.actor.character.profBonus } },
    ).modifiers).toEqual([]);
  });

  it('casts Magic Initiate with its free use and then a slot inside one compiled two-PC chronology', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-RUNTIME-MAGIC-INITIATE-01' },
  }, () => {
    const runtime = foundation(magicInitiate, 'magic-initiate-complete');
    const falseLifeEntity = required(magicInitiate.assembled.spells.find((spell) => (
      spell.card_number === 'false_life'
    )), 'Magic Initiate False Life');
    const action = required(magicInitiate.rulesActions.find((candidate): candidate is Extract<
      RuleActionDefinition, { kind: 'spell' }
    > => candidate.kind === 'spell'
      && candidate.sourceEntityIds.includes(falseLifeEntity.id)
      && candidate.sourceEntityIds.includes(magicInitiate.matrixCase.originFeat.id)),
    'Magic Initiate False Life action');
    const grant = required(magicInitiate.actor.spellcastingAccess?.grants.find((candidate) => (
      candidate.actionId === action.id && candidate.sourceId === FEAT.magicInitiate
    )), 'Magic Initiate False Life grant');
    const freeUse = required(grant.freeUseResource, 'Magic Initiate free-use resource');
    const slotBefore = 1;
    let spec: ScenarioSpec = {
      ...runtime.spec,
      steps: [
        ...runtime.spec.steps,
        { do: 'startTurn', actor: 'subject', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-MI-FREE-TURN`, 'scene.turnStarted', true,
        )] },
        spellStep({
          id: `${runtime.spec.id}:MECHANIC-MI-FREE-CAST`, action,
          grantId: grant.grantId,
        }),
        { do: 'checkpointReload', assertions: [
          assertion(`${runtime.spec.id}:MECHANIC-MI-FREE-SPENT`, `actors.subject.runtime.resources.${freeUse}`, 0),
          assertion(`${runtime.spec.id}:MECHANIC-MI-SLOT-PRESERVED`, 'actors.subject.runtime.resources.spell_slot_1', slotBefore),
        ] },
        { do: 'endTurn', actor: 'subject', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-MI-FREE-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
        { do: 'startTurn', actor: 'support', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-MI-SUPPORT-TURN`, 'scene.turnStarted', true,
        )] },
        { do: 'endTurn', actor: 'support', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-MI-SUPPORT-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
        { do: 'startTurn', actor: 'subject', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-MI-SLOT-TURN`, 'scene.turnStarted', true,
        )] },
        spellStep({
          id: `${runtime.spec.id}:MECHANIC-MI-SLOT-CAST`, action,
          grantId: grant.grantId, preferFreeUse: false,
        }),
        { do: 'endTurn', actor: 'subject', assertions: [
          assertion(`${runtime.spec.id}:MECHANIC-MI-SLOT-SPENT`, 'actors.subject.runtime.resources.spell_slot_1', 0),
        ] },
      ],
    };
    spec = withRolls(spec, { suffix: [
      { label: 'Magic Initiate free False Life 1', sides: 4, value: 2 },
      { label: 'Magic Initiate free False Life 2', sides: 4, value: 3 },
      { label: 'Magic Initiate slot False Life 1', sides: 4, value: 4 },
      { label: 'Magic Initiate slot False Life 2', sides: 4, value: 4 },
    ] });
    const provider = extendCompiledRuntimeProvider({
      foundation: runtime,
      subject: (actor) => ({
        ...actor,
        runtime: {
          ...actor.runtime,
          resources: { ...actor.runtime.resources, spell_slot_1: slotBefore },
          maxResources: { ...actor.runtime.maxResources, spell_slot_1: slotBefore },
        },
      }),
    });
    const run = runCompiledRuntimeScenario({ foundation: runtime, spec, provider });
    expect(run.finalState.actors.subject.runtime.resources).toMatchObject({
      [freeUse]: 0, spell_slot_1: 0,
    });
    expect(run.finalState.actors.subject.runtime.hp.temp).toBe(12);
    const declarations = run.events.filter((event) => (
      event.payload.type === 'ActionDeclared' && event.payload.actionId === action.id
    ));
    expect(declarations).toHaveLength(2);
    expect(declarations.map((entry) => entry.payload.type === 'ActionDeclared'
      ? entry.payload.spell?.payment?.kind
      : undefined)).toEqual(['free_use', 'slot']);
  });

  it('uses all three Skilled selections in checks inside one compiled two-PC chronology', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-RUNTIME-SKILLED-01' },
  }, () => {
    const runtime = foundation(skilled, 'skilled-complete');
    const selected = decision(skilled, 'feat_skilled').optionIds.map((id) => {
      if (!id.startsWith('skill:')) throw new Error(`Skilled runtime probe is not a skill: ${id}`);
      return id.slice('skill:'.length);
    });
    let spec: ScenarioSpec = {
      ...runtime.spec,
      steps: [
        ...runtime.spec.steps,
        { do: 'startTurn', actor: 'subject', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-SKILLED-TURN`, 'scene.turnStarted', true,
        )] },
        ...selected.map((skill, index): ScenarioStep => ({
          do: 'abilityCheck', actor: 'subject',
          ability: skillAbility(skill, 'str'), skill, dc: 1,
          assertions: [{
            id: `${runtime.spec.id}:MECHANIC-SKILLED-CHECK-${index + 1}`,
            type: 'event', match: {
              engineEventType: 'roll', actorId: 'subject', roll: { kind: 'check', outcome: 'success' },
            }, exactly: 1,
          }],
        })),
        { do: 'endTurn', actor: 'subject', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-SKILLED-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
      ],
    };
    spec = withRolls(spec, { suffix: selected.map((skill, index) => ({
      label: `Skilled ${skill} ${index + 1}`, sides: 20, value: 10,
    })) });
    const run = runCompiledRuntimeScenario({ foundation: runtime, spec });
    for (const skill of selected) {
      const event = checkRollFor(run.events, skill);
      if (event.type !== 'roll') throw new Error(`${skill} did not roll`);
      expect(event.roll.modifiers).toContainEqual({
        value: skilled.actor.character.profBonus, source: 'БМ',
      });
    }
    expect(new Set(selected).size).toBe(3);
    expect(run.finalState.actors.subject.character.skillProficiencies)
      .toEqual(expect.arrayContaining(selected));
  });

  it('applies Archery only to ranged weapon attacks inside one compiled two-PC chronology', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-RUNTIME-ARCHERY-01' },
  }, () => {
    const runtime = foundation(archery, 'archery-complete');
    const handCrossbow = required(catalogs.cards.find((card) => (
      card.card_number === 'CARD-0306'
    )), 'profiled shortbow') as Card;
    const dagger = required(catalogs.cards.find((card) => (
      card.card_number === 'CARD-0297'
    )), 'profiled dagger') as Card;
    let spec: ScenarioSpec = {
      ...runtime.spec,
      steps: [
        ...runtime.spec.steps,
        { do: 'startTurn', actor: 'subject', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-ARCHERY-RANGED-TURN`, 'scene.turnStarted', true,
        )] },
        { do: 'beginAttack', actor: 'subject', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-ARCHERY-RANGED-BEGIN`, type: 'event',
          match: { payloadType: 'ActionDeclared', actorId: 'subject', payloadSubset: { actionId: 'core.action.attack' } },
          exactly: 1,
        }] },
        {
          do: 'weaponAttack', actor: 'subject', weaponCardId: handCrossbow.id,
          target: 'support', facts: { ...ENEMY_FACTS, targetCanSeeSource: false },
          assertions: [{
            id: `${runtime.spec.id}:MECHANIC-ARCHERY-RANGED-HIT`, type: 'event',
            match: { engineEventType: 'roll', actorId: 'subject', roll: { kind: 'd20', outcome: 'hit' } },
            exactly: 1,
          }],
        },
        { do: 'resolveReaction', actor: 'support', actionId: null, assertions: [{
          id: `${runtime.spec.id}:MECHANIC-ARCHERY-RANGED-REACTION`,
          type: 'pending', pendingType: null,
        }] },
        { do: 'endTurn', actor: 'subject', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-ARCHERY-RANGED-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
        { do: 'startTurn', actor: 'support', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-ARCHERY-SUPPORT-TURN`, 'scene.turnStarted', true,
        )] },
        { do: 'endTurn', actor: 'support', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-ARCHERY-SUPPORT-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
        { do: 'startTurn', actor: 'subject', assertions: [assertion(
          `${runtime.spec.id}:MECHANIC-ARCHERY-MELEE-TURN`, 'scene.turnStarted', true,
        )] },
        { do: 'beginAttack', actor: 'subject', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-ARCHERY-MELEE-BEGIN`, type: 'event',
          match: { payloadType: 'ActionDeclared', actorId: 'subject', payloadSubset: { actionId: 'core.action.attack' } },
          exactly: 1,
        }] },
        {
          do: 'weaponAttack', actor: 'subject', weaponCardId: dagger.id,
          target: 'support', facts: { ...ENEMY_FACTS, distanceFt: 5 },
          assertions: [{
            id: `${runtime.spec.id}:MECHANIC-ARCHERY-MELEE-HIT`, type: 'event',
            match: { engineEventType: 'roll', actorId: 'subject', roll: { kind: 'd20', outcome: 'hit' } },
            exactly: 1,
          }],
        },
        { do: 'resolveReaction', actor: 'support', actionId: null, assertions: [{
          id: `${runtime.spec.id}:MECHANIC-ARCHERY-MELEE-REACTION`,
          type: 'pending', pendingType: null,
        }] },
        { do: 'endTurn', actor: 'subject', assertions: [{
          id: `${runtime.spec.id}:MECHANIC-ARCHERY-MELEE-END`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }] },
      ],
    };
    spec = withRolls(spec, { suffix: [
      { label: 'Archery ranged attack', sides: 20, value: 15 },
      { label: 'Archery ranged attack advantage', sides: 20, value: 14 },
      { label: 'Archery ranged damage', sides: 6, value: 2 },
      { label: 'Archery melee attack', sides: 20, value: 15 },
      { label: 'Archery melee damage', sides: 4, value: 2 },
    ] });
    const provider = extendCompiledRuntimeProvider({
      foundation: runtime,
      subject: (actor) => withEquippedWeapons(actor, handCrossbow, dagger),
    });
    const run = runCompiledRuntimeScenario({ foundation: runtime, spec, provider });
    const weaponDeclarationIndex = (weaponCardId: string) => run.events.findIndex((entry) => (
      entry.payload.type === 'ActionDeclared'
        && (entry.payload.facts as JsonRecord | undefined)?.weaponCardId === weaponCardId
    ));
    const rangedDeclarationIndex = weaponDeclarationIndex(handCrossbow.id);
    const meleeDeclarationIndex = weaponDeclarationIndex(dagger.id);
    expect(rangedDeclarationIndex).toBeGreaterThanOrEqual(0);
    expect(meleeDeclarationIndex).toBeGreaterThan(rangedDeclarationIndex);
    const rangedEvents = engineEvents(run.events.slice(
      rangedDeclarationIndex + 1,
      meleeDeclarationIndex,
    ));
    const meleeEvents = engineEvents(run.events.slice(meleeDeclarationIndex + 1));
    const rangedAttack = required(rangedEvents.find(({ event }) => (
      event.type === 'roll' && event.roll.kind === 'd20'
    )), 'Archery ranged attack roll');
    const rangedDamage = required(rangedEvents.find(({ event }) => event.type === 'damage'), 'ranged damage');
    const meleeAttack = required(meleeEvents.find(({ event }) => (
      event.type === 'roll' && event.roll.kind === 'd20'
    )), 'Archery melee attack roll');
    if (rangedAttack.event.type !== 'roll' || meleeAttack.event.type !== 'roll') {
      throw new Error('Weapon attacks did not roll');
    }
    expect(rangedAttack.event.roll.modifiers).toContainEqual({
      value: 2, source: 'Fighting Style: Archery',
    });
    expect(meleeAttack.event.roll.modifiers.some((modifier) => (
      modifier.source === 'Fighting Style: Archery'
    ))).toBe(false);
    if (rangedDamage.event.type !== 'damage') throw new Error('Ranged attack did not deal damage');
    expect(rangedDamage.event.roll?.modifiers.some((modifier) => (
      modifier.source === 'Fighting Style: Archery'
    ))).toBe(false);
  });

  it('applies Defense only after armor is donned inside one compiled two-PC chronology', {
    timeout: 60_000,
    meta: { semanticProtocol: 'mandatory-two-pc-v1', scenarioId: 'SC-RUNTIME-DEFENSE-01' },
  }, () => {
    const runtime = foundation(defense, 'defense-complete');
    const leather = required(
      catalogs.cards.find((card) => card.card_number === 'CARD-0249'),
      'CARD-0249 leather armor',
    ) as Card;
    const spec: ScenarioSpec = {
      ...runtime.spec,
      steps: [
        {
          do: 'donArmor', actor: 'subject', armorCardId: leather.id,
          assertions: [
            assertion(`${runtime.spec.id}:MECHANIC-DEFENSE-DON`, 'actors.subject.runtime.equipment.body', leather.id),
            {
              id: `${runtime.spec.id}:MECHANIC-DEFENSE-EVENT`, type: 'event',
              match: {
                payloadType: 'EquipmentChanged', actorId: 'subject',
                payloadSubset: { operation: 'don_armor', cardId: leather.id },
              }, exactly: 1,
            },
          ],
        },
        ...runtime.spec.steps,
      ],
    };
    const provider = extendCompiledRuntimeProvider({
      foundation: runtime,
      subject: (actor) => ({
        ...actor,
        character: {
          ...actor.character,
          equippedCards: [],
          knownCards: [leather],
        },
        runtime: {
          ...actor.runtime,
          equipment: {},
          inventory: [{ cardId: leather.id, qty: 1 }],
        },
      }),
    });
    const run = runCompiledRuntimeScenario({ foundation: runtime, spec, provider });
    const initial = run.initialState.actors.subject;
    const armored = run.finalState.actors.subject;
    const defensePassive = (armored.passives ?? []).filter((passive) => passive.id === 'fs_defense');
    expect(defensePassive).toHaveLength(1);
    expect(
      armorClassValue(initial.character, initial.runtime, initial.passives ?? []).value
        - armorClassValue(initial.character, initial.runtime, []).value,
    ).toBe(0);
    expect(
      armorClassValue(armored.character, armored.runtime, armored.passives ?? []).value
        - armorClassValue(armored.character, armored.runtime, []).value,
    ).toBe(1);
    expect(armored.runtime.equipment.body).toBe(leather.id);
  });
});
