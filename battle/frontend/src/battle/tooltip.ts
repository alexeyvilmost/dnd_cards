// Tooltip model + builders for the BG3-style "inspect" panel.
// Pure frontend: turns a backend Spell / a known action / an ability into a
// uniform TooltipData the InspectTooltip component renders.

import { Spell, imageUrl } from "../api/client";
import { SPELL_ICONS, spellIconKey } from "../data/spellIcons";

export type RollKind = "attack" | "save";

export interface CostPip {
  shape: "cir" | "sq" | "dia";
  color: string;
  label: string;
}

export interface TooltipData {
  name: string;
  subtype: string; // "Заговор · Некромантия", "Действие · ближний бой", "Пассивный"
  icon: string; // big icon path
  roll?: RollKind;
  attackBonus?: string; // "+ 5"; when absent the row shows just "к20"
  saveAbility?: string; // "Ловкость"; default "—"
  saveDC?: number; // default 10
  dmg?: string; // "1к8 + 3" (nominative damage type rendered separately)
  dtype?: string; // "дробящий" (именительный)
  heal?: string; // "1к10 + ур"
  desc: string; // supports **bold** segments
  save?: string; // "При провале спасброска — полный урон"
  meta?: [string, string][]; // [iconChar, label]
  cost?: CostPip[];
}

// ─── Damage type → colour + glyph (extend here for new types) ────────────────
export const DMG_COLOR: Record<string, string> = {
  некротический: "var(--dt-necrotic)",
  огонь: "var(--dt-fire)",
  холод: "var(--dt-cold)",
  кислота: "var(--dt-acid)",
  излучение: "var(--dt-radiant)",
  психический: "var(--dt-psychic)",
  "силовое поле": "var(--dt-force)",
  яд: "var(--dt-acid)",
  электричество: "var(--dt-cold)",
  звук: "var(--dt-force)",
  дробящий: "var(--dt-physical)",
  колющий: "var(--dt-physical)",
  рубящий: "var(--dt-physical)",
  "на выбор": "var(--gold)",
};

export const DMG_GLYPH: Record<string, string> = {
  некротический: "☠",
  огонь: "🔥",
  холод: "❄",
  кислота: "🧪",
  излучение: "☀",
  психический: "🧠",
  "силовое поле": "✷",
  яд: "☣",
  электричество: "⚡",
  звук: "♪",
  дробящий: "🔨",
  колющий: "🗡",
  рубящий: "⚔",
  "на выбор": "✦",
};

// Defaults used when backend has not supplied the value yet (see TODO below).
export const DEFAULT_SAVE_DC = 10;

// ─── English → Russian fallbacks (backend stores English) ────────────────────
const SCHOOL_RU: Record<string, string> = {
  abjuration: "Ограждение",
  conjuration: "Вызов",
  divination: "Прорицание",
  enchantment: "Очарование",
  evocation: "Воплощение",
  illusion: "Иллюзия",
  necromancy: "Некромантия",
  transmutation: "Преобразование",
};

const DTYPE_RU: Record<string, string> = {
  acid: "кислота",
  bludgeoning: "дробящий",
  cold: "холод",
  fire: "огонь",
  force: "силовое поле",
  lightning: "электричество",
  necrotic: "некротический",
  piercing: "колющий",
  poison: "яд",
  psychic: "психический",
  radiant: "излучение",
  slashing: "рубящий",
  thunder: "звук",
};

const ABILITY_RU: Record<string, string> = {
  strength: "Сила",
  dexterity: "Ловкость",
  constitution: "Телосложение",
  intelligence: "Интеллект",
  wisdom: "Мудрость",
  charisma: "Харизма",
  СИЛ: "Сила",
  ЛОВ: "Ловкость",
  ТЕЛ: "Телосложение",
  ИНТ: "Интеллект",
  МДР: "Мудрость",
  ХАР: "Харизма",
};

