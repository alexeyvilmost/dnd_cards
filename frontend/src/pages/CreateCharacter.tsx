import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Upload, FileText } from 'lucide-react';
import { charactersApi } from '../api/charactersApi';
import { useAuth } from '../contexts/AuthContext';

const CreateCharacter: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [importData, setImportData] = useState('');
  const [groupId, setGroupId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImportCharacter = async () => {
    if (!importData.trim()) {
      setError('Введите данные персонажа');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const newCharacter = await charactersApi.importCharacter({
        character_data: importData,
        group_id: groupId || undefined
      });

      navigate(`/characters/${newCharacter.id}`);
    } catch (err) {
      setError('Ошибка импорта персонажа');
      console.error('Error importing character:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setImportData(content);
      };
      reader.readAsText(file);
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

  const isValidJSON = validateJSON(importData);

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex items-center space-x-4">
        <button
          onClick={() => navigate('/characters')}
          className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft size={20} />
          <span>Назад</span>
        </button>
        <div>
          <h1 className="text-3xl font-fantasy font-bold text-gray-900">
            Создание персонажа
          </h1>
          <p className="text-gray-600">
            Импортируйте персонажа из JSON файла
          </p>
        </div>
      </div>

      {/* Ошибка */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="text-red-800">{error}</div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Основная форма */}
        <div className="lg:col-span-2 space-y-6">
          {/* Импорт персонажа */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
              <Upload className="h-5 w-5 mr-2" />
              Импорт персонажа
            </h2>
            
            <div className="space-y-4">
              {/* Загрузка файла */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Загрузить JSON файл
                </label>
                <div className="flex items-center space-x-4">
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                  />
                </div>
              </div>

              {/* Или ввод вручную */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Или вставьте JSON данные вручную
                </label>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      Вставьте JSON данные персонажа
                    </span>
                    <div className="flex items-center space-x-2">
                      <div className={`w-3 h-3 rounded-full ${isValidJSON ? 'bg-green-500' : 'bg-red-500'}`} />
                      <span className="text-sm text-gray-600">
                        {isValidJSON ? 'Валидный JSON' : 'Ошибка в JSON'}
                      </span>
                    </div>
                  </div>
                  <textarea
                    value={importData}
                    onChange={(e) => setImportData(e.target.value)}
                    className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={15}
                    placeholder="Вставьте JSON данные персонажа..."
                  />
                </div>
              </div>

              {/* Группа */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Группа (необязательно)
                </label>
                <select
                  value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Без группы</option>
                  {/* Здесь можно добавить список групп */}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Боковая панель */}
        <div className="space-y-6">
          {/* Информация */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <FileText className="h-5 w-5 mr-2" />
              Информация
            </h3>
            <div className="space-y-3 text-sm text-gray-600">
              <p>
                Вы можете импортировать персонажа из JSON файла, экспортированного из другого приложения или созданного вручную.
              </p>
              <p>
                Имя персонажа будет автоматически извлечено из JSON данных.
              </p>
              <p>
                После импорта вы сможете редактировать все данные персонажа.
              </p>
            </div>
          </div>

          {/* Подсказки */}
          <div className="bg-blue-50 rounded-lg border border-blue-200 p-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-4">Подсказки</h3>
            <div className="space-y-3 text-sm text-blue-800">
              <div>
                <strong>Формат файла:</strong> JSON файл с данными персонажа
              </div>
              <div>
                <strong>Размер:</strong> Максимальный размер файла 10 МБ
              </div>
              <div>
                <strong>Кодировка:</strong> UTF-8
              </div>
              <div>
                <strong>Валидация:</strong> JSON должен быть валидным
              </div>
            </div>
          </div>

          {/* Кнопки действий */}
          <div className="bg-gray-50 rounded-lg border border-gray-200 p-6">
            <div className="space-y-3">
              <button
                onClick={handleImportCharacter}
                disabled={loading || !isValidJSON || !importData.trim()}
                className="w-full btn-primary disabled:opacity-50 flex items-center justify-center space-x-2"
              >
                <Upload size={18} />
                <span>{loading ? 'Импорт...' : 'Импортировать персонажа'}</span>
              </button>
              
              <button
                onClick={() => navigate('/characters')}
                className="w-full btn-secondary"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateCharacter;
