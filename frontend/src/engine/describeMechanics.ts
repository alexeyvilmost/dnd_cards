/**
 * Общий гуманизатор механики (фаза F, парадигма №2): mechanics → человеческий текст.
 * Работает от СОХРАНЁННОЙ mechanics (а не от состояния редактора), поэтому годится для
 * любого источника — конструктор, лист, disabled-превью, боевой лог, подсказка реакции.
 * Возвращает строку в разметке FormattedText ([fire]…[/fire], :action:, **bold**), чтобы
 * рендериться единообразно. Чистый модуль (без React).
 */
import { getDamageLabel } from '../utils/damageTypes';
import { conditionLabel } from './conditions';

type Dict = Record<string, unknown>;

export interface MechanicsDescription {
  /** Основная строка эффекта (что делает), разметка FormattedText. */
  summary: string;
  /** Доп. строки: стоимость, длительность, использования, ограничения. */
  details: string[];
}

const diceRu = (s: string) => String(s).replace(/(\d)[dд](\d)/gi, '$1к$2');

const ROLL_RU: Record<string, string> = {
  attack: 'атаку', saving_throw: 'спасбросок', ability_check: 'проверку',
  damage: 'урон', ac: 'КЗ', speed: 'скорость', initiative: 'инициативу',
  spell_dc: 'СЛ заклинаний', max_hp: 'макс. хиты',
};
const ABILITY_RU: Record<string, string> = {
  str: 'СИЛ', dex: 'ЛВК', con: 'ТЕЛ', int: 'ИНТ', wis: 'МДР', cha: 'ХАР',
};
const PER_RU: Record<string, string> = {
  turn: 'ход', round: 'раунд', short_rest: 'короткий отдых', long_rest: 'длинный отдых', day: 'день',
};
const DUR_RU: Record<string, string> = {
  rounds: 'раунд(ов)', minutes: 'мин', hours: 'ч', instantaneous: 'мгновенно',
  until_long_rest: 'до длинного отдыха', while_active: 'пока активно',
  until_dispelled: 'до развеивания', permanent: 'постоянно', until_start_of_next_turn: 'до начала след. хода',
};
const RES_ICON = new Set(['action', 'bonus_action', 'reaction', 'spell_slot']);
const RES_RU: Record<string, string> = {
  focus: 'фокус', rage: 'ярость', superiority_die: 'кость превосходства',
  channel_divinity: 'божественный канал', luck_points: 'очко удачи', bardic_inspiration: 'вдохновение',
  second_wind: 'второе дыхание', action_surge: 'прилив действий', hp: 'хиты',
};

const rollRu = (r: unknown) => ROLL_RU[String(r)] ?? String(r ?? 'бросок');
const abilityRu = (a: unknown) => ABILITY_RU[String(a)] ?? String(a ?? '').toUpperCase();

function damagePhrase(p: Dict): string {
  const val = p.dice ?? p.amount ?? p.formula;
  if (val == null || val === '') return '';
  const type = String(p.type ?? p.damage_type ?? '');
  const label = getDamageLabel(type);
  const body = `${diceRu(String(val))}${label ? ` ${label.toLowerCase()}` : ''}`;
  return type ? `[${type}]${body}[/${type}]` : body;
}

function conditionValuePhrase(p: Dict): string {
  const label = conditionLabel(String(p.value ?? ''));
  return String(p.op) === 'remove' ? `снимает **${label}**` : `накладывает **${label}**`;
}

function modifierPhrase(p: Dict): string {
  const applies = (p.applies_to as Dict) ?? {};
  const roll = rollRu(applies.roll);
  const op = String(p.op ?? 'add');
  const projected = String(p.scope ?? 'self') === 'target';
  let core: string;
  if (op === 'advantage') core = `преимущество на ${roll}`;
  else if (op === 'disadvantage') core = `помеха на ${roll}`;
  else core = `${p.value ?? ''} к ${roll}`;
  const base = projected ? `атакующим по вам — ${core}` : core;
  const when = p.when as Dict[] | undefined;
  return when?.length ? `${base} (при условии)` : base;
}

