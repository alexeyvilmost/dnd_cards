/**
 * Общий строитель персонажа реальным конвейером кузницы (0.5). Живой (ходит в API
 * через loadBundle). Расширение autoBuild из forge.sweep: параметр УРОВНЯ и выбор
 * ПОДКЛАССА — для аудитора динамических проверок (переменные/гранты/числа на уровне L).
 *
 * ВНИМАНИЕ: loadBundle тянет apiClient(axios), который в node читает localStorage —
 * потребитель обязан поставить заглушку localStorage ДО импорта этого модуля
 * (см. autoBuild.live.test.ts). Спелл-выборы намеренно не закрываются (как в forge.sweep).
 */
import { assemble, loadBundle, type AssembledCharacter } from '../character/assemble';
import { emptyDraft, ABILITY_KEYS, type AbilityKey, type CharacterDraft } from '../character/types';
import { classSkillChoice } from '../character/forgeHelpers';
import { getSkillGrantSource, resolveCharacterRules } from '../character/rules/resolveCharacterRules';
import type { PendingChoice } from '../mechanics/collectChoices';
import { LANGUAGES, ORIGIN_FEATS, SKILLS } from '../mechanics/registries';
import { bonusOf } from '../character/pointBuy';
import type { Background, CharacterClass, Feat, Race } from '../types';

export interface BuildContent {
  classes: CharacterClass[];
  races: Race[];
  backgrounds: Background[];
  feats: Feat[];
}

export interface BuildParams {
  classId: string;
  raceId: string;
  backgroundId: string;
  lineageId?: string | null;
  /** UUID подкласса; если не задан и уровень ≥ subclass_level — берётся первый доступный. */
  subclassId?: string | null;
  level: number;
}

export interface BuildResult {
  draft: CharacterDraft;
  assembled: AssembledCharacter;
  ruleState: ReturnType<typeof resolveCharacterRules>;
  unresolvedNonSpell: string[];
}

const FEAT_FILTER_CATEGORY: Record<string, Feat['category']> = {
  fighting_style: 'fighting_style', origin_feats: 'origin', origin: 'origin',
  general: 'general', epic_boon: 'epic_boon',
};

function pickChoiceOptions(pc: PendingChoice, ruleState: ReturnType<typeof resolveCharacterRules>, already: string[], feats: Feat[]): string[] {
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
    const isExpertise = pc.filter === 'proficient';
    const base = Array.isArray(pc.filter) ? (pc.filter as string[]) : SKILLS.map((s) => s.id);
    pool = base.filter((id) => { const g = !!getSkillGrantSource(ruleState, id); return isExpertise ? g : !g; });
  } else if (pc.source === 'language') {
    pool = LANGUAGES.map((l) => l.id).filter((id) => !ruleState.proficiencies.languages.includes(id));
  } else if (pc.source === 'spell') {
    pool = Array.isArray(pc.filter) ? (pc.filter as string[]) : [];
  } else {
    pool = (pc.items || []).map((it) => it.id);
  }
  for (const id of pool) { if (picked.length >= pc.count) break; if (!picked.includes(id)) picked.push(id); }
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
      const picked = pickChoiceOptions(pc, rs, sel, content.feats);
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

  const ruleState = resolveCharacterRules({ draft: current, assembled });
  const unresolvedNonSpell = assembled.pendingChoices
    .filter((pc) => pc.source !== 'spell' && pc.context !== 'in_play')
    .filter((pc) => (current.resolvedChoices[pc.id] || []).length < pc.count)
    .map((pc) => `${pc.prompt} [${pc.source}]`);

  return { draft: current, assembled, ruleState, unresolvedNonSpell };
}
