import { describe, expect, it } from 'vitest';
import contentPatch from '../canon/data/micro-mvp-l1-content-patch.v1.json';
import compiledFixture from '../pages/rulesLabFixture.generated.json';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import type { CharacterContext } from '../mvp/contracts';
import type { Action, Card, CharacterClass, PassiveEffect, Spell } from '../types';
import { collectChoices, type ChoiceOrigin } from '../mechanics/collectChoices';
import { collectSheetPrimitiveChoices } from './sheetActionOrchestrator';
import { collectSheetActions, type SheetAction } from './actionSheet';
import type { AssembledCharacter } from './assemble';
import {
  buildSheetCanonicalRuntime,
  projectSheetCanonicalPersistence,
  readSheetCanonicalWorld,
  writeSheetCanonicalWorld,
} from './sheetCanonicalWorld';
import { FIND_FAMILIAR_MATERIAL_RESOURCE } from '../rules-core/familiarRuntime';
import { SHEET_SPELL_CAST_CHOICE } from './sheetSpellCastingUi';
import { sourceKey } from '../mechanics/choiceKey';
import type { CharacterRuleState } from './rules/types';
import { resolveSpellAccess } from '../rules-core/spellcastingAccess';
import { emptyDraft } from './types';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import { bindEquippedWeaponAmmoCost } from '../engine/weapon';
import { pay } from '../engine/cost';
import { withDeclaredTestWeaponProfile } from '../testing/weaponProfileFixtures';

type PatchRow = {
  entityId: string;
  cardNumber: string;
  mechanics: Record<string, unknown>;
};

const effectPatches = contentPatch.mechanicsPatches.effects as PatchRow[];
const actionPatches = contentPatch.mechanicsPatches.actions as PatchRow[];
const spellPatches = contentPatch.mechanicsPatches.spells as PatchRow[];
const generated = compiledFixture as unknown as {
  roots: Record<string, {
    actor: ActorState;
    actions: RuleActionDefinition[];
    initialWorldObjects: unknown[];
  }>;
  execution: {
    scenarios: {
      chain: { findFamiliarActionId: string };
    };
  };
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function patchEffect(cardNumber: string): PassiveEffect {
  const row = effectPatches.find((candidate) => candidate.cardNumber === cardNumber);
  if (!row) throw new Error(`Missing content patch ${cardNumber}`);
  return {
    id: row.entityId,
    card_number: row.cardNumber,
    name: row.cardNumber,
    description: row.cardNumber,
    rarity: 'common',
    effect_type: 'class_ability',
    mechanics: clone(row.mechanics),
    created_at: '',
    updated_at: '',
  };
}

function patchAction(cardNumber: string): Action {
  const row = actionPatches.find((candidate) => candidate.cardNumber === cardNumber);
  if (!row) throw new Error(`Missing content patch ${cardNumber}`);
  return {
    id: row.entityId,
    card_number: row.cardNumber,
    name: cardNumber,
    description: cardNumber,
    rarity: 'common',
    resource: 'action',
    action_type: 'base_action',
    type: 'basic',
    mechanics: clone(row.mechanics),
    created_at: '',
    updated_at: '',
  };
}

function spellFromAction(action: RuleActionDefinition): Spell {
  if (action.kind !== 'spell') throw new Error(`${action.id} is not a spell`);
  const entityId = action.sourceEntityIds[0];
  const patch = spellPatches.find((candidate) => candidate.entityId === entityId);
  return {
    id: entityId,
    card_number: patch?.cardNumber ?? entityId,
    name: action.name,
    description: action.name,
    rarity: 'common',
    level: action.spell.level,
    component_verbal: action.spell.components?.verbal ?? false,
    component_somatic: action.spell.components?.somatic ?? false,
    component_material: action.spell.components?.material ?? false,
    classes: [...(action.spell.classListIds ?? [])],
    concentration: action.concentration === true,
    ritual: action.spell.ritual === true,
    is_healing: false,
    // The generated fixture is intentionally regenerated only once after all
    // parallel changes have frozen.  Until then, materialize this local sheet
    // fixture from the current production-data patch so strict targeting does
    // not inherit legacy/defaulted fields from the previous generated release.
    mechanics: clone(patch?.mechanics ?? action.mechanics),
    created_at: '',
    updated_at: '',
  };
}

function sheetSpell(action: RuleActionDefinition): SheetAction {
  const spell = spellFromAction(action);
  return {
    id: action.id,
    name: action.name,
    mechanics: clone(spell.mechanics ?? action.mechanics),
    group: 'spell',
    spellRef: spell,
    sourceEntityIds: [...action.sourceEntityIds] as [string, ...string[]],
  };
}

function warlockClass(): CharacterClass {
  return {
    id: 'class-entity:warlock',
    card_number: 'CLASS-warlock',
    name: 'Warlock',
    description: '',
    rarity: 'common',
    created_at: '',
    updated_at: '',
  };
}

function wizardClass(): CharacterClass {
  return {
    id: 'd3b22b24-a4f1-4dab-8038-c89bfee62843',
    card_number: 'CLASS-wizard',
    name: 'Переименованный волшебник',
    description: '',
    rarity: 'common',
    created_at: '',
    updated_at: '',
  };
}

function assembled(input: {
  effect: PassiveEffect;
  spells?: Spell[];
  pendingChoices?: ReturnType<typeof collectChoices>;
}): AssembledCharacter {
  return {
    klass: warlockClass(),
    effects: [{
      effect: input.effect,
      origin: { kind: 'class', id: 'class-entity:warlock', name: 'Warlock' },
    }],
    spells: input.spells ?? [],
    pendingChoices: input.pendingChoices ?? [],
    race: null,
    background: null,
    feats: [],
    actions: [],
    resources: [],
    featAbilityIncreases: [],
    variables: {},
    derived: {
      proficiencyBonus: 2,
      maxHP: 10,
      initiative: 0,
      ac: 10,
      speed: 30,
      abilityMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 3 },
      spellcasting: null,
    },
  } as unknown as AssembledCharacter;
}

