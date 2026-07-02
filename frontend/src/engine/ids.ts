/** UUID v4 (и совместимые варианты) — отличаем от slug/card_number. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isEntityUuid(ref: string): boolean {
  return UUID_RE.test(ref.trim());
}

export function splitRefs(refs: string[]): { uuids: string[]; slugs: string[] } {
  const uuids: string[] = [];
  const slugs: string[] = [];
  for (const raw of refs) {
    const ref = raw.trim();
    if (!ref) continue;
    if (isEntityUuid(ref)) uuids.push(ref);
    else slugs.push(ref);
  }
  return { uuids, slugs };
}
