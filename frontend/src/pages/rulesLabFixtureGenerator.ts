import { createHash } from 'node:crypto';
import {
  open,
  readFile,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  compileMicroMvpL1ChoiceVariants,
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Root,
} from '../canon/microMvpL1Overlay';
import { readProdSnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import { replacePreparedSpells } from '../rules-core/spellcastingAccess';

type JsonObject = Record<string, unknown>;

export const RULES_LAB_FIXTURE_SCHEMA_VERSION = 5 as const;
export const RULES_LAB_GENERATED_FIXTURE_VERSION = '5.0.0' as const;
export const RULES_LAB_FIGHTER_ROOT_KEY =
  'class.fighter|species.human|background.soldier|feat.alert' as const;
export const RULES_LAB_WIZARD_ROOT_KEY =
  'class.wizard|species.human|background.soldier|feat.alert' as const;
export const RULES_LAB_WEAPON_CARD_NUMBER = 'CARD-0298' as const;
export const RULES_LAB_WIZARD_SPELL_CARD_NUMBER = 'SPELL-0171' as const;
export const RULES_LAB_FIND_FAMILIAR_CARD_NUMBER = 'SPELL-0241' as const;
export const RULES_LAB_CHILL_TOUCH_CARD_NUMBER = 'chill_touch' as const;
export const RULES_LAB_SHIELD_CARD_NUMBER = 'SPELL-0317' as const;
export const RULES_LAB_TOME_CANTRIP_CARD_NUMBER = 'fire_bolt' as const;
export const RULES_LAB_CHAIN_FAMILIAR_ACTION_ID = 'mm2025.owl.talons' as const;
export const RULES_LAB_GENERATED_ARTIFACT_PATH = fileURLToPath(
  new URL('./rulesLabFixture.generated.json', import.meta.url),
);

function required<T>(value: T | undefined, description: string): T {
  if (value === undefined) throw new Error(`Cannot generate Rules Lab fixture: missing ${description}`);
  return value;
}

function actionBySpellCard(
  root: CompiledMicroMvpL1Root,
  spellCardNumber: string,
): RuleActionDefinition {
  const entity = required(
    root.assembled.spells.find((spell) => spell.card_number === spellCardNumber),
    `${root.stableKey} spell ${spellCardNumber}`,
  );
  return required(
    root.rulesActions.find((action) => (
      action.kind === 'spell' && action.sourceEntityIds.includes(entity.id)
    )),
    `${root.stableKey} compiled action for ${spellCardNumber}`,
  );
}

function grantIdForAction(actor: ActorState, actionId: string): string {
  return required(
    actor.spellcastingAccess?.grants.find((grant) => grant.actionId === actionId)?.grantId,
    `${actor.id} spell grant for ${actionId}`,
  );
}

function withPreparedWizardActions(
  root: CompiledMicroMvpL1Root,
  requiredActionIds: readonly string[],
): CompiledMicroMvpL1Root {
  const actor = JSON.parse(JSON.stringify(root.actor)) as ActorState;
  const access = required(actor.spellcastingAccess, `${root.stableKey} Wizard spell access`);
  const source = required(access.preparedSources['CLASS-wizard'], 'Wizard prepared source');
  const selected = [
    ...requiredActionIds,
    ...source.preparedActionIds.filter((id) => !requiredActionIds.includes(id)),
    ...source.availableActionIds.filter((id) => (
      !requiredActionIds.includes(id) && !source.preparedActionIds.includes(id)
    )),
  ].slice(0, source.capacity);
  const replaced = replacePreparedSpells(access, 'CLASS-wizard', selected);
  if ('status' in replaced) {
    throw new Error(`Cannot generate Rules Lab Wizard preparation: ${replaced.message}`);
  }
  return { ...root, actor: { ...root.actor, spellcastingAccess: replaced } };
}

/** Build the checked-in browser fixture from the authoritative pinned compiler inputs. */
export async function buildRulesLabFixtureArtifact(): Promise<JsonObject> {
  const provider = await compileMicroMvpL1Overlay();
  const catalogs = readProdSnapshotCatalogs();
  const fighterRoot = required(
    provider.roots.find((root) => root.stableKey === RULES_LAB_FIGHTER_ROOT_KEY),
    `compiled Fighter root ${RULES_LAB_FIGHTER_ROOT_KEY}`,
  );
  const wizardRoot = required(
    provider.roots.find((root) => root.stableKey === RULES_LAB_WIZARD_ROOT_KEY),
    `compiled Wizard root ${RULES_LAB_WIZARD_ROOT_KEY}`,
  );
  const warlockRoot = required(
    provider.roots.find((root) => root.matrixCase.klass.card_number === 'CLASS-warlock'),
    'compiled Warlock root',
  );
  const spellEntityId = (cardNumber: string): string => required(
    catalogs.spells.find((spell) => spell.card_number === cardNumber)?.id,
    `snapshot spell ${cardNumber}`,
  );
  const [bladeRoot, chainRoot, tomeRoot, rawFamiliarWizardRoot] = await compileMicroMvpL1ChoiceVariants([
    {
      stableKey: warlockRoot.stableKey,
      overrides: { warlock_invocation_l1: ['EFF-pact-blade'] },
    },
    {
      stableKey: warlockRoot.stableKey,
      overrides: { warlock_invocation_l1: ['EFF-pact-chain'] },
    },
    {
      stableKey: warlockRoot.stableKey,
      overrides: {
        warlock_invocation_l1: ['EFF-pact-tome'],
        pact_tome_cantrips: ['fire_bolt', 'light', 'SPELL-0230'],
        pact_tome_rituals: ['SPELL-0236', 'SPELL-0252'],
      },
    },
    {
      stableKey: wizardRoot.stableKey,
      overrides: {
        wizard_cantrips: ['fire_bolt', 'SPELL-0218', RULES_LAB_CHILL_TOUCH_CARD_NUMBER],
        wizard_spellbook_level_1: [
          RULES_LAB_FIND_FAMILIAR_CARD_NUMBER,
          'detect_magic',
          'SPELL-0174',
          'SPELL-0242',
          RULES_LAB_SHIELD_CARD_NUMBER,
          'SPELL-0190',
        ].map(spellEntityId),
      },
    },
  ]);
  const rawFindFamiliarAction = actionBySpellCard(
    rawFamiliarWizardRoot,
    RULES_LAB_FIND_FAMILIAR_CARD_NUMBER,
  );
  const rawShieldAction = actionBySpellCard(rawFamiliarWizardRoot, RULES_LAB_SHIELD_CARD_NUMBER);
  const familiarWizardRoot = withPreparedWizardActions(
    rawFamiliarWizardRoot,
    [rawFindFamiliarAction.id, rawShieldAction.id],
  );
  const findFamiliarAction = actionBySpellCard(
    familiarWizardRoot,
    RULES_LAB_FIND_FAMILIAR_CARD_NUMBER,
  );
  const chillTouchAction = actionBySpellCard(
    familiarWizardRoot,
    RULES_LAB_CHILL_TOUCH_CARD_NUMBER,
  );
  const shieldAction = actionBySpellCard(familiarWizardRoot, RULES_LAB_SHIELD_CARD_NUMBER);
  const chainFindFamiliarAction = actionBySpellCard(chainRoot, RULES_LAB_FIND_FAMILIAR_CARD_NUMBER);
  const tomeCantripAction = actionBySpellCard(tomeRoot, RULES_LAB_TOME_CANTRIP_CARD_NUMBER);
  const weaponCardId = required(
    catalogs.cards.find((card) => card.card_number === RULES_LAB_WEAPON_CARD_NUMBER)?.id,
    `snapshot card ${RULES_LAB_WEAPON_CARD_NUMBER}`,
  );
  const weaponCard = required(
    provider.catalog.getCard?.(weaponCardId),
    `materialized overlay card ${RULES_LAB_WEAPON_CARD_NUMBER}`,
  );
  const wizardSpell = required(
    catalogs.spells.find((spell) => spell.card_number === RULES_LAB_WIZARD_SPELL_CARD_NUMBER),
    `snapshot spell ${RULES_LAB_WIZARD_SPELL_CARD_NUMBER}`,
  );
  const wizardAction = required(
    wizardRoot.rulesActions.find((action) => (
      action.kind === 'spell' && action.sourceEntityIds.includes(wizardSpell.id)
    )),
    `compiled Wizard action granted by ${wizardSpell.card_number}`,
  );

  return {
    schemaVersion: RULES_LAB_FIXTURE_SCHEMA_VERSION,
    fixtureVersion: RULES_LAB_GENERATED_FIXTURE_VERSION,
    source: {
      ruleset: provider.ruleset,
      release: provider.release,
      rootStableKeys: {
        fighter: RULES_LAB_FIGHTER_ROOT_KEY,
        wizard: RULES_LAB_WIZARD_ROOT_KEY,
        warlock: warlockRoot.stableKey,
      },
      weaponCardNumber: RULES_LAB_WEAPON_CARD_NUMBER,
      wizardSpellEntityId: wizardSpell.id,
    },
    roots: {
      fighter: {
        stableKey: fighterRoot.stableKey,
        fixtureId: fighterRoot.fixtureId,
        // The exact compiler input lets browser acceptance exercise the real
        // Character Forge before opening the matching canonical actor root.
        draft: fighterRoot.draft,
        actor: fighterRoot.actor,
        actions: fighterRoot.rulesActions,
      },
      wizard: {
        stableKey: wizardRoot.stableKey,
        fixtureId: wizardRoot.fixtureId,
        draft: wizardRoot.draft,
        actor: wizardRoot.actor,
        actions: wizardRoot.rulesActions,
      },
      blade: {
        stableKey: bladeRoot.stableKey,
        fixtureId: bladeRoot.fixtureId,
        actor: bladeRoot.actor,
        actions: bladeRoot.rulesActions,
        initialWorldObjects: bladeRoot.initialWorldObjects,
      },
      chain: {
        stableKey: chainRoot.stableKey,
        fixtureId: chainRoot.fixtureId,
        actor: chainRoot.actor,
        actions: chainRoot.rulesActions,
        initialWorldObjects: chainRoot.initialWorldObjects,
      },
      tome: {
        stableKey: tomeRoot.stableKey,
        fixtureId: tomeRoot.fixtureId,
        actor: tomeRoot.actor,
        actions: tomeRoot.rulesActions,
        initialWorldObjects: tomeRoot.initialWorldObjects,
      },
      familiarWizard: {
        stableKey: familiarWizardRoot.stableKey,
        fixtureId: familiarWizardRoot.fixtureId,
        actor: familiarWizardRoot.actor,
        actions: familiarWizardRoot.rulesActions,
        initialWorldObjects: familiarWizardRoot.initialWorldObjects,
      },
    },
    weaponCard,
    execution: {
      actorIds: { fighter: 'fighter', wizard: 'wizard' },
      fighterWeaponCardId: weaponCard.id,
      wizardActionId: wizardAction.id,
      scenarios: {
        blade: {
          bondActionId: required(bladeRoot.actor.warlockPacts?.blade?.bondActionId, 'Pact Blade bond action'),
          weaponCardId: weaponCard.id,
          defenderShieldActionId: shieldAction.id,
          defenderShieldGrantId: grantIdForAction(familiarWizardRoot.actor, shieldAction.id),
        },
        chain: {
          findFamiliarActionId: chainFindFamiliarAction.id,
          findFamiliarGrantId: grantIdForAction(chainRoot.actor, chainFindFamiliarAction.id),
          familiarActionId: RULES_LAB_CHAIN_FAMILIAR_ACTION_ID,
        },
        tome: {
          initialBookObjectId: required(tomeRoot.actor.warlockPacts?.tome?.tome.bookObjectId, 'Pact Tome book'),
          cantripActionId: tomeCantripAction.id,
          cantripActionIds: required(tomeRoot.actor.warlockPacts?.tome?.tome.cantripActionIds, 'Pact Tome cantrips'),
          ritualActionIds: required(tomeRoot.actor.warlockPacts?.tome?.tome.ritualActionIds, 'Pact Tome rituals'),
        },
        familiar: {
          findFamiliarActionId: findFamiliarAction.id,
          findFamiliarGrantId: grantIdForAction(familiarWizardRoot.actor, findFamiliarAction.id),
          chillTouchActionId: chillTouchAction.id,
          chillTouchGrantId: grantIdForAction(familiarWizardRoot.actor, chillTouchAction.id),
          shieldActionId: shieldAction.id,
          shieldGrantId: grantIdForAction(familiarWizardRoot.actor, shieldAction.id),
        },
      },
    },
  };
}

export function serializeRulesLabFixtureArtifact(artifact: JsonObject): string {
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

export function rulesLabFixtureSha256(serialized: string): string {
  return `sha256:${createHash('sha256').update(serialized).digest('hex')}`;
}

export interface RulesLabFixtureDriftResult {
  matches: boolean;
  expected: string;
  actual: string | null;
  expectedHash: string;
  actualHash: string | null;
}

/** Pure dry-run comparison when expected bytes are supplied by the caller. */
export async function checkRulesLabFixtureDrift(
  artifactPath = RULES_LAB_GENERATED_ARTIFACT_PATH,
  expected?: string,
): Promise<RulesLabFixtureDriftResult> {
  const rendered = expected ?? serializeRulesLabFixtureArtifact(
    await buildRulesLabFixtureArtifact(),
  );
  let actual: string | null = null;
  try {
    actual = await readFile(artifactPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return {
    matches: actual === rendered,
    expected: rendered,
    actual,
    expectedHash: rulesLabFixtureSha256(rendered),
    actualHash: actual === null ? null : rulesLabFixtureSha256(actual),
  };
}

let temporaryFileOrdinal = 0;

/** Write fully flushed bytes to a sibling file, then atomically replace the artifact. */
export async function writeRulesLabFixtureAtomically(
  serialized: string,
  artifactPath = RULES_LAB_GENERATED_ARTIFACT_PATH,
): Promise<void> {
  const directory = dirname(artifactPath);
  const temporaryPath = join(
    directory,
    `.${basename(artifactPath)}.${process.pid}.${temporaryFileOrdinal += 1}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporaryPath, 'wx', 0o644);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, artifactPath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
  }
}

export async function generateRulesLabFixture(
  artifactPath = RULES_LAB_GENERATED_ARTIFACT_PATH,
): Promise<{ artifactPath: string; hash: string; bytes: number }> {
  const serialized = serializeRulesLabFixtureArtifact(await buildRulesLabFixtureArtifact());
  await writeRulesLabFixtureAtomically(serialized, artifactPath);
  return {
    artifactPath,
    hash: rulesLabFixtureSha256(serialized),
    bytes: Buffer.byteLength(serialized),
  };
}
