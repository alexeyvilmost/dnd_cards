/**
 * ПИЛОТ покрытия правил — Варвар (класс + 4 подкласса).
 * (docs/rules-coverage-plan-2026-07-11.md, этап 1.)
 *
 * Офлайн, детерминированно: канонический реестр officials/canon/phb2024/class-barbarian.json
 * сверяется с прод-снапшотом officials/canon/prod-snapshot. Пишет отчёт
 * docs/coverage/class-barbarian.md. Роняет тест ТОЛЬКО на: битых ссылках, провале
 * блокирующих checks (реально работающих фич), регрессии present-базлайна. Отсутствующий
 * контент и гапы — в отчёт, не в красноту (их закрывают волны, а не этот гейт).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  auditUnit, findClassUnit, type CanonUnit, type CanonFeature, type Snapshot,
} from './audit';
import { runChecks, type CheckResult } from './checks';
import { loadSnapshot, loadRegistry, renderUnitReport, renderCoverageDoc, REPO_ROOT } from './reports';

function progressionTables(reg: CanonUnit): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const pt = (reg as unknown as { progression_tables?: Record<string, unknown> }).progression_tables || {};
  for (const [k, v] of Object.entries(pt)) {
    if (k === 'verified_by' || typeof v !== 'object' || v === null) continue;
    out[k] = v as Record<string, number>;
  }
  return out;
}

function checksOf(f: CanonFeature): Record<string, unknown>[] {
  return (f.checks as Record<string, unknown>[] | undefined) || [];
}

describe('Пилот покрытия: Варвар', () => {
  const snapshot: Snapshot = loadSnapshot();
  const reg = loadRegistry<CanonUnit>('class-barbarian.json');
  const base = findClassUnit(snapshot, reg.match?.class_name || 'Варвар');
  const tables = progressionTables(reg);

  it('снапшот и реестр загрузились', () => {
    expect(base, 'базовый Варвар не найден в снапшоте').toBeTruthy();
    expect(reg.features.length).toBeGreaterThan(10);
  });

  // --- аудит базы + подклассов, сбор checks, генерация отчёта ---
  const sections: string[] = [];
  const allChecks: CheckResult[] = [];
  let brokenTotal = 0;

  const baseReport = auditUnit(base!, reg.features, snapshot, reg.unit, reg.names.ru, 20);
  brokenTotal += baseReport.broken.length;
  const baseChecks: CheckResult[] = [];
  for (const f of reg.features) {
    const cs = checksOf(f);
    if (cs.length) baseChecks.push(...runChecks(f, cs, { unit: base!, snapshot, progressionTables: tables }));
  }
  allChecks.push(...baseChecks);

  // core_traits как отдельная секция-проверка
  const ct = (reg.core_traits || {}) as Record<string, unknown>;
  const traitLines: string[] = ['**Core traits (сверка полей класса):**', ''];
  const traitOk: Record<string, boolean> = {};
  const cmp = (label: string, expected: unknown, actual: unknown) => {
    const ok = JSON.stringify(expected) === JSON.stringify(actual);
    traitOk[label] = ok;
    traitLines.push(`- ${ok ? '✅' : '❌'} ${label}: прод=${JSON.stringify(actual)} канон=${JSON.stringify(expected)}`);
  };
  cmp('hit_die', ct.hit_die, base!.hit_die);
  cmp('saving_throws', ct.saving_throws, base!.saving_throws);
  cmp('armor_training', ct.armor_training, base!.armor_training);
  cmp('weapon_proficiencies', ct.weapon_proficiencies, base!.weapon_proficiencies);

  sections.push(renderUnitReport(baseReport, baseChecks, traitLines.join('\n')));

  const subReports: { name: string; present: number; total: number }[] = [];
  for (const sub of reg.subclasses || []) {
    const ent = findClassUnit(snapshot, sub.match?.class_name || sub.names.ru);
    if (!ent) { sections.push(`### ${sub.names.ru} — ❌ не найден в снапшоте (\`${sub.match?.class_name}\`)`); continue; }
    const rep = auditUnit(ent, sub.features, snapshot, sub.unit, sub.names.ru, 20);
    brokenTotal += rep.broken.length;
    const subChecks: CheckResult[] = [];
    for (const f of sub.features) {
      const cs = checksOf(f);
      if (cs.length) subChecks.push(...runChecks(f, cs, { unit: ent, snapshot, progressionTables: tables }));
    }
    allChecks.push(...subChecks);
    sections.push(renderUnitReport(rep, subChecks));
    subReports.push({ name: sub.names.ru, present: rep.coverage.present, total: rep.coverage.totalFeatures });
  }

  // сводка по движковым дырам (ссылки engine_ref из аспектов)
  const engRefs = new Map<string, number>();
  const countRefs = (feats: CanonFeature[]) => {
    for (const f of feats) for (const a of f.aspects || []) if (a.engine_ref) engRefs.set(a.engine_ref, (engRefs.get(a.engine_ref) || 0) + 1);
  };
  countRefs(reg.features);
  for (const s of reg.subclasses || []) countRefs(s.features);
  const engSummary = ['**Блокеры движка (engine_ref → сколько аспектов ждут):**', '',
    ...[...engRefs.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `- ${r}: ${n}`)].join('\n');

  const doc = renderCoverageDoc('Варвар (class:barbarian)', [...sections, engSummary]);
  writeFileSync(join(REPO_ROOT, 'docs/coverage/class-barbarian.md'), doc + '\n');

  // ---------- АССЕРТЫ (гейт) ----------
  it('нет битых ссылок фич (база + подклассы)', () => {
    const allBroken = [baseReport, ...(reg.subclasses || []).map((s) => {
      const e = findClassUnit(snapshot, s.match?.class_name || s.names.ru);
      return e ? auditUnit(e, s.features, snapshot, s.unit, s.names.ru, 20) : null;
    }).filter(Boolean)] as { broken: string[] }[];
    const flat = allBroken.flatMap((r) => r.broken);
    expect(flat, flat.join('; ')).toHaveLength(0);
    expect(brokenTotal).toBe(0);
  });

  it('core traits Варвара совпадают с каноном', () => {
    const bad = Object.entries(traitOk).filter(([, ok]) => !ok).map(([k]) => k);
    expect(bad, `расходятся: ${bad.join(', ')}`).toHaveLength(0);
  });

  it('блокирующие checks (реально работающие фичи) — зелёные', () => {
    const failed = allChecks.filter((r) => !r.ok && r.blocking).map((r) => `${r.feature}/${r.type}: ${r.detail}`);
    expect(failed, `провалены:\n${failed.join('\n')}`).toHaveLength(0);
  });

  it('present-базлайн не регрессировал (фичи не исчезли из прода)', () => {
    // на 2026-07-11: база Варвара — 9 присутствуют из 24 (остальное missing/misplaced/needs_content)
    expect(baseReport.coverage.present).toBeGreaterThanOrEqual(9);
    // все 4 подкласса присутствуют структурно (по 4-5 фич каждый)
    for (const s of subReports) {
      expect(s.present, `${s.name}: присутствует ${s.present}/${s.total}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('отчёт docs/coverage/class-barbarian.md сгенерирован', () => {
    expect(doc.length).toBeGreaterThan(500);
    expect(doc).toContain('Ярость');
  });
});
