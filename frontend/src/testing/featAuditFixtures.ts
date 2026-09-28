import manifestJSON from '../../../backend/migrations/data/catalog-audit-20260929/feats.json';

export type AuditDict = Record<string, any>;
export interface FeatAuditEntry {
  entity_type: string; id: string; card_number: string; name: string;
  preimage: AuditDict | null; patch?: AuditDict;
  review?: {status: string; tested: string[]; limitations: string[]};
}
export const featAudit = manifestJSON as unknown as {entities: FeatAuditEntry[]; guards: FeatAuditEntry[]};
export const auditedRows = [...featAudit.guards, ...featAudit.entities].map((entry) => ({
  ...entry.preimage, ...entry.patch, id: entry.id, card_number: entry.card_number,
  entity_type: entry.entity_type,
})) as AuditDict[];
export function auditedRow(reference: string): AuditDict {
  const row = auditedRows.find((entry) => entry.id === reference || entry.card_number === reference);
  if (!row) throw new Error(`Missing guarded catalog dependency: ${reference}`);
  return row;
}
export function featEffects(n: number): AuditDict[] {
  return (auditedRow(`FEAT-${String(n).padStart(4, '0')}`).related_effects ?? []).map(auditedRow);
}
export function featMechanics(n: number): AuditDict[] {
  return featEffects(n).map((effect) => ({...effect.mechanics, id: effect.id, name: effect.name}));
}
export function* auditPayloads(value: any): Generator<AuditDict> {
  if (Array.isArray(value)) for (const entry of value) yield* auditPayloads(entry);
  else if (value && typeof value === 'object') {
    yield value;
    for (const entry of Object.values(value)) yield* auditPayloads(entry);
  }
}
