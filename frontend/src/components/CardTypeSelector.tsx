import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface CardTypeSelectorProps {
  onClose?: () => void;
}

const CardTypeSelector: React.FC<CardTypeSelectorProps> = ({ onClose }) => {
  const navigate = useNavigate();

  const cardTypes = [
    {
      id: 'weapon',
      name: '⚔️ Оружие',
      description: 'Мечи, луки, магические артефакты',
      color: 'bg-red-50 border-red-200 hover:bg-red-100'
    },
    {
      id: 'equipment',
      name: '🛡️ Экипировка',
      description: 'Доспехи, одежда, аксессуары',
      color: 'bg-blue-50 border-blue-200 hover:bg-blue-100'
    },
    {
      id: 'potion',
      name: '🧪 Зелье',
      description: 'Магические зелья и эликсиры',
      color: 'bg-green-50 border-green-200 hover:bg-green-100'
    },
    {
      id: 'ingredient',
      name: '🌿 Ингредиент',
      description: 'Компоненты для зелий и заклинаний',
      color: 'bg-yellow-50 border-yellow-200 hover:bg-yellow-100'
    },
    {
      id: 'trinket',
      name: '💎 Безделушка',
      description: 'Украшения, игрушки, сувениры',
      color: 'bg-purple-50 border-purple-200 hover:bg-purple-100'
    },
    {
      id: 'custom',
      name: '🔧 Свой предмет',
      description: 'Создать уникальный предмет',
      color: 'bg-gray-50 border-gray-200 hover:bg-gray-100'
    }
  ];

  const handleTypeSelect = (typeId: string) => {
    if (typeId === 'weapon') {
      navigate('/card-creator/weapon');
    } else if (typeId === 'equipment') {
      navigate('/card-creator/equipment');
    } else if (typeId === 'potion') {
      navigate('/card-creator?template_id=4ac499e7-5706-4600-86f2-65bb70d083a1');
    } else if (typeId === 'ingredient') {
      navigate('/card-creator?template_id=2239f356-a314-4ccc-bfb8-c483598c7150');
    } else if (typeId === 'trinket') {
      navigate('/card-creator?template_id=740161b8-1870-4a8d-8810-5c1a3f0c660c');
    } else if (typeId === 'custom') {
      navigate('/card-creator');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Приветствую! Что создаем сегодня?
          </h1>
          <p className="text-gray-600">
            Выберите тип предмета для создания карты
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {cardTypes.map((type) => {
            return (
              <button
                key={type.id}
                onClick={() => handleTypeSelect(type.id)}
                className={`
                  ${type.color}
                  border-2 rounded-xl p-6 text-left transition-all duration-200
                  hover:scale-105 hover:shadow-lg
                  focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                `}
              >
                <div className="mb-4">
                  <h3 className="text-xl font-semibold text-gray-900">
                    {type.name}
                  </h3>
                </div>
                <p className="text-gray-600 text-sm">
                  {type.description}
                </p>
              </button>
            );
          })}
        </div>

        {onClose && (
          <div className="text-center mt-8">
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 transition-colors"
            >
              ← Назад
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default CardTypeSelector;
