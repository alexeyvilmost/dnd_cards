import axios from 'axios';
import { Card, CreateCardRequest, UpdateCardRequest } from '../types';

// Railway production URL по умолчанию, можно переопределить через VITE_API_URL
// Для локальной разработки установите: VITE_API_URL=http://localhost:8080
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://backend-production-41c3.up.railway.app';

export const cardsApi = {
  async getCards(): Promise<Card[]> {
    const response = await axios.get(`${API_BASE_URL}/api/cards`);
    return response.data;
  },

  async getCard(id: number): Promise<Card> {
    const response = await axios.get(`${API_BASE_URL}/api/cards/${id}`);
    return response.data;
  },

  async createCard(card: CreateCardRequest): Promise<Card> {
    const response = await axios.post(`${API_BASE_URL}/api/cards`, card);
    return response.data;
  },

  async updateCard(id: number, card: UpdateCardRequest): Promise<Card> {
    const response = await axios.put(`${API_BASE_URL}/api/cards/${id}`, card);
    return response.data;
  },

  async deleteCard(id: number): Promise<void> {
    await axios.delete(`${API_BASE_URL}/api/cards/${id}`);
  },

  async generateImage(prompt: string): Promise<string> {
    const response = await axios.post(`${API_BASE_URL}/api/generate-image`, { prompt });
    return response.data.image_url;
  },

  async exportCards(cardIds: number[]): Promise<Blob> {
    const response = await axios.post(`${API_BASE_URL}/api/export-cards`, { card_ids: cardIds }, {
      responseType: 'blob'
    });
    return response.data;
  }
};
