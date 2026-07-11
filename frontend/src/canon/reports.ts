/**
 * Загрузка прод-снапшота (офлайн) + рендер отчёта покрытия по юниту в markdown.
 * Отчёт пишется в docs/coverage/<unit>.md — это «отчёт по каждому», требуемый владельцем.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Snapshot, UnitReport, SupportStatus } from './audit';
import type { CheckResult } from './checks';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(HERE, '../../..'); // frontend/src/canon → repo root
const SNAP = join(REPO_ROOT, 'officials/canon/prod-snapshot');

export function loadSnapshot(): Snapshot {
  const read = (name: string) => JSON.parse(readFileSync(join(SNAP, `${name}.json`), 'utf8'));
  return {
    classes: read('classes'),
    races: read('races'),
    effects: read('effects'),
    actions: read('actions'),
    spells: read('spells'),
  };
}

export function loadRegistry<T = unknown>(file: string): T {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'officials/canon/phb2024', file), 'utf8'));
}

const STATUS_LABEL: Record<SupportStatus, string> = {
  full: 'Полностью',
  partial: 'Частично',
  needs_engine: 'С доработкой движка',
  needs_content: 'С доработкой контента',
  narrative: 'Нарратив (не поддерживается)',
};

const PRESENCE_ICON: Record<string, string> = {
  present: '✅', missing: '❌', misplaced: '⚠️',
};

export function renderUnitReport(
  report: UnitReport,
  checkResults: CheckResult[],
  extraSections?: string,
): string {
  const c = report.coverage;
  const lines: string[] = [];
  lines.push(`### ${report.name} (\`${report.unit}\`)`);
  lines.push('');
  lines.push(`Покрытие: **${c.present}/${c.totalFeatures} присутствуют**, ${c.missing} отсутствуют, ${c.misplaced} не на своём уровне.`);
  const bs = c.byStatus;
  lines.push(`Категории (классификация): полностью ${bs.full}, частично ${bs.partial}, `
    + `доработка движка ${bs.needs_engine}, доработка контента ${bs.needs_content}, нарратив ${bs.narrative}.`);
  lines.push('');

  lines.push('| Ур | Фича | Классификация | В проде | Заметка |');
  lines.push('|---|---|---|---|---|');
  for (const v of report.verdicts) {
    const note = v.presence === 'misplaced' ? `фактически на ур. ${v.actualLevel}`
      : v.presence === 'missing' ? (v.matchRef ? `ссылка ${v.matchRef} не найдена` : 'нет в проде')
      : (v.matchRef || '');
    lines.push(`| ${v.level} | ${v.name} | ${STATUS_LABEL[v.status]} | ${PRESENCE_ICON[v.presence]} | ${note} |`);
  }
  lines.push('');

  if (report.broken.length) {
    lines.push(`**⚠️ Битые ссылки (${report.broken.length}):** ${report.broken.join(', ')}`);
    lines.push('');
  }
  if (report.extra.length) {
    lines.push(`**Лишнее в проде (не в реестре, ${report.extra.length}):** `
      + report.extra.map((e) => `${e.card_number} «${e.name}» (L${e.level})`).join('; '));
    lines.push('');
  }

  if (checkResults.length) {
    lines.push('**Проверки (checks):**');
    lines.push('');
    for (const r of checkResults) {
      const icon = r.ok ? '✅' : (r.blocking ? '❌' : '⚠️');
      lines.push(`- ${icon} \`${r.type}\` — ${r.detail}`);
    }
    lines.push('');
  }

  if (extraSections) { lines.push(extraSections); lines.push(''); }
  return lines.join('\n');
}

export function renderCoverageDoc(title: string, sections: string[]): string {
  return [
    `# Отчёт покрытия правил: ${title}`,
    '',
    '> Сгенерировано аудитором (`frontend/src/canon`), источник — прод-снапшот',
    '> `officials/canon/prod-snapshot`. Не редактировать руками: перегенерируется тестом',
    '> `barbarian.canon.test.ts`. План: `docs/rules-coverage-plan-2026-07-11.md`.',
    '',
    ...sections,
  ].join('\n');
}
