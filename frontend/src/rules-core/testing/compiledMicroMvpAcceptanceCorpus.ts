import {
  compileMicroMvpL1Overlay,
  compileMicroMvpL1ChoiceVariants,
  type CompiledMicroMvpL1Provider,
  type CompiledMicroMvpL1Root,
} from '../../canon/microMvpL1Overlay';
import {
  readMicroMvpSnapshotManifest,
  readProdSnapshotCatalogs,
  type MicroMvpSnapshotManifest,
  type SnapshotCatalogs,
} from '../../canon/prodSnapshotL1Fixtures';
import {
  canonicalStringify,
  createLogicalClock,
  createSequentialIdFactory,
} from '../determinism';
import type { RuleActionDefinition, SpatialFacts } from '../domain';
import type { SpellGrantAccess } from '../spellcastingAccess';
import { buildMicroMvpSpellScopePolicy } from '../microMvpSpellScope';
import {
  createCompiledMicroMvpScenarioFixtureProvider,
  type CompiledMicroMvpScenarioFixtureProvider,
} from './compiledMicroMvpScenarioAdapter';
import { runScenario, type ScenarioRun, type ScenarioSpec } from './scenario';

const WIZARD_CLASS_CARD_NUMBER = 'CLASS-wizard';
const THUNDERWAVE_CARD_NUMBER = 'SPELL-0171';

export const COMPILED_MICRO_MVP_COMMON_TRACE = [
  'nonSpellAction',
  'castSpell',
  'applyCondition',
  'savingThrow',
  'abilityCheck',
] as const;

export type CompiledMicroMvpBuildAxis =
  | 'species'
  | 'class'
  | 'background'
  | 'originFeat'
  | 'lineage'
  | 'selectedSpell'
  | 'selectedInvocation'
  | 'fightingStyle';

export interface CompiledMicroMvpBuildClaim {
  axis: CompiledMicroMvpBuildAxis;
  entityId: string;
  cardNumber: string;
  assertionId: string;
  statePath: string;
}

type CompiledMicroMvpSourceAxis = Exclude<
  CompiledMicroMvpBuildAxis,
  'selectedSpell' | 'selectedInvocation' | 'fightingStyle'
>;

export interface CompiledMicroMvpAcceptanceCase {
  id: string;
  subject: CompiledMicroMvpL1Root;
  support: CompiledMicroMvpL1Root;
  provider: CompiledMicroMvpScenarioFixtureProvider;
  spec: ScenarioSpec;
  buildClaims: readonly CompiledMicroMvpBuildClaim[];
}

export interface CompiledMicroMvpAcceptanceCorpus {
  compiled: CompiledMicroMvpL1Provider;
  cases: readonly CompiledMicroMvpAcceptanceCase[];
  requiredBuildKeys: readonly string[];
}

