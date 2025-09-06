import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Search, Package, Weight, Coins } from 'lucide-react';
import { inventoryApi } from '../api/inventoryApi';
import { cardsApi } from '../api/client';
import type { Inventory, Card } from '../types';
import { getRarityColor } from '../utils/rarityColors';

const AddItemToInventory: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [filteredCards, setFilteredCards] = useState<Card[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [formData, setFormData] = useState({
    quantity: 1,
    notes: '',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id) {
      loadInventory();
      loadCards();
    }
  }, [id]);

  useEffect(() => {
    if (searchTerm) {
      const filtered = cards.filter(card =>
        card.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        card.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
      setFilteredCards(filtered);
    } else {
      setFilteredCards(cards);
    }
  }, [searchTerm, cards]);

  const loadInventory = async () => {
    try {
      const data = await inventoryApi.getInventory(id!);
      setInventory(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки инвентаря');
    }
  };

  const loadCards = async () => {
    try {
      setIsLoading(true);
      const response = await cardsApi.getCards({ limit: 1000 });
      setCards(response.cards);
      setFilteredCards(response.cards);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки карточек');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard || !inventory) return;

    try {
      setIsSubmitting(true);
      setError(null);
      
      await inventoryApi.addItemToInventory(inventory.id, {
        card_id: selectedCard.id,
        quantity: formData.quantity,
        notes: formData.notes,
      });
      
      navigate(`/inventory/${inventory.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка добавления предмета');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatWeight = (weight: number) => {
    return `${weight.toFixed(1)} фнт.`;
  };

  const formatPrice = (price: number) => {
    return `${price} зм.`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка...</p>
        </div>
      </div>
    );
  }

  if (error || !inventory) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <button
            onClick={() => navigate('/inventory')}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft size={20} className="mr-2" />
            Назад к инвентарям
          </button>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center">
            <div className="text-red-600">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Ошибка загрузки</h3>
              <p className="text-sm text-red-700 mt-1">{error || 'Инвентарь не найден'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate(`/inventory/${inventory.id}`)}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft size={20} className="mr-2" />
          Назад к инвентарю
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Добавить предмет в инвентарь</h1>
        <p className="text-gray-600 mt-1">Выберите предмет из библиотеки карточек</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Cards list */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Библиотека карточек</h2>
            
            {/* Search */}
            <div className="relative mb-4">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
              <input
                type="text"
                placeholder="Поиск карточек..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="input-field pl-10"
              />
            </div>

            {/* Cards grid */}
            <div className="max-h-96 overflow-y-auto space-y-2">
              {filteredCards.map((card) => (
                <div
                  key={card.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedCard?.id === card.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                  onClick={() => setSelectedCard(card)}
                >
                  <div className="flex items-start justify-between">
                                      <div className="flex-1">
                    <h3 className={`font-medium ${getRarityColor(card.rarity)}`}>{card.name}</h3>
                    <p className="text-sm text-gray-600 line-clamp-2">{card.description}</p>
                      <div className="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                        {card.weight && (
                          <span className="flex items-center">
                            <Weight size={12} className="mr-1" />
                            {formatWeight(card.weight)}
                          </span>
                        )}
                        {card.price && (
                          <span className="flex items-center">
                            <Coins size={12} className="mr-1" />
                            {formatPrice(card.price)}
                          </span>
                        )}
                      </div>
                    </div>
                    {card.image_url && (
                      <img
                        src={card.image_url}
                        alt={card.name}
                        className="w-12 h-12 object-cover rounded ml-3"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Selected card and form */}
        <div className="space-y-4">
          {selectedCard ? (
            <>
              {/* Selected card info */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Выбранный предмет</h2>
                <div className="flex items-start space-x-4">
                  {selectedCard.image_url && (
                    <img
                      src={selectedCard.image_url}
                      alt={selectedCard.name}
                      className="w-16 h-16 object-cover rounded"
                    />
                  )}
                  <div className="flex-1">
                    <h3 className={`font-medium ${getRarityColor(selectedCard.rarity)}`}>{selectedCard.name}</h3>
                    <p className="text-sm text-gray-600 mt-1">{selectedCard.description}</p>
                    <div className="flex items-center space-x-4 mt-2 text-sm text-gray-500">
                      {selectedCard.weight && (
                        <span className="flex items-center">
                          <Weight size={14} className="mr-1" />
                          {formatWeight(selectedCard.weight)}
                        </span>
                      )}
                      {selectedCard.price && (
                        <span className="flex items-center">
                          <Coins size={14} className="mr-1" />
                          {formatPrice(selectedCard.price)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Add to inventory form */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Добавить в инвентарь</h2>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Error message */}
                  {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <p className="text-red-800 text-sm">{error}</p>
                    </div>
                  )}

                  {/* Quantity */}
                  <div>
                    <label htmlFor="quantity" className="block text-sm font-medium text-gray-700 mb-2">
                      Количество
                    </label>
                    <input
                      id="quantity"
                      type="number"
                      min="1"
                      required
                      value={formData.quantity}
                      onChange={(e) => setFormData(prev => ({ ...prev, quantity: parseInt(e.target.value) || 1 }))}
                      className="input-field"
                    />
                  </div>

                  {/* Notes */}
                  <div>
                    <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-2">
                      Заметки (необязательно)
                    </label>
                    <textarea
                      id="notes"
                      rows={3}
                      value={formData.notes}
                      onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                      className="input-field resize-none"
                      placeholder="Добавьте заметки о предмете..."
                    />
                  </div>

                  {/* Submit button */}
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full btn-primary bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSubmitting ? (
                      <div className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                        Добавление...
                      </div>
                    ) : (
                      <div className="flex items-center justify-center">
                        <Plus size={20} className="mr-2" />
                        Добавить в инвентарь
                      </div>
                    )}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="text-center py-8">
                <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 mb-2">Выберите предмет</h3>
                <p className="text-gray-600">Выберите карточку из библиотеки, чтобы добавить её в инвентарь</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddItemToInventory;
