import type { CharacterEventRow } from '../character/api';
import type { SoloCombatState } from '../solo-combat/types';
import { apiClient, ApiRequestError } from '../api/client';
import type { ForgeCharacter } from '../character/types';
import type { Monster } from '../monsters/types';
import type { Action, PassiveEffect } from '../types';
import {playCommandSound,playCommittedEvents} from '../audio/commandSounds';
import type {RollInfluence} from '../engine/rollInfluence';
import type {RollLog} from '../mvp/contracts';
import {notifyRunUpdated} from './navigation';

export interface JourneyAura extends PassiveEffect {key:string;mechanics:NonNullable<PassiveEffect['mechanics']>}
export interface JourneyRoom {id:string;name:string;description:string;icon:string}
export interface JourneyNode {id:string;row:number;lane:number;kind:string;next:string[];completed:boolean;resolved_kind?:string}
export interface JourneyCheck {skill:string;ability:string;dc:number}
export interface JourneyOption {id:string;name:string;description:string;cost_gold?:number;checks?:JourneyCheck[]}
export interface UrvinDefinition {id:string;name:string;description:string;auras:JourneyAura[]}
export interface UrvinJourney {version:1;name:string;nodes:JourneyNode[];current_node:string;aura:JourneyAura;aura_active:boolean;rooms:JourneyRoom[];
  stash?:Array<{card_id:string;name:string}>;
  event?:{definition:{id:string;name:string;description:string;options:JourneyOption[]};choice_id?:string;actor_id?:string;check_index:number;finished:boolean;
    pending?:{phase:'influence'|'boost'|'resolved';roll:RollLog;influences:RollInfluence[]};rolls:Array<{roll:RollLog}>};}

export interface RoguelikeOffer {
  id: string;
  card_id?: string;
  card_number?: string;
  name: string;
  price: number;
  price_currency?: string;
  quantity: number;
  pinned: boolean;
  sold: boolean;
  starting_only?: boolean;
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
  mode?: 'classic'|'urvin';
  journey?: UrvinJourney;
  command_events?: CharacterEventRow[];
  combat_state?: SoloCombatState;
  /** Initialization receipt only: exact board before automatic enemy turns. */
  combat_opening_state?: SoloCombatState;
  trusted_combat_available?: boolean;
  id: string;
  user_id: string;
  source_character_id: string;
  character_id: string;
  party?: {members?:Array<{character_id:string;source_character_id:string}>};
  characters?: ForgeCharacter[];
  status: 'active' | 'victory' | 'defeat' | 'abandoned';
  phase: 'camp' | 'combat' | 'ended';
  revision: number;
  experience: number;
  gold: number;
  supplies: number;
  encounters_won: number;
  attempt: number;
  game_clock_hours: number;
  game_clock_remainder_seconds?: number;
  last_long_rest_remainder_seconds?: number;
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
  | 'enter_room' | 'leave_room' | 'resume_room' | 'claim_stash' | 'event_choice' | 'event_roll' | 'event_resolve' | 'event_continue'
  | 'initialize_combat'
  | 'combat_intent'
  | 'upgrade_combat_rules'
  | 'start_encounter'
  | 'complete_encounter'
  | 'buy'
  | 'buy_cart'
  | 'sell'
  | 'transfer_item'
  | 'pin'
  | 'refresh_shop'
  | 'bind_weapon' | 'recall_weapon' | 'camp_action' | 'camp_turn'
  | 'short_rest'
  | 'long_rest'
  | 'use_item'
  | 'confirm_level_up'
  | 'retry'
  | 'victory';

export const roguelikeApi = {
  initiativeOptions: async (id: string, revision: number): Promise<{enabled: false} | {
    enabled: true; run_revision: number; character_id: string; runtime_revision: number;
    artifact_hash: string; content_manifest_hash: string; options: Action[];
  }> => {
    try {
      const {data} = await apiClient.get(`/api/roguelike/runs/${id}/initiative-options`, {params: {expected_revision: revision}});
      if (typeof data?.enabled !== 'boolean' || (data.enabled && !Array.isArray(data.options))) {
        throw Error('Сервер не вернул доступные варианты инициативы');
      }
      return data;
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return {enabled: false};
      throw error;
    }
  },
  modes: async ():Promise<UrvinDefinition> => (await apiClient.get<{mode:UrvinDefinition}>('/api/roguelike/runs/modes')).data.mode,
  listSelection: async (): Promise<{runs: RoguelikeRun[]; unavailable_source_character_ids: string[]}> => {
    const {data} = await apiClient.get<{runs: RoguelikeRun[]; unavailable_source_character_ids?: string[]}>('/api/roguelike/runs');
    return {runs: data.runs ?? [], unavailable_source_character_ids: data.unavailable_source_character_ids ?? []};
  },
  list: async (): Promise<RoguelikeRun[]> => {
    const { data } = await apiClient.get<{ runs: RoguelikeRun[] }>('/api/roguelike/runs');
    return data.runs ?? [];
  },
  get: async (id: string): Promise<RoguelikeRun> => {
    const { data } = await apiClient.get<{ run: RoguelikeRun }>(`/api/roguelike/runs/${id}`);
    return data.run;
  },
  remove: async (id: string): Promise<void> => {
    await apiClient.delete(`/api/roguelike/runs/${id}`);
    notifyRunUpdated();
  },
  create: async (sourceCharacterId: string | string[], options?:{mode?:string;aura_id?:string;templates?:Array<{template_id:string;name:string}>}): Promise<RoguelikeRun> => {
    const { data } = await apiClient.post<{ run: RoguelikeRun }>('/api/roguelike/runs', {
      ...(Array.isArray(sourceCharacterId)?{source_character_ids:sourceCharacterId}:{source_character_id: sourceCharacterId}),
      ...options,
    });
    return data.run;
  },
  command: async (
    id: string,
    revision: number,
    type: RoguelikeCommandType,
    payload: Record<string, unknown> = {},
    commandId: string = crypto.randomUUID(),
  ): Promise<RoguelikeRun> => {
    const { data } = await apiClient.post<{ run: RoguelikeRun; events?: CharacterEventRow[] }>(`/api/roguelike/runs/${id}/commands`, {
      command_id: commandId,
      expected_revision: revision,
      type,
      payload,
    });
    playCommandSound(type,commandId);
    if(type==='camp_action'||type==='use_item')playCommittedEvents((data.events??[]).map(e=>e.payload),commandId);
    return { ...data.run, command_events: data.events };
  },
};