const LEVEL_RU: Record<number, string> = {
  0: "Заговор",
  1: "1 круг",
  2: "2 круг",
  3: "3 круг",
  4: "4 круг",
  5: "5 круг",
};

function ru<T extends string>(map: Record<string, string>, v?: string | null, fallback = ""): string {
  if (!v) return fallback;
  return map[v] || map[v.toLowerCase()] || v;
}

export const DEFAULT_ICON = "/icons/default.png";

/** Resolve a spell's icon from its stored image key; falls back to default.png.
 * Spell images live in the backend image store (see images_repo.py); they are no
 * longer bundled static files. */
export function spellImageUrl(spell?: { image?: string | null }): string {
  return spell?.image ? imageUrl(spell.image) : DEFAULT_ICON;
}

// Roll spec coming from SPELL_ICONS.roll: "attack" | "save:ЛОВ" | null
function parseRoll(spec: string | null): { roll?: RollKind; ability?: string } {
  if (!spec) return {};
  if (spec === "attack") return { roll: "attack" };
  if (spec.startsWith("save:")) return { roll: "save", ability: spec.slice(5) };
  return {};
}

/** Build inspect tooltip for a spell using backend data enriched by SPELL_ICONS. */
export function buildSpellTooltip(spell: Spell): TooltipData {
  const icon = SPELL_ICONS[spellIconKey(spell.name) || ""];
  const level = spell.level ?? icon?.level ?? 0;

  const schoolRu = icon?.school || ru(SCHOOL_RU, spell.school, spell.school || "");
  const subtype =
    level === 0 ? `Заговор · ${schoolRu}` : `${LEVEL_RU[level] || `${level} круг`} · ${schoolRu}`;

  // Roll: prefer curated spec, else derive from backend fields.
  let roll: RollKind | undefined;
  let saveAbility: string | undefined;
  const parsed = parseRoll(icon?.roll ?? null);
  if (parsed.roll) {
    roll = parsed.roll;
    if (parsed.ability) saveAbility = ru(ABILITY_RU, parsed.ability, parsed.ability);
  } else if (spell.save_ability) {
    roll = "save";
    saveAbility = ru(ABILITY_RU, spell.save_ability, spell.save_ability);
  } else if (spell.damage_dice && !spell.auto_hit) {
    roll = "attack";
  }

  const dmg = icon?.dmg || spell.damage_dice || undefined;
  const dtype = icon?.dtype || ru(DTYPE_RU, spell.damage_type, "") || undefined;
  const heal = spell.heal_dice || undefined;

  const meta: [string, string][] = [];
  const range = icon?.range || (spell.range_ft != null ? `${spell.range_ft} фт` : "");
  if (range) meta.push(["🎯", range]);
  const dur = icon?.dur || spell.duration || "";
  if (dur && dur.toLowerCase() !== "мгновенная" && dur.toLowerCase() !== "instantaneous")
    meta.push(["⏱", dur]);
  if (spell.concentration) meta.push(["◈", "Концентрация"]);
  if (spell.area_radius) meta.push(["⊙", `${spell.area_radius} фт`]);

  let save: string | undefined;
  if (roll === "save" && (spell.half_on_save || spell.save_for_half))
    save = "При успехе — половина урона";

  // Cost pips. Reaction/bonus detection from curated cast label.
  const cast = (icon?.cast || spell.casting_time || "Действие").toLowerCase();
  const cost: CostPip[] = [];
  if (cast.includes("бонус") || cast.includes("bonus"))
    cost.push({ shape: "sq", color: "#d88a4a", label: "Бонусное действие" });
  else if (cast.includes("реакц") || cast.includes("reaction"))
    cost.push({ shape: "dia", color: "#6fb6e8", label: "Реакция" });
  else cost.push({ shape: "cir", color: "#d8b24a", label: "Действие" });
  if (level > 0) cost.push({ shape: "sq", color: "#9a7ad8", label: `Слот ${level} круга` });

  return {
    name: icon?.name || spell.name,
    subtype,
    icon: spellImageUrl(spell),
    roll,
    // TODO(backend): передавать spell.attack_bonus / spell.save_dc из движка.
    // Пока их нет — атака показывается как "к20" без бонуса, спасбросок — "Сл 10".
    attackBonus: (spell as any).attack_bonus != null ? fmtBonus((spell as any).attack_bonus) : undefined,
    saveAbility,
    saveDC: (spell as any).save_dc != null ? (spell as any).save_dc : DEFAULT_SAVE_DC,
    dmg,
    dtype,
    heal,
    desc: icon?.desc || spell.description || spell.effect || "",
    save,
    meta,
    cost,
  };
}

