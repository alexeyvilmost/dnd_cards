import { describe, expect, it } from 'vitest';
import type { MonsterInput } from '../monsters/types';
import { monsterPayloadForSave } from './MonsterCreator';

const monster = (token_url: string): MonsterInput => ({
  slug: 'goblin-warrior', name: 'Гоблин', description: '', size: 'small',
  creature_type: 'goblinoid', alignment: '', challenge_rating: '1/4',
  armor_class: 15, max_hp: 10, speed: 30, initiative_bonus: 2,
  proficiency_bonus: 2,
  abilities: { str: 8, dex: 15, con: 10, int: 10, wis: 8, cha: 8 },
  action_ids: [], effect_ids: [], ai: { strategy: 'melee_chase' }, token_url, source: '',
});

describe('monster constructor image save boundary', () => {
  it('never sends a selected base64 file through the monster JSON update', () => {
    const dataUrl = 'data:image/png;base64,local-file';
    const { localToken, payload } = monsterPayloadForSave(
      monster(dataUrl),
      'https://storage.example/old-token.png',
    );
    expect(localToken).toBe(dataUrl);
    expect(payload.token_url).toBe('https://storage.example/old-token.png');
  });

  it('passes an ordinary remote token URL through unchanged', () => {
    const form = monster('https://storage.example/new-token.png');
    expect(monsterPayloadForSave(form, 'https://storage.example/old-token.png'))
      .toEqual({ localToken: null, payload: form });
  });
});
