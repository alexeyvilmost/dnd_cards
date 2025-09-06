import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users, Hash, AlertCircle } from 'lucide-react';
import { groupsApi } from '../api/groupsApi';

const JoinGroup: React.FC = () => {
  const [groupId, setGroupId] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await groupsApi.joinGroup({ group_id: groupId });
      setSuccess('Вы успешно присоединились к группе!');
      setTimeout(() => {
        navigate('/groups');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка присоединения к группе');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setGroupId(e.target.value);
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/groups')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft size={20} className="mr-2" />
          Назад к группам
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Присоединиться к группе</h1>
        <p className="text-gray-600 mt-1">Введите ID группы, к которой хотите присоединиться</p>
      </div>

      {/* Form */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Success message */}
          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-green-800 text-sm">{success}</p>
                </div>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <p className="text-red-800 text-sm">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Group ID input */}
          <div>
            <label htmlFor="groupId" className="block text-sm font-medium text-gray-700 mb-2">
              ID группы *
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Hash className="h-5 w-5 text-gray-400" />
              </div>
              <input
                id="groupId"
                name="groupId"
                type="text"
                required
                value={groupId}
                onChange={handleChange}
                className="input-field pl-10"
                placeholder="Введите ID группы"
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              ID группы можно получить у мастера игры
            </p>
          </div>

          {/* Info box */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <Users className="h-5 w-5 text-blue-400" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-blue-800">
                  Как получить ID группы?
                </h3>
                <div className="text-sm text-blue-700 mt-1 space-y-1">
                  <p>• Попросите мастера игры поделиться ID группы</p>
                  <p>• ID группы выглядит как: 123e4567-e89b-12d3-a456-426614174000</p>
                  <p>• После присоединения вы станете игроком в группе</p>
                </div>
              </div>
            </div>
          </div>

          {/* Submit button */}
          <div className="flex justify-end space-x-4">
            <button
              type="button"
              onClick={() => navigate('/groups')}
              className="btn-secondary border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isLoading || !groupId.trim()}
              className="btn-primary bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Присоединение...
                </div>
              ) : (
                'Присоединиться'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JoinGroup;
