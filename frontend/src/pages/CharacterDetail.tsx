import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Package, Weight, Coins, Shield, Heart, Zap, User, Sword, Star, Eye } from 'lucide-react';
import { charactersApi } from '../api/charactersApi';
import { useAuth } from '../contexts/AuthContext';
import type { Character, CharacterData } from '../types';

const CharacterDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [character, setCharacter] = useState<Character | null>(null);
  const [characterData, setCharacterData] = useState<CharacterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('basic');

  useEffect(() => {
    if (id) {
      loadCharacter();
    }
  }, [id]);

  const loadCharacter = async () => {
    if (!id) return;

    try {
      setLoading(true);
      setError(null);
      const character = await charactersApi.getCharacter(id);
      setCharacter(character);

      // Парсим JSON данные персонажа
      try {
        const parsed = JSON.parse(character.data);
        setCharacterData(parsed);
      } catch (parseError) {
        console.error('Error parsing character data:', parseError);
        setError('Ошибка парсинга данных персонажа');
      }
    } catch (err) {
      setError('Ошибка загрузки персонажа');
      console.error('Error loading character:', err);
    } finally {
      setLoading(false);
    }
  };

  const calculateCarryingCapacity = (strength: number): number => {
    return strength * 15; // Грузоподъемность = Сила * 15 фт
  };

  const calculateCurrentWeight = (): number => {
    if (!character?.inventories) return 0;
    
    let totalWeight = 0;
    character.inventories.forEach(inventory => {
      inventory.items?.forEach(item => {
        if (item.card.weight) {
          totalWeight += item.card.weight * item.quantity;
        }
      });
    });
    return totalWeight;
  };

  const getModifier = (score: number): string => {
    const modifier = Math.floor((score - 10) / 2);
    return modifier >= 0 ? `+${modifier}` : `${modifier}`;
  };

  const getSkillBonus = (skillName: string): string => {
    if (!characterData?.skills || !characterData?.stats) return '+0';
    
    const skill = characterData.skills[skillName];
    if (!skill) return '+0';
    
    const baseStat = skill.baseStat;
    const statScore = characterData.stats[baseStat]?.score || 10;
    const statModifier = Math.floor((statScore - 10) / 2);
    const proficiencyBonus = characterData.proficiency || 0;
    const isProficient = skill.isProf === 1 || skill.isProf === true;
    
    const totalBonus = statModifier + (isProficient ? proficiencyBonus : 0);
    return totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;
  };

  const getPassivePerception = (): number => {
    if (!characterData?.stats) return 10;
    
    const wisdomScore = characterData.stats.wis?.score || 10;
    const wisdomModifier = Math.floor((wisdomScore - 10) / 2);
    const proficiencyBonus = characterData.proficiency || 0;
    const perceptionSkill = characterData.skills?.perception;
    const isProficient = perceptionSkill?.isProf === 1 || perceptionSkill?.isProf === true;
    
    return 10 + wisdomModifier + (isProficient ? proficiencyBonus : 0);
  };

  const tabs = [
    { id: 'basic', name: 'Основное', icon: User },
    { id: 'class-race', name: 'Класс и Раса', icon: Star },
    { id: 'inventory', name: 'Инвентарь', icon: Package },
    { id: 'actions', name: 'Действия', icon: Sword },
    { id: 'passives', name: 'Пассивы', icon: Eye },
  ];

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-lg text-gray-600">Загрузка персонажа...</div>
      </div>
    );
  }

  if (error || !character || !characterData) {
    return (
      <div className="text-center py-12">
        <div className="text-red-600 mb-4">{error || 'Персонаж не найден'}</div>
        <Link to="/characters" className="btn-primary">
          Вернуться к списку
        </Link>
      </div>
    );
  }

  const strength = characterData.stats?.str?.score || 10;
  const carryingCapacity = calculateCarryingCapacity(strength);
  const currentWeight = calculateCurrentWeight();
  const weightPercentage = carryingCapacity > 0 ? (currentWeight / carryingCapacity) * 100 : 0;

  const renderBasicTab = () => (
    <div className="space-y-6">
      {/* Характеристики */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Характеристики</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Object.entries(characterData.stats || {}).map(([key, stat]) => (
            <div key={key} className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600 uppercase">{key}</div>
              <div className="text-2xl font-bold text-gray-900">{stat.score}</div>
              <div className="text-sm text-gray-600">{getModifier(stat.score)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Здоровье и защита */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Здоровье и защита</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-red-50 rounded-lg">
            <Heart className="mx-auto h-6 w-6 text-red-600 mb-2" />
            <div className="text-sm text-gray-600">Хиты</div>
            <div className="text-lg font-bold text-gray-900">
              {characterData.vitality?.['hp-current']?.value || 0} / {characterData.vitality?.['hp-max']?.value || 0}
            </div>
          </div>
          <div className="text-center p-3 bg-blue-50 rounded-lg">
            <Shield className="mx-auto h-6 w-6 text-blue-600 mb-2" />
            <div className="text-sm text-gray-600">КЗ</div>
            <div className="text-lg font-bold text-gray-900">
              {characterData.vitality?.ac?.value || 10}
            </div>
          </div>
          <div className="text-center p-3 bg-green-50 rounded-lg">
            <Zap className="mx-auto h-6 w-6 text-green-600 mb-2" />
            <div className="text-sm text-gray-600">Скорость</div>
            <div className="text-lg font-bold text-gray-900">
              {characterData.vitality?.speed?.value || 30} фт
            </div>
          </div>
          <div className="text-center p-3 bg-yellow-50 rounded-lg">
            <Coins className="mx-auto h-6 w-6 text-yellow-600 mb-2" />
            <div className="text-sm text-gray-600">Золото</div>
            <div className="text-lg font-bold text-gray-900">
              {characterData.coins?.gp?.value || 0} зм
            </div>
          </div>
        </div>
      </div>

      {/* Уровень и бонус мастерства */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Уровень и мастерство</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-sm text-gray-600">Уровень</div>
            <div className="text-2xl font-bold text-gray-900">
              {characterData.info?.level?.value || 1}
            </div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-sm text-gray-600">Бонус мастерства</div>
            <div className="text-2xl font-bold text-gray-900">
              +{characterData.proficiency || 2}
            </div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-sm text-gray-600">Пассивное восприятие</div>
            <div className="text-2xl font-bold text-gray-900">
              {getPassivePerception()}
            </div>
          </div>
          <div className="text-center p-3 bg-purple-50 rounded-lg">
            <div className="text-sm text-gray-600">Опыт</div>
            <div className="text-2xl font-bold text-gray-900">
              {characterData.info?.experience?.value || 0}
            </div>
          </div>
        </div>
      </div>

      {/* Навыки */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Навыки</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.entries(characterData.skills || {}).map(([skillName, skill]) => {
            const isProficient = skill.isProf === 1 || skill.isProf === true;
            return (
              <div key={skillName} className={`flex items-center justify-between p-3 rounded-lg ${isProficient ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
                <div className="flex items-center space-x-2">
                  <span className="font-medium text-gray-900 capitalize">{skill.name}</span>
                  {isProficient && <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">Мастерство</span>}
                </div>
                <div className="font-bold text-gray-900">{getSkillBonus(skillName)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Языки */}
      {characterData.prof?.value && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Языки и владения</h2>
          <div className="prose max-w-none">
            <div className="text-gray-700 whitespace-pre-wrap">
              {/* Здесь можно добавить парсинг языков из prof */}
              <p>Языки и владения персонажа</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderClassRaceTab = () => (
    <div className="space-y-6">
      {/* Информация о классе и расе */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Класс и Раса</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Раса</h3>
            <div className="p-3 bg-blue-50 rounded-lg">
              <div className="font-medium text-blue-900">{characterData.info?.race?.value}</div>
            </div>
          </div>
          <div>
            <h3 className="text-lg font-medium text-gray-900 mb-3">Класс</h3>
            <div className="p-3 bg-green-50 rounded-lg">
              <div className="font-medium text-green-900">{characterData.info?.charClass?.value}</div>
              <div className="text-sm text-green-700">Уровень {characterData.info?.level?.value}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Спасброски */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Спасброски</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Object.entries(characterData.saves || {}).map(([saveName, save]) => {
            const isProficient = save.isProf === true;
            const statScore = characterData.stats?.[saveName as keyof typeof characterData.stats]?.score || 10;
            const statModifier = Math.floor((statScore - 10) / 2);
            const proficiencyBonus = characterData.proficiency || 0;
            const totalBonus = statModifier + (isProficient ? proficiencyBonus : 0);
            const bonusString = totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;
            
            return (
              <div key={saveName} className={`text-center p-3 rounded-lg ${isProficient ? 'bg-green-50 border border-green-200' : 'bg-gray-50'}`}>
                <div className="text-sm text-gray-600 uppercase">{saveName}</div>
                <div className="text-lg font-bold text-gray-900">{bonusString}</div>
                {isProficient && <div className="text-xs text-green-600">Мастерство</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Особенности класса и расы */}
      {characterData.traits?.value && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Особенности класса и расы</h2>
          <div className="prose max-w-none">
            <div className="text-gray-700 whitespace-pre-wrap">
              {/* Здесь можно добавить парсинг особенностей из traits */}
              <p>Особенности класса и расы персонажа</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderInventoryTab = () => (
    <div className="space-y-6">
      {/* Грузоподъемность */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
          <Weight className="h-5 w-5 mr-2" />
          Грузоподъемность
        </h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600">Текущий вес</div>
              <div className="text-xl font-bold text-gray-900">{currentWeight.toFixed(1)} фт</div>
            </div>
            <div className="text-center p-3 bg-gray-50 rounded-lg">
              <div className="text-sm text-gray-600">Максимум</div>
              <div className="text-xl font-bold text-gray-900">{carryingCapacity} фт</div>
            </div>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${
                weightPercentage > 100 ? 'bg-red-500' :
                weightPercentage > 75 ? 'bg-yellow-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(weightPercentage, 100)}%` }}
            />
          </div>
          <div className="text-center text-sm text-gray-600">
            {weightPercentage.toFixed(1)}% загруженности
          </div>
        </div>
      </div>

      {/* Инвентари */}
      {character.inventories && character.inventories.length > 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
            <Package className="h-5 w-5 mr-2" />
            Инвентари
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {character.inventories.map((inventory) => (
              <Link
                key={inventory.id}
                to={`/inventory/${inventory.id}`}
                className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200"
              >
                <div className="font-medium text-gray-900 mb-1">{inventory.name}</div>
                <div className="text-sm text-gray-600">
                  {inventory.items?.length || 0} предметов
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Нет инвентарей</h3>
          <p className="text-gray-600">У этого персонажа пока нет инвентарей</p>
        </div>
      )}
    </div>
  );

  const renderActionsTab = () => (
    <div className="space-y-6">
      {/* Оружие */}
      {characterData.weaponsList && characterData.weaponsList.length > 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Оружие</h2>
          <div className="space-y-3">
            {characterData.weaponsList.map((weapon) => (
              <div key={weapon.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div>
                  <div className="font-medium text-gray-900">{weapon.name.value}</div>
                  <div className="text-sm text-gray-600">{weapon.dmg.value}</div>
                  {weapon.notes.value && (
                    <div className="text-xs text-gray-500 mt-1">{weapon.notes.value}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="font-bold text-gray-900 text-lg">{weapon.mod.value}</div>
                  {weapon.isProf && (
                    <div className="text-xs text-green-600">Мастерство</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 text-center">
          <Sword className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Нет оружия</h3>
          <p className="text-gray-600">У этого персонажа пока нет оружия</p>
        </div>
      )}

      {/* Заклинания */}
      {characterData.spells && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Заклинания</h2>
          <div className="prose max-w-none">
            <p className="text-gray-600">Информация о заклинаниях персонажа</p>
          </div>
        </div>
      )}
    </div>
  );

  const renderPassivesTab = () => (
    <div className="space-y-6">
      {/* Снаряжение */}
      {characterData.feats && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Снаряжение</h2>
          <div className="prose max-w-none">
            <div className="text-gray-700 whitespace-pre-wrap">
              {/* Здесь можно добавить парсинг снаряжения из feats */}
              <p>Снаряжение персонажа</p>
            </div>
          </div>
        </div>
      )}

      {/* Союзники и особенности */}
      {characterData.allies && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Союзники и особенности</h2>
          <div className="prose max-w-none">
            <div className="text-gray-700 whitespace-pre-wrap">
              {/* Здесь можно добавить парсинг союзников из allies */}
              <p>Союзники и особенности персонажа</p>
            </div>
          </div>
        </div>
      )}

      {/* Условия */}
      {characterData.conditions && characterData.conditions.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">Активные условия</h2>
          <div className="space-y-2">
            {characterData.conditions.map((condition, index) => (
              <div key={index} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <div className="font-medium text-yellow-900">{condition}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link
            to="/characters"
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>Назад</span>
          </Link>
          <div>
            <h1 className="text-3xl font-fantasy font-bold text-gray-900">
              {characterData.name?.value || character.name}
            </h1>
            <p className="text-gray-600">
              {characterData.info?.race?.value} • {characterData.info?.charClass?.value} {characterData.info?.level?.value} ур.
            </p>
          </div>
        </div>
        <Link
          to={`/characters/${character.id}/edit`}
          className="btn-primary flex items-center space-x-2"
        >
          <Edit size={18} />
          <span>Редактировать</span>
        </Link>
      </div>

      {/* Вкладки */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="border-b border-gray-200">
          <nav className="flex space-x-8 px-6">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center space-x-2 py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon size={18} />
                  <span>{tab.name}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Содержимое вкладок */}
        <div className="p-6">
          {activeTab === 'basic' && renderBasicTab()}
          {activeTab === 'class-race' && renderClassRaceTab()}
          {activeTab === 'inventory' && renderInventoryTab()}
          {activeTab === 'actions' && renderActionsTab()}
          {activeTab === 'passives' && renderPassivesTab()}
        </div>
      </div>
    </div>
  );
};

export default CharacterDetail;
