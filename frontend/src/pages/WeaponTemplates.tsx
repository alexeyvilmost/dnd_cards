import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { weaponTemplatesApi } from '../services/weaponTemplatesApi';
import { WeaponTemplate, WEAPON_CATEGORIES } from '../types';
import WeaponTemplateCard from '../components/WeaponTemplateCard';

const WeaponTemplates: React.FC = () => {
  const [templates, setTemplates] = useState<WeaponTemplate[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<WeaponTemplate[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    loadTemplates();
  }, []);

  useEffect(() => {
    filterTemplates();
  }, [templates, selectedCategory, searchTerm]);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const data = await weaponTemplatesApi.getWeaponTemplates();
      setTemplates(data);
    } catch (error) {
      console.error('Ошибка загрузки шаблонов:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterTemplates = () => {
    let filtered = templates;

    // Фильтр по категории
    if (selectedCategory) {
      filtered = filtered.filter(template => template.category === selectedCategory);
    }

    // Фильтр по поиску
    if (searchTerm) {
      filtered = filtered.filter(template =>
        template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        template.name_en.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredTemplates(filtered);
  };

  const handleTemplateSelect = (template: WeaponTemplate) => {
    // Передаем данные шаблона через URL параметры
    const params = new URLSearchParams({
      name: template.name,
      category: template.category,
      damage_type: template.damage_type,
      price: template.price.toString(),
      weight: template.weight.toString(),
      bonus_type: 'damage',
      bonus_value: template.damage,
      image_path: template.image_path,
      properties: template.properties.join(',')
    });
    navigate(`/create?${params.toString()}`);
  };

  const generateDescription = (template: WeaponTemplate): string => {
    const damageTypeLabels: Record<string, string> = {
      'slashing': 'рубящий',
      'piercing': 'колющий',
      'bludgeoning': 'дробящий'
    };

    const categoryLabels: Record<string, string> = {
      'simple_melee': 'простое рукопашное',
      'martial_melee': 'воинское рукопашное',
      'simple_ranged': 'простое дальнобойное',
      'martial_ranged': 'воинское дальнобойное'
    };

    let description = `${template.name} - это ${categoryLabels[template.category]} оружие, наносящее ${template.damage} ${damageTypeLabels[template.damage_type]} урона.`;

    if (template.properties.length > 0) {
      const propertyLabels: Record<string, string> = {
        'light': 'легкое',
        'heavy': 'тяжелое',
        		'finesse': 'фехтовальное',
        'thrown': 'метательное',
        'versatile': 'универсальное',
        'two-handed': 'двуручное',
        'reach': 'досягаемости',
        'ammunition': 'требует боеприпасы',
        'loading': 'зарядка',
        'special': 'особое'
      };

      const properties = template.properties.map(p => propertyLabels[p] || p).join(', ');
      description += ` Свойства: ${properties}.`;
    }

    return description;
  };



  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <div className="text-lg">Загрузка шаблонов...</div>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <h1 className="text-3xl font-fantasy font-bold text-gray-900 mb-4">Шаблоны оружия</h1>
            <p className="text-gray-600">Выберите шаблон оружия для создания карты</p>
          </div>

          {/* Фильтры */}
          <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Поиск по названию..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="sm:w-64">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Все категории</option>
              {WEAPON_CATEGORIES.map(category => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Счетчик результатов */}
        <div className="mb-4 text-sm text-gray-600">
          Найдено: {filteredTemplates.length} из {templates.length}
        </div>

        {/* Сетка шаблонов */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-1 gap-y-2">
          {filteredTemplates.map((template) => (
            <WeaponTemplateCard
              key={template.id}
              template={template}
              onClick={() => handleTemplateSelect(template)}
            />
          ))}
        </div>

        {filteredTemplates.length === 0 && (
          <div className="text-center py-12">
            <div className="text-gray-500 text-lg">
              {searchTerm || selectedCategory ? 'Шаблоны не найдены' : 'Шаблоны не загружены'}
            </div>
          </div>
        )}
        </>
      )}
    </div>
  );
};

export default WeaponTemplates;
