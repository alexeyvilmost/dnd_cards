import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Users, Crown, User, Calendar, LogOut, Trash2, UserPlus } from 'lucide-react';
import { groupsApi } from '../api/groupsApi';
import { useAuth } from '../contexts/AuthContext';
import type { Group, GroupMember } from '../types';

const GroupDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (id) {
      loadGroup();
      loadMembers();
    }
  }, [id]);

  const loadGroup = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await groupsApi.getGroup(id!);
      setGroup(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки группы');
    } finally {
      setIsLoading(false);
    }
  };

  const loadMembers = async () => {
    try {
      const data = await groupsApi.getGroupMembers(id!);
      setMembers(data);
    } catch (err) {
      console.error('Ошибка загрузки участников:', err);
    }
  };

  const handleLeaveGroup = async () => {
    if (!window.confirm('Вы уверены, что хотите покинуть группу?')) {
      return;
    }

    try {
      setIsLeaving(true);
      await groupsApi.leaveGroup(id!);
      navigate('/groups');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при покидании группы');
    } finally {
      setIsLeaving(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const getUserRole = () => {
    if (!group || !user) return null;
    const member = group.members.find(m => m.user_id === user.id);
    return member?.role || null;
  };

  const isDM = () => {
    return group?.dm_id === user?.id;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Загрузка группы...</p>
        </div>
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="mb-8">
          <button
            onClick={() => navigate('/groups')}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft size={20} className="mr-2" />
            Назад к группам
          </button>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-6">
          <div className="flex items-center">
            <div className="text-red-600">
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Ошибка загрузки</h3>
              <p className="text-sm text-red-700 mt-1">{error || 'Группа не найдена'}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => navigate('/groups')}
          className="flex items-center text-gray-600 hover:text-gray-900 mb-4 transition-colors"
        >
          <ArrowLeft size={20} className="mr-2" />
          Назад к группам
        </button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <h1 className="text-3xl font-bold text-gray-900">{group.name}</h1>
              {isDM() && (
                <div className="flex items-center text-yellow-600">
                  <Crown size={20} />
                </div>
              )}
            </div>
            {group.description && (
              <p className="text-gray-600 text-lg">{group.description}</p>
            )}
          </div>
          <div className="flex space-x-3">
            {!isDM() && (
              <button
                onClick={handleLeaveGroup}
                disabled={isLeaving}
                className="btn-secondary border-red-300 text-red-700 hover:bg-red-50 flex items-center space-x-2"
              >
                <LogOut size={16} />
                <span>{isLeaving ? 'Покидание...' : 'Покинуть группу'}</span>
              </button>
            )}
            <Link
              to={`/groups/${group.id}/inventory`}
              className="btn-primary bg-blue-600 hover:bg-blue-700 flex items-center space-x-2"
            >
              <Users size={16} />
              <span>Инвентарь группы</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Group info */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Group details */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Информация о группе</h2>
          <div className="space-y-4">
            <div className="flex items-center text-sm text-gray-600">
              <Crown size={16} className="mr-3 text-yellow-600" />
              <span>Мастер игры: {group.dm.display_name}</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <Users size={16} className="mr-3" />
              <span>{group.members.length} участников</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <Calendar size={16} className="mr-3" />
              <span>Создана {formatDate(group.created_at)}</span>
            </div>
            <div className="flex items-center text-sm text-gray-600">
              <User size={16} className="mr-3" />
              <span>Ваша роль: {
                getUserRole() === 'dm' ? 'Мастер игры' : 'Игрок'
              }</span>
            </div>
          </div>
        </div>

        {/* Group ID */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">ID группы</h2>
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-2">Поделитесь этим ID с игроками:</p>
            <div className="flex items-center space-x-2">
              <code className="flex-1 text-sm font-mono bg-white border border-gray-200 rounded px-3 py-2">
                {group.id}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(group.id)}
                className="btn-secondary border-gray-300 text-gray-700 hover:bg-gray-50 text-sm px-3 py-2"
              >
                Копировать
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Members list */}
      <div className="mt-8">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Участники группы</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {members.map((member) => (
              <div key={member.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    member.role === 'dm' 
                      ? 'bg-yellow-100 text-yellow-600' 
                      : 'bg-blue-100 text-blue-600'
                  }`}>
                    {member.role === 'dm' ? (
                      <Crown size={16} />
                    ) : (
                      <User size={16} />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {member.user.display_name}
                    </p>
                    <p className="text-xs text-gray-500">
                      @{member.user.username}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    member.role === 'dm'
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-blue-100 text-blue-800'
                  }`}>
                    {member.role === 'dm' ? 'Мастер игры' : 'Игрок'}
                  </span>
                  {member.user_id === user?.id && (
                    <span className="text-xs text-gray-500">(Вы)</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default GroupDetail;
