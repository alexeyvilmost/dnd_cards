/**
 * Общий строитель персонажа реальным конвейером кузницы (0.5). Живой (ходит в API
 * через loadBundle). Расширение autoBuild из forge.sweep: параметр УРОВНЯ и выбор
 * ПОДКЛАССА — для аудитора динамических проверок (переменные/гранты/числа на уровне L).
 *
 * ВНИМАНИЕ: loadBundle тянет apiClient(axios), который в node читает localStorage —
 * потребитель обязан поставить заглушку localStorage ДО импорта этого модуля
 * (см. autoBuild.live.test.ts).
 */
import { assemble, loadBundle, type AssembledCharacter } from '../character/assemble';
import { emptyDraft, ABILITY_KEYS, type AbilityKey, type CharacterDraft } from '../character/types';
import { classSkillChoice, completionIssues } from '../character/forgeHelpers';
import { unavailableChoiceOptions } from '../character/choiceAvailability';
import { getSkillGrantSource, resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import { buildCharacterContext } from '../character/runtime';
import { syncRuntimeResources } from '../character/resourceInit';
import { spellMatchesChoice } from '../character/spellChoices';
import { isSpellSelectionChoice, type PendingChoice } from '../mechanics/collectChoices';
import { LANGUAGES, ORIGIN_FEATS, SKILLS, optionsForChoiceSource } from '../mechanics/registries';
import { bonusOf } from '../character/pointBuy';
import { maxAvailableSpellSlotLevel } from '../engine/resources';
import { collectChosenSpellUuids } from '../engine/spellRefs';
import type { Background, CharacterClass, Feat, Race, Spell } from '../types';

export interface BuildContent {
  classes: CharacterClass[];
  races: Race[];
  backgrounds: Background[];
  feats: Feat[];
  /** Каталог, из которого разрешаются spell-choice. Если не передан, старые аудиторы их пропускают. */
  spells?: Spell[];
}

export interface BuildParams {
  classId: string;
  raceId: string;
  backgroundId: string;
  lineageId?: string | null;
  /** UUID подкласса; если не задан и уровень ≥ subclass_level — берётся первый доступный. */
  subclassId?: string | null;
  /** Явно выбранные дополнительные черты (в micro-MVP — заменяющая черта происхождения). */
  featIds?: string[];
  /** Включает тот же режим замены черты происхождения, что и переключатель кузницы. */
  replaceBackgroundFeat?: boolean;
  /** Приоритет конкретных вариантов для детерминированных acceptance-аудитов. */
  preferredChoiceOptionIds?: string[];
  level: number;
}

export interface BuildResult {
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  ruleState: ReturnType<typeof resolveCharacterRules>;
  unresolvedNonSpell: string[];
  unresolvedSpell: string[];
  issues: string[];
}

const FEAT_FILTER_CATEGORY: Record<string, Feat['category']> = {
  fighting_style: 'fighting_style', origin_feats: 'origin', origin: 'origin',
  general: 'general', epic_boon: 'epic_boon',
};

function pickChoiceOptions(
  pc: PendingChoice,
  ruleState: ReturnType<typeof resolveCharacterRules>,
  already: string[],
  feats: Feat[],
  activeFeats: readonly Feat[],
  spells: Spell[],
  maxSlotLevel: number,
  reservedSpellIds: Set<string>,
  preferredChoiceOptionIds: Set<string>,
): string[] {
  const picked = [...already];
  if (pc.count - picked.length <= 0) return picked;
  let pool: string[] = [];
  if (pc.source === 'subfeature' || pc.source === 'explicit' || pc.source === 'effect') {
    pool = (pc.items || []).map((it) => it.id);
  } else if (pc.source === 'feat') {
    if (pc.items?.length) pool = pc.items.map((it) => it.id);
    else {
      const category = typeof pc.filter === 'string' ? FEAT_FILTER_CATEGORY[pc.filter] : undefined;
      const list = category ? feats.filter((f) => f.category === category) : feats;
      pool = list.length ? list.map((f) => f.id) : ORIGIN_FEATS.map((f) => f.id);
    }
  } else if (pc.source === 'skill') {
    pool = Array.isArray(pc.filter) ? (pc.filter as string[]) : SKILLS.map((s) => s.id);
  } else if (pc.source === 'language') {
    pool = LANGUAGES.map((l) => l.id);
  } else if (isSpellSelectionChoice(pc)) {
    pool = spells
      .filter((spell) => spellMatchesChoice(spell, pc, maxSlotLevel))
      .map((spell) => spell.id);
  } else {
    pool = pc.items?.length
      ? pc.items.map((it) => it.id)
      : optionsForChoiceSource(pc.source).map((it) => it.id);
  }
  const featByReference = new Map(feats.flatMap((feat) => (
    [[feat.id, feat.id], [feat.card_number, feat.id]] as const
  )));
  const spellByReference = new Map(spells.flatMap((spell) => (
    [[spell.id, spell.id], [spell.card_number, spell.id]] as const
  )));
  const unavailable = unavailableChoiceOptions(pc, ruleState, pool, picked, {
    activeFeatIds: new Set(activeFeats.map((feat) => feat.id)),
    repeatableFeatIds: new Set(feats.filter((feat) => feat.repeatable).map((feat) => feat.id)),
    canonicalFeatId: (reference) => featByReference.get(reference) ?? reference,
    canonicalSpellId: (reference) => spellByReference.get(reference) ?? reference,
  });
  pool = pool.filter((id) => !unavailable[id]);
  const orderedPool = [
    ...pool.filter((id) => preferredChoiceOptionIds.has(id)),
    ...pool.filter((id) => !preferredChoiceOptionIds.has(id)),
  ];
  for (const id of orderedPool) {
    if (picked.length >= pc.count) break;
    if (picked.includes(id)) continue;
    if (pc.source === 'spell' && reservedSpellIds.has(id)) continue;
    picked.push(id);
  }
  return picked;
}

/** Собрать персонажа (класс+раса+предыстория) на уровне L с авторазрешением выборов. */
export async function autoBuildAt(params: BuildParams, content: BuildContent): Promise<BuildResult> {
  const klass = content.classes.find((c) => c.id === params.classId);
  let subclassId = params.subclassId ?? null;
  // выбрать подкласс, если уровень открыл его, а явный не задан
  const subclassLevel = Number(klass?.subclass_level ?? 3);
  if (!subclassId && klass && params.level >= subclassLevel) {
    const sub = content.classes.find((c) => c.is_subclass && c.parent_class_id === klass.id);
    subclassId = sub?.id ?? null;
  }

  let current: CharacterDraft = {
    ...emptyDraft(),
    raceId: params.raceId,
    lineageId: params.lineageId ?? null,
    classId: params.classId,
    backgroundId: params.backgroundId,
    subclassId,
    level: params.level,
    name: 'Аудит',
    featIds: [...(params.featIds ?? [])],
    swapFeat: params.replaceBackgroundFeat ?? false,
  };

  let assembled = assemble({ ...(await loadBundle(current)), spells: [] }, current);
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    const sc = classSkillChoice(assembled);
    while (sc && current.classSkillChoices.length < sc.count) {
      const rs = resolveCharacterRules({ draft: current, assembled });
      const next = sc.options.map((o) => o.toLowerCase())
        .find((o) => !getSkillGrantSource(rs, o) && !current.classSkillChoices.includes(o));
      if (!next) break;
      current.classSkillChoices = [...current.classSkillChoices, next];
      changed = true;
    }
    for (const pc of assembled.pendingChoices) {
      const sel = current.resolvedChoices[pc.id] || [];
      if (sel.length >= pc.count) continue;
      const rs = resolveCharacterRules({ draft: current, assembled });
      const maxSlotLevel = maxAvailableSpellSlotLevel(
        syncRuntimeResources(
          buildCharacterContext(
            rs,
            { level: current.level, abilities: current.abilities as Record<string, number> },
            [],
            assembled.klass,
          ),
          assembled,
          undefined,
          rs.freeuseSpells,
        ).maxResources,
      );
      // Один UUID из двух источников (например, класс + «Посвящённый в магию»)
      // даёт blocking conflict в completionIssues. Автосборщик имитирует валидный
      // пользовательский выбор и берёт другое доступное заклинание.
      const reservedSpellIds = new Set(collectChosenSpellUuids(current, assembled));
      for (const id of sel) reservedSpellIds.delete(id);
      const picked = pickChoiceOptions(
        pc,
        rs,
        sel,
        content.feats,
        assembled.feats,
        content.spells ?? [],
        maxSlotLevel,
        reservedSpellIds,
        new Set(params.preferredChoiceOptionIds ?? []),
      );
      if (picked.length !== sel.length) { current.resolvedChoices[pc.id] = picked; changed = true; }
    }
    if (!changed && pass > 0) break;
    assembled = assemble({ ...(await loadBundle(current)), spells: [] }, current);
  }

  const rec = (klass?.recommended_abilities ?? {}) as Partial<Record<AbilityKey, number>>;
  const bg = content.backgrounds.find((b) => b.id === params.backgroundId);
  const bgAb = (bg?.ability_scores || []) as AbilityKey[];
  if (bgAb.length >= 2) {
    current.abilityBonuses = { mode: 'two_one', assignments: { [bgAb[0]]: 2, [bgAb[1]]: 1 }, anyAbilities: false };
  }
  const abilities: Partial<Record<AbilityKey, number>> = {};
  for (const k of ABILITY_KEYS) abilities[k] = (rec[k] ?? 8) + bonusOf(current.abilityBonuses, k);
  current.abilities = abilities;

  const chosenSpellIds = collectChosenSpellUuids(current, assembled);
  current.spellIds = chosenSpellIds;
  const selectedSpells = (content.spells ?? []).filter((spell) => chosenSpellIds.includes(spell.id));
  assembled = assemble({ ...(await loadBundle(current)), spells: selectedSpells }, current);
  const ruleState = resolveCharacterRules({ draft: current, assembled });
  const unresolvedNonSpell = assembled.pendingChoices
    .filter((pc) => !isSpellSelectionChoice(pc) && pc.context !== 'in_play')
    .filter((pc) => (current.resolvedChoices[pc.id] || []).length < pc.count)
    .map((pc) => `${pc.prompt} [${pc.source}]`);
  const unresolvedSpell = assembled.pendingChoices
    .filter((pc) => isSpellSelectionChoice(pc) && pc.context !== 'in_play')
    .filter((pc) => (current.resolvedChoices[pc.id] || []).length < pc.count)
    .map((pc) => `${pc.prompt}: ${current.resolvedChoices[pc.id]?.length ?? 0}/${pc.count}`);
  const issues = completionIssues(current, assembled);

  return { draft: current, assembled, ruleState, unresolvedNonSpell, unresolvedSpell, issues };
}
