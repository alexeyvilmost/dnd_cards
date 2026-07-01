import { SKILLS } from '../mechanics/registries';

const LABEL_TO_ID: Record<string, string> = Object.fromEntries(
  SKILLS.map((s) => [s.label.toLowerCase(), s.id]),
);

/** Нормализует skill-id или русское название навыка к canonical id. */
export function normalizeSkillId(value: string): string {
  const trimmed = value.trim();
  if (SKILLS.some((s) => s.id === trimmed)) return trimmed;
  const byLabel = LABEL_TO_ID[trimmed.toLowerCase()];
  return byLabel || trimmed;
}

export function normalizeSkillList(values: string[] | null | undefined): string[] {
  if (!values?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const id = normalizeSkillId(v);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
