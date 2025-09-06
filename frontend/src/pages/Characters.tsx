import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users, User, Package, Eye, Edit, Trash2, Download, Upload } from 'lucide-react';
import { charactersApi } from '../api/charactersApi';
import { useAuth } from '../contexts/AuthContext';
import type { Character } from '../types';

const Characters: React.FC = () => {
  const { user } = useAuth();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importData, setImportData] = useState('');
  const [importGroupId, setImportGroupId] = useState<string>('');
  const [importFile, setImportFile] = useState<File | null>(null);

  useEffect(() => {
    loadCharacters();
  }, [selectedGroup]);

  const loadCharacters = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await charactersApi.getCharacters({
        group_id: selectedGroup || undefined,
        limit: 100
      });
      setCharacters(response.characters || []);
    } catch (err) {
      setError('Ошибка загрузки персонажей');
      console.error('Error loading characters:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCharacter = async (id: string) => {
    if (!window.confirm('Вы уверены, что хотите удалить этого персонажа?')) {
      return;
    }

    try {
      await charactersApi.deleteCharacter(id);
      setCharacters(characters.filter(char => char.id !== id));
    } catch (err) {
      setError('Ошибка удаления персонажа');
      console.error('Error deleting character:', err);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setImportFile(file);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        setImportData(content);
      };
      reader.readAsText(file);
    }
  };

  const handleImportCharacter = async () => {
    if (!importData.trim()) {
      setError('Введите данные персонажа или загрузите файл');
      return;
    }

    try {
      const newCharacter = await charactersApi.importCharacter({
        character_data: importData,
        group_id: importGroupId || undefined
      });
      setCharacters([newCharacter, ...characters]);
      setImportModalOpen(false);
      setImportData('');
      setImportGroupId('');
      setImportFile(null);
    } catch (err) {
      setError('Ошибка импорта персонажа');
      console.error('Error importing character:', err);
    }
  };

  const handleExportCharacter = async (character: Character) => {
    try {
      const response = await charactersApi.exportCharacter(character.id);
      const blob = new Blob([response.character_data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${character.name}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError('Ошибка экспорта персонажа');
      console.error('Error exporting character:', err);
    }
  };

  const parseCharacterData = (data: string) => {
    try {
      const parsed = JSON.parse(data);
      return {
        name: parsed.name?.value || 'Неизвестный персонаж',
        class: parsed.info?.charClass?.value || 'Неизвестный класс',
        level: parsed.info?.level?.value || 1,
        race: parsed.info?.race?.value || 'Неизвестная раса'
      };
    } catch {
      return {
        name: 'Неизвестный персонаж',
        class: 'Неизвестный класс',
        level: 1,
        race: 'Неизвестная раса'
      };
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="text-lg text-gray-600">Загрузка персонажей...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Заголовок */}
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-fantasy font-bold text-gray-900">
          Мои персонажи
        </h1>
        <div className="flex space-x-3">
          <button
            onClick={() => setImportModalOpen(true)}
            className="btn-secondary flex items-center space-x-2"
          >
            <Upload size={18} />
            <span>Импорт</span>
          </button>
          <Link
            to="/characters/create"
            className="btn-primary flex items-center space-x-2"
          >
            <Plus size={18} />
            <span>Создать персонажа</span>
          </Link>
        </div>
      </div>

      {/* Фильтры */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center space-x-4">
          <label className="text-sm font-medium text-gray-700">
            Группа:
          </label>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Все группы</option>
            {/* Здесь можно добавить список групп */}
          </select>
        </div>
      </div>

      {/* Ошибка */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <div className="text-red-800">{error}</div>
        </div>
      )}

      {/* Список персонажей */}
      {characters.length === 0 ? (
        <div className="text-center py-12">
          <User className="mx-auto h-12 w-12 text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Персонажи не найдены
          </h3>
          <p className="text-gray-600 mb-4">
            Создайте своего первого персонажа или импортируйте существующего
          </p>
          <div className="flex justify-center space-x-3">
            <button
              onClick={() => setImportModalOpen(true)}
              className="btn-secondary flex items-center space-x-2"
            >
              <Upload size={16} />
              <span>Импорт</span>
            </button>
            <Link
              to="/characters/create"
              className="btn-primary flex items-center space-x-2"
            >
              <Plus size={16} />
              <span>Создать</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {characters.map((character) => {
            const characterInfo = parseCharacterData(character.data);
            return (
              <div
                key={character.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      {characterInfo.name}
                    </h3>
                    <p className="text-sm text-gray-600">
                      {characterInfo.race} • {characterInfo.class} {characterInfo.level} ур.
                    </p>
                    {character.group && (
                      <p className="text-xs text-blue-600 mt-1">
                        Группа: {character.group.name}
                      </p>
                    )}
                  </div>
                  <div className="flex space-x-1">
                    <Link
                      to={`/characters/${character.id}`}
                      className="p-1 text-gray-400 hover:text-blue-600 transition-colors"
                      title="Просмотр"
                    >
                      <Eye size={16} />
                    </Link>
                    <Link
                      to={`/characters/${character.id}/edit`}
                      className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                      title="Редактировать"
                    >
                      <Edit size={16} />
                    </Link>
                    <button
                      onClick={() => handleExportCharacter(character)}
                      className="p-1 text-gray-400 hover:text-purple-600 transition-colors"
                      title="Экспорт"
                    >
                      <Download size={16} />
                    </button>
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
            );
          })}
        </div>
      )}

      {/* Модальное окно импорта */}
      {importModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Импорт персонажа
            </h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Загрузить файл персонажа:
                </label>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {importFile && (
                  <p className="mt-1 text-sm text-green-600">
                    Загружен файл: {importFile.name}
                  </p>
                )}
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Или вставьте JSON данные персонажа:
                </label>
                <textarea
                  value={importData}
                  onChange={(e) => setImportData(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={10}
                  placeholder="Вставьте JSON данные персонажа..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Группа (необязательно):
                </label>
                <select
                  value={importGroupId}
                  onChange={(e) => setImportGroupId(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Без группы</option>
                  {/* Здесь можно добавить список групп */}
                </select>
              </div>
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setImportModalOpen(false);
                  setImportData('');
                  setImportGroupId('');
                  setImportFile(null);
                }}
                className="btn-secondary"
              >
                Отмена
              </button>
              <button
                onClick={handleImportCharacter}
                className="btn-primary"
              >
                Импорт
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Characters;
