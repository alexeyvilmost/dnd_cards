import axios from "axios";

// Same-origin: in dev Vite proxies API prefixes to the backend; in prod nginx
// proxies them. So a relative baseURL works in both environments.
export const api = axios.create({ baseURL: "/" });

// ─── Shared types ───────────────────────────────────────────────────────────

export interface AbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export interface Spell {
  id?: string;
  name: string;
  level: number;
  school: string;
  casting_time?: string;
  range_ft?: number;
  components?: string;
  duration?: string;
  concentration?: boolean;
  effect: string;
  targeting?: string;
  damage_dice?: string | null;
  damage_type?: string | null;
  save_ability?: string | null;
  save_for_half?: boolean;
  half_on_save?: boolean;
  condition?: string | null;
  heal_dice?: string | null;
  auto_hit?: boolean;
  num_targets?: number;
  area_radius?: number;
  area_shape?: string | null;
  upcast_damage_dice?: string | null;
  upcast_targets?: number;
  cantrip_scale?: boolean;
  effect_options?: EffectOption[];
  battle_ready?: boolean;
  description?: string;
  image?: string; // image store key; resolve via /images/{key}
}

export interface EffectOption {
  key: string;
  label: string;
  damage_type?: string | null;
  condition?: string | null;
}

export interface MonsterAttack {
  name: string;
  attack_bonus: number;
  reach: number;
  damage_dice: string;
  damage_type: string;
}

export interface Monster {
  id?: string;
  name: string;
  cr: number;
  size?: string;
  type?: string;
  ability_scores: AbilityScores;
  max_hp: number;
  ac: number;
  speed: number;
  attacks: MonsterAttack[];
  multiattack?: number;
  save_proficiencies?: string[];
  features?: string[];
  xp?: number;
  portrait?: string;
  battle_ready?: boolean;
  description?: string;
}

export interface BattleCharacter {
  id?: string;
  owner?: string;
  name: string;
  class_name: string;
  level: number;
  xp: number;
  race?: string;
  ability_scores: AbilityScores;
  fighting_style?: string | null;
  weapon_masteries?: string[];
  weapon_choice?: string;
  cantrips?: string[];
  spells_prepared?: string[];
  skill_proficiencies?: string[];
  portrait?: string;
  background?: string;
  gold?: number;
  equipment?: any[];
  pending_choices?: any;
  created_at?: string;
  updated_at?: string;
}

// ─── Spells ─────────────────────────────────────────────────────────────────

export const spellsApi = {
  list: () => api.get<Spell[]>("/spells").then((r) => r.data),
  get: (id: string) => api.get<Spell>(`/spells/${id}`).then((r) => r.data),
  create: (s: Spell) => api.post<Spell>("/spells", s).then((r) => r.data),
  update: (id: string, s: Spell) => api.put<Spell>(`/spells/${id}`, s).then((r) => r.data),
  remove: (id: string) => api.delete(`/spells/${id}`).then((r) => r.data),
};

// ─── Images ───────────────────────────────────────────────────────────────────

/** URL for an image key (served by the backend image store). */
export const imageUrl = (key: string) => `/images/${key}`;

export const imagesApi = {
  // Create or replace an image. Pass `key` to overwrite, omit to mint a new one.
  upload: (file: File, key?: string): Promise<{ id: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    if (key) fd.append("key", key);
    return api
      .post<{ id: string }>("/images", fd, { headers: { "Content-Type": "multipart/form-data" } })
      .then((r) => r.data);
  },
  remove: (key: string) => api.delete(`/images/${key}`).then((r) => r.data),
};

// ─── Monsters ───────────────────────────────────────────────────────────────

export const monstersApi = {
  list: () => api.get<Monster[]>("/monsters").then((r) => r.data),
  get: (id: string) => api.get<Monster>(`/monsters/${id}`).then((r) => r.data),
  create: (m: Monster) => api.post<Monster>("/monsters", m).then((r) => r.data),
  update: (id: string, m: Monster) => api.put<Monster>(`/monsters/${id}`, m).then((r) => r.data),
  remove: (id: string) => api.delete(`/monsters/${id}`).then((r) => r.data),
};

// ─── Characters (persistent sheets, /characters-api) ──────────────────────────

export const charactersApi = {
  list: () => api.get<BattleCharacter[]>("/characters-api").then((r) => r.data),
  get: (id: string) => api.get<BattleCharacter>(`/characters-api/${id}`).then((r) => r.data),
  create: (c: any) => api.post<BattleCharacter>("/characters-api", c).then((r) => r.data),
  update: (id: string, c: any) => api.put<BattleCharacter>(`/characters-api/${id}`, c).then((r) => r.data),
  remove: (id: string) => api.delete(`/characters-api/${id}`).then((r) => r.data),
  levelUpOptions: (id: string) => api.get(`/characters-api/${id}/level-up/options`).then((r) => r.data),
  levelUp: (id: string, choices: any) =>
    api.post(`/characters-api/${id}/level-up`, choices).then((r) => r.data),
  awardXp: (id: string, amount: number) =>
    api.post(`/characters-api/${id}/award-xp`, { amount }).then((r) => r.data),
  importEquipmentCard: (id: string, cardId: string) =>
    api.post(`/characters-api/${id}/equipment/import-card`, { card_id: cardId }).then((r) => r.data),
  removeEquipmentCard: (id: string, cardId: string) =>
    api.delete(`/characters-api/${id}/equipment/${cardId}`).then((r) => r.data),
  createOptions: () => api.get(`/characters-api/meta/create-options`).then((r) => r.data),
};

