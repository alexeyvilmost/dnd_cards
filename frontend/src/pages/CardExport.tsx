import { useState, useEffect } from 'react';
import { Check, Download, Printer } from 'lucide-react';
import { cardsApi } from '../api/client';
import type { Card } from '../types';
import CardPreview from '../components/CardPreview';

const CardExport = () => {
  const [cards, setCards] = useState<Card[]>([]);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Загрузка всех карточек
  useEffect(() => {
    const loadCards = async () => {
      try {
        setLoading(true);
        const response = await cardsApi.getCards({ limit: 1000 });
        setCards(response.cards);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ошибка загрузки карточек');
      } finally {
        setLoading(false);
      }
    };
    loadCards();
  }, []);

  // Выбор/отмена выбора карточки
  const toggleCardSelection = (cardId: string) => {
    setSelectedCards(prev => 
      prev.includes(cardId) 
        ? prev.filter(id => id !== cardId)
        : [...prev, cardId]
    );
  };

  // Выбор всех карточек
  const selectAllCards = () => {
    setSelectedCards(cards.map(card => card.id));
  };

  // Отмена выбора всех карточек
  const deselectAllCards = () => {
    setSelectedCards([]);
  };

  // Экспорт выбранных карточек
  const handleExport = async () => {
    if (selectedCards.length === 0) {
      setError('Выберите карточки для экспорта');
      return;
    }

    try {
      setLoading(true);
      const response = await cardsApi.exportCards({ card_ids: selectedCards });
      
      // TODO: Генерация PDF для печати
      // Пока просто показываем сообщение
      alert(`Готово к экспорту ${response.cards.length} карточек`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка экспорта');
    } finally {
      setLoading(false);
    }
  };

  // Печать выбранных карточек
  const handlePrint = () => {
    if (selectedCards.length === 0) {
      setError('Выберите карточки для печати');
      return;
    }

    // TODO: Реализовать печать
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-fantasy font-bold text-gray-900">
          Экспорт карточек
        </h1>
        <div className="flex space-x-2">
          <button
            onClick={selectAllCards}
            className="btn-secondary"
            disabled={loading}
          >
            Выбрать все
          </button>
          <button
            onClick={deselectAllCards}
            className="btn-secondary"
            disabled={loading}
          >
            Снять выбор
          </button>
        </div>
      </div>

      {/* Информация */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-blue-900 mb-2">
          Информация об экспорте
        </h2>
        <ul className="text-blue-800 space-y-1">
          <li>• Размер карточки: 52.5мм x 74.25мм</li>
          <li>• 16 карточек на А4 лист (4x4)</li>
          <li>• Автоматическая разметка для резки</li>
          <li>• QR-коды для быстрого поиска в библиотеке</li>
        </ul>
      </div>

      {/* Действия */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
          <div className="text-sm text-gray-600">
            Выбрано карточек: <span className="font-semibold">{selectedCards.length}</span>
          </div>
          <div className="flex space-x-2">
            <button
              onClick={handleExport}
              disabled={loading || selectedCards.length === 0}
              className="btn-primary flex items-center space-x-2 disabled:opacity-50"
            >
              <Download size={18} />
              <span>Экспорт PDF</span>
            </button>
            <button
              onClick={handlePrint}
              disabled={loading || selectedCards.length === 0}
              className="btn-secondary flex items-center space-x-2 disabled:opacity-50"
            >
              <Printer size={18} />
              <span>Печать</span>
            </button>
          </div>
        </div>
      </div>

      {/* Сообщение об ошибке */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Загрузка */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Список карточек */}
      {!loading && cards.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">Карточки не найдены</p>
        </div>
      )}

      {!loading && cards.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-fantasy font-semibold text-gray-900">
            Выберите карточки для экспорта
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
            {cards.map((card) => (
              <div key={card.id} className="relative group">
                <div
                  className={`cursor-pointer transition-all duration-200 ${
                    selectedCards.includes(card.id) 
                      ? 'ring-2 ring-blue-500 ring-offset-2' 
                      : 'hover:shadow-card-hover'
                  }`}
                  onClick={() => toggleCardSelection(card.id)}
                >
                  <CardPreview card={card} />
                </div>
                
                {/* Индикатор выбора */}
                {selectedCards.includes(card.id) && (
                  <div className="absolute top-2 left-2 bg-blue-500 text-white rounded-full p-1">
                    <Check size={12} />
                  </div>
                )}
                
                {/* Название карточки */}
                <div className="mt-2 text-center">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {card.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {card.card_number}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CardExport;
