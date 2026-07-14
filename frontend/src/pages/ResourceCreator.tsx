import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { resourcesApi } from '../api/client';
import type { CreateResourceRequest, ResourceDefinition } from '../types';
import ImageUploader from '../components/ImageUploader';

const categoryOptions = [
  { value: 'action_cost', label: 'Стоимость действия' },
  { value: 'class_resource', label: 'Ресурс класса' },
  { value: 'character_resource', label: 'Ресурс персонажа' },
  { value: 'item_resource', label: 'Ресурс предмета' },
];

const rechargeOptions = [
  { value: '', label: 'Не восстанавливается автоматически' },
  { value: 'per_turn', label: 'Каждый ход' },
  { value: 'per_round', label: 'Каждый раунд' },
  { value: 'short_rest', label: 'Короткий отдых' },
  { value: 'long_rest', label: 'Длинный отдых' },
  { value: 'custom', label: 'Произвольно' },
];

const ResourceCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const returnTo = searchParams.get('returnTo');
  const returnPath = returnTo === 'action-creator' ? '/action-creator' : '/?type=resources';
  const isEditMode = Boolean(editId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resources, setResources] = useState<ResourceDefinition[]>([]);
  const { register, handleSubmit, setValue, reset, watch, formState: { errors } } = useForm<CreateResourceRequest>({
    defaultValues: { category: 'class_resource', sort_order: 100 },
  });

  useEffect(() => {
    resourcesApi.getResources()
      .then((response) => setResources(response.resources || []))
      .catch(() => setResources([]));
    if (!editId) return;
    resourcesApi.getResource(editId)
      .then((resource) => {
        reset({
          resource_id: resource.resource_id,
          name: resource.name,
          name_en: resource.name_en || '',
          description: resource.description || '',
          category: resource.category || 'class_resource',
          image_url: resource.image_url || '',
          image_url_spent: resource.image_url_spent || '',
          recharge: resource.recharge || '',
          sort_order: resource.sort_order || 100,
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки ресурса'));
  }, [editId, reset]);

  const deleteResource = async (id: string) => {
    if (!confirm('Удалить ресурс?')) return;
    try {
      await resourcesApi.deleteResource(id);
      setResources((prev) => prev.filter((resource) => resource.resource_id !== id && resource.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления ресурса');
    }
  };

  const onSubmit = async (data: CreateResourceRequest) => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        ...data,
        resource_id: data.resource_id.trim(),
        name: data.name.trim(),
        category: data.category || 'class_resource',
        recharge: data.recharge || '',
        sort_order: Number(data.sort_order) || 0,
      };
      if (isEditMode && editId) {
        await resourcesApi.updateResource(editId, payload);
      } else {
        await resourcesApi.createResource(payload);
      }
      navigate(returnPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения ресурса');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">
        {isEditMode ? 'Редактирование ресурса' : 'Создание ресурса'}
      </h1>

      <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-lg shadow p-6 space-y-5 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">ID ресурса *</label>
          <input
            {...register('resource_id', {
              required: 'ID обязателен',
              pattern: { value: /^[a-zA-Z0-9_-]{1,100}$/, message: 'Только латиница, цифры, дефис и подчёркивание' },
            })}
            disabled={isEditMode}
            placeholder="rage_charge"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
          />
          {errors.resource_id && <p className="text-red-500 text-sm mt-1">{errors.resource_id.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Название *</label>
          <input
            {...register('name', { required: 'Название обязательно' })}
            placeholder="Заряд ярости"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
          {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Оригинальное название</label>
          <input
            {...register('name_en')}
            placeholder="Rage Charge"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Описание</label>
          <textarea
            {...register('description')}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            placeholder="Когда и как расходуется ресурс"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Категория</label>
            <select {...register('category')} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {categoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Восстановление</label>
            <select {...register('recharge')} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
              {rechargeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Сортировка</label>
            <input {...register('sort_order')} type="number" className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Иконка</label>
          <ImageUploader
            onImageUpload={(imageUrl) => setValue('image_url', imageUrl)}
            currentImageUrl={watch('image_url') || ''}
            entityType="card"
            entityId={watch('resource_id') || 'new'}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Вид использованного заряда</label>
          <ImageUploader
            onImageUpload={(imageUrl) => setValue('image_url_spent', imageUrl)}
            currentImageUrl={watch('image_url_spent') || ''}
            entityType="card"
            entityId={`${watch('resource_id') || 'new'}_spent`}
          />
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700">{error}</div>}

        <div className="flex gap-3">
          <button type="submit" disabled={loading} className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400">
            {loading ? 'Сохранение...' : 'Сохранить ресурс'}
          </button>
          <button type="button" onClick={() => navigate(returnPath)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            Отмена
          </button>
        </div>
      </form>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Существующие ресурсы</h2>
        <div className="space-y-2">
          {resources.map((resource) => (
            <div key={resource.resource_id} className="flex items-center justify-between border border-gray-200 rounded-lg p-3">
              <div className="flex items-center gap-3">
                {resource.image_url && <img src={resource.image_url} alt="" className="w-8 h-8 object-contain" />}
                <div>
                  <div className="font-medium text-gray-900">{resource.name}</div>
                  <div className="text-xs text-gray-500">{resource.resource_id} · {resource.category || 'character_resource'}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <Link to={`/resource-creator?edit=${resource.resource_id}`} className="text-sm text-blue-600 hover:text-blue-800">
                  Редактировать
                </Link>
                <button type="button" onClick={() => deleteResource(resource.resource_id)} className="text-sm text-red-600 hover:text-red-800">
                  Удалить
                </button>
              </div>
            </div>
          ))}
          {resources.length === 0 && <p className="text-sm text-gray-500">Ресурсы пока не созданы.</p>}
        </div>
      </div>
    </div>
  );
};

export default ResourceCreator;
