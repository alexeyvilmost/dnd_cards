import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Eye } from 'lucide-react';
import { charactersApi } from '../api/charactersApi';
import { useAuth } from '../contexts/AuthContext';
import type { Character, CharacterData, UpdateCharacterRequest } from '../types';

const CharacterEdit: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [character, setCharacter] = useState<Character | null>(null);
  const [characterData, setCharacterData] = useState<CharacterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);

  // Форма редактирования
  const [formData, setFormData] = useState({
    name: '',
    group_id: '',
    data: ''
  });

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
        setFormData({
          name: character.name,
          group_id: character.group_id || '',
          data: character.data
        });
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

  const handleSave = async () => {
    if (!id) return;

    try {
      setSaving(true);
      setError(null);

      const updateData: UpdateCharacterRequest = {
        name: formData.name,
        group_id: formData.group_id || undefined,
        data: formData.data
      };

      await charactersApi.updateCharacter(id, updateData);
      navigate(`/characters/${id}`);
    } catch (err) {
      setError('Ошибка сохранения персонажа');
      console.error('Error saving character:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDataChange = (newData: string) => {
    setFormData(prev => ({ ...prev, data: newData }));
    
    // Пытаемся обновить имя персонажа из JSON
    try {
      const parsed = JSON.parse(newData);
      if (parsed.name?.value && parsed.name.value !== formData.name) {
        setFormData(prev => ({ ...prev, name: parsed.name.value }));
      }
    } catch {
      // Игнорируем ошибки парсинга при вводе
    }
  };

  const validateJSON = (jsonString: string): boolean => {
    try {
      JSON.parse(jsonString);
      return true;
    } catch {
      return false;
    }
  };

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
        <button
          onClick={() => navigate('/characters')}
          className="btn-primary"
        >
          Вернуться к списку
        </button>
      </div>
    );
  }

  const isValidJSON = validateJSON(formData.data);

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate(`/characters/${id}`)}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft size={20} />
            <span>Назад</span>
          </button>
          <div>
            <h1 className="text-3xl font-fantasy font-bold text-gray-900">
              Редактирование персонажа
            </h1>
            <p className="text-gray-600">
              {characterData.name?.value || character.name}
            </p>
          </div>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={() => setPreviewMode(!previewMode)}
            className="btn-secondary flex items-center space-x-2"
          >
            <Eye size={18} />
            <span>{previewMode ? 'Редактировать' : 'Предпросмотр'}</span>
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !isValidJSON}
            className="btn-primary flex items-center space-x-2 disabled:opacity-50"
          >
            <Save size={18} />
            <span>{saving ? 'Сохранение...' : 'Сохранить'}</span>
          </button>
        </div>
      </div>

      {/* Ошибка */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="text-red-800">{error}</div>
        </div>
      )}

      {/* Предупреждение о невалидном JSON */}
      {!isValidJSON && formData.data && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4">
          <div className="text-yellow-800">
            JSON данные содержат ошибки. Исправьте их перед сохранением.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Основная форма */}
        <div className="lg:col-span-2 space-y-6">
          {/* Основная информация */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Основная информация</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Имя персонажа
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Введите имя персонажа"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Группа (необязательно)
                </label>
                <select
                  value={formData.group_id}
                  onChange={(e) => setFormData(prev => ({ ...prev, group_id: e.target.value }))}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Без группы</option>
                  {/* Здесь можно добавить список групп */}
                </select>
              </div>
            </div>
          </div>

          {/* JSON данные */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Данные персонажа (JSON)</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600">
                  Здесь хранятся все данные персонажа в формате JSON. Будьте осторожны при редактировании.
                </p>
                <div className="flex items-center space-x-2">
                  <div className={`w-3 h-3 rounded-full ${isValidJSON ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className="text-sm text-gray-600">
                    {isValidJSON ? 'Валидный JSON' : 'Ошибка в JSON'}
                  </span>
                </div>
              </div>
              
              {previewMode ? (
                <div className="border border-gray-300 rounded-md p-4 bg-gray-50 max-h-96 overflow-y-auto">
                  <pre className="text-sm text-gray-800 whitespace-pre-wrap">
                    {JSON.stringify(JSON.parse(formData.data), null, 2)}
                  </pre>
                </div>
              ) : (
                <textarea
                  value={formData.data}
                  onChange={(e) => handleDataChange(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={20}
                  placeholder="Введите JSON данные персонажа..."
                />
              )}
            </div>
          </div>
        </div>

        {/* Боковая панель */}
        <div className="space-y-6">
          {/* Информация о персонаже */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Информация</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Создан:</span>
                <span>{new Date(character.created_at).toLocaleDateString('ru-RU')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Обновлен:</span>
                <span>{new Date(character.updated_at).toLocaleDateString('ru-RU')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Владелец:</span>
                <span>{character.user?.display_name || character.user?.username}</span>
              </div>
              {character.group && (
                <div className="flex justify-between">
                  <span className="text-gray-600">Группа:</span>
                  <span>{character.group.name}</span>
                </div>
              )}
            </div>
          </div>

          {/* Подсказки */}
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-4">Подсказки</h3>
            <div className="space-y-3 text-sm text-blue-800">
              <div>
                <strong>Имя персонажа:</strong> Будет автоматически обновлено из JSON данных при сохранении.
              </div>
              <div>
                <strong>JSON данные:</strong> Содержат всю информацию о персонаже. Будьте осторожны при редактировании.
              </div>
              <div>
                <strong>Предпросмотр:</strong> Используйте кнопку "Предпросмотр" для красивого отображения JSON.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterEdit;
