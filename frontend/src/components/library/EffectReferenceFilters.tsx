import { useEffect, useState } from 'react';
import { classesApi, racesApi } from '../../api/client';
import { loadCatalogPages } from '../../api/catalogPages';
import { REFERENCE_LABEL } from '../../api/entityReferences';
import { useAuth } from '../../contexts/AuthContext';

export interface EffectReferenceFilterValues {
  referenceState: string;
  referenceType: string;
  referenceId: string;
  referenceLevel: string;
}

export default function EffectReferenceFilters({ value, onChange }: {
  value: EffectReferenceFilterValues;
  onChange: (next: EffectReferenceFilterValues) => void;
}) {
  const { token } = useAuth();
  const [sources, setSources] = useState<Array<{ type: 'class' | 'race'; id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setSources([]);
    setLoading(true);
    setError('');
    void Promise.all([
      loadCatalogPages((page: number) => classesApi.getClasses({ page, limit: 100, fields: 'list' }), 'classes', true, () => current),
      loadCatalogPages((page: number) => racesApi.getRaces({ page, limit: 100, fields: 'list' }), 'races', true, () => current),
    ]).then(([classes, races]) => {
      if (current) setSources([
        ...classes.classes.map(source => ({ type: 'class' as const, id: source.id, name: source.name })),
        ...races.races.map(source => ({ type: 'race' as const, id: source.id, name: source.name })),
      ].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
    }).catch(() => { if (current) setError('Не удалось загрузить классы и виды.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [token, revision]);
  const change = (patch: Partial<EffectReferenceFilterValues>) => onChange({ ...value, ...patch });
  const sourceTypes = (['class', 'race'] as const).filter(type => !value.referenceType || value.referenceType === type);

  return <>
    <label className="block text-sm font-medium text-gray-700">Связи механик
      <select aria-label="Связи механик" value={value.referenceState} onChange={event => change({
        referenceState: event.target.value,
        ...(event.target.value === 'unlinked' ? { referenceType: '', referenceId: '', referenceLevel: '' } : {}),
      })} className="input-field mt-2">
        <option value="">Все эффекты</option><option value="linked">Есть входящие связи</option><option value="unlinked">Нет входящих связей</option>
      </select>
    </label>
    <label className="block text-sm font-medium text-gray-700">Тип источника
      <select aria-label="Тип источника" value={value.referenceType} onChange={event => change({
        referenceType: event.target.value, referenceId: '', ...(event.target.value ? { referenceState: 'linked' } : {}),
      })} className="input-field mt-2">
        <option value="">Любой источник</option>{Object.entries(REFERENCE_LABEL).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
      </select>
    </label>
    {sourceTypes.length > 0 && <div>
      <label className="block text-sm font-medium text-gray-700">Класс или вид
        <select aria-label="Класс или вид" value={value.referenceId ? `${value.referenceType}:${value.referenceId}` : ''}
          disabled={loading || !!error} onChange={event => {
            const [type, id] = event.target.value.split(':');
            change({ referenceId: id || '', ...(id ? { referenceType: type, referenceState: 'linked' } : {}) });
          }} className="input-field mt-2">
          <option value="">{loading ? 'Загрузка классов и видов…' : 'Все классы и виды'}</option>
          {sourceTypes.map(type => <optgroup key={type} label={type === 'class' ? 'Классы и подклассы' : 'Виды и подвиды'}>
            {sources.filter(source => source.type === type).map(source => <option key={source.id} value={`${type}:${source.id}`}>{source.name}</option>)}
          </optgroup>)}
        </select>
      </label>
      {error && <div className="text-sm text-red-600" role="alert">{error} <button type="button" onClick={() => setRevision(old => old + 1)}>Повторить</button></div>}
    </div>}
    <label className="block text-sm font-medium text-gray-700">Уровень получения
      <select aria-label="Уровень получения" value={value.referenceLevel} onChange={event => change({
        referenceLevel: event.target.value, ...(event.target.value ? { referenceState: 'linked' } : {}),
      })} className="input-field mt-2">
        <option value="">Все уровни</option>
        {Array.from({ length: 20 }, (_, index) => index + 1).map(level => <option key={level} value={String(level)}>{level} уровень</option>)}
      </select>
    </label>
  </>;
}
