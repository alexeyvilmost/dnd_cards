import type {CharacterClass, Spell} from '../types';
import type {AssembledCharacter, OriginAction, OriginEffect} from './assemble';
import {collectActionUsesRecharge, collectSheetActions} from './actionSheet';
import {findResource, type ResourceOption} from '../utils/resources';
import type {CharacterContext} from '../mvp/contracts';
import type {AppliedGrant} from './rules/types';
import {resolveCount} from '../engine/resources';
import {projectSheetSpellGrantAccess, SheetCanonicalWorldError} from './sheetCanonicalWorld';
import {spellCanBeAcquired} from './spellChoices';
import type {SpellAccessKind} from '../rules-core/spellcastingAccess';

export interface LevelUpSpellGrantSnapshot {
  assembled: AssembledCharacter;
  grants: readonly AppliedGrant[];
  context: CharacterContext;
}

export interface LevelUpSpellGrant {
  key: string;
  spell: Spell;
  grant: AppliedGrant;
  access?: SpellAccessKind;
  level: number;
  freeUses?: number;
  change: 'added' | 'changed';
}

/** References are resolved for presentation only; they never become manually
 * learned spells or modify the saved choices. */
export function levelUpSpellGrantRefs(...snapshots: Array<LevelUpSpellGrantSnapshot | null>): string[] {
  return [...new Set(snapshots.flatMap(snapshot => snapshot?.grants
    .filter(grant => grant.kind === 'spell').map(grant => grant.value) ?? []))].sort();
}

function projectedSpellGrants(snapshot: LevelUpSpellGrantSnapshot, spellsByRef: ReadonlyMap<string, Spell>) {
  return snapshot.grants.flatMap(grant => {
    const spell = spellsByRef.get(grant.value);
    if (grant.kind !== 'spell' || !spell || !spellCanBeAcquired(spell)) return [];
    let projected: ReturnType<typeof projectSheetSpellGrantAccess> | undefined;
    try {
      projected = projectSheetSpellGrantAccess({spell, grant, assembled: snapshot.assembled});
    } catch (error) {
      // An incomplete source stays inspectable without claiming a valid cast.
      // The authoritative compiler still rejects malformed access declarations.
      if (!(error instanceof SheetCanonicalWorldError)) throw error;
    }
    const override = projected?.castingOverride;
    const freeUses = grant.freeuse && !grant.freeuse.atWill
      ? resolveCount(grant.freeuse.count, snapshot.context) : undefined;
    const key = JSON.stringify([spell.id, grant.source.type, grant.source.originEntityId ?? grant.source.id,
      grant.source.featureEntityId ?? grant.source.id, grant.choiceId ?? null]);
    const level = grant.freeuse?.level ?? override?.spellLevel ?? spell.level;
    const signature = JSON.stringify({access:projected?.access, level, freeUses,
      freeuse:grant.freeuse ? {...grant.freeuse, count:freeUses} : undefined,
      ability:grant.spellcastingAbility, override});
    return [{key, spell, grant, access:projected?.access, level, freeUses, signature}];
  });
}

/** Compare source-scoped grants, not spell names or merged free-use pools.
 * Switching a subclass immediately removes its obsolete grants from this view. */
export function levelUpSpellGrants(before: LevelUpSpellGrantSnapshot, after: LevelUpSpellGrantSnapshot,
  spellsByRef: ReadonlyMap<string, Spell>): LevelUpSpellGrant[] {
  const previous = new Map(projectedSpellGrants(before, spellsByRef).map(grant => [grant.key, grant.signature]));
  return projectedSpellGrants(after, spellsByRef).flatMap(({signature, ...grant}) =>
    previous.get(grant.key) === signature ? [] : [{...grant, change:previous.has(grant.key) ? 'changed' as const : 'added' as const}])
    .sort((left,right) => left.spell.level - right.spell.level || left.spell.name.localeCompare(right.spell.name));
}

export interface SubclassProgressionColumn {
  subclass: CharacterClass;
  effects: OriginEffect[];
  actions: OriginAction[];
}

/** Progression origins come from the canonical feature collector/assembler.
 * Unleveled related abilities become available when the subclass is chosen. */
export function subclassAbilityLevel(origin: OriginEffect['origin'], unlockLevel: number): number {
  return origin.progressionLevel ?? unlockLevel;
}

export function subclassProgressionLevels(columns: readonly SubclassProgressionColumn[], unlockLevel: number): number[] {
  return [...new Set(columns.flatMap(column => [...column.effects, ...column.actions]
    .map(entry => subclassAbilityLevel(entry.origin, column.subclass.subclass_level ?? unlockLevel))))]
    .filter(level => Number.isSafeInteger(level) && level > 0).sort((left, right) => left - right);
}

export function subclassAbilitiesAtLevel(column: SubclassProgressionColumn, level: number, unlockLevel: number) {
  const declaredUnlock = column.subclass.subclass_level ?? unlockLevel;
  return {
    effects: column.effects.filter(entry => subclassAbilityLevel(entry.origin, declaredUnlock) === level),
    actions: column.actions.filter(entry => subclassAbilityLevel(entry.origin, declaredUnlock) === level),
  };
}

export function availableSubclassAbilities(assembled: Pick<AssembledCharacter, 'effects' | 'actions'>, subclassId: string, classLevel: number) {
  return {
    effects: assembled.effects.filter(entry => entry.origin.kind === 'class' && entry.origin.id === subclassId
      && (entry.origin.progressionLevel == null || entry.origin.progressionLevel <= classLevel)),
    actions: assembled.actions.filter(entry => entry.origin.kind === 'class' && entry.origin.id === subclassId
      && (entry.origin.progressionLevel == null || entry.origin.progressionLevel <= classLevel)),
  };
}

export function levelUpResourceGains(before: Readonly<Record<string, number>>, after: Readonly<Record<string, number>>) {
  return Object.entries(after).flatMap(([key, maximum]) => {
    const previous = before[key] ?? 0;
    return maximum > previous ? [{key, before: previous, after: maximum, delta: maximum - previous}] : [];
  }).sort((left, right) => left.key.localeCompare(right.key));
}

/** Uses pools retain their owning canonical action/effect presentation; no
 * separate names or mechanics are invented for transient resource keys. */
export function levelUpResourceOptions(options: ResourceOption[], assembled: AssembledCharacter): ResourceOption[] {
  const recharge=collectActionUsesRecharge(assembled);
  return [...options,...collectSheetActions(assembled).flatMap(action=>action.usesKey&&!findResource(options,action.usesKey)?[{
    id:action.usesKey,label:action.name,description:action.actionRef?.description??action.effectRef?.description,
    imageUrl:action.imageUrl??undefined,recharge:recharge[action.usesKey],category:action.group==='class'?'class_resource':'character_resource',
  }]:[])];
}
