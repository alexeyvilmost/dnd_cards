import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { conceptsApi } from '../api/client';
import type { CreateConceptRequest, Concept } from '../types';
import { FormattedTextarea } from '../components/FormattedTextarea';
import { evictEntity } from '../components/EntityRefRegistry';

// Библиотека + конструктор «понятий» (глоссарий). Понятие — это пояснение, которое не
// выражается отдельной сущностью (напр. «Спасбросок»). На него ссылаются из текстов:
// [[Спасбросок|concept:saving_throw]]. Аналог переменных.
const ConceptCreator = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get('edit');
  const returnPath = '/?type=concepts';
  const isEditMode = Boolean(editId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [concepts, setConcepts] = useState<Concept[]>([]);
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<CreateConceptRequest>({
    defaultValues: { sort_order: 100, description: '' },
  });

  useEffect(() => {
    conceptsApi.getConcepts()
      .then((response) => setConcepts(response.concepts || []))
      .catch(() => setConcepts([]));
    if (!editId) return;
    conceptsApi.getConcept(editId)
      .then((v) => reset({
        concept_id: v.concept_id,
        name: v.name,
        name_en: v.name_en || '',
        description: v.description || '',
        image_url: v.image_url || '',
        sort_order: v.sort_order || 100,
      }))
      .catch((err) => setError(err instanceof Error ? err.message : 'Ошибка загрузки понятия'));
  }, [editId, reset]);

  const deleteConcept = async (id: string) => {
    if (!confirm('Удалить понятие?')) return;
    try {
      await conceptsApi.deleteConcept(id);
      evictEntity('concept', id);
      setConcepts((prev) => prev.filter((v) => v.concept_id !== id && v.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления понятия');
    }
  };

  const onSubmit = async (data: CreateConceptRequest) => {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        ...data,
        concept_id: data.concept_id.trim(),
        name: data.name.trim(),
        description: (data.description || '').trim(),
        image_url: (data.image_url || '').trim(),
        sort_order: Number(data.sort_order) || 0,
      };
      if (isEditMode && editId) { await conceptsApi.updateConcept(editId, payload); evictEntity('concept', editId); evictEntity('concept', payload.concept_id); }
      else await conceptsApi.createConcept(payload);
      navigate(returnPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения понятия');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        {isEditMode ? 'Редактирование понятия' : 'Создание понятия'}
      </h1>
      <p className="text-sm text-gray-500 mb-6">
        Понятие — это пояснение из глоссария (напр. «Спасбросок»), которое не выражается
        отдельной сущностью. На него можно сослаться из любого текста:
        {' '}<code>[[Спасбросок|concept:saving_throw]]</code>.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="bg-white rounded-lg shadow p-6 space-y-5 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">ID понятия *</label>
          <input
            {...register('concept_id', {
              required: 'ID обязателен',
              pattern: { value: /^[a-zA-Z0-9_-]{1,100}$/, message: 'Только латиница, цифры, дефис и подчёркивание' },
            })}
            disabled={isEditMode}
            placeholder="saving_throw"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100 font-mono"
          />
          {errors.concept_id && <p className="text-red-500 text-sm mt-1">{errors.concept_id.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Название *</label>
          <input
            {...register('name', { required: 'Название обязательно' })}
            placeholder="Спасбросок"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
          {errors.name && <p className="text-red-500 text-sm mt-1">{errors.name.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Оригинальное название</label>
          <input
            {...register('name_en')}
            placeholder="Saving Throw"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Описание</label>
          <FormattedTextarea
            value={watch('description') || ''}
            onChange={(v) => setValue('description', v)}
            rows={5}
            placeholder="Пояснение понятия (разметка, иконки, ссылки на другие сущности)"
          />
          <input type="hidden" {...register('description')} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Иконка (URL, необязательно)</label>
            <input
              {...register('image_url')}
              placeholder="https://…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
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
            {loading ? 'Сохранение...' : 'Сохранить понятие'}
          </button>
          <button type="button" onClick={() => navigate(returnPath)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
            Отмена
          </button>
        </div>
      </form>

      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Существующие понятия</h2>
        <div className="space-y-2">
          {concepts.map((v) => (
            <div key={v.concept_id} className="flex items-center justify-between border border-gray-200 rounded-lg p-3">
              <div>
                <div className="font-medium text-gray-900">{v.name}</div>
                <div className="text-xs text-gray-500 font-mono">{v.concept_id}</div>
              </div>
              <div className="flex gap-2">
                <Link to={`/concept-creator?edit=${v.concept_id}`} className="text-sm text-blue-600 hover:text-blue-800">Редактировать</Link>
                <button type="button" onClick={() => deleteConcept(v.concept_id)} className="text-sm text-red-600 hover:text-red-800">Удалить</button>
              </div>
            </div>
          ))}
          {concepts.length === 0 && <p className="text-sm text-gray-500">Понятия пока не созданы.</p>}
        </div>
      </div>
    </div>
  );
};

export default ConceptCreator;
