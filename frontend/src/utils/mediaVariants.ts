// Presentation-only mapping. Canonical URLs, saved documents and exports stay original.
type Variant = Readonly<{ url: string; sha256: string; sourceSha256: string; width: number; height: number }>
type MediaManifest = Readonly<{ schemaVersion: 1; entries: Readonly<Record<string, Variant>> }>
declare const __MEDIA_VARIANTS__: unknown
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function validatedMediaManifest(value: unknown): MediaManifest | null {
  if (!plain(value) || value.schemaVersion !== 1 || !plain(value.entries) || Object.keys(value.entries).length > 512) return null
  const entries: Record<string, Variant> = Object.create(null)
  for (const [source, row] of Object.entries(value.entries)) {
    if (!/^\/(?!\/)[^?#\\]+\.png$/i.test(source) || source.split('/').some(part => part === '..' || part === '.') || !plain(row)
      || !digest(row.sha256) || !digest(row.sourceSha256) || row.url !== `/media/variants/${row.sha256}.webp`
      || !Number.isSafeInteger(row.width) || !Number.isSafeInteger(row.height) || Number(row.width) < 1 || Number(row.height) < 1) return null
    entries[source] = Object.freeze({ url: String(row.url), sha256: row.sha256, sourceSha256: row.sourceSha256, width: Number(row.width), height: Number(row.height) })
  }
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries) })
}

export function createMediaVariantResolver(manifest: unknown, enabled: boolean) {
  const validated = enabled ? validatedMediaManifest(manifest) : null
  return (source: string, purpose: 'screen' | 'print' | 'export' = 'screen'): string => {
    if (!validated || purpose !== 'screen') return source
    return validated.entries[source]?.url ?? source
  }
}

const manifest = typeof __MEDIA_VARIANTS__ === 'undefined' ? null : __MEDIA_VARIANTS__
export const resolveMediaVariant = createMediaVariantResolver(manifest, manifest !== null)
