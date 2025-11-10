import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { apiClient } from '../api/client';
import { Plus, User, Sword, Shield, Heart, Zap, Eye, Edit, Trash2, Package } from 'lucide-react';

interface CharacterV3 {
  id: string;
  name: string;
  race: string;
  class: string;
  level: number;
  speed: number;
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
  max_hp: number;
  current_hp: number;
  saving_throw_proficiencies: string[];
  skill_proficiencies: string[];
  created_at: string;
  updated_at: string;
  inventories?: any[]; // Добавляем инвентари
}

const CharactersV3: React.FC = () => {
  const { user } = useAuth();
  const [characters, setCharacters] = useState<CharacterV3[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCharacters();
  }, []);

  const fetchCharacters = async () => {
    try {
      setLoading(true);
      const { data } = await apiClient.get<CharacterV3[]>('/api/characters-v2');
      // Нормализуем поля-массивы и защищаемся от null/undefined
      const normalized = (Array.isArray(data) ? data : []).map((c) => ({
        ...c,
        saving_throw_proficiencies: c?.saving_throw_proficiencies || [],
        skill_proficiencies: c?.skill_proficiencies || [],
        max_hp: typeof c?.max_hp === 'number' && c.max_hp > 0 ? c.max_hp : 1,
        current_hp: typeof c?.current_hp === 'number' && c.current_hp >= 0 ? c.current_hp : 0,
      }));
      
      // Загружаем инвентари для каждого персонажа
      const charactersWithInventories = await Promise.all(
        normalized.map(async (character) => {
          try {
            const inventoriesResponse = await apiClient.get(`/api/characters-v2/${character.id}/inventories`);
            return {
              ...character,
              inventories: inventoriesResponse.data || []
            };
          } catch (err) {
            console.warn(`Failed to load inventories for character ${character.id}:`, err);
            return {
              ...character,
              inventories: []
            };
          }
        })
      );
      
      setCharacters(charactersWithInventories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      setLoading(true);
      setError(null);
      const payload = {
        name: 'Тест',
        race: 'Эльф',
        class: 'Колдун',
        level: 5,
        speed: 30,
        strength: 8,
        dexterity: 15,
        constitution: 17,
        intelligence: 12,
        wisdom: 14,
        charisma: 21,
        max_hp: 45,
        current_hp: 40,
        saving_throw_proficiencies: ['charisma', 'dexterity'],
        skill_proficiencies: [],
      };
      await apiClient.post('/api/characters-v2', payload);
      await fetchCharacters();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать персонажа');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCharacter = async (id: string) => {
    if (!window.confirm('Вы уверены, что хотите удалить этого персонажа?')) {
      return;
    }

    try {
      await apiClient.delete(`/api/characters-v2/${id}`);
      setCharacters(characters.filter(char => char.id !== id));
    } catch (err) {
      setError('Ошибка удаления персонажа');
      console.error('Error deleting character:', err);
    }
  };

  const getModifier = (score: number): number => {
    return Math.floor((score - 10) / 2);
  };

  const getProficiencyBonus = (level: number): number => {
    return Math.floor((level - 1) / 4) + 2;
  };

  const getStatName = (stat: string): string => {
    const names: { [key: string]: string } = {
      'strength': 'СИЛ',
      'dexterity': 'ЛВК',
      'constitution': 'ТЕЛ',
      'intelligence': 'ИНТ',
      'wisdom': 'МДР',
      'charisma': 'ХАР'
    };
    return names[stat] || stat.toUpperCase();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Загрузка персонажей...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 text-xl mb-4">❌</div>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={fetchCharacters}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Персонажи V3</h1>
            <p className="text-gray-600 mt-2">
              Копия системы персонажей V2 для модернизации
            </p>
          </div>
          <button onClick={handleCreate} className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Plus size={20} />
            <span>Создать персонажа</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {characters.map((character) => (
            <div
              key={character.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {character.name}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {character.race} • {character.class} {character.level} ур.
                  </p>
                </div>
                <div className="flex space-x-1">
                  <Link
                    to={`/characters-v3/${character.id}`}
                    className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                    title="Просмотр"
                  >
                    <Eye size={16} />
                  </Link>
                  <Link
                    to={`/characters-v3/${character.id}/edit`}
                    className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                    title="Редактировать"
                  >
                    <Edit size={16} />
                  </Link>
                  <button
                    onClick={() => handleDeleteCharacter(character.id)}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors"
                    title="Удалить"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-sm text-gray-500">
                <div className="flex items-center space-x-4">
                  {character.inventories && character.inventories.length > 0 && (
                    <div className="flex items-center space-x-1">
                      <Package size={14} />
                      <span>{character.inventories.length} инвентарей</span>
                    </div>
                  )}
                </div>
                <div>
                  {new Date(character.created_at).toLocaleDateString('ru-RU')}
                </div>
              </div>
            </div>
          ))}
        </div>

        {characters.length === 0 && (
          <div className="text-center py-12">
            <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              Персонажи не найдены
            </h3>
            <p className="text-gray-600 mb-6">
              Создайте своего первого персонажа в новой системе V3
            </p>
            <button onClick={handleCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Создать персонажа
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CharactersV3;