function payloadPhrase(p: Dict): string {
  switch (String(p.kind)) {
    case 'damage': return damagePhrase(p);
    case 'healing': { const v = p.amount ?? p.dice ?? p.formula; return v != null ? `лечение ${diceRu(String(v))}` : 'лечение'; }
    case 'temp_hp': return `временные хиты ${diceRu(String(p.amount ?? ''))}`;
    case 'condition': return conditionValuePhrase(p);
    case 'modifier': return modifierPhrase(p);
    case 'resistance': {
      const lvl = String(p.value ?? 'resistance');
      const w = lvl === 'immunity' ? 'иммунитет' : lvl === 'vulnerability' ? 'уязвимость' : 'сопротивление';
      return `${w} к «${p.damage_type ?? ''}»`;
    }
    case 'resource': return String(p.op) === 'restore' ? `восстанавливает ${p.id}` : `выдаёт ${p.amount ?? 1} ${p.id}`;
    case 'movement': return `${p.value ?? 'перемещение'} ${p.distance ?? ''} фт`.trim();
    case 'grant_action': return `даёт бонусное действие: ${(p.options as string[] ?? []).join(', ')}`;
    case 'boon': return `талон ${diceRu(String(p.die ?? ''))}`;
    case 'set_value': return `устанавливает ${p.target}=${p.formula ?? p.value}`;
    case 'reroll': return 'переброс';
    case 'transform': return 'превращение';
    case 'narrative': return String(p.description ?? p.text ?? '');
    default: return '';
  }
}

function payloadsPhrases(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return (arr as Dict[]).map(payloadPhrase).filter(Boolean);
}

function interactionPhrase(eff: Dict): string {
  const resolution = String(eff.resolution ?? '');
  if (resolution === 'attack_roll') {
    const on = [...payloadsPhrases(eff.on_hit), ...payloadsPhrases(eff.on_crit)];
    return `атака (к20)${on.length ? ` → ${on.join(', ')}` : ''}`;
  }
  if (resolution === 'save') {
    const abil = abilityRu(eff.ability);
    const dc = eff.dc != null ? ` СЛ ${diceRu(String(eff.dc))}` : '';
    const on = payloadsPhrases(eff.on_fail);
    const half = Array.isArray(eff.on_success) && (eff.on_success as Dict[]).some((p) => p.on_success === 'half');
    return `спасбросок ${abil}${dc}${on.length ? ` → ${on.join(', ')}` : ''}${half ? ' (полурон при успехе)' : ''}`;
  }
  if (resolution === 'ability_check') {
    return `проверка ${String(eff.skill ?? abilityRu(eff.ability))}`;
  }
  // auto
  return payloadsPhrases(eff.result ?? eff.results).join(', ');
}

function costDetail(cost: Dict[]): string {
  if (!cost.length) return '';
  const parts = cost.map((c) => {
    const r = String(c.resource ?? '');
    if (r === 'spell_slot') return c.level != null ? `слот ${c.level} круга` : ':spell_slot:';
    if (RES_ICON.has(r)) return `:${r}:`;
    const amount = c.amount != null ? `${c.amount} ` : '';
    return `${amount}${RES_RU[r] ?? r}`;
  });
  return `Стоит: ${parts.join(', ')}`;
}

function durationDetail(duration: Dict | undefined): string {
  if (!duration) return '';
  const t = String(duration.type ?? '');
  if (!t) return '';
  const label = DUR_RU[t] ?? t;
  const amount = duration.amount != null && (t === 'rounds' || t === 'minutes' || t === 'hours') ? `${duration.amount} ` : '';
  const conc = duration.concentration ? ', концентрация' : '';
  return `Длительность: ${amount}${label}${conc}`;
}

function usesDetail(uses: Dict | undefined): string {
  if (!uses) return '';
  const count = uses.count != null ? diceRu(String(uses.count)) : '';
  const per = uses.per != null ? `/${PER_RU[String(uses.per)] ?? uses.per}` : '';
  return count || per ? `Использования: ${count}${per}` : '';
}

