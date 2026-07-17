/**
 * Инварианты данных действий на прод-снапшоте (задача 0.9 / KB-027).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from '../canon/reports';

type Dict = Record<string, unknown>;
const raw = JSON.parse(readFileSync(join(REPO_ROOT, 'officials/canon/prod-snapshot/actions.json'), 'utf8')) as unknown;
const ACTIONS: Dict[] = (Array.isArray(raw) ? raw : (Object.values(raw as Dict).find(Array.isArray) as Dict[])) ?? [];

describe('прод-данные: действия (KB-027)', () => {
  it('«Помощь» — базовое действие (type=basic), иначе на лист не грузится', () => {
    const help = ACTIONS.find((a) => a.id === '2863e54d-0d7e-4d2c-8291-0f222a7ce662');
    expect(help, '«Помощь» в снапшоте').toBeTruthy();
    // Базовые действия грузятся getActions({type:'basic'}); null → действие нигде не появляется.
    expect(help?.type).toBe('basic');
  });
});
