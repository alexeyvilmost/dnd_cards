import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grid3X3, List } from 'lucide-react';
import { weaponTemplatesApi } from '../services/weaponTemplatesApi';
import { WeaponTemplate, WEAPON_CATEGORIES } from '../types';
import WeaponTemplateCard from '../components/WeaponTemplateCard';

const WeaponTemplates: React.FC = () => {
  const [templates, setTemplates] = useState<WeaponTemplate[]>([]);
  const [filteredTemplates, setFilteredTemplates] = useState<WeaponTemplate[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [hoveredTemplate, setHoveredTemplate] = useState<WeaponTemplate | null>(null);
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
      image_url: template.image_cloudinary_url || template.image_path || '',
      properties: template.properties.join(','),
      // Добавляем новые поля
      author: 'Admin',
      source: 'Player\'s Handbook',
      type: 'weapon',
      tags: template.name + ',Оружие'
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
            
            {/* Переключатель режимов отображения */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg border ${
                  viewMode === 'grid' 
                    ? 'bg-blue-100 border-blue-300 text-blue-700' 
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
                title="Сетка"
              >
                <Grid3X3 size={18} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg border ${
                  viewMode === 'list' 
                    ? 'bg-blue-100 border-blue-300 text-blue-700' 
                    : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                }`}
                title="Список"
              >
                <List size={18} />
              </button>
            </div>
          </div>

        {/* Счетчик результатов */}
        <div className="mb-4 text-sm text-gray-600">
          Найдено: {filteredTemplates.length} из {templates.length}
        </div>

        {/* Отображение в зависимости от режима */}
        {viewMode === 'grid' ? (
          /* Сетка шаблонов */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-1 gap-y-2">
            {filteredTemplates.map((template) => (
              <WeaponTemplateCard
                key={template.id}
                template={template}
                onClick={() => handleTemplateSelect(template)}
              />
            ))}
          </div>
        ) : (
          /* Список названий в три колонки */
          <div className="relative">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {filteredTemplates.map((template) => (
                <div
                  key={template.id}
                  className="relative"
                  onMouseEnter={() => setHoveredTemplate(template)}
                  onMouseLeave={() => setHoveredTemplate(null)}
                >
                  <button
                    onClick={() => handleTemplateSelect(template)}
                    className="w-full text-left p-3 rounded-lg border border-gray-200 bg-white transition-all duration-200 hover:shadow-md hover:bg-gray-50 text-gray-900"
                  >
                    <div className="flex items-center space-x-3">
                      {/* Маленькая картинка слева */}
                      <div className="flex-shrink-0 w-12 h-12 rounded border border-gray-200 overflow-hidden">
                        {template.image_cloudinary_url && template.image_cloudinary_url.trim() !== '' ? (
                          <img
                            src={template.image_cloudinary_url}
                            alt={template.name}
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src = '/default_image.png';
                            }}
                          />
                        ) : template.image_path && template.image_path.trim() !== '' ? (
                          <img
                            src={template.image_path}
                            alt={template.name}
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              const target = e.target as HTMLImageElement;
                              target.src = '/default_image.png';
                            }}
                          />
                        ) : (
                          <img
                            src="/default_image.png"
                            alt="Default D&D"
                            className="w-full h-full object-contain"
                          />
                        )}
                      </div>
                      
                      {/* Текст справа */}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-gray-900">
                          {template.name}
                        </div>
                        
                        {/* Нижняя панель с весом, ценой, уроном */}
                        <div className="flex items-center justify-between mt-1 text-xs">
                          <div className="flex items-center space-x-2">
                            {template.weight && (
                              <div className="flex items-center space-x-1">
                                <span className="text-gray-900 font-medium">
                                  {template.weight}
                                </span>
                                <img src="/icons/weight.png" alt="Вес" className="w-3 h-3" />
                              </div>
                            )}
                            {template.price && (
                              <div className="flex items-center space-x-1">
                                <span className="text-yellow-600 font-bold">
                                  {template.price >= 1000 ? `${(template.price / 1000).toFixed(1)}K` : template.price}
                                </span>
                                <img src="/icons/coin.png" alt="Монеты" className="w-3 h-3" style={{ filter: 'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)' }} />
                              </div>
                            )}
                            {template.damage && (
                              <div className="flex items-center space-x-0.5">
                                <span className="text-gray-900 font-medium">
                                  {template.damage}
                                </span>
                                {template.damage_type && (
                                  <img src={`/icons/${template.damage_type}.png`} alt={template.damage_type} className="w-3 h-3" />
                                )}
                              </div>
                            )}
                          </div>
                          <span className="text-gray-400 font-mono">
                            #{template.id}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              ))}
            </div>
            
            {/* Показ шаблона при наведении */}
            {hoveredTemplate && (
              <div className="fixed top-4 right-4 z-50 pointer-events-none">
                <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-2">
                  <WeaponTemplateCard
                    template={hoveredTemplate}
                    onClick={() => {}}
                  />
                </div>
              </div>
            )}
          </div>
        )}

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
