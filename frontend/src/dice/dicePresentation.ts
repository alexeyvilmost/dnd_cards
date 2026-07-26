import type { PlannedDie } from '../engine/dicePlan';

export interface DicePresentation {
  key: string;
  label: string;
  color: string;
  textColor: string;
}

export interface DiceThrowConfig {
  strength: number;
  throwForce: number;
  spinForce: number;
  startingHeight: number;
}

export interface DiceReleasePoint {
  x: number;
  y: number;
}

const DICE_WORLD_SIZE = 9.5;

/**
 * Перевод силы пользовательского жеста в параметры физической сцены.
 * Нижняя граница не даёт костям «урониться на месте», верхняя ограничивает
 * слишком резкие жесты и сохраняет предсказуемое время остановки.
 */
export function diceThrowConfig(strength: number): DiceThrowConfig {
  const normalized = Math.max(0.15, Math.min(1, strength));
  return {
    strength: normalized,
    throwForce: 4.5 + normalized * 10.5,
    spinForce: 4 + normalized * 10,
    startingHeight: 6.5 + normalized * 5,
  };
}

/** Перевод экранной точки отпускания в координаты физического стола DiceBox. */
export function diceStartPosition(
  release: DiceReleasePoint,
  viewport: { width: number; height: number },
  startingHeight: number,
): [number, number, number] {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const aspect = width / height;
  const normalizedX = Math.max(-1, Math.min(1, release.x / width * 2 - 1));
  const normalizedY = Math.max(-1, Math.min(1, release.y / height * 2 - 1));
  // Оставляем запас до физических стен, чтобы крупная кость не появилась внутри коллайдера.
  return [
    normalizedX * DICE_WORLD_SIZE * aspect * 0.43,
    startingHeight,
    normalizedY * DICE_WORLD_SIZE * 0.43,
  ];
}

const ABILITY_TONES: Array<{ match: RegExp; tone: DicePresentation }> = [
  { match: /(сил|strength|athletics|атлетик)/i, tone: { key: 'str', label: 'Сила', color: '#8f2f2b', textColor: '#f7dfbd' } },
  { match: /(ловк|лов\b|dexterity|acrobat|stealth|скрыт|инициатив)/i, tone: { key: 'dex', label: 'Ловкость', color: '#315f42', textColor: '#f2e5bd' } },
  { match: /(телослож|тел\b|constitution|концентрац)/i, tone: { key: 'con', label: 'Телосложение', color: '#555b5d', textColor: '#f4e8ce' } },
  { match: /(интеллект|инт\b|intelligence|arcana|history|investigation|магия|истори|расслед)/i, tone: { key: 'int', label: 'Интеллект', color: '#294f78', textColor: '#f1dfb8' } },
  { match: /(мудр|wisdom|perception|insight|survival|восприят|прониц|выжив)/i, tone: { key: 'wis', label: 'Мудрость', color: '#a47a20', textColor: '#241b0e' } },
  { match: /(харизм|хар\b|charisma|persuasion|deception|intimidation|performance|убежд|обман|запуг|выступ)/i, tone: { key: 'cha', label: 'Харизма', color: '#663d78', textColor: '#f5dfc4' } },
];

const DAMAGE_TONES: Array<{ match: RegExp; tone: DicePresentation }> = [
  { match: /(огонь|fire)/i, tone: { key: 'fire', label: 'Огонь', color: '#a43b24', textColor: '#ffe3b3' } },
  { match: /(холод|cold)/i, tone: { key: 'cold', label: 'Холод', color: '#33798b', textColor: '#e8fbff' } },
  { match: /(молни|lightning)/i, tone: { key: 'lightning', label: 'Молния', color: '#b78919', textColor: '#211807' } },
  { match: /(кислот|acid)/i, tone: { key: 'acid', label: 'Кислота', color: '#668432', textColor: '#f2f6ce' } },
  { match: /(яд|poison)/i, tone: { key: 'poison', label: 'Яд', color: '#416738', textColor: '#eef0c5' } },
  { match: /(некрот|necrotic)/i, tone: { key: 'necrotic', label: 'Некротический', color: '#493451', textColor: '#ead9ee' } },
  { match: /(излуч|radiant)/i, tone: { key: 'radiant', label: 'Излучение', color: '#c59a3a', textColor: '#241b0b' } },
  { match: /(психич|psychic)/i, tone: { key: 'psychic', label: 'Психический', color: '#8a3f72', textColor: '#f7daec' } },
  { match: /(звук|гром|thunder)/i, tone: { key: 'thunder', label: 'Звук', color: '#4d4e83', textColor: '#ece8ff' } },
  { match: /(силовое|force)/i, tone: { key: 'force', label: 'Силовое поле', color: '#3d4f84', textColor: '#e5eaff' } },
  { match: /(рубящ|slashing)/i, tone: { key: 'slashing', label: 'Рубящий', color: '#763833', textColor: '#f4dfc6' } },
  { match: /(колющ|piercing)/i, tone: { key: 'piercing', label: 'Колющий', color: '#4e6268', textColor: '#f1e8d5' } },
  { match: /(дробящ|bludgeoning)/i, tone: { key: 'bludgeoning', label: 'Дробящий', color: '#735d3e', textColor: '#f4e2c0' } },
];

const ATTACK: DicePresentation = {
  key: 'attack',
  label: 'Атака',
  color: '#27231f',
  textColor: '#e5c98f',
};

const HEALING: DicePresentation = {
  key: 'healing',
  label: 'Лечение',
  color: '#47705a',
  textColor: '#f3e5bd',
};

const DEFAULT: DicePresentation = {
  key: 'default',
  label: 'Бросок',
  color: '#6f5134',
  textColor: '#f1dfbd',
};

/** Цвет и визуальная роль кости определяются данными плана, а не конкретным действием. */
export function dicePresentation(die: PlannedDie): DicePresentation {
  const label = die.label || '';
  if (/(атак|attack)/i.test(label) && die.sides === 20) return ATTACK;
  if (/(лечен|исцелен|healing|heal)/i.test(label)) return HEALING;
  if (/(урон|damage)/i.test(label)) {
    return DAMAGE_TONES.find(({ match }) => match.test(label))?.tone ?? DEFAULT;
  }
  return ABILITY_TONES.find(({ match }) => match.test(label))?.tone ?? DEFAULT;
}

export interface DiceResultGroup {
  label: string;
  sides: number;
  values: number[];
  presentation: DicePresentation;
}

export function groupDiceResults(plan: PlannedDie[], values: number[]): DiceResultGroup[] {
  const groups: DiceResultGroup[] = [];
  plan.forEach((die, index) => {
    const previous = groups[groups.length - 1];
    const value = values[index];
    if (previous && previous.label === die.label && previous.sides === die.sides) {
      previous.values.push(value);
    } else {
      groups.push({
        label: die.label,
        sides: die.sides,
        values: [value],
        presentation: dicePresentation(die),
      });
    }
  });
  return groups;
}
