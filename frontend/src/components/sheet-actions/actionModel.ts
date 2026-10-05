import type {SheetAction} from '../../character/actionSheet';
import type {CharacterType} from '../../character/types';
import type {RuntimeState, TargetContext} from '../../mvp/contracts';
import type {RuleActionDefinition} from '../../rules-core/domain';
import {canPay} from '../../engine/cost';
import {SPELL_SCHOOL_OPTIONS} from '../../types';
import {UNARMED_STRIKE_PRIMITIVE} from '../../character/sheetCombatDeclaration';

// UI projection only. These are the existing sheet selectors; execution and
// validation remain in the canonical engine and command lifecycle.
export function sheetActionPanelLockIssue(
  disabledReason?: string,
): { disabled: true; reason: string } | null {
  return disabledReason ? { disabled: true, reason: disabledReason } : null;
}

export function sheetTriggerOnlyReason(
  mechanics: Record<string, unknown> | undefined,
): string | null {
  const activation = mechanics?.activation as Record<string, unknown> | undefined;
  const mode = String(activation?.mode ?? '');
  const trigger = activation?.trigger as Record<string, unknown> | undefined;
  const hasTrigger = typeof trigger?.event === 'string'
    || (Array.isArray(trigger?.events) && trigger.events.some((event) => typeof event === 'string'));
  return hasTrigger && (mode === 'reaction' || mode === 'triggered')
    ? 'Доступно только в окне реакции после подходящего события'
    : null;
}

export function sheetSpellActionsForPresentation(actions: readonly SheetAction[]): SheetAction[] {
  return actions.filter((action) => action.group === 'spell');
}

export interface ExplicitSheetTargetFacts {
  armorClass: number | null | undefined;
  savingThrowModifier: number | null | undefined;
}

function targetResolutionRequirements(mechanics: Record<string, unknown>): {
  attack: boolean;
  save: boolean;
} {
  const effects = Array.isArray(mechanics.effects)
    ? mechanics.effects as Record<string, unknown>[]
    : [];
  return {
    attack: effects.some((effect) => effect.resolution === 'attack_roll'),
    save: effects.some((effect) => effect.resolution === 'save'),
  };
}

/** Legacy execution accepts no invented target statistics. */
export function explicitSheetTargetFactsIssue(
  mechanics: Record<string, unknown>,
  facts: ExplicitSheetTargetFacts,
): string | null {
  const required = targetResolutionRequirements(mechanics);
  if (required.attack && (typeof facts.armorClass !== 'number'
    || !Number.isFinite(facts.armorClass)
    || facts.armorClass <= 0)) {
    return 'Укажите КД цели или выберите персонажа с явно рассчитанной КД';
  }
  if (required.save && (typeof facts.savingThrowModifier !== 'number'
    || !Number.isSafeInteger(facts.savingThrowModifier))) {
    return 'Укажите модификатор спасброска цели или выберите персонажа с рассчитанными спасбросками';
  }
  return null;
}

export function explicitSheetTargetContext(
  mechanics: Record<string, unknown>,
  facts: ExplicitSheetTargetFacts,
): TargetContext | undefined {
  const issue = explicitSheetTargetFactsIssue(mechanics, facts);
  if (issue) throw new Error(issue);
  const required = targetResolutionRequirements(mechanics);
  if (!required.attack && !required.save) return undefined;
  return {
    ...(required.attack ? { ac: facts.armorClass as number } : {}),
    ...(required.save ? {
      saveMods: {
        dex: facts.savingThrowModifier as number,
        con: facts.savingThrowModifier as number,
        str: facts.savingThrowModifier as number,
        int: facts.savingThrowModifier as number,
        wis: facts.savingThrowModifier as number,
        cha: facts.savingThrowModifier as number,
      },
    } : {}),
  };
}

const GROUP_DETAIL: Record<SheetAction['group'], string> = {
  basic: 'Базовое действие', race: 'Вид', class: 'Класс', item: 'Предмет', spell: 'Заклинание',
};
const spellSchoolLabel = (s?: string | null) => SPELL_SCHOOL_OPTIONS.find((o) => o.value === s)?.label || s || '';
export function sheetActionDisplayName(
  action: Pick<SheetAction, 'name' | 'mechanics'>,
): string {
  const primitive = action.mechanics.primitive as Record<string, unknown> | undefined;
  if (primitive?.type !== 'weapon_attack') return action.name;
  const effects = Array.isArray(action.mechanics.effects)
    ? action.mechanics.effects as Array<Record<string, unknown>>
    : [];
  const attackKind = effects.find((effect) => effect.resolution === 'attack_roll')?.attack_kind;
  if (attackKind === 'weapon_ranged') return 'Дальнобойная атака оружием';
  if (attackKind === 'weapon_melee') return 'Рукопашная атака оружием';
  return action.name;
}
// Вторая строка ряда действия (как у предметов, но без веса/цены).
export const actionDetail = (a: SheetAction): string => {
  if (a.spellRef) {
    const lvl = a.spellRef.level ?? a.level ?? 0;
    return `${lvl === 0 ? 'Заговор' : `${lvl} уровень`}${a.spellRef.school ? ` · ${spellSchoolLabel(a.spellRef.school)}` : ''}`;
  }
  if (a.group === 'basic') return 'Базовое действие';
  return a.sourceLabel ?? GROUP_DETAIL[a.group] ?? '';
};

