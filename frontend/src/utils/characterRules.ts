export type CharacterRuleType = 'stat' | 'skill' | 'derived' | 'base' | 'context' | string;

export interface CharacterRuleFormula {
  formula: string;
  conditions: Record<string, string>;
  rawConditions: Record<string, string>;
}

export interface CharacterRule {
  name: string;
  russian_name: string;
  type: CharacterRuleType;
  dependencies?: string[];
  influence?: string[];
  formulas?: CharacterRuleFormula[];
}

const normalizeName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-+/g, '_');

export const normalizeRuleIdentifier = (name: string): string => normalizeName(name);

const DEFAULT_SKILL_NAMES = [
  'acrobatics',
  'animal_handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight_of_hand',
  'stealth',
  'survival',
];

const ruleModules = import.meta.glob('../../character_rules/*.json', {
  eager: true,
}) as Record<string, { default: CharacterRule } | CharacterRule>;

const rulesMap: Record<string, CharacterRule> = {};

Object.entries(ruleModules).forEach(([path, mod]) => {
  const data = (mod as { default?: CharacterRule }).default ?? (mod as CharacterRule);

  if (!data || !('name' in data)) {
    console.warn(`[characterRules] Пропущен файл правил ${path}: отсутствует поле name`);
    return;
  }

  const normalizedName = normalizeName(data.name);
  const normalizedDependencies = (data.dependencies ?? []).map((dep) => normalizeName(dep));
  const normalizedInfluence = (data.influence ?? []).map((inf) => normalizeName(inf));

  const rawFormulas = Array.isArray((data as Record<string, unknown>).calculate_formulas)
    ? (data as Record<string, unknown>).calculate_formulas
    : [];

  const normalizedFormulas: CharacterRuleFormula[] = (rawFormulas as Array<Record<string, unknown>>)
    .map((formulaEntry) => {
      if (!formulaEntry || typeof formulaEntry !== 'object') {
        return null;
      }

      const rawFormula = formulaEntry.formula;
      if (typeof rawFormula !== 'string' || !rawFormula.trim()) {
        return null;
      }

      const rawConditions: Record<string, string> = {};
      const conditions: Record<string, string> = {};

      Object.entries(formulaEntry).forEach(([key, value]) => {
        if (key === 'formula' || value === undefined || value === null) {
          return;
        }

        if (typeof value === 'string' || typeof value === 'number') {
          rawConditions[key] = String(value);
          conditions[normalizeName(key)] = normalizeName(String(value));
        }
      });

      return {
        formula: rawFormula.trim(),
        conditions,
        rawConditions,
      };
    })
    .filter((entry): entry is CharacterRuleFormula => Boolean(entry));

  if (rulesMap[normalizedName]) {
    console.warn(`[characterRules] Повторное определение правила "${normalizedName}" (файл ${path})`);
  }

  rulesMap[normalizedName] = {
    ...data,
    name: normalizedName,
    dependencies: normalizedDependencies,
    influence: normalizedInfluence,
    formulas: normalizedFormulas,
  };
});

export const getRule = (name: string): CharacterRule | undefined => {
  return rulesMap[normalizeName(name)];
};

export const getRuleRussianName = (name: string): string | undefined => {
  const normalized = normalizeName(name);
  const rule = rulesMap[normalized];
  if (!rule) {
    console.warn(`[characterRules] Правило не найдено: "${name}" (нормализовано: "${normalized}")`);
    return undefined;
  }
  return rule.russian_name;
};

export const getRuleDependencies = (name: string): CharacterRule[] => {
  const rule = getRule(name);
  if (!rule?.dependencies?.length) {
    return [];
  }

  return rule.dependencies
    .map((dependencyName) => getRule(dependencyName))
    .filter((dependency): dependency is CharacterRule => Boolean(dependency));
};

export const getRuleDependencyNames = (name: string): string[] => {
  return getRule(name)?.dependencies ?? [];
};

export const getRuleFormulas = (name: string): CharacterRuleFormula[] => {
  return getRule(name)?.formulas ?? [];
};

export const getDependentNames = (targetName: string, typeFilter?: CharacterRuleType): string[] => {
  const target = normalizeName(targetName);
  const result = new Set<string>();

  Object.values(rulesMap).forEach((rule) => {
    if (rule.dependencies?.includes(target)) {
      if (!typeFilter || rule.type === typeFilter) {
        result.add(rule.name);
      }
    }
  });

  return Array.from(result);
};

export const getPrimaryStatForSkill = (skillName: string): string | undefined => {
  const rule = getRule(skillName);
  if (!rule) {
    // Fallback: проверяем известные соответствия навыков и характеристик
    const skillToStatMap: Record<string, string> = {
      'acrobatics': 'dexterity',
      'animal_handling': 'wisdom',
      'arcana': 'intelligence',
      'athletics': 'strength',
      'deception': 'charisma',
      'history': 'intelligence',
      'insight': 'wisdom',
      'intimidation': 'charisma',
      'investigation': 'intelligence',
      'medicine': 'wisdom',
      'nature': 'intelligence',
      'perception': 'wisdom',
      'performance': 'charisma',
      'persuasion': 'charisma',
      'religion': 'intelligence',
      'sleight_of_hand': 'dexterity',
      'stealth': 'dexterity',
      'survival': 'wisdom',
    };
    const normalizedSkill = normalizeName(skillName);
    return skillToStatMap[normalizedSkill];
  }

  // Ищем первую зависимость типа 'stat'
  for (const dependency of rule.dependencies ?? []) {
    const dependencyRule = getRule(dependency);
    if (dependencyRule?.type === 'stat') {
      return dependencyRule.name;
    }
  }

  // Fallback: проверяем известные соответствия навыков и характеристик
  const skillToStatMap: Record<string, string> = {
    'acrobatics': 'dexterity',
    'animal_handling': 'wisdom',
    'arcana': 'intelligence',
    'athletics': 'strength',
    'deception': 'charisma',
    'history': 'intelligence',
    'insight': 'wisdom',
    'intimidation': 'charisma',
    'investigation': 'intelligence',
    'medicine': 'wisdom',
    'nature': 'intelligence',
    'perception': 'wisdom',
    'performance': 'charisma',
    'persuasion': 'charisma',
    'religion': 'intelligence',
    'sleight_of_hand': 'dexterity',
    'stealth': 'dexterity',
    'survival': 'wisdom',
  };
  const normalizedSkill = normalizeName(skillName);
  return skillToStatMap[normalizedSkill];
};

export const getAllSkillNames = (): string[] => {
  const skills = Object.values(rulesMap)
    .filter((rule) => rule.type === 'skill')
    .map((rule) => rule.name)
    .sort();

  if (skills.length === 0) {
    console.warn(
      '[characterRules] Не удалось загрузить ни одного правила навыков. Используем дефолтный список.'
    );
    return [...DEFAULT_SKILL_NAMES];
  }

  return skills;
};

export const getRulesByType = (type: CharacterRuleType): CharacterRule[] => {
  return Object.values(rulesMap).filter((rule) => rule.type === type);
};

export const getAllRules = (): CharacterRule[] => {
  return Object.values(rulesMap);
};

