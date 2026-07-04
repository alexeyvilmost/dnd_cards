import type { AttackRollResult } from './attackParser';

/** Один результат броска: итог + значения костей + плоский бонус + подпись (тип урона). */
export interface RollChip {
  total: number;
  dice: number[];
  bonus?: number;
  suffix?: string;
}

export interface LogLine {
  label: string;
  chips: RollChip[];
}

export interface CombatLogEntry {
  id: string;
  ts: number;
  /** Акцентный цвет существа (hex) для полоски слева. */
  color: string;
  /** Заголовок: «Мумия атакует…» либо сообщение об HP. */
  title: string;
  /** Строки с бросками (пусто для простых сообщений об HP). */
  lines: LogLine[];
}

function newEntry(color: string, title: string, lines: LogLine[] = []): CombatLogEntry {
  return { id: crypto.randomUUID(), ts: Date.now(), color, title, lines };
}

export function buildAttackEntry(
  creatureName: string,
  color: string,
  result: AttackRollResult,
): CombatLogEntry {
  const bonus = result.bonus !== 0 ? result.bonus : undefined;
  const attackLine: LogLine = {
    label: 'Броски атаки',
    chips: result.attackRolls.map((r) => ({ total: r.total, dice: [r.die], bonus })),
  };
  const lines: LogLine[] = [attackLine];

  if (result.damageRolls.length > 0) {
    lines.push({
      label: 'Броски урона',
      chips: result.damageRolls.map((dr) => ({
        total: dr.total,
        dice: dr.dice,
        bonus: dr.bonus !== 0 ? dr.bonus : undefined,
        suffix: dr.type,
      })),
    });
  }

  const name = creatureName || 'Существо';
  return newEntry(color, `${name} атакует, используя ${result.attackName}.`, lines);
}

export function buildDamageEntry(creatureName: string, color: string, amount: number): CombatLogEntry {
  return newEntry(color, `${creatureName || 'Существо'} получает ${amount} урона`);
}

export function buildHealEntry(creatureName: string, color: string, amount: number): CombatLogEntry {
  return newEntry(color, `${creatureName || 'Существо'} исцеляется на ${amount} здоровья`);
}

export function buildHpChangeEntry(
  creatureName: string,
  color: string,
  from: number,
  to: number,
): CombatLogEntry {
  return newEntry(color, `Здоровье ${creatureName || 'Существо'} меняется: ${from} -> ${to}`);
}