/** Сгенерировать человеческое описание механики (summary + details). */
export function describeMechanics(mechanics: Dict | null | undefined): MechanicsDescription {
  if (!mechanics || typeof mechanics !== 'object') return { summary: '', details: [] };

  const activation = mechanics.activation as Dict | undefined;
  const effects = mechanics.effects as Dict[] | undefined;

  const summaryParts = Array.isArray(effects) ? effects.map(interactionPhrase).filter(Boolean) : [];
  const summary = summaryParts.join('; ');

  const details: string[] = [];
  const cost = costDetail((activation?.cost as Dict[]) ?? []);
  if (cost) details.push(cost);
  const dur = durationDetail(mechanics.duration as Dict | undefined);
  if (dur) details.push(dur);
  const uses = usesDetail(mechanics.uses as Dict | undefined);
  if (uses) details.push(uses);

  return { summary, details };
}

/** Короткая одна строка (summary + details через « · ») — для подсказок/лога. */
export function describeMechanicsLine(mechanics: Dict | null | undefined): string {
  const d = describeMechanics(mechanics);
  return [d.summary, ...d.details].filter(Boolean).join(' · ');
}

// ─── Структурированная статистика превью (атака/спасбросок/урон/лечение) из механики ──

const ABILITY_FULL_RU: Record<string, string> = {
  str: 'Сила', dex: 'Ловкость', con: 'Телосложение', int: 'Интеллект', wis: 'Мудрость', cha: 'Харизма',
};
/** Полное русское название характеристики ('dex' → 'Ловкость'). */
export function abilityFullRu(a: string | null | undefined): string {
  return a ? (ABILITY_FULL_RU[a] ?? String(a)) : '';
}

export interface MechanicsStats {
  attack: boolean;
  save: boolean;
  /** Характеристика спасброска ('dex' и т.п.) — из механики, для показа «Ловкость». */
  saveAbility: string | null;
  damage: Array<{ value: string; type: string }>;
  heal: string[];
}

/**
 * Извлечь статистику превью из СОХРАНЁННОЙ механики (executable-истина), а не из
 * легаси-флагов заклинания (attack_roll/saving_throw) — они бывают рассинхронены
 * (напр. Брызги кислоты: saving_throw=false, а в mechanics есть спасбросок ЛВК).
 */
export function parseMechanicsStats(mechanics: Dict | null | undefined): MechanicsStats {
  const out: MechanicsStats = { attack: false, save: false, saveAbility: null, damage: [], heal: [] };
  const effects = Array.isArray((mechanics as Dict | undefined)?.effects) ? ((mechanics as Dict).effects as Dict[]) : [];

  const readDmg = (arr: unknown): void => {
    (Array.isArray(arr) ? (arr as Dict[]) : []).forEach((p) => {
      if (p?.kind === 'damage') {
        const v = p.dice ?? p.formula ?? p.amount;
        // dice:"weapon" — плейсхолдер, значение резолвится из оружия в руке (см. weaponAttackPreview).
        // Без контекста оружия показывать нечего, поэтому пропускаем (иначе рисуется литерал «weapon»).
        if (v != null && v !== '' && v !== 'weapon') {
          out.damage.push({ value: String(v), type: String(p.type ?? p.damage_type ?? 'damage') });
        }
      } else if (p?.kind === 'healing') {
        const v = p.amount ?? p.dice ?? p.formula;
        if (v != null && v !== '') out.heal.push(String(v));
      }
    });
  };

  for (const eff of effects) {
    const res = String(eff.resolution ?? '');
    if (res === 'attack_roll') { out.attack = true; readDmg(eff.on_hit); readDmg(eff.on_crit); }
    else if (res === 'save') { out.save = true; if (!out.saveAbility && eff.ability) out.saveAbility = String(eff.ability); readDmg(eff.on_fail); readDmg(eff.on_success); }
    else readDmg(eff.result ?? eff.results);
  }
  return out;
}
