import {describe,it,expect} from 'vitest'
import {createMediaVariantResolver,validatedMediaManifest,resolveMediaVariant} from './mediaVariants'

const hash = 'a'.repeat(64)
const entry = { url: `/media/variants/${hash}.webp`, sha256: hash, sourceSha256: 'b'.repeat(64), width: 100, height: 80 }
const manifest = { schemaVersion: 1, entries: { '/assets/battle-maps/a.png': entry } }
describe('verified media presentation mapping', () => {
  it('defaults to originals and never changes print/export or canonical source data', () => {
    const source = '/assets/battle-maps/a.png'
    expect(resolveMediaVariant(source)).toBe(source)
    expect(createMediaVariantResolver(manifest, false)(source)).toBe(source)
    const enabled = createMediaVariantResolver(manifest, true)
    expect(enabled(source)).toBe(entry.url)
    expect(enabled(source, 'print')).toBe(source)
    expect(enabled(source, 'export')).toBe(source)
    expect(Object.keys(manifest.entries)).toEqual([source])
  })
  it('leaves dynamic, remote, query, data, blob, and missing URLs unchanged', () => {
    const resolve = createMediaVariantResolver(manifest, true)
    for (const source of ['https://cdn.test/assets/battle-maps/a.png', '//cdn.test/a.png', '/assets/battle-maps/a.png?v=1', '/assets/battle-maps/a.png#fragment', 'data:image/png;base64,AAA', 'blob:local', '/unknown.png']) expect(resolve(source)).toBe(source)
  })
  it('fails closed to every original for malformed or remapped manifests', () => {
    for (const bad of [null, [], {}, { ...manifest, schemaVersion: 2 }, { ...manifest, entries: { '/assets/battle-maps/a.png': { ...entry, url: '/remote.webp' } } }, { ...manifest, entries: { '//evil/a.png': entry } }, { ...manifest, entries: { '/../a.png': entry } }, { ...manifest, entries: { '/a.png': { ...entry, width: 0 } } }]) {
      expect(validatedMediaManifest(bad)).toBeNull()
      expect(createMediaVariantResolver(bad, true)('/assets/battle-maps/a.png')).toBe('/assets/battle-maps/a.png')
    }
  })
  it('captures an immutable independent mapping so later input mutation cannot change URLs', () => {
    const input = structuredClone(manifest)
    const resolve = createMediaVariantResolver(input, true)
    input.entries['/assets/battle-maps/a.png'].url = '/changed.webp'
    expect(resolve('/assets/battle-maps/a.png')).toBe(entry.url)
    expect(Object.isFrozen(validatedMediaManifest(manifest)?.entries)).toBe(true)
  })
})
