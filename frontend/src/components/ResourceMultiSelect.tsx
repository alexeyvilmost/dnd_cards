import { useNavigate } from 'react-router-dom';
import { useResourceOptions } from '../utils/resources';

interface ResourceMultiSelectProps {
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  /** Куда вернуться после создания ресурса (returnTo для resource-creator) */
  returnTo?: string;
  required?: boolean;
}

// Множественный выбор ресурсов (можно выбрать несколько одновременно).
// Используется в конструкторах действий и заклинаний.
const ResourceMultiSelect = ({ value, onChange, label = 'Ресурсы (можно выбрать несколько)', returnTo, required }: ResourceMultiSelectProps) => {
  const navigate = useNavigate();
  const resources = useResourceOptions();

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-sm font-medium text-gray-700">
          {label}{required ? ' *' : ''}
        </label>
        <button
          type="button"
          onClick={() => navigate(`/resource-creator${returnTo ? `?returnTo=${returnTo}` : ''}`)}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Создать ресурс
        </button>
      </div>
      <div className="space-y-2 border border-gray-300 rounded-lg p-3 max-h-48 overflow-y-auto">
        {resources.map((resource) => (
          <label
            key={resource.id}
            className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
          >
            <input
              type="checkbox"
              checked={value.includes(resource.id)}
              onChange={() => toggle(resource.id)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <div className="flex items-center space-x-2 flex-1">
              <img
                src={resource.imageUrl || '/icons/resources/action.png'}
                alt={resource.label}
                className="w-6 h-6 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div>
                <div className="text-sm font-medium text-gray-900">{resource.label}</div>
                {resource.description && <div className="text-xs text-gray-500">{resource.description}</div>}
              </div>
            </div>
          </label>
        ))}
      </div>
      {required && value.length === 0 && (
        <p className="text-red-500 text-sm mt-1">Выберите хотя бы один ресурс</p>
      )}
    </div>
  );
};

export default ResourceMultiSelect;