function character(
  actorId: string,
  resolvedChoices: Record<string, string[]> = {},
  currency?: Record<string, number>,
) {
  return {
    id: actorId,
    name: actorId,
    system_id: 'dnd5e-2024',
    ruleset_version: '2024',
    turn_state: null,
    resolved_choices: resolvedChoices,
    ...(currency ? { currency } : {}),
  };
}

function spellRuleState(
  effect: PassiveEffect,
  spells: readonly Spell[],
  labels: Readonly<Record<string, string | undefined>> = {},
): Pick<CharacterRuleState, 'appliedGrants'> {
  const sourceId = sourceKey('class', 'class-entity:warlock', effect.id);
  return {
    appliedGrants: spells.map((spell, index) => ({
      id: `grant:${index}:${spell.id}`,
      source: {
        type: 'class',
        id: sourceId,
        name: `Warlock: ${effect.name}`,
        originEntityId: 'class-entity:warlock',
        featureEntityId: effect.id,
      },
      kind: 'spell',
      value: spell.id,
      mode: 'proficiency',
      spellcastingAbility: 'cha',
      ...(labels[spell.id] ? { label: labels[spell.id] } : {}),
    })),
  };
}

function wizardRuleState(
  effect: PassiveEffect,
  spells: readonly Spell[],
): Pick<CharacterRuleState, 'appliedGrants'> {
  const klass = wizardClass();
  const sourceId = sourceKey('class', klass.id, effect.id);
  return {
    appliedGrants: spells.map((spell, index) => ({
      id: `wizard-grant:${index}:${spell.id}`,
      source: {
        type: 'class',
        id: sourceId,
        name: `Display text is not identity: ${effect.name}`,
        originEntityId: klass.id,
        featureEntityId: effect.id,
      },
      kind: 'spell',
      value: spell.id,
      mode: 'proficiency',
      spellcastingAbility: 'int',
      label: spell.level === 0 ? 'cantrip' : 'spellbook',
    })),
  };
}

