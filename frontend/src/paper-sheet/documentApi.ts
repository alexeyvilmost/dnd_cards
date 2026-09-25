import { apiClient } from '../api/client';
import { importPaperSheet, type PaperSheetDocument } from './model';

export interface SavedPaperDocument { id: string; document: PaperSheetDocument; revision: number; anonymous: boolean }
export interface PaperDocumentSummary { id: string; name: string; updated_at: string }
function parseDocument(data: SavedPaperDocument): SavedPaperDocument {
  return { ...data, document: importPaperSheet(JSON.stringify(data.document)) };
}
export const paperDocumentApi = {
  async list(deleted = false): Promise<PaperDocumentSummary[]> { return (await apiClient.get('/api/paper-sheets', { params: deleted ? { deleted: true } : undefined })).data.sheets; },
  async remove(id: string): Promise<void> { await apiClient.delete(`/api/paper-sheets/${encodeURIComponent(id)}`); },
  async restore(id: string): Promise<void> { await apiClient.post(`/api/paper-sheets/${encodeURIComponent(id)}/restore`); },
  async get(id: string): Promise<SavedPaperDocument> { return parseDocument((await apiClient.get(`/api/paper-sheets/${encodeURIComponent(id)}`)).data); },
  async create(document: PaperSheetDocument, anonymous: boolean): Promise<SavedPaperDocument> {
    return parseDocument((await apiClient.post('/api/paper-sheets', { document, anonymous })).data);
  },
  async save(id: string, document: PaperSheetDocument, revision: number): Promise<number> {
    return (await apiClient.put(`/api/paper-sheets/${encodeURIComponent(id)}`, { document, revision })).data.revision;
  },
};

export function paperDocumentError(error: unknown): string {
  const candidate = error as { response?: { data?: { error?: string } }; message?: string };
  return candidate?.response?.data?.error || candidate?.message || 'Не удалось связаться с сервером. Попробуйте ещё раз.';
}
