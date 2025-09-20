import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { Plus, User, Sword, Shield, Heart, Zap } from 'lucide-react';

interface CharacterV2 {
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
}

const CharactersV2: React.FC = () => {
  const { user } = useAuth();
  const [characters, setCharacters] = useState<CharacterV2[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCharacters();
  }, []);

  const fetchCharacters = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch('/api/characters-v2', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error('Ошибка загрузки персонажей');
      }

      const data = await response.json();
      setCharacters(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Произошла ошибка');
    } finally {
      setLoading(false);
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
            <h1 className="text-3xl font-bold text-gray-900">Персонажи V2</h1>
            <p className="text-gray-600 mt-2">
              Новая упрощенная система персонажей
            </p>
          </div>
          <button className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
            <Plus size={20} />
            <span>Создать персонажа</span>
          </button>
        </div>

        {/* Characters Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {characters.map((character) => (
            <div
              key={character.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              {/* Character Header */}
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <User className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {character.name}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {character.race} {character.class} {character.level}
                  </p>
                </div>
              </div>

              {/* HP */}
              <div className="flex items-center space-x-2 mb-4">
                <Heart className="w-4 h-4 text-red-500" />
                <span className="text-sm text-gray-600">
                  {character.current_hp}/{character.max_hp} HP
                </span>
                <div className="flex-1 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-red-500 h-2 rounded-full"
                    style={{
                      width: `${(character.current_hp / character.max_hp) * 100}%`,
                    }}
                  ></div>
                </div>
              </div>

              {/* Speed */}
              <div className="flex items-center space-x-2 mb-4">
                <Zap className="w-4 h-4 text-yellow-500" />
                <span className="text-sm text-gray-600">
                  Скорость: {character.speed} фт
                </span>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-2 mb-4">
                {[
                  { key: 'strength', value: character.strength },
                  { key: 'dexterity', value: character.dexterity },
                  { key: 'constitution', value: character.constitution },
                  { key: 'intelligence', value: character.intelligence },
                  { key: 'wisdom', value: character.wisdom },
                  { key: 'charisma', value: character.charisma },
                ].map(({ key, value }) => {
                  const modifier = getModifier(value);
                  const isProficient = character.saving_throw_proficiencies.includes(key);
                  const savingThrow = modifier + (isProficient ? getProficiencyBonus(character.level) : 0);
                  
                  return (
                    <div key={key} className="text-center">
                      <div className="text-xs text-gray-500 uppercase">
                        {getStatName(key)}
                      </div>
                      <div className="text-lg font-bold text-gray-900">
                        {value}
                      </div>
                      <div className="text-xs text-gray-500">
                        {modifier >= 0 ? '+' : ''}{modifier}
                      </div>
                      {isProficient && (
                        <div className="text-xs text-blue-600 font-medium">
                          СБ: +{savingThrow}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Proficiency Bonus */}
              <div className="text-center text-sm text-gray-600">
                Мастерство: +{getProficiencyBonus(character.level)}
              </div>

              {/* Saving Throw Proficiencies */}
              {character.saving_throw_proficiencies.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="text-xs text-gray-500 mb-1">Владения спасбросками:</div>
                  <div className="text-sm text-gray-700">
                    {character.saving_throw_proficiencies
                      .map(stat => getStatName(stat))
                      .join(', ')}
                  </div>
                </div>
              )}
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
              Создайте своего первого персонажа в новой системе
            </p>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Создать персонажа
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CharactersV2;