describe('real sheet canonical world materialization', () => {
  it('keeps bound ammunition in canonical activation.cost and pays it as an item', () => {
    const entity = patchAction('action_basic_weapon');
    const bow = withDeclaredTestWeaponProfile({
      id: 'card:bow', card_number: 'CARD-bow', name: 'Bow', type: 'weapon',
    } as unknown as Card, {
      weaponType: 'shortbow', proficiencyCategory: 'simple', attackAbility: 'dex',
      damageLines: [{ dice: '1d6', type: 'piercing' }],
      defaultAttackMode: 'ranged',
      attackModes: [{ kind: 'ranged', normal_ft: 80, long_ft: 320 }],
      properties: ['ammunition', 'two_handed'], masteryEffectId: 'effect:test:vex',
      ammo: { card_id: 'card:arrow', name: 'Arrows' },
    });
    const arrow = {
      id: 'card:arrow', card_number: 'CARD-arrow', name: 'Arrows', type: 'item',
    } as unknown as Card;
    const unrelatedCards = Array.from({ length: 790 }, (_, index) => ({
      id: `card:unrelated:${index}`,
      card_number: `CARD-unrelated-${index}`,
      name: `Unrelated ${index}`,
      description: 'x'.repeat(2_000),
      type: 'item',
    } as unknown as Card));
    const mechanics = bindEquippedWeaponAmmoCost(
      entity.mechanics as Record<string, unknown>,
      { main_hand: bow.id },
      new Map([[bow.id, bow], [arrow.id, arrow]]),
    );
    const sheetAction: SheetAction = {
      id: entity.id,
      name: entity.name,
      mechanics,
      group: 'basic',
      actionRef: entity,
      sourceEntityIds: [entity.id, entity.card_number],
    };
    const baseAssembly = assembled({ effect: patchEffect('EFF-pact-blade') });
    const runtime = {
      hp: { current: 10, max: 10, temp: 0 },
      resources: { action: 1 },
      maxResources: { action: 1 },
      equipment: { main_hand: bow.id },
      inventory: [{ cardId: arrow.id, qty: 2 }],
      activeEffects: [],
    };
    const passives = [{ activation: { mode: 'passive' }, source: 'archer-test' }];
    const built = buildSheetCanonicalRuntime({
      character: character('sheet-archer'),
      assembled: { ...baseAssembly, klass: null, effects: [] },
      ruleState: { appliedGrants: [] },
      sheetActions: [sheetAction],
      runtime,
      characterContext: {
        abilityMods: { str: 0, dex: 3, con: 1, int: 0, wis: 0, cha: 0 },
        profBonus: 2,
        level: 1,
        passives,
      } as CharacterContext,
      passives,
      cards: [bow, arrow, ...unrelatedCards],
      ac: 13,
    });
    const canonical = built.actionFor(sheetAction);
    const cost = (canonical.mechanics.activation as { cost: Record<string, unknown>[] }).cost;
    expect(cost).toEqual([
      { resource: 'action' },
      { resource: 'item', card_id: arrow.id, amount: 1, name: 'Arrows' },
    ]);
    const paid = pay(built.world.actors[built.actorId].runtime, cost);
    expect(paid.state.resources.action).toBe(0);
    expect(paid.state.inventory).toEqual([{ cardId: arrow.id, qty: 1 }]);
    expect(built.world.actors[built.actorId].character.knownCards?.map((card) => card.id).sort())
      .toEqual([arrow.id, bow.id].sort());
    expect((built.world.actors[built.actorId].character as CharacterContext & { passives?: unknown }).passives)
      .toBeUndefined();
    expect(built.world.actors[built.actorId].passives).toEqual(passives);
    expect(JSON.stringify(built.world).length).toBeLessThan(768 << 10);

    const persisted = writeSheetCanonicalWorld({}, built.actorId, built.world);
    const stale = clone(persisted);
    (stale.canonical_rules_world_v1 as Record<string, unknown>).rulesetContentHash =
      'sheet:previous-deployment';
    expect(readSheetCanonicalWorld(
      stale,
      built.actorId,
      built.world.ruleset.contentHash,
    )).toBeNull();
  });

  it('promotes an active class effect into a real sheet action with provenance', () => {
    const blade = patchEffect('EFF-pact-blade');
    const actions = collectSheetActions(assembled({ effect: blade }));
    expect(actions).toContainEqual(expect.objectContaining({
      id: blade.id,
      group: 'class',
      effectRef: blade,
      sourceEntityIds: expect.arrayContaining([
        blade.id,
        blade.card_number,
        'class-entity:warlock',
      ]),
    }));
  });

  it('materializes Pact Chain and its source-scoped at-will Find Familiar path from mechanics', () => {
    const chain = patchEffect('EFF-pact-chain');
    const root = clone(generated.roots.chain);
    const canonicalAction = root.actions.find((candidate) => (
      candidate.id === generated.execution.scenarios.chain.findFamiliarActionId
    ))!;
    const action = sheetSpell(canonicalAction);
    const actor = clone(root.actor);
    const sheetAssembly = assembled({ effect: chain, spells: [action.spellRef!] });
    const runtime = buildSheetCanonicalRuntime({
      character: character('sheet-chain', {}, { gold: 20 }),
      assembled: sheetAssembly,
      ruleState: spellRuleState(chain, [action.spellRef!]),
      sheetActions: [action],
      runtime: actor.runtime,
      characterContext: actor.character,
      cards: [],
      ac: actor.ac,
    });
    expect(runtime.resourceBindings).toEqual({
      [FIND_FAMILIAR_MATERIAL_RESOURCE]: { kind: 'currency', currency: 'gold' },
    });
    expect(runtime.world.actors[runtime.actorId].runtime.resources)
      .toMatchObject({ [FIND_FAMILIAR_MATERIAL_RESOURCE]: 20 });
    expect(runtime.world.actors[runtime.actorId].warlockPacts?.chain).toMatchObject({
      sourceEntityId: chain.id,
      template: { findFamiliarActionId: action.id },
      activeFamiliar: null,
    });
    expect(runtime.world.actors[runtime.actorId].spellcastingAccess?.grants).toContainEqual(
      expect.objectContaining({
        actionId: action.id,
        sourceId: chain.card_number,
        access: 'innate',
      }),
    );
    const choices = collectSheetPrimitiveChoices({ runtime, action: runtime.actionFor(action) });
    expect(choices.find((candidate) => candidate.id === 'find_familiar_form')?.items)
      .toContainEqual(expect.objectContaining({ id: 'imp' }));
    expect(choices.find((candidate) => candidate.id === SHEET_SPELL_CAST_CHOICE)?.items)
      .toContainEqual(expect.objectContaining({ id: expect.stringContaining('spell-grant:') }));
    expect(choices.some((candidate) => candidate.id === 'find_familiar_cast_path')).toBe(false);

    const spentWorld = clone(runtime.world);
    spentWorld.actors[runtime.actorId].runtime.resources[FIND_FAMILIAR_MATERIAL_RESOURCE] = 10;
    const projection = projectSheetCanonicalPersistence({
      runtime: spentWorld.actors[runtime.actorId].runtime,
      currency: { gold: 20.5 },
      resourceBindings: runtime.resourceBindings,
    });
    expect(projection.currency).toEqual({ gold: 10.5 });
    expect(projection.runtime.resources[FIND_FAMILIAR_MATERIAL_RESOURCE]).toBeUndefined();
    expect(projection.runtime.maxResources[FIND_FAMILIAR_MATERIAL_RESOURCE]).toBeUndefined();

    const persisted = writeSheetCanonicalWorld(
      {},
      runtime.actorId,
      spentWorld,
      runtime.resourceBindings,
    );
    const reloaded = buildSheetCanonicalRuntime({
      character: {
        ...character('sheet-chain', {}, projection.currency),
        turn_state: persisted,
        resources: projection.runtime.resources,
        max_resources: projection.runtime.maxResources,
      },
      assembled: sheetAssembly,
      ruleState: spellRuleState(chain, [action.spellRef!]),
      sheetActions: [action],
      runtime: projection.runtime,
      characterContext: actor.character,
      cards: [],
      ac: actor.ac,
    });
    expect(reloaded.resourceBindings).toEqual(runtime.resourceBindings);
    expect(reloaded.world.actors[reloaded.actorId].runtime.resources)
      .toMatchObject({ [FIND_FAMILIAR_MATERIAL_RESOURCE]: 10 });
  });

  it('materializes Pact Tome from the five resolved Forge choices and round-trips its book/grants', () => {
    const tome = patchEffect('EFF-pact-tome');
    const root = clone(generated.roots.tome);
    const compiledTome = root.actor.warlockPacts?.tome?.tome;
    if (!compiledTome) throw new Error('Generated Tome root has no compiled pact state');
    const selectedIds = [...compiledTome.cantripActionIds, ...compiledTome.ritualActionIds];
    const selectedActions = selectedIds.map((id) => {
      const action = root.actions.find((candidate) => candidate.id === id);
      if (!action) throw new Error(`Generated Tome action ${id} is missing`);
      return sheetSpell(action);
    });
    const origin: ChoiceOrigin = {
      kind: 'class',
      id: 'class-entity:warlock',
      name: 'Warlock',
      featureId: tome.id,
      featureName: tome.name,
    };
    const pending = collectChoices(tome.mechanics, origin);
    const cantripChoice = pending.find((candidate) => candidate.id.endsWith(':pact_tome_cantrips'))!;
    const ritualChoice = pending.find((candidate) => candidate.id.endsWith(':pact_tome_rituals'))!;
    const resolvedChoices = {
      [cantripChoice.id]: selectedActions.slice(0, 3).map((action) => action.spellRef!.id),
      [ritualChoice.id]: selectedActions.slice(3).map((action) => action.spellRef!.id),
    };
    const actor = root.actor;
    const runtime = buildSheetCanonicalRuntime({
      character: character('sheet-tome', resolvedChoices),
      assembled: assembled({
        effect: tome,
        spells: selectedActions.map((action) => action.spellRef!),
        pendingChoices: pending,
      }),
      ruleState: spellRuleState(tome, selectedActions.map((action) => action.spellRef!), Object.fromEntries(
        selectedActions.map((action) => [
          action.spellRef!.id,
          action.spellRef!.level === 0 ? 'cantrip' : 'prepared',
        ]),
      )),
      sheetActions: selectedActions,
      runtime: actor.runtime,
      characterContext: actor.character,
      cards: [] as Card[],
      ac: actor.ac,
    });
    const state = runtime.world.actors[runtime.actorId].warlockPacts?.tome?.tome;
    expect(state?.cantripActionIds).toEqual([...compiledTome.cantripActionIds].sort());
    expect(state?.ritualActionIds).toEqual([...compiledTome.ritualActionIds].sort());
    expect(runtime.world.objects[state!.bookObjectId]).toMatchObject({
      ownerActorId: runtime.actorId,
      tags: expect.arrayContaining(['book_of_shadows', 'spellcasting_focus']),
    });
    expect(runtime.world.actors[runtime.actorId].spellcastingAccess?.grants)
      .toHaveLength(5);

    const persisted = writeSheetCanonicalWorld({}, runtime.actorId, runtime.world);
    expect(readSheetCanonicalWorld(
      JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>,
      runtime.actorId,
      runtime.world.ruleset.contentHash,
    )).toEqual(runtime.world);
  });

  it('materializes and reloads the explicit Wizard spellbook/prepared subset without first-N defaults', () => {
    const spellcasting = patchEffect('EFF-wizard-spellcasting');
    const root = clone(generated.roots.wizard);
    const spellActions = root.actions.filter((candidate): candidate is Extract<
      RuleActionDefinition,
      { kind: 'spell' }
    > => candidate.kind === 'spell');
    const sheetActions = spellActions.map(sheetSpell);
    const spells = sheetActions.map((action) => action.spellRef!);
    const origin: ChoiceOrigin = {
      kind: 'class',
      id: wizardClass().id,
      name: 'Любое локализованное имя',
      featureId: spellcasting.id,
      featureName: spellcasting.name,
    };
    const initialChoices = collectChoices(spellcasting.mechanics, origin);
    const cantripChoice = initialChoices.find((choice) => choice.id.endsWith(':wizard_cantrips'))!;
    const bookChoice = initialChoices.find((choice) => choice.id.endsWith(':wizard_spellbook_level_1'))!;
    const cantrips = spells.filter((spell) => spell.level === 0).map((spell) => spell.id);
    const book = spells.filter((spell) => spell.level === 1).map((spell) => spell.id);
    const named = (fragment: string) => spells.find((spell) => (
      spell.name.toLowerCase().includes(fragment)
    ))!.id;
    const prepared = [
      named('огненные ладони'),
      named('волшебная стрела'),
      named('щит'),
      named('волна грома'),
    ];
    const resolvedChoices = {
      [cantripChoice.id]: cantrips,
      [bookChoice.id]: book,
    };
    const pendingChoices = collectChoices(spellcasting.mechanics, origin, resolvedChoices);
    const preparedChoice = pendingChoices.find((choice) => choice.source === 'prepared_spell')!;
    const persistedChoices = {
      ...resolvedChoices,
      [preparedChoice.id]: prepared,
    };
    const assembly = {
      ...assembled({ effect: spellcasting, spells, pendingChoices }),
      klass: wizardClass(),
      effects: [{ effect: spellcasting, origin: {
        kind: 'class' as const,
        id: wizardClass().id,
        name: 'Имя не участвует в identity',
      } }],
    };
    const draft = {
      ...emptyDraft(),
      classId: wizardClass().id,
      level: 1,
      abilities: { str: 10, dex: 14, con: 14, int: 15, wis: 12, cha: 10 },
      resolvedChoices: persistedChoices,
    };
    const resolvedRuleState = resolveCharacterRules({ draft, assembled: assembly });
    expect(resolvedRuleState.appliedGrants.filter((grant) => grant.kind === 'spell'))
      .toHaveLength(9);
    expect(resolvedRuleState.appliedGrants
      .filter((grant) => grant.kind === 'spell')
      .every((grant) => grant.spellcastingAbility === 'int')).toBe(true);
    const built = buildSheetCanonicalRuntime({
      character: character('sheet-wizard', persistedChoices),
      assembled: assembly,
      ruleState: resolvedRuleState,
      sheetActions,
      runtime: root.actor.runtime,
      characterContext: root.actor.character,
      cards: [],
      ac: root.actor.ac,
    });
    const actorAccess = built.world.actors[built.actorId].spellcastingAccess!;
    const source = actorAccess.preparedSources['CLASS-wizard']!;
    expect(source.capacity).toBe(4);
    expect(source.availableActionIds).toHaveLength(6);
    expect(source.preparedActionIds).toEqual(prepared.map((id) => `${id}@CLASS-wizard`).sort());
    for (const spellId of prepared) {
      expect(resolveSpellAccess({
        state: actorAccess,
        actionId: `${spellId}@CLASS-wizard`,
        resources: { spell_slot_1: 2 },
      })).toMatchObject({ status: 'allowed', payment: { kind: 'slot', resource: 'spell_slot_1' } });
    }

    const persisted = writeSheetCanonicalWorld({}, built.actorId, built.world);
    const reloaded = buildSheetCanonicalRuntime({
      character: {
        ...character('sheet-wizard', persistedChoices),
        turn_state: persisted,
      },
      assembled: assembly,
      ruleState: resolvedRuleState,
      sheetActions,
      runtime: root.actor.runtime,
      characterContext: root.actor.character,
      cards: [],
      ac: root.actor.ac,
    });
    expect(reloaded.world.actors[reloaded.actorId].spellcastingAccess?.preparedSources)
      .toEqual(actorAccess.preparedSources);
  });

  it('fails closed on missing, duplicate, and outside-book Wizard preparation', () => {
    const spellcasting = patchEffect('EFF-wizard-spellcasting');
    const root = clone(generated.roots.wizard);
    const sheetActions = root.actions
      .filter((candidate) => candidate.kind === 'spell')
      .map(sheetSpell);
    const spells = sheetActions.map((action) => action.spellRef!);
    const origin: ChoiceOrigin = {
      kind: 'class', id: wizardClass().id, name: 'Wizard', featureId: spellcasting.id,
    };
    const initial = collectChoices(spellcasting.mechanics, origin);
    const cantripChoice = initial.find((choice) => choice.id.endsWith(':wizard_cantrips'))!;
    const bookChoice = initial.find((choice) => choice.id.endsWith(':wizard_spellbook_level_1'))!;
    const cantrips = spells.filter((spell) => spell.level === 0).map((spell) => spell.id);
    const book = spells.filter((spell) => spell.level === 1).map((spell) => spell.id);
    const baseChoices = { [cantripChoice.id]: cantrips, [bookChoice.id]: book };
    const pendingChoices = collectChoices(spellcasting.mechanics, origin, baseChoices);
    const preparedChoice = pendingChoices.find((choice) => choice.source === 'prepared_spell')!;
    const assembly = {
      ...assembled({ effect: spellcasting, spells, pendingChoices }),
      klass: wizardClass(),
      effects: [{ effect: spellcasting, origin: {
        kind: 'class' as const, id: wizardClass().id, name: 'Wizard',
      } }],
    };
    const attempt = (selection: string[] | undefined) => buildSheetCanonicalRuntime({
      character: character('invalid-wizard', {
        ...baseChoices,
        ...(selection ? { [preparedChoice.id]: selection } : {}),
      }),
      assembled: assembly,
      ruleState: wizardRuleState(spellcasting, spells),
      sheetActions,
      runtime: root.actor.runtime,
      characterContext: root.actor.character,
      cards: [],
      ac: root.actor.ac,
    });
    expect(() => attempt(undefined)).toThrow(/Откройте редактирование персонажа/);
    expect(() => attempt([book[0], book[0], book[1], book[2]])).toThrow(/различны/);
    expect(() => attempt([book[0], book[1], book[2], cantrips[0]])).toThrow(/вне выбранной книги/);
    expect(() => attempt(book.slice(0, 3))).toThrow(/ровно 4/);
  });
});
