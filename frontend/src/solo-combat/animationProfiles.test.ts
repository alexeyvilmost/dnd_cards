import { afterEach, describe, expect, it } from 'vitest';
import seed from '../../../backend/animationpresentation/catalog.json';
import type { RuleActionDefinition } from '../rules-core/domain';
import type { SoloCombatState } from './types';
import { builtInAnimationCatalog, combatAnimationForOutcome, resolveActiveSpellCircles, resolveCombatAnimation, setCombatAnimationCatalog, type CombatAnimationProfile } from './animationProfiles';

const spell = (id = 'unrelated-spell', level = 0): RuleActionDefinition => ({id, name: 'Совсем другое название', kind: 'spell',
  sourceEntityIds: [id], spell: {entityId: id, level}, mechanics: {}});
const action = (id: string): RuleActionDefinition => ({id, name: 'Совсем другое название', kind: 'nonSpell', sourceEntityIds: [id], mechanics: {}});
afterEach(() => setCombatAnimationCatalog(builtInAnimationCatalog));

describe('entity-owned combat animation profiles', () => {
  it.each([
    {profileKey: 'spell.frost-ray', primitive: 'charged_beam'},
    {profileKey: 'spell.shocking-grasp', primitive: 'beam'},
    {profileKey: 'spell.fire-bolt', primitive: 'projectile'},
    {profileKey: 'spell.ice-knife', primitive: 'weapon_throw'},
  ])('selects a confirmed magic critical for $primitive from assigned $profileKey data', data => {
    const entity = spell(`unrelated-${data.primitive}`);
    const catalog = {...builtInAnimationCatalog, bindings: [{entity_type: 'spell', entity_id: entity.id, profile_key: data.profileKey}]};
    const base = resolveCombatAnimation(entity, {}, catalog);
    const before = JSON.stringify({entity, catalog});
    const critical = resolveCombatAnimation(entity, {outcome: 'crit', rollPhase: 'after-reaction'}, catalog);
    expect(critical).toMatchObject({key: catalog.defaults.criticalProfile![base.key], baseProfileKey: base.key,
      primitive: data.primitive, strikeStyle: 'critical', criticalEffect: 'magic', palette: base.palette, casterCircle: true});
    expect(critical.weaponShape).toBe(base.weaponShape);
    for (const outcome of [undefined, 'hit', 'miss', 'crit_miss'] as const) {
      expect(resolveCombatAnimation(entity, {outcome}, catalog)).toEqual(base);
    }
    expect(resolveCombatAnimation(entity, {outcome: 'crit', rollPhase: 'before-reaction'}, catalog)).toEqual(base);
    expect(combatAnimationForOutcome(base, {outcome: 'crit', damageType: 'force'}, catalog))
      .toMatchObject({key: critical.key, primitive: data.primitive, criticalEffect: 'magic',
        palette: catalog.profiles.find(profile => profile.key === 'spell.force')!.palette});
    expect(JSON.stringify({entity, catalog})).toBe(before);
  });
  it.each([
    {id: 'arbitrary-blade', primitive: 'melee_slash' as const},
    {id: 'unrelated-launcher', primitive: 'weapon_throw' as const, weaponShape: 'axe' as const},
  ])('selects $id critical delivery from an explicit mapping and only a confirmed outcome', data => {
    const base: CombatAnimationProfile = {key: data.id, primitive: data.primitive,
      palette: {primary: '#135790', secondary: '#abcdef'}, motion: {durationMs: 900, scale: 1}, casterCircle: false,
      ...('weaponShape' in data ? {weaponShape: data.weaponShape} : {})};
    const critical: CombatAnimationProfile = {...base, key: `${data.id}.strong`, strikeStyle: 'critical', baseProfileKey: base.key,
      palette: {primary: '#000000', secondary: '#ffffff'}, motion: {durationMs: 1400, scale: 1.4, launchRatio: .25, contactRatio: .48}};
    const catalog = {...builtInAnimationCatalog, profiles: [...builtInAnimationCatalog.profiles, base, critical],
      bindings: [{entity_type: 'action', entity_id: 'unrelated-entity', profile_key: base.key}],
      defaults: {...builtInAnimationCatalog.defaults, criticalProfile: {[base.key]: critical.key}}};
    const entity = action('unrelated-entity');
    expect(resolveCombatAnimation(entity, {outcome: 'crit'}, catalog)).toMatchObject({key: critical.key, strikeStyle: 'critical',
      primitive: base.primitive, palette: base.palette, motion: critical.motion});
    expect(resolveCombatAnimation(entity, {outcome: 'crit'}, catalog).weaponShape).toBe(base.weaponShape);
    for (const outcome of [undefined, 'hit', 'miss', 'crit_miss'] as const) {
      expect(resolveCombatAnimation(entity, {outcome}, catalog).key).toBe(base.key);
    }
    expect(resolveCombatAnimation(entity, {outcome: 'crit', rollPhase: 'before-reaction'}, catalog).key).toBe(base.key);
    expect(combatAnimationForOutcome(base, {outcome: 'crit', rollPhase: 'after-reaction', damageType: 'force'}, catalog))
      .toMatchObject({key: critical.key, primitive: base.primitive, palette: builtInAnimationCatalog.profiles.find(profile => profile.key === 'spell.force')!.palette});
  });
  it('resolves two unrelated entities entirely from metadata, including actor-scoped spell IDs', () => {
    const catalog = {...builtInAnimationCatalog, bindings: [
      {entity_type: 'spell', entity_id: 'arbitrary-cold-source', profile_key: 'spell.frost-ray'},
      {entity_type: 'action', entity_id: 'arbitrary-jaw-source', profile_key: 'natural.bite'},
    ]};
    const frost = {...spell('arbitrary-cold-source'), id: 'actor:private-slot'};
    expect(resolveCombatAnimation(frost, {}, catalog)).toMatchObject({primitive: 'charged_beam', motif: 'frost'});
    expect(resolveCombatAnimation(action('arbitrary-jaw-source'), {}, catalog)).toMatchObject({primitive: 'bite'});
    expect(resolveCombatAnimation({...action('derived-followup'), sourceEntityIds: ['arbitrary-cold-source']}, {}, catalog)).toMatchObject({primitive: 'charged_beam', motif: 'frost'});
    expect(resolveCombatAnimation({...frost, name: 'Переименованное заклинание'}, {}, catalog)).toEqual(resolveCombatAnimation(frost, {}, catalog));
  });

  it('lets the server replace or remove a presentation binding without changing mechanics', () => {
    const original = spell(seed.cantripCoverage[0].id);
    const serialized = JSON.stringify(original);
    setCombatAnimationCatalog({...builtInAnimationCatalog, bindings: [{entity_type: 'spell', entity_id: original.id, profile_key: 'spell.light'}]});
    expect(resolveCombatAnimation(original).key).toBe('spell.light');
    setCombatAnimationCatalog({...builtInAnimationCatalog, bindings: []});
    expect(resolveCombatAnimation(original).key).toBe('spell.force');
    expect(JSON.stringify(original)).toBe(serialized);
  });

  it.each([
    {damage: 'force', palette: 'spell.force'},
    {damage: 'arbitrary-energy', palette: 'spell.frost'},
  ])('applies data-owned $damage palette without replacing the entity animation', data => {
    const catalog = {...builtInAnimationCatalog, bindings: [{entity_type: 'action', entity_id: 'arbitrary-strike', profile_key: 'natural.bite'}],
      defaults: {...builtInAnimationCatalog.defaults, damagePalette: {[data.damage]: data.palette}}};
    const result = resolveCombatAnimation(action('arbitrary-strike'), {damageType: data.damage}, catalog);
    expect(result.primitive).toBe('bite');
    expect(result.palette).toEqual(catalog.profiles.find(profile => profile.key === data.palette)?.palette);
    expect(result.casterCircle).toBe(false);
  });

  it('covers the 35 current base cantrips and all 49 authored variants, without invalid profiles', () => {
    expect(seed.cantripCoverage.filter(row => !row.card_number.startsWith('SPELL-VAR-'))).toHaveLength(35);
    expect(seed.cantripCoverage.filter(row => row.card_number.startsWith('SPELL-VAR-'))).toHaveLength(49);
    for (const row of seed.cantripCoverage) {
      const binding = seed.bindings.find(binding => binding.entity_type === 'spell' && binding.entity_id === row.id);
      expect(binding, row.card_number).toBeDefined();
      expect(resolveCombatAnimation(spell(row.id))).toMatchObject({key: binding!.profile_key, casterCircle: true});
    }
    expect(seed.bindings.filter(binding => binding.profile_key.startsWith('natural.')).length).toBeGreaterThanOrEqual(8);
    const keys = new Set(seed.profiles.map(profile => profile.key));
    expect(keys.size).toBe(seed.profiles.length);
    for (const binding of seed.bindings) expect(keys.has(binding.profile_key), binding.profile_key).toBe(true);
  });

  it('uses confirmed event and generic mechanics fallbacks without entity recognition', () => {
    expect(resolveCombatAnimation(undefined, {visual: 'ranged'}).primitive).toBe('ranged_arrow');
    expect(resolveCombatAnimation(undefined, {visual: 'piercing'}).primitive).toBe('melee_pierce');
    expect(resolveCombatAnimation(undefined, {event: 'stabilized'}).primitive).toBe('recover');
    expect(resolveCombatAnimation(undefined, {event: 'death'}).primitive).toBe('death');
    expect(resolveCombatAnimation(undefined, {event: 'resource_restored'}).primitive).toBe('recover');
    expect(resolveCombatAnimation(undefined, {event: 'damage_reduction'}).primitive).toBe('ward');
    expect(resolveCombatAnimation(undefined, {event: 'condition_immune'}).primitive).toBe('ward');
    expect(resolveCombatAnimation(undefined, {event: 'world_interaction'}).primitive).toBe('interact');
    expect(resolveCombatAnimation(undefined, {event: 'communication'})).toMatchObject({primitive: 'help', casterCircle: false});
    expect(resolveCombatAnimation(undefined, {event: 'turn_started'}).primitive).toBe('aura');
    expect(resolveCombatAnimation({...action('anything'), mechanics: {activation: {counts_as: 'hide'}}}).primitive).toBe('hide');
    const elemental = {...spell(), mechanics: {effects: [{resolution: 'auto', result: [{kind: 'damage', type: 'lightning'}]}]}};
    expect(resolveCombatAnimation(elemental).motif).toBe('lightning');
    expect(resolveCombatAnimation(spell()).key).toBe('spell.force');
  });

  it.each([
    {id: 'arbitrary-level-three-heal', level: 3, school: 'evocation', event: 'healing', primitive: 'heal'},
    {id: 'arbitrary-level-six-protection', level: 6, school: 'abjuration', event: 'effect_applied', primitive: 'ward'},
  ])('keeps a caster circle for an unbound levelled spell: $id', data => {
    const definition = {...spell(data.id, data.level), spell: {entityId: data.id, level: data.level, school: data.school}} as RuleActionDefinition;
    expect(resolveCombatAnimation(definition, {event: data.event})).toMatchObject({primitive: data.primitive, casterCircle: true});
  });

  it('keeps spell fallbacks for temporary HP and action-shaped spell effects', () => {
    expect(resolveCombatAnimation(spell('unknown-protection', 2), {event: 'temp_hp'})).toMatchObject({primitive: 'ward', casterCircle: true});
    expect(resolveCombatAnimation({...spell('unknown-mobility', 4), mechanics: {activation: {counts_as: 'dash'}}}, {event: 'effect_applied'}).casterCircle).toBe(true);
  });
});

