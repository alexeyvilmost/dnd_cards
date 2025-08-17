import axios from 'axios';
import { Card, CreateCardRequest, UpdateCardRequest } from '../types';

const API_BASE_URL = 'http://localhost:8080/api';

export const cardsApi = {
  async getCards(): Promise<Card[]> {
    const response = await axios.get(`${API_BASE_URL}/cards`);
    return response.data;
  },

  async getCard(id: number): Promise<Card> {
    const response = await axios.get(`${API_BASE_URL}/cards/${id}`);
    return response.data;
  },

  async createCard(card: CreateCardRequest): Promise<Card> {
    const response = await axios.post(`${API_BASE_URL}/cards`, card);
    return response.data;
  },

  async updateCard(id: number, card: UpdateCardRequest): Promise<Card> {
    const response = await axios.put(`${API_BASE_URL}/cards/${id}`, card);
    return response.data;
  },

  async deleteCard(id: number): Promise<void> {
    await axios.delete(`${API_BASE_URL}/cards/${id}`);
  },

  async generateImage(prompt: string): Promise<string> {
    const response = await axios.post(`${API_BASE_URL}/generate-image`, { prompt });
    return response.data.image_url;
  },

  async exportCards(cardIds: number[]): Promise<Blob> {
    const response = await axios.post(`${API_BASE_URL}/export-cards`, { card_ids: cardIds }, {
      responseType: 'blob'
    });
    return response.data;
  }
};
