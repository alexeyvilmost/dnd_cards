import {apiClient} from '../api/client';
import type {ForgeCharacter} from './types';

export interface CharacterTemplate {
  id: string;
  name: string;
  description: string;
  preset_key: string | null;
  character: Omit<ForgeCharacter, 'id' | 'user_id' | 'user'>;
  version: number;
}
export interface TemplateEdit {name: string; description: string; source_character_id?: string; version?: number}
export const characterTemplatesApi = {
  list: async () => (await apiClient.get<{templates: CharacterTemplate[]; can_manage: boolean}>('/api/character-templates')).data,
  copy: async (id: string, name: string) => (await apiClient.post<ForgeCharacter>(`/api/character-templates/${id}/copies`, {name})).data,
  create: async (body: TemplateEdit) => (await apiClient.post<CharacterTemplate>('/api/character-templates', body)).data,
  update: async (id: string, body: TemplateEdit) => (await apiClient.put<CharacterTemplate>(`/api/character-templates/${id}`, body)).data,
};