interface PreparedThunderwave {
  root: CompiledMicroMvpL1Root;
  action: Extract<RuleActionDefinition, { kind: 'spell' }>;
  grant: SpellGrantAccess;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function claimKey(claim: Pick<CompiledMicroMvpBuildClaim, 'axis' | 'entityId'>): string {
  return `${claim.axis}:${claim.entityId}`;
}

function buildClaims(root: CompiledMicroMvpL1Root): CompiledMicroMvpBuildClaim[] {
  const sources: Array<[
    CompiledMicroMvpSourceAxis,
    { id: string; card_number: string } | undefined,
  ]> = [
    ['species', root.matrixCase.species],
    ['class', root.matrixCase.klass],
    ['background', root.matrixCase.background],
    ['originFeat', root.matrixCase.originFeat],
    ['lineage', root.assembled.subrace ?? undefined],
  ];
  const entityClaims = sources.flatMap(([axis, source]) => source ? [{
    axis,
    entityId: source.id,
    cardNumber: source.card_number,
    assertionId: `COMPILED-BUILD-${axis.toUpperCase()}-${slug(source.id)}`,
    statePath: sourceAssertionPath(axis),
  }] : []);
  const selectedSpellIds = [...root.selectedSpellIds].sort();
  const spellClaims: CompiledMicroMvpBuildClaim[] = selectedSpellIds.map((entityId, index) => {
    const spell = root.assembled.spells.find((candidate) => candidate.id === entityId);
    return {
      axis: 'selectedSpell', entityId,
      cardNumber: spell?.card_number ?? entityId,
      assertionId: `COMPILED-BUILD-SELECTED-SPELL-${slug(entityId)}`,
      statePath: `actors.subject.compiledSource.selectedSpellIds.${index}`,
    };
  });
  const selectedInvocationIds = [...root.selectedInvocationEffectIds].sort();
  const invocationClaims: CompiledMicroMvpBuildClaim[] = selectedInvocationIds.map((entityId, index) => {
    const effect = root.assembled.effects.find((candidate) => candidate.effect.id === entityId)?.effect;
    return {
      axis: 'selectedInvocation', entityId,
      cardNumber: effect?.card_number ?? entityId,
      assertionId: `COMPILED-BUILD-SELECTED-INVOCATION-${slug(entityId)}`,
      statePath: `actors.subject.compiledSource.selectedInvocationEffectIds.${index}`,
    };
  });
  const styleDecisionIndex = root.decisions.findIndex((decision) => (
    decision.choiceId.endsWith(':fighter_fighting_style')
  ));
  const styleId = styleDecisionIndex < 0 ? undefined : root.decisions[styleDecisionIndex].optionIds[0];
  const style = styleId
    ? root.assembled.feats.find((candidate) => candidate.id === styleId)
    : undefined;
  const styleClaim: CompiledMicroMvpBuildClaim[] = styleId ? [{
    axis: 'fightingStyle', entityId: styleId, cardNumber: style?.card_number ?? styleId,
    assertionId: `COMPILED-BUILD-FIGHTING-STYLE-${slug(styleId)}`,
    statePath: `actors.subject.choices.${styleDecisionIndex}.optionIds.0`,
  }] : [];
  return [...entityClaims, ...spellClaims, ...invocationClaims, ...styleClaim];
}

function releaseEntries(manifest: MicroMvpSnapshotManifest): Array<{
  cardNumber: string;
  collection: string;
}> {
  return Object.entries(manifest.collections)
    .flatMap(([collection, entries]) => entries.map((entry) => ({
      cardNumber: entry.selector.cardNumber,
      collection,
    })))
    .filter((entry): entry is { cardNumber: string; collection: string } => (
      typeof entry.cardNumber === 'string' && entry.cardNumber.trim().length > 0
    ))
    .sort((left, right) => left.cardNumber.localeCompare(right.cardNumber));
}

function selectedDecision(root: CompiledMicroMvpL1Root, choiceId: string) {
  return root.decisions.find((decision) => decision.choiceId.endsWith(`:${choiceId}`));
}

/**
 * Default character choices are not an independent release denominator: a
 * legal spell or Fighting Style can be present in the pinned manifest without
 * being selected by any default root. Compile one deterministic focused root
 * for every such option so the corpus cannot silently omit a release entity.
 */
async function compileMissingReleaseVariants(input: {
  compiled: CompiledMicroMvpL1Provider;
  manifest: MicroMvpSnapshotManifest;
  catalogs: SnapshotCatalogs;
}): Promise<readonly CompiledMicroMvpL1Root[]> {
  const coveredCards = new Set(input.compiled.roots.flatMap((root) => (
    buildClaims(root).map((claim) => claim.cardNumber)
  )));
  const missingEntries = releaseEntries(input.manifest)
    .filter((entry) => !coveredCards.has(entry.cardNumber));
  if (missingEntries.length === 0) return [];

  const policy = buildMicroMvpSpellScopePolicy({
    manifest: input.manifest,
    snapshotSpells: input.catalogs.spells,
  });
  const curatedByCard = new Map(policy.spells.map((spell) => [spell.cardNumber, spell]));
  const choices = Object.values(policy.choices).sort((left, right) => left.id.localeCompare(right.id));
  const roots = [...input.compiled.roots].sort((left, right) => left.stableKey.localeCompare(right.stableKey));
  const fightingStyleIds = new Set(input.manifest.collections.fightingStyles.map((entry) => {
    const feat = input.catalogs.feats.find((candidate) => (
      candidate.card_number === entry.selector.cardNumber
    ));
    if (!feat) throw new Error(`Compiled release corpus cannot resolve ${entry.selector.cardNumber}`);
    return feat.id;
  }));

  const requests = missingEntries.map(({ cardNumber, collection }) => {
    const spell = curatedByCard.get(cardNumber);
    if (!spell && collection === 'fightingStyles') {
      const feat = input.catalogs.feats.find((candidate) => candidate.card_number === cardNumber);
      if (!feat) throw new Error(`Compiled release corpus cannot resolve ${cardNumber}`);
      const candidate = roots.flatMap((root) => root.decisions.map((decision) => ({
        root,
        decision,
      }))).find(({ decision }) => (
        decision.optionIds.some((optionId) => fightingStyleIds.has(optionId))
      ));
      if (!candidate) {
        throw new Error(`Compiled release corpus has no Fighting Style choice for ${cardNumber}`);
      }
      const choiceId = candidate.decision.choiceId.split(':').at(-1)!;
      return {
        stableKey: candidate.root.stableKey,
        overrides: { [choiceId]: [feat.id] },
      };
    }
    if (!spell) throw new Error(`Compiled release corpus cannot materialize ${cardNumber}`);
    const candidate = choices.flatMap((choice) => (
      choice.spellIds.includes(spell.id)
        ? roots.flatMap((root) => {
          const decision = selectedDecision(root, choice.id);
          return decision ? [{ choice, root, decision }] : [];
        })
        : []
    ))[0];
    if (!candidate) {
      throw new Error(`Compiled release corpus has no legal choice for ${cardNumber}`);
    }
    const optionIds = [
      spell.id,
      ...candidate.decision.optionIds.filter((optionId) => optionId !== spell.id),
    ].slice(0, candidate.choice.count);
    if (optionIds.length !== candidate.choice.count) {
      throw new Error(`Compiled release choice ${candidate.choice.id} cannot select ${cardNumber}`);
    }
    return {
      stableKey: candidate.root.stableKey,
      overrides: { [candidate.choice.id]: optionIds },
    };
  });
  const variants = await compileMicroMvpL1ChoiceVariants(requests);
  const coveredWithVariants = new Set([
    ...coveredCards,
    ...variants.flatMap((root) => buildClaims(root).map((claim) => claim.cardNumber)),
  ]);
  const unresolved = releaseEntries(input.manifest)
    .map((entry) => entry.cardNumber)
    .filter((cardNumber) => !coveredWithVariants.has(cardNumber));
  if (unresolved.length) {
    throw new Error(`Compiled release corpus cannot cover manifest cards: ${unresolved.join(', ')}`);
  }
  return variants;
}

function selectBuildCover(roots: readonly CompiledMicroMvpL1Root[]): {
  roots: CompiledMicroMvpL1Root[];
  requiredKeys: string[];
} {
  const ordered = [...roots].sort((left, right) => left.stableKey.localeCompare(right.stableKey));
  const required = new Set(ordered.flatMap((root) => buildClaims(root).map(claimKey)));
  const uncovered = new Set(required);
  const selected: CompiledMicroMvpL1Root[] = [];

  while (uncovered.size) {
    const best = ordered
      .filter((root) => !selected.includes(root))
      .map((root) => ({
        root,
        covered: buildClaims(root).map(claimKey).filter((key) => uncovered.has(key)),
      }))
      .sort((left, right) => (
        right.covered.length - left.covered.length
          || left.root.stableKey.localeCompare(right.root.stableKey)
      ))[0];
    if (!best || best.covered.length === 0) {
      throw new Error(`Compiled build cover cannot satisfy: ${[...uncovered].sort().join(', ')}`);
    }
    selected.push(best.root);
    best.covered.forEach((key) => uncovered.delete(key));
  }
  return { roots: selected, requiredKeys: [...required].sort() };
}

function preparedThunderwave(compiled: CompiledMicroMvpL1Provider): PreparedThunderwave {
  for (const root of [...compiled.roots].sort((left, right) => left.stableKey.localeCompare(right.stableKey))) {
    if (root.matrixCase.klass.card_number !== WIZARD_CLASS_CARD_NUMBER) continue;
    const spell = root.assembled.spells.find((candidate) => (
      candidate.card_number === THUNDERWAVE_CARD_NUMBER
    ));
    if (!spell) continue;
    const action = root.rulesActions.find((candidate): candidate is Extract<
      RuleActionDefinition,
      { kind: 'spell' }
    > => candidate.kind === 'spell' && candidate.sourceEntityIds.includes(spell.id));
    if (!action) continue;
    const grant = root.actor.spellcastingAccess?.grants.find((candidate) => (
      candidate.actionId === action.id
        && root.actor.spellcastingAccess?.preparedSources[candidate.sourceId]
          ?.preparedActionIds.includes(action.id) === true
    ));
    if (grant) return { root, action, grant };
  }
  throw new Error('No compiled micro-MVP Wizard has a prepared Thunderwave grant');
}

function distinctPreparedThunderwave(
  compiled: CompiledMicroMvpL1Provider,
  excludedFixtureId: string,
): PreparedThunderwave {
  for (const root of [...compiled.roots].sort((left, right) => left.stableKey.localeCompare(right.stableKey))) {
    if (root.fixtureId === excludedFixtureId) continue;
    try {
      return preparedThunderwave({ ...compiled, roots: [root] });
    } catch {
      // This root is not a Wizard with prepared Thunderwave.
    }
  }
  throw new Error(`No distinct compiled Thunderwave support actor for ${excludedFixtureId}`);
}

const enemyInArea: SpatialFacts = {
  factsSource: 'scenario',
  boardRevision: 1,
  distanceFt: 5,
  lineOfSight: true,
  cover: 'none',
  relation: 'enemy',
};

function sourceAssertionPath(axis: CompiledMicroMvpSourceAxis): string {
  return axis === 'lineage'
    ? 'actors.subject.compiledSource.entities.lineage.id'
    : `actors.subject.compiledSource.entities.${axis}.id`;
}

function scenarioFor(
  index: number,
  compiled: CompiledMicroMvpL1Provider,
  subject: CompiledMicroMvpL1Root,
  thunderwave: PreparedThunderwave,
  idPrefix = 'compiled-acceptance',
): CompiledMicroMvpAcceptanceCase {
  const supportSpell = thunderwave.root.fixtureId === subject.fixtureId
    ? distinctPreparedThunderwave(compiled, subject.fixtureId)
    : thunderwave;
  const support = supportSpell.root;
  const provider = createCompiledMicroMvpScenarioFixtureProvider(
    { ...compiled, roots: [subject, support] },
    { fixtureIds: [subject.fixtureId, support.fixtureId] },
  );
  const claims = buildClaims(subject);
  const id = `${idPrefix}-${String(index + 1).padStart(2, '0')}-${slug(subject.stableKey)}`;
  const hpBefore = subject.actor.runtime.hp.current;
  const slotBefore = support.actor.runtime.resources.spell_slot_1;
  const expectedDamage = 5;
  const spec: ScenarioSpec = {
    schemaVersion: 1,
    id,
    ruleset: provider.ruleset,
    actors: {
      subject: { fixtureId: subject.fixtureId },
      support: { fixtureId: support.fixtureId },
    },
    initiative: ['subject', 'support'],
    autoStartEncounter: false,
    rollTape: [
      { label: `${id}: Hide check`, sides: 20, value: 20 },
      { label: `${id}: ability check`, sides: 20, value: 10 },
      { label: `${id}: Thunderwave damage 1`, sides: 8, value: 2 },
      { label: `${id}: Thunderwave damage 2`, sides: 8, value: 3 },
    ],
    steps: [
      {
        do: 'startEncounter', actor: 'subject', assertions: [{
          id: `${id}:TWO-PC-INITIATIVE`, type: 'equals',
          path: 'scene.initiative', value: ['subject', 'support'],
        }],
      },
      {
        do: 'startTurn', actor: 'subject', assertions: [
          {
            id: `${id}:SUBJECT-COMPILED-ROOT`, type: 'equals',
            path: 'actors.subject.compiledSource.stableKey', value: subject.stableKey,
          },
          ...claims.map((claim) => ({
            id: claim.assertionId,
            type: 'equals' as const,
            path: claim.statePath,
            value: claim.entityId,
          })),
        ],
      },
      {
        do: 'hide', actor: 'subject', eligibility: {
          factsSource: 'scenario', boardRevision: 1, heavilyObscured: true,
          cover: 'three_quarters', visibleToAnyEnemy: false,
        }, assertions: [
          {
            id: `${id}:NONSPELL-ACTION`, type: 'event',
            match: {
              payloadType: 'ActionDeclared', sourceActorId: 'subject', actorId: 'subject',
              payloadSubset: { actionId: 'core.action.hide', actionKind: 'nonSpell' },
            }, exactly: 1,
          },
          {
            id: `${id}:CONDITION-APPLIED`, type: 'condition',
            actor: 'subject', condition: 'invisible', present: true,
          },
        ],
      },
      {
        do: 'abilityCheck', actor: 'subject', ability: 'str', dc: 1, assertions: [{
          id: `${id}:ABILITY-CHECK`, type: 'event',
          match: {
            engineEventType: 'roll', actorId: 'subject',
            includesObligationIds: ['system:ability-check'],
            roll: { kind: 'check', outcome: 'success' },
          }, exactly: 1,
        }],
      },
      {
        do: 'endTurn', actor: 'subject', assertions: [{
          id: `${id}:SUBJECT-ENDS-TURN`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }],
      },
      {
        do: 'checkpointReload', assertions: [{
          id: `${id}:BUILD-SURVIVES-CHECKPOINT`, type: 'equals',
          path: 'actors.subject.compiledSource.stableKey', value: subject.stableKey,
        }],
      },
      {
        do: 'startTurn', actor: 'support', assertions: [{
          id: `${id}:SUPPORT-COMPILED-ROOT`, type: 'equals',
          path: 'actors.support.compiledSource.stableKey', value: support.stableKey,
        }],
      },
      {
        do: 'use', actor: 'support', actionId: supportSpell.action.id, actionKind: 'spell',
        targets: ['subject'], factsByTarget: { subject: enemyInArea },
        spell: { baseLevel: 1, grantId: supportSpell.grant.grantId, mode: 'normal' },
        worldInput: { type: 'area_objects', factsByObject: {} },
        assertions: [
          {
            id: `${id}:CROSS-PC-SPELL`, type: 'event',
            match: {
              payloadType: 'ActionDeclared', sourceActorId: 'support', actorId: 'support',
              targetIds: ['subject'],
              payloadSubset: {
                actionId: supportSpell.action.id,
                actionKind: 'spell',
                spell: {
                  grantId: supportSpell.grant.grantId,
                  sourceId: supportSpell.grant.sourceId,
                },
              },
            }, exactly: 1,
          },
          {
            id: `${id}:SAVE-WINDOW`, type: 'pending', pendingType: 'target_save',
          },
          {
            id: `${id}:SOURCE-SLOT-SPENT`, type: 'equals',
            path: 'actors.support.runtime.resources.spell_slot_1', value: slotBefore - 1,
          },
        ],
      },
      {
        do: 'checkpointReload', assertions: [
          { id: `${id}:SAVE-SURVIVES-CHECKPOINT`, type: 'pending', pendingType: 'target_save' },
          {
            id: `${id}:GRANT-SURVIVES-CHECKPOINT`, type: 'equals',
            path: 'pendingResolution.spell.grantId', value: supportSpell.grant.grantId,
          },
        ],
      },
      {
        do: 'resolveDecision', actor: 'subject',
        roll: { mode: 'manual', dice: [{ sides: 20, value: 1 }] },
        assertions: [
          {
            id: `${id}:SAVING-THROW`, type: 'event',
            match: {
              engineEventType: 'roll', actorId: 'subject',
              includesObligationIds: [`entity:${supportSpell.action.id}`, 'system:target-save'],
              roll: { kind: 'save', outcome: 'fail' },
            }, exactly: 1,
          },
          {
            id: `${id}:CROSS-PC-DAMAGE`, type: 'equals',
            path: 'actors.subject.runtime.hp.current', value: Math.max(0, hpBefore - expectedDamage),
          },
        ],
      },
      {
        do: 'endTurn', actor: 'support', assertions: [{
          id: `${id}:SUPPORT-ENDS-TURN`, type: 'event', eventType: 'turn_ended', exactly: 1,
        }],
      },
    ],
    requiredTrace: [...COMPILED_MICRO_MVP_COMMON_TRACE],
  };
  return { id, subject, support, provider, spec, buildClaims: claims };
}

function providerWithFocusedRoot(
  compiled: CompiledMicroMvpL1Provider,
  subject: CompiledMicroMvpL1Root,
): CompiledMicroMvpL1Provider {
  const current = compiled.roots.find((root) => root.fixtureId === subject.fixtureId);
  if (current === subject) return compiled;
  if (current && canonicalStringify(current) !== canonicalStringify(subject)) {
    throw new Error(`Focused compiled root ${subject.fixtureId} conflicts with the release corpus`);
  }
  const roots = current ? [...compiled.roots] : [...compiled.roots, subject];
  const actions = new Map(subject.rulesActions.map((action) => [action.id, action]));
  const byId = new Map(roots.map((root) => [root.fixtureId, root]));
  return {
    ...compiled,
    roots,
    catalog: {
      getAction: (id) => actions.get(id) ?? compiled.catalog.getAction(id),
    },
    getRoot: (fixtureId) => byId.get(fixtureId),
    getActor: (fixtureId) => byId.get(fixtureId)?.actor,
    getInitialWorldObjects: (fixtureId) => byId.get(fixtureId)?.initialWorldObjects,
  };
}

/**
 * Reuses the exact common two-PC acceptance trace for any real 448-root or a
 * focused choice variant compiled from one of those roots. The focused root is
 * validated by the same scenario adapter and release catalog contract.
 */
export function createCompiledMicroMvpAcceptanceCaseForRoot(
  corpus: CompiledMicroMvpAcceptanceCorpus,
  subject: CompiledMicroMvpL1Root,
  options: { index: number; idPrefix?: string },
): CompiledMicroMvpAcceptanceCase {
  const compiled = providerWithFocusedRoot(corpus.compiled, subject);
  return scenarioFor(
    options.index,
    compiled,
    subject,
    preparedThunderwave(corpus.compiled),
    options.idPrefix ?? 'compiled-semantic',
  );
}

/**
 * Compiles production roots first, then chooses a deterministic minimal set
 * covering every currently compiled build axis. No scenario actor or action is
 * hand-authored by the corpus.
 */
export async function compileMicroMvpAcceptanceCorpus(): Promise<CompiledMicroMvpAcceptanceCorpus> {
  const [compiled, manifest, catalogs] = await Promise.all([
    compileMicroMvpL1Overlay(),
    readMicroMvpSnapshotManifest(),
    Promise.resolve(readProdSnapshotCatalogs()),
  ]);
  const focusedVariants = await compileMissingReleaseVariants({ compiled, manifest, catalogs });
  const cover = selectBuildCover([...compiled.roots, ...focusedVariants]);
  const thunderwave = preparedThunderwave(compiled);
  const cases = cover.roots.map((root, index) => scenarioFor(
    index,
    providerWithFocusedRoot(compiled, root),
    root,
    thunderwave,
  ));
  return { compiled, cases, requiredBuildKeys: cover.requiredKeys };
}

export function runCompiledMicroMvpAcceptanceCase(
  scenario: CompiledMicroMvpAcceptanceCase,
): ScenarioRun {
  return runScenario(scenario.spec, scenario.provider, {
    clock: createLogicalClock(90_000),
    nextId: createSequentialIdFactory(`compiled-corpus:${scenario.id}`),
  });
}
