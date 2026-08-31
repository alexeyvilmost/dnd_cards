export type TurnCommand = 'approach' | 'drop' | 'flee' | 'grovel' | 'halt';

const TURN_COMMAND_LABELS: Record<TurnCommand, string> = {
  approach: 'Подойди',
  drop: 'Брось',
  flee: 'Убегай',
  grovel: 'Падай',
  halt: 'Стой',
};

const TURN_COMMAND_INSTRUCTIONS: Record<TurnCommand, string> = {
  approach: 'В начале следующего хода двигайтесь к заклинателю по кратчайшему прямому пути; если окажетесь в 5 фт. от него, завершите ход.',
  drop: 'В начале следующего хода бросьте всё, что держите, затем завершите ход.',
  flee: 'В начале следующего хода удаляйтесь от заклинателя самым быстрым доступным способом, затем завершите ход.',
  grovel: 'В начале следующего хода получите состояние «Сбит с ног», затем завершите ход.',
  halt: 'В начале следующего хода не двигайтесь и не совершайте действий или бонусных действий; завершите ход.',
};

export function turnCommandLabel(command: unknown): string {
  return TURN_COMMAND_LABELS[String(command) as TurnCommand] ?? String(command || 'Приказ');
}

export function turnCommandEffectName(source: string | undefined, command: unknown): string {
  const trimmed = source?.trim();
  const prefix = trimmed && trimmed !== 'действие' ? trimmed : 'Приказ';
  return `${prefix}: ${turnCommandLabel(command)}`;
}

export function turnCommandInstruction(command: unknown): string | null {
  return TURN_COMMAND_INSTRUCTIONS[String(command) as TurnCommand] ?? null;
}
