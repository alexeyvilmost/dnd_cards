import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { variablesApi } from '../api/client';
import type { CreateVariableRequest, Variable } from '../types';

// Библиотека + конструктор переменных (см. docs/variables.md). Переменная — это
// name + type + default_value; значения на персонаже задают эффекты.
const typeOptions = [
  { value: 'number', label: 'Число (напр. 2)' },
  { value: 'dice', label: 'Кость (напр. 1d6)' },
];

const VariableCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const returnTo = searchParams.get('returnTo');
  const returnPath = returnTo === 'effect-creator' ? '/effect-creator' : '/?type=variables';
  const isEditMode = Boolean(editId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variables, setVariables] = useState<Variable[]>([]);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<CreateVariableRequest>({
    defaultValues: { var_type: 'number', default_value: '0', sort_order: 100 },
  });

  useEffect(() => {
    variablesApi.getVariables()
      .then((response) => setVariables(response.variables || []))
      .catch(() => setVariables([]));
    if (!editId) return;
    variablesApi.getVariable(editId)
      .then((v) => reset({
        variable_id: v.variable_id,
        name: v.name,
        description: v.description || '',
        var_type: v.var_type || 'number',
        default_value: v.default_value || '',
        sort_order: v.sort_order || 100,
      }))
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки переменной'));
  }, [editId, reset]);

  const deleteVariable = async (id: string) => {
    if (!confirm('Удалить переменную?')) return;
    try {
      await variablesApi.deleteVariable(id);
      setVariables((prev) => prev.filter((v) => v.variable_id !== id && v.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления переменной');
    }
  };

  const onSubmit = async (data: CreateVariableRequest) => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        ...data,
        variable_id: data.variable_id.trim(),
        name: data.name.trim(),
        var_type: data.var_type || 'number',
        default_value: (data.default_value || '').trim(),
        sort_order: Number(data.sort_order) || 0,
      };
      if (isEditMode && editId) await variablesApi.updateVariable(editId, payload);
      else await variablesApi.createVariable(payload);
      navigate(returnPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения переменной');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        {isEditMode ? 'Редактирование переменной' : 'Создание переменной'}
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Переменная — это имя, тип и значение по умолчанию. Значение на персонаже задают
        эффекты (payload <code>variable</code>, op set/add/remove). Ссылка в формулах — по ID.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-lg shadow p-6 space-y-5 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">ID переменной *</label>
          <input
            {...register('variable_id', {
              required: 'ID обязателен',
              pattern: { value: /^[a-zA-Z0-9_-]{1,100}$/, message: 'Только латиница, цифры, дефис и подчёркивание' },
            })}
            disabled={isEditMode}
            placeholder="martial_arts_die"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 font-mono"
          />
          {errors.variable_id && <p className="text-red-500 text-sm mt-1">{errors.variable_id.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Название *</label>
          <input
            {...register('name', { required: 'Название обязательно' })}
            placeholder="Кость боевых искусств"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
          {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Описание</label>
          <textarea
            {...register('description')}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            placeholder="Что это за переменная и откуда берётся"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Тип</label>
            <select {...register('var_type')} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {typeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Значение по умолчанию</label>
            <input
              {...register('default_value')}
              placeholder="1d6 или 2"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Сортировка</label>
            <input {...register('sort_order')} type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700">{error}</div>}

        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400">
            {loading ? 'Сохранение...' : 'Сохранить переменную'}
          </button>
          <button type="button" onClick={() => navigate(returnPath)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            Отмена
          </button>
        </div>
      </form>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Существующие переменные</h2>
        <div className="space-y-2">
          {variables.map((v) => (
            <div key={v.variable_id} className="flex items-center justify-between border border-gray-200 rounded-lg p-3">
              <div>
                <div className="font-medium text-gray-900">{v.name}</div>
                <div className="text-xs text-gray-500 font-mono">
                  {v.variable_id} · {v.var_type || 'number'} · по умолчанию: {v.default_value || '—'}
                </div>
              </div>
              <div className="flex gap-2">
                <Link to={`/variable-creator?edit=${v.variable_id}`} className="text-sm text-blue-600 hover:text-blue-800">Редактировать</Link>
                <button type="button" onClick={() => deleteVariable(v.variable_id)} className="text-sm text-red-600 hover:text-red-800">Удалить</button>
              </div>
            </div>
          ))}
          {variables.length === 0 && <p className="text-sm text-gray-500">Переменные пока не созданы.</p>}
        </div>
      </div>
    </div>
  );
};

export default VariableCreator;
