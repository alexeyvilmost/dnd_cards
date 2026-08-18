import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MICRO_MVP_L1_CONTENT_PATCH } from '../../canon/declarativeMechanicsPatch';
import {
  MICRO_MVP_CONDITION_CERTIFICATION_VERSION,
  type ConditionEffectRecord,
} from '../../api/conditionsApi';
import { validateConditionDatabaseMaterialization } from '../../canon/conditionDatabaseMaterialization';

function versionedRows(): ConditionEffectRecord[] {
  return MICRO_MVP_L1_CONTENT_PATCH.conditionPatches.map((declaration) => ({
    card_number: declaration.cardNumber,
    name: String(declaration.fields.name ?? ''),
    description: String(declaration.fields.description ?? ''),
    effect_type: String(declaration.fields.effect_type ?? ''),
    mechanics: structuredClone(declaration.fields.mechanics),
  }));
}

describe('condition database materialization release gate', () => {
  it('uses the same certification suite identity as the production batch', () => {
    const moduleUrl = new URL(
      '../../../../scripts/content/micro-mvp-certifications.mjs',
      import.meta.url,
    );
    const source = readFileSync(fileURLToPath(moduleUrl), 'utf8');
    const certificationVersion = source.match(
      /export const MICRO_MVP_CERTIFICATION_VERSION\s*=\s*'([^']+)'/,
    )?.[1];
    expect(MICRO_MVP_CONDITION_CERTIFICATION_VERSION)
      .toBe(certificationVersion);
  });

  it('materializes every versioned DB record into the atomically tested executable rule', () => {
    expect(() => validateConditionDatabaseMaterialization(versionedRows())).not.toThrow();
  });

  it('fails closed when the adapter would drop one DB-owned clause', () => {
    const rows = versionedRows();
    const blinded = rows.find((row) => (
      (row.mechanics as { condition?: { id?: string } }).condition?.id === 'blinded'
    ))!;
    const mechanics = blinded.mechanics as {
      effects: Array<{ result: Array<Record<string, unknown>> }>;
    };
    mechanics.effects[0].result.pop();
    expect(() => validateConditionDatabaseMaterialization(rows))
      .toThrow(/blinded: database materializer changes or drops executable mechanics/);
  });
});
