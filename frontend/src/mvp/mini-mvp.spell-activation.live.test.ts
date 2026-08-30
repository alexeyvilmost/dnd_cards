import { beforeAll, describe, expect, it } from 'vitest';
import { API_BASE_URL } from '../api/client';
import type { Spell } from '../types';
import { readLiveJson } from './liveJsonRead';
import {
  buildMiniMvpSpellActivationCatalog,
  MINI_MVP_SPELL_ACTIVATION_CATALOG_VERSION,
  type MiniMvpSpellActivationManifest,
  type VerifiedMiniMvpSpellActivation,
} from './miniMvpSpellActivationCatalog';

describe.skipIf(process.env.MVP_CONTENT !== '1')('mini-MVP live spell activation catalog', () => {
  let verified: VerifiedMiniMvpSpellActivation[];

  beforeAll(async () => {
    const manifestUrl = new URL('../../../scripts/content/mini-mvp-manifest.mjs', import.meta.url);
    const { MINI_MVP_MANIFEST } = await import(/* @vite-ignore */ manifestUrl.href) as {
      MINI_MVP_MANIFEST: MiniMvpSpellActivationManifest;
    };
    const body = await readLiveJson<Record<string, unknown>>(
      `${API_BASE_URL}/api/spells?page=1&limit=1000`,
      { label: '/api/spells activation catalog' },
    );
    if (!Array.isArray(body.spells)) throw new Error('/api/spells: required collection spells is missing');
    verified = buildMiniMvpSpellActivationCatalog(MINI_MVP_MANIFEST, body.spells as Spell[]);
  }, 180_000);

  it('certifies every pinned cantrip and first-level spell through the real sheet boundary', () => {
    expect(MINI_MVP_SPELL_ACTIVATION_CATALOG_VERSION).toBe('mini-mvp-spell-activation-v1');
    expect(verified).toHaveLength(98);
    expect(verified.filter((spell) => spell.level === 0)).toHaveLength(34);
    expect(verified.filter((spell) => spell.level === 1)).toHaveLength(64);
    expect(new Set(verified.map((spell) => spell.cardNumber)).size).toBe(98);
    expect(verified.every((spell) => spell.evidence.length === 5)).toBe(true);
  });
});
