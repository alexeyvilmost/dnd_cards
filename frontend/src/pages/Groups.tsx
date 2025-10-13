import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users, Crown, User, Calendar, ArrowRight } from 'lucide-react';
import { groupsApi } from '../api/groupsApi';
import { useAuth } from '../contexts/AuthContext';
import type { Group } from '../types';

const Groups: React.FC = () => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await groupsApi.getGroups();
      setGroups(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки групп');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getUserRole = (group: Group) => {
    const member = group.members.find(m => m.user_id === user?.id);
    return member?.role || 'player';
  };

  const isDM = (group: Group) => {
    return group.dm_id === user?.id;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка групп...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <div className="flex items-center">
          <div className="text-red-600">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Ошибка загрузки</h3>
            <p className="text-sm text-red-700 mt-1">{error}</p>
          </div>
        </div>
        <div className="mt-4">
          <button
            onClick={loadGroups}
            className="text-sm bg-red-100 text-red-800 px-3 py-2 rounded-md hover:bg-red-200 transition-colors"
          >
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Мои группы</h1>
          <p className="text-sm sm:text-base text-gray-600 mt-1">Управляйте своими группами D&D</p>
        </div>
        <Link
          to="/groups/create"
          className="btn-primary bg-blue-600 hover:bg-blue-700 flex items-center justify-center space-x-2 w-full sm:w-auto"
        >
          <Plus size={20} />
          <span>Создать группу</span>
        </Link>
      </div>

      {/* Groups list */}
      {groups.length === 0 ? (
        <div className="text-center py-12">
          <Users className="h-16 w-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">У вас пока нет групп</h3>
          <p className="text-gray-600 mb-6">Создайте новую группу или присоединитесь к существующей</p>
          <div className="space-x-4">
            <Link
              to="/groups/create"
              className="btn-primary bg-blue-600 hover:bg-blue-700 inline-flex items-center space-x-2"
            >
              <Plus size={20} />
              <span>Создать группу</span>
            </Link>
            <Link
              to="/groups/join"
              className="btn-secondary border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center space-x-2"
            >
              <Users size={20} />
              <span>Присоединиться</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((group) => (
            <div
              key={group.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow"
            >
              <div className="p-6">
                {/* Group header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900 mb-1">
                      {group.name}
                    </h3>
                    {group.description && (
                      <p className="text-sm text-gray-600 line-clamp-2">
                        {group.description}
                      </p>
                    )}
                  </div>
                  {isDM(group) && (
                    <div className="flex items-center text-yellow-600 ml-2">
                      <Crown size={16} />
                    </div>
                  )}
                </div>

                {/* Group info */}
                <div className="space-y-3 mb-4">
                  <div className="flex items-center text-sm text-gray-600">
                    <User size={16} className="mr-2" />
                    <span>ДМ: {group.dm.display_name}</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-600">
                    <Users size={16} className="mr-2" />
                    <span>{group.members.length} участников</span>
                  </div>
                  <div className="flex items-center text-sm text-gray-600">
                    <Calendar size={16} className="mr-2" />
                    <span>Создана {formatDate(group.created_at)}</span>
                  </div>
                </div>

                {/* User role */}
                <div className="mb-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    getUserRole(group) === 'dm'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {getUserRole(group) === 'dm' ? (
                      <>
                        <Crown size={12} className="mr-1" />
                        Мастер игры
                      </>
                    ) : (
                      <>
                        <User size={12} className="mr-1" />
                        Игрок
                      </>
                    )}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex space-x-2">
                  <Link
                    to={`/groups/${group.id}`}
                    className="flex-1 btn-primary bg-blue-600 hover:bg-blue-700 flex items-center justify-center space-x-2"
                  >
                    <span>Открыть</span>
                    <ArrowRight size={16} />
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Groups;
