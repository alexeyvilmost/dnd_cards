import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { compileMicroMvpL1Overlay } from '../canon/microMvpL1Overlay';
import { readProdSnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import { SYSTEM_ACTION_IDS } from '../rules-core/systemActions';
import artifact from './rulesLabFixture.generated.json';
import {
  buildRulesLabFixtureArtifact,
  checkRulesLabFixtureDrift,
  generateRulesLabFixture,
  RULES_LAB_FIGHTER_ROOT_KEY,
  RULES_LAB_GENERATED_ARTIFACT_PATH,
  RULES_LAB_WEAPON_CARD_NUMBER,
  RULES_LAB_WIZARD_ROOT_KEY,
  rulesLabFixtureSha256,
  serializeRulesLabFixtureArtifact,
} from './rulesLabFixtureGenerator';

describe('checked-in Rules Lab compiled artifact', () => {
  it('is byte-semantic equal to its stable real overlay roots and pinned snapshot bindings', async () => {
    const provider = await compileMicroMvpL1Overlay();
    const fighterRoot = provider.roots.find(
      (root) => root.stableKey === RULES_LAB_FIGHTER_ROOT_KEY,
    );
    const wizardRoot = provider.roots.find(
      (root) => root.stableKey === RULES_LAB_WIZARD_ROOT_KEY,
    );
    const snapshotWeaponCard = readProdSnapshotCatalogs().cards.find(
      (card) => card.card_number === RULES_LAB_WEAPON_CARD_NUMBER,
    );
    const weaponCard = snapshotWeaponCard
      ? provider.catalog.getCard?.(snapshotWeaponCard.id)
      : undefined;

    expect(fighterRoot).toBeDefined();
    expect(wizardRoot).toBeDefined();
    expect(snapshotWeaponCard).toBeDefined();
    expect(snapshotWeaponCard?.mechanics).toMatchObject({
      weapon_profile: {
        weapon_type: 'mace',
        attack_ability: 'str',
        damage_lines: [{ dice: '1d6', type: 'bludgeoning' }],
        default_attack_mode: 'melee',
      },
    });
    expect(weaponCard?.mechanics).toMatchObject({
      weapon_profile: {
        weapon_type: 'mace',
        attack_ability: 'str',
        damage_lines: [{ dice: '1d6', type: 'bludgeoning' }],
        default_attack_mode: 'melee',
      },
    });
    expect(artifact.schemaVersion).toBe(5);
    expect(artifact.fixtureVersion).toBe('5.0.0');
    expect(artifact.source.ruleset).toEqual(provider.ruleset);
    expect(artifact.source.release).toEqual(provider.release);
    expect(artifact.source.rootStableKeys).toMatchObject({
      fighter: RULES_LAB_FIGHTER_ROOT_KEY,
      wizard: RULES_LAB_WIZARD_ROOT_KEY,
    });
    expect(artifact.roots.fighter).toEqual({
      stableKey: fighterRoot!.stableKey,
      fixtureId: fighterRoot!.fixtureId,
      draft: fighterRoot!.draft,
      actor: fighterRoot!.actor,
      actions: fighterRoot!.rulesActions,
    });
    expect(artifact.roots.wizard).toEqual({
      stableKey: wizardRoot!.stableKey,
      fixtureId: wizardRoot!.fixtureId,
      draft: wizardRoot!.draft,
      actor: wizardRoot!.actor,
      actions: wizardRoot!.rulesActions,
    });

    expect(artifact.weaponCard).toEqual(weaponCard);
    expect(artifact.execution.fighterWeaponCardId).toBe(weaponCard!.id);
    expect(Object.keys(artifact.execution.scenarios).sort())
      .toEqual(['blade', 'chain', 'familiar', 'tome']);
    expect(artifact.roots.blade.actor.warlockPacts?.blade?.bondActionId)
      .toBe(artifact.execution.scenarios.blade.bondActionId);
    expect(artifact.roots.chain.actor.warlockPacts?.chain?.template.findFamiliarActionId)
      .toBe(artifact.execution.scenarios.chain.findFamiliarActionId);
    expect(artifact.roots.tome.actor.warlockPacts?.tome?.tome.bookObjectId)
      .toBe(artifact.execution.scenarios.tome.initialBookObjectId);
    expect(artifact.execution.scenarios.tome.cantripActionIds).toHaveLength(3);
    expect(artifact.execution.scenarios.tome.ritualActionIds).toHaveLength(2);
    expect(artifact).not.toHaveProperty('systemWeaponAction');
    expect(artifact.source).not.toHaveProperty('systemWeaponActionCardNumber');
  });

  it('uses a real Wizard save spell and an equipped weapon outside the Fighter mastery selection', () => {
    const wizardAction = artifact.roots.wizard.actions.find(
      (action) => action.id === artifact.execution.wizardActionId,
    );
    const saveEffects = wizardAction?.mechanics.effects.filter(
      (effect) => effect.resolution === 'save',
    );

    expect(wizardAction).toMatchObject({
      name: 'Волна грома',
      kind: 'spell',
      spell: { level: 1, sourceClass: 'CLASS-wizard' },
      mechanics: { primitive: { type: 'area_object_push' } },
    });
    expect(saveEffects).toEqual([
      expect.objectContaining({ ability: 'con', who: 'target' }),
    ]);
    expect(wizardAction?.sourceEntityIds).toContain(artifact.source.wizardSpellEntityId);
    expect(SYSTEM_ACTION_IDS).toMatchObject({
      attack: 'core.action.attack',
      weaponAttack: 'core.attack.weapon',
    });
    expect(artifact.roots.fighter.actor.character.weaponMasteries).not.toContain(
      artifact.weaponCard.weapon_type,
    );
    expect(wizardAction?.targeting).toEqual({
      minTargets: 0,
      maxTargets: 8,
      rangeFt: 15,
      requiresLineOfSight: false,
      allowedRelations: ['ally', 'enemy', 'neutral'],
    });
  });

  it('renders deterministic bytes and detects drift without mutating the checked-in artifact', async () => {
    const firstRender = serializeRulesLabFixtureArtifact(
      await buildRulesLabFixtureArtifact(),
    );
    const secondRender = serializeRulesLabFixtureArtifact(
      await buildRulesLabFixtureArtifact(),
    );
    const checkedInBefore = await readFile(RULES_LAB_GENERATED_ARTIFACT_PATH, 'utf8');

    expect(secondRender).toBe(firstRender);
    const current = await checkRulesLabFixtureDrift(
      RULES_LAB_GENERATED_ARTIFACT_PATH,
      firstRender,
    );
    expect(current).toMatchObject({
      matches: true,
      expectedHash: rulesLabFixtureSha256(firstRender),
      actualHash: rulesLabFixtureSha256(firstRender),
    });
    expect(await readFile(RULES_LAB_GENERATED_ARTIFACT_PATH, 'utf8')).toBe(checkedInBefore);

    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'rules-lab-fixture-'));
    try {
      const temporaryArtifact = join(temporaryDirectory, 'fixture.json');
      await writeFile(temporaryArtifact, `${firstRender}stale\n`, 'utf8');

      const stale = await checkRulesLabFixtureDrift(temporaryArtifact, firstRender);
      expect(stale.matches).toBe(false);
      expect(stale.actualHash).not.toBe(stale.expectedHash);

      const generated = await generateRulesLabFixture(temporaryArtifact);
      expect(await readFile(temporaryArtifact, 'utf8')).toBe(firstRender);
      expect(generated).toMatchObject({
        artifactPath: temporaryArtifact,
        hash: rulesLabFixtureSha256(firstRender),
      });
      expect(await readdir(temporaryDirectory)).toEqual(['fixture.json']);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 30_000);
});