// ─── Rooms / combat (existing engine API) ─────────────────────────────────────

export const combatApi = {
  quickstart: () => api.post("/quickstart").then((r) => r.data),
  createRoom: (name: string) => api.post("/rooms", { name }).then((r) => r.data),
  getRoom: (id: string) => api.get(`/rooms/${id}`).then((r) => r.data),
  addCharacter: (roomId: string, body: any) =>
    api.post(`/rooms/${roomId}/characters`, body).then((r) => r.data),
  addFromSaved: (roomId: string, savedId: string, x: number, y: number) =>
    api.post(`/rooms/${roomId}/characters/from-saved`, { saved_id: savedId, x, y }).then((r) => r.data),
  addFromSheet: (roomId: string, sheetId: string, x: number, y: number, team = "party") =>
    api
      .post(`/rooms/${roomId}/characters/from-sheet`, { sheet_id: sheetId, x, y, team })
      .then((r) => r.data),
  addMonster: (roomId: string, body: any) =>
    api.post(`/rooms/${roomId}/monsters`, body).then((r) => r.data),
  startCombat: (roomId: string) => api.post(`/rooms/${roomId}/combat/start`).then((r) => r.data),
  getCombat: (roomId: string) => api.get(`/rooms/${roomId}/combat`).then((r) => r.data),
  endTurn: (roomId: string, characterId: string) =>
    api.post(`/rooms/${roomId}/combat/end-turn`, { character_id: characterId }).then((r) => r.data),
  autoTurn: (roomId: string) => api.post(`/rooms/${roomId}/combat/auto-turn`).then((r) => r.data),
  action: (roomId: string, action: string, body: any) =>
    api.post(`/rooms/${roomId}/actions/${action}`, body).then((r) => r.data),
  log: (roomId: string, limit = 50) =>
    api.get(`/rooms/${roomId}/log?limit=${limit}`).then((r) => r.data),
};

// ─── Definitions (backgrounds / feats / fighting styles) ──────────────────────

export interface Effect {
  type: string;
  [key: string]: any;
}

export interface Definition {
  id: string;
  kind: "background" | "origin_feat" | "general_feat" | "fighting_style";
  name: string;
  name_ru?: string;
  description?: string;
  source?: string;
  effects?: Effect[];
  ability_options?: string[];
  prerequisites?: { min_level?: number; [k: string]: any };
  repeatable?: boolean;
}

export const definitionsApi = {
  list: (kind?: string) =>
    api.get<Definition[]>("/definitions", { params: kind ? { kind } : {} }).then((r) => r.data),
  get: (id: string) => api.get<Definition>(`/definitions/${id}`).then((r) => r.data),
  schema: () => api.get("/definitions/meta/schema").then((r) => r.data),
  create: (d: Partial<Definition>) => api.post<Definition>("/definitions", d).then((r) => r.data),
  update: (id: string, d: Partial<Definition>) =>
    api.put<Definition>(`/definitions/${id}`, d).then((r) => r.data),
  remove: (id: string) => api.delete(`/definitions/${id}`).then((r) => r.data),
};

export const featsApi = {
  add: (charId: string, featId: string) =>
    api.post(`/characters-api/${charId}/feats`, { feat_id: featId }).then((r) => r.data),
  remove: (charId: string, featId: string) =>
    api.delete(`/characters-api/${charId}/feats/${featId}`).then((r) => r.data),
};

export const runsApi = {
  list: () => api.get("/runs").then((r) => r.data),
  start: (sheetId: string) => api.post("/runs/start", { sheet_id: sheetId }).then((r) => r.data),
  get: (id: string) => api.get(`/runs/${id}`).then((r) => r.data),
  nextRoom: (id: string) => api.post(`/runs/${id}/next-room`).then((r) => r.data),
  resolve: (id: string) => api.post(`/runs/${id}/resolve`).then((r) => r.data),
  shop: (id: string) => api.get(`/runs/${id}/shop`).then((r) => r.data),
  buy: (id: string, offerId: string) =>
    api.post(`/runs/${id}/shop/buy`, { offer_id: offerId }).then((r) => r.data),
};

// ─── Saved character templates (legacy library) ──────────────────────────────

export const savedApi = {
  list: () => api.get("/saved-characters").then((r) => r.data),
  get: (id: string) => api.get(`/saved-characters/${id}`).then((r) => r.data),
  save: (c: any) => api.post("/saved-characters", c).then((r) => r.data),
  remove: (id: string) => api.delete(`/saved-characters/${id}`).then((r) => r.data),
};

export const healthApi = {
  get: () => api.get("/api/health").then((r) => r.data),
};
