import type { EntitySupportCertification } from '../content/supportStatus';

export type MonsterAbility = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export interface Monster {
  id: string;
  slug: string;
  name: string;
  name_en?: string | null;
  description: string;
  size: string;
  creature_type: string;
  alignment: string;
  challenge_rating: string;
  armor_class: number;
  max_hp: number;
  speed: number;
  initiative_bonus: number;
  proficiency_bonus: number;
  abilities: Record<MonsterAbility, number>;
  action_ids: string[];
  effect_ids: string[];
  ai: { strategy?: 'melee_chase'; preferred_range_ft?: number; [key: string]: unknown };
  token_url: string;
  source: string;
  support?: EntitySupportCertification | null;
  created_at: string;
  updated_at: string;
}
export type MonsterInput = Omit<
  Monster,
  'id' | 'support' | 'created_at' | 'updated_at'
>;

export interface MonstersResponse {
  monsters: Monster[];
  total: number;
  page: number;
  limit: number;
}