describe('persistent spell circles', () => {
  const state = (): SoloCombatState => ({world: {scene: {mode: 'encounter', round: 2}, concentrations: {}, objects: {}, actors: {
    caster: {runtime: {activeEffects: []}}, target: {runtime: {activeEffects: []}}, other: {runtime: {activeEffects: []}},
  }}, tokens: {caster: {}, target: {}, other: {}}, catalogActions: [spell('first', 1), spell('second', 2)]} as unknown as SoloCombatState);
  it('deduplicates targets by source and preserves the saved upcast level across reloads', () => {
    const combat = state();
    const effect = {id: 'one', name: 'Название не используется', mechanics: {}, source: 'arbitrary', sourceId: 'caster', spellOriginId: 'first', roundsLeft: 3,
      actionContext: {sourceId: 'caster', character: {level: 1, profBonus: 2, abilityMods: {str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0}}, spell: {spellId: 'first', baseLevel: 1, castLevel: 5}}};
    combat.world.actors.target.runtime.activeEffects = [effect];
    combat.world.actors.other.runtime.activeEffects = [{...effect, id: 'two'}];
    combat.world.concentrations.caster = {id: 'concentration', sourceActorId: 'caster', actionId: 'first', startedAtRevision: 1, effectLinks: []};
    const circles = resolveActiveSpellCircles(combat);
    expect(circles).toHaveLength(1);
    expect(circles[0]).toMatchObject({actorId: 'caster', actionId: 'first', spellLevel: 5});
    expect(resolveActiveSpellCircles(JSON.parse(JSON.stringify(combat)))).toEqual(circles);
  });
  it('keeps independent sources, ignores unknown/expired origins, and removes ended circles', () => {
    const combat = state();
    combat.world.actors.target.runtime.activeEffects = [
      {id: 'first', name: 'Неважно', mechanics: {}, source: '', sourceId: 'caster', spellOriginId: 'first', roundsLeft: 1},
      {id: 'second', name: 'Неважно', mechanics: {}, source: '', sourceId: 'other', magicOrigin: {kind: 'spell', sourceEntityId: 'second'}, roundsLeft: 2},
      {id: 'expired', name: 'Неважно', mechanics: {}, source: '', sourceId: 'target', spellOriginId: 'first', roundsLeft: 0},
      {id: 'unproven', name: 'first', mechanics: {}, source: 'first'},
    ];
    expect(resolveActiveSpellCircles(combat).map(circle => [circle.actorId, circle.spellLevel])).toEqual([['caster', 1], ['other', 2]]);
    combat.world.actors.target.runtime.activeEffects = [];
    expect(resolveActiveSpellCircles(combat)).toEqual([]);
  });
  it('projects current spell areas and objects but excludes mundane objects', () => {
    const combat = state();
    combat.world.objects = {light: {id: 'light', name: 'Свет', kind: 'spell_effect', size: 'tiny', sourceActorId: 'caster', sourceActionId: 'first', roundsLeft: 2},
      item: {id: 'item', name: 'Инструмент', kind: 'item', size: 'tiny', sourceActorId: 'target', sourceActionId: 'first'}};
    combat.combatAreas = {area: {id: 'area', name: 'Область', zoneType: 'test', sourceEntityIds: ['second'], origin: {x: 0, y: 0}, cells: [], triggers: [],
      sourceActorId: 'other', sourceActionId: 'second', duration: {type: 'rounds', roundsLeft: 2}}};
    expect(resolveActiveSpellCircles(combat).map(circle => circle.actorId).sort()).toEqual(['caster', 'other']);
  });
  it('keeps a circle for a timed spell attached to an ordinary item until its attachment expires', () => {
    const combat = state();
    combat.world.objects = {item: {id: 'item', name: 'Обычный камень', kind: 'item', size: 'tiny', illumination: {
      id: 'light', sourceActorId: 'caster', sourceActionId: 'first', brightRadiusFt: 20, dimAdditionalRadiusFt: 20, roundsLeft: 2,
    }, prestidigitation: [{id: 'mark', kind: 'magic_mark', description: '', sourceActorId: 'other', sourceActionId: 'second', roundsLeft: 1}]}};
    expect(resolveActiveSpellCircles(combat).map(circle => circle.actorId)).toEqual(['caster', 'other']);
    combat.world.objects.item.illumination!.roundsLeft = 0;
    combat.world.objects.item.prestidigitation = [];
    expect(resolveActiveSpellCircles(combat)).toEqual([]);
  });
});