/** Апкаст (D1): заклинание со стоимостью spell_slot уровня N доступно, если есть ЛЮБОЙ
 *  слот уровня ≥ N (не только базового) — иначе кастер со свободным старшим слотом, но
 *  потраченным базовым, не смог бы кастовать. Прочие ресурсы стоимости — обычной проверкой.
 *  freeuseAvailable снимает ТОЛЬКО требование ячейки (каст из пула бесплатных использований),
 *  но НЕ экономику действий: не-слотовые косты (основное/бонусное действие, реакция, предмет)
 *  проверяются всегда — без свободного действия заклинание недоступно даже при freeuse. */
export function payableWithUpcast(runtime: RuntimeState, cost: Record<string, unknown>[], freeuseAvailable = false): boolean {
  const slot = cost.find((c) => String(c.resource ?? '') === 'spell_slot' && c.level != null);
  const nonSlot = cost.filter((c) => c !== slot);
  if (nonSlot.length && !canPay(runtime, nonSlot).ok) return false;
  if (slot && !freeuseAvailable) {
    const base = Number(slot.level) || 0;
    const need = Number(slot.amount ?? 1) || 1;
    let ok = false;
    for (let L = base; L <= 9; L++) if ((runtime.resources[`spell_slot_${L}`] ?? 0) >= need) { ok = true; break; }
    if (!ok) return false;
  }
  return true;
}

export function mechanicsPrimitiveType(mechanics: Record<string, unknown>): string | null {
  const primitive = mechanics.primitive;
  if (!primitive || typeof primitive !== 'object' || Array.isArray(primitive)) return null;
  const type = (primitive as Record<string, unknown>).type;
  return typeof type === 'string' && type ? type : null;
}

/** Every spell row and every run action uses the canonical authority, primitive or not. */
export function sheetActionNeedsCanonicalAvailability(
  action: Pick<SheetAction, 'mechanics' | 'spellRef'>,
  characterType?: CharacterType,
): boolean {
  const effects = Array.isArray(action.mechanics.effects)
    ? action.mechanics.effects as Record<string, unknown>[]
    : [];
  const structuralUnarmed = effects.some((effect) => (
    effect.resolution === 'attack_roll' && effect.attack_kind === 'unarmed'
  ));
  return characterType === 'dungeon_crawl'
    || action.spellRef !== undefined
    || mechanicsPrimitiveType(action.mechanics) !== null
    || structuralUnarmed;
}

/**
 * Compatibility projection for the data-owned basic Unarmed Strike row. It is
 * structural (not tied to an id/name), so another entity with the same generic
 * attack contract can reuse the scene-target flow.
 */
export function legacyUnarmedTargetAction(action: SheetAction): RuleActionDefinition | null {
  const effects = Array.isArray(action.mechanics.effects)
    ? action.mechanics.effects as Record<string, unknown>[]
    : [];
  if (mechanicsPrimitiveType(action.mechanics)
    || !effects.some((effect) => (
      effect.resolution === 'attack_roll' && effect.attack_kind === 'unarmed'
    ))) return null;
  const targeting = action.mechanics.targeting;
  const declared = targeting && typeof targeting === 'object' && !Array.isArray(targeting)
    ? targeting as Record<string, unknown>
    : {};
  const rangeMatch = String(declared.range ?? '').match(/\d+/);
  const rangeFt = rangeMatch ? Number(rangeMatch[0]) : 5;
  const sourceId = action.actionRef?.id ?? action.id;
  const sourceCard = action.actionRef?.card_number ?? action.id;
  return {
    id: action.id,
    name: action.name,
    kind: 'nonSpell',
    sourceEntityIds: [sourceId, sourceCard],
    mechanics: {
      ...action.mechanics,
      primitive: { type: UNARMED_STRIKE_PRIMITIVE },
      targeting: {
        domain: 'actor',
        actor_targets: true,
        shape: 'single',
        min_targets: 1,
        max_targets: 1,
        range_ft: rangeFt,
        requires_line_of_sight: true,
        allowed_relations: ['enemy'],
      },
    },
    targeting: {
      minTargets: 1,
      maxTargets: 1,
      rangeFt,
      requiresLineOfSight: true,
      allowedRelations: ['enemy'],
    },
  };
}

/** Target relations are mechanics-owned; localized names never decide picker membership. */
export function sheetMechanicsAllowsSelfTarget(mechanics: Record<string, unknown>): boolean {
  const targeting = mechanics.targeting as Record<string, unknown> | undefined;
  return Array.isArray(targeting?.allowed_relations)
    && targeting.allowed_relations.includes('self');
}

