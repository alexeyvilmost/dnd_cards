import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import schema from '../schemas/mechanics.schema.json';

export type MechanicKind = 'passive_effect' | 'action' | 'spell' | 'trait';

export interface MechanicMeta {
  id: string;
  name: string;
  kind: MechanicKind;
}

/** Привести внешний идентификатор к slug-формату, которую требует схема. */
export function normalizeMechanicId(id: string): string {
  const normalized = String(id || '')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return normalized || 'draft';
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateCard = ajv.compile(schema);

/** Привести сохранённый формат конструктора к MechanicCard для ajv. */
export function normalizeMechanicsForSchema(
  mechanics: Record<string, unknown>,
  meta: MechanicMeta,
): Record<string, unknown> {
  const activation = (mechanics.activation as Record<string, unknown>) || { mode: 'passive' };
  const interactions = (mechanics.effects as unknown[]) || (mechanics.interactions as unknown[]) || [];
  return {
    schema_version: '1.0',
    id: normalizeMechanicId(meta.id),
    name: meta.name || 'draft',
    kind: meta.kind,
    activation,
    interactions,
    ...(mechanics.uses ? { uses: mechanics.uses } : {}),
    ...(mechanics.targeting ? { targeting: mechanics.targeting } : {}),
  };
}

export function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors?.length) return [];
  return errors.map((e) => {
    const path = e.instancePath || '/';
    return `${path}: ${e.message ?? 'ошибка'}`;
  });
}

/** Валидировать mechanics-объект. null/пустой — ок. */
export function validateMechanics(
  mechanics: Record<string, unknown> | null | undefined,
  meta: MechanicMeta,
): { valid: boolean; errors: string[] } {
  if (!mechanics || Object.keys(mechanics).length === 0) {
    return { valid: true, errors: [] };
  }
  const card = normalizeMechanicsForSchema(mechanics, meta);
  const valid = validateCard(card);
  return { valid: !!valid, errors: formatAjvErrors(validateCard.errors) };
}
