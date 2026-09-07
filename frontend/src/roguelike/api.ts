import { apiClient } from '../api/client';
import type { ForgeCharacter } from '../character/types';
import type { Monster } from '../monsters/types';
import type { Action, PassiveEffect } from '../types';

export interface RoguelikeOffer {
  id: string;
  card_id?: string;
  card_number?: string;
  name: string;
  price: number;
  quantity: number;
  pinned: boolean;
  sold: boolean;
}

export interface RoguelikeShop {
  generation: number;
  pinned_offer_id?: string;
  offers: RoguelikeOffer[];
  staples: RoguelikeOffer[];
}

export interface RoguelikeEncounter {
  composition_key?: string;
  roster?: Array<{ monster_id: string; monster_slug: string; monster_name: string; quantity: number; xp_each: number }>;
  generator_version?: string;
  catalog?: { version: 1; monsters: Monster[]; actions: Action[]; effects: PassiveEffect[] };
  number?: number;
  difficulty?: 'low' | 'moderate' | 'high';
  budget_xp?: number;
  monster_id?: string;
  monster_slug?: string;
  monster_name?: string;
  quantity?: number;
  xp_each?: number;
  xp_total?: number;
}

export interface RoguelikeReward {
  experience?: number;
  gold?: number;
  total_experience?: number;
  item?: { card_id: string; card_number: string; name: string };
  items?: Array<{ card_id: string; card_number: string; name: string }>;
}

export interface RoguelikeRun {
  id: string;
  user_id: string;
  source_character_id: string;
  character_id: string;
  status: 'active' | 'victory' | 'defeat' | 'abandoned';
  phase: 'camp' | 'combat' | 'ended';
  revision: number;
  experience: number;
  gold: number;
  supplies: number;
  encounters_won: number;
  attempt: number;
  game_clock_hours: number;
  last_long_rest_hour: number;
  paid_refresh_count: number;
  pending_level?: number;
  encounter: RoguelikeEncounter;
  shop: RoguelikeShop;
  last_reward: RoguelikeReward;
  character?: ForgeCharacter;
  created_at: string;
  updated_at: string;
}

export type RoguelikeCommandType =
  | 'start_encounter'
  | 'complete_encounter'
  | 'buy'
  | 'pin'
  | 'refresh_shop'
  | 'short_rest'
  | 'long_rest'
  | 'use_item'
  | 'confirm_level_up'
  | 'retry'
  | 'victory';

export const roguelikeApi = {
  list: async (): Promise<RoguelikeRun[]> => {
    const { data } = await apiClient.get<{ runs: RoguelikeRun[] }>('/api/roguelike/runs');
    return data.runs ?? [];
  },
  get: async (id: string): Promise<RoguelikeRun> => {
    const { data } = await apiClient.get<{ run: RoguelikeRun }>(`/api/roguelike/runs/${id}`);
    return data.run;
  },
  create: async (sourceCharacterId: string): Promise<RoguelikeRun> => {
    const { data } = await apiClient.post<{ run: RoguelikeRun }>('/api/roguelike/runs', {
      source_character_id: sourceCharacterId,
    });
    return data.run;
  },
  command: async (
    id: string,
    revision: number,
    type: RoguelikeCommandType,
    payload: Record<string, unknown> = {},
  ): Promise<RoguelikeRun> => {
    const { data } = await apiClient.post<{ run: RoguelikeRun }>(`/api/roguelike/runs/${id}/commands`, {
      command_id: crypto.randomUUID(),
      expected_revision: revision,
      type,
      payload,
    });
    return data.run;
  },
};