export function fmtBonus(n: number): string {
  return n >= 0 ? `+ ${n}` : `− ${Math.abs(n)}`;
}

// ─── Static action / ability definitions ─────────────────────────────────────
// Generic rules text (not character-specific), BG3-style.
export type ActionCategory = "action" | "bonus" | "reaction" | "passive";

export interface ActionDef {
  id: string;
  category: ActionCategory;
  tooltip: TooltipData;
}

const COST_ACTION: CostPip = { shape: "cir", color: "#d8b24a", label: "Действие" };
const COST_BONUS: CostPip = { shape: "sq", color: "#d88a4a", label: "Бонусное действие" };

export const ACTION_DEFS: Record<string, ActionDef> = {
  move: {
    id: "move",
    category: "action",
    tooltip: {
      name: "Движение",
      subtype: "Перемещение",
      icon: DEFAULT_ICON,
      desc: "Переместитесь по сетке в пределах оставшейся скорости. Кликните по свободной клетке.",
      meta: [["👣", "По скорости"]],
    },
  },
  attack: {
    id: "attack",
    category: "action",
    tooltip: {
      name: "Атака оружием",
      subtype: "Действие · ближний бой",
      icon: "/icons/actions/base/main_attack.png",
      roll: "attack",
      // TODO(backend): бонус атаки и кости урона из снаряжения персонажа.
      desc: "Совершаете атаку рукопашным оружием, что держите в руках. При попадании наносите урон костью оружия плюс модификатор характеристики.",
      meta: [["🎯", "Касание"], ["⚔", "Оружие"]],
      cost: [COST_ACTION],
    },
  },
  dash: {
    id: "dash",
    category: "action",
    tooltip: {
      name: "Рывок",
      subtype: "Действие",
      icon: "/icons/actions/base/dash.png",
      desc: "Получаете дополнительное перемещение, равное вашей скорости, до конца текущего хода.",
      meta: [["👣", "+ Скорость"]],
      cost: [COST_ACTION],
    },
  },
  dodge: {
    id: "dodge",
    category: "action",
    tooltip: {
      name: "Уклонение",
      subtype: "Действие",
      icon: DEFAULT_ICON,
      desc: "Сосредотачиваетесь на уклонении. Атаки по вам совершаются с **помехой**, а спасброски Ловкости — с преимуществом, пока действует эффект.",
      meta: [["🛡", "Помеха по вам"]],
      cost: [COST_ACTION],
    },
  },
  disengage: {
    id: "disengage",
    category: "action",
    tooltip: {
      name: "Отход",
      subtype: "Действие",
      icon: "/icons/actions/base/disengage.png",
      desc: "До конца хода ваше перемещение **не провоцирует** атак при покидании досягаемости врагов.",
      meta: [["👣", "Без провокаций"]],
      cost: [COST_ACTION],
    },
  },
  "second-wind": {
    id: "second-wind",
    category: "bonus",
    tooltip: {
      name: "Второе дыхание",
      subtype: "Бонусное действие · Воин",
      icon: DEFAULT_ICON,
      desc: "Черпаете запас сил и восстанавливаете **1к10 + уровень воина** хитов. Ограниченное число раз между отдыхами.",
      heal: "1к10 + ур",
      meta: [["❤", "Лечение"]],
      cost: [COST_BONUS],
    },
  },
};
