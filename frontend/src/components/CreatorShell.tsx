import { useState, type ReactNode } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';

// Единые классы полей конструкторов — раньше эта пара строк копировалась в каждый конструктор.
export const CREATOR_INPUT_CLS = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500';
export const CREATOR_LABEL_CLS = 'block text-sm font-medium text-gray-700 mb-2';

interface CreatorShellProps {
  /** Заголовок страницы (обычно «Создание X» / «Редактирование X»). */
  title: string;
  onBack: () => void;
  /** Первичная загрузка сущности — показывает спиннер вместо формы. */
  loading?: boolean;
  error?: string | null;
  previewTitle: string;
  preview: ReactNode;
  /** Форма конструктора. */
  children: ReactNode;
}

/**
 * Общий каркас конструктора с превью: шапка (назад/заголовок/переключатель превью),
 * баннер ошибки, спиннер загрузки и сетка «форма + липкое превью».
 * Состояние показа превью живёт здесь — наружу не протекает.
 */
const CreatorShell = ({ title, onBack, loading = false, error = null, previewTitle, preview, children }: CreatorShellProps) => {
  const [showPreview, setShowPreview] = useState(true);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-2 sm:p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-4 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <button onClick={onBack} className="flex items-center space-x-2 text-gray-600 hover:text-gray-900">
            <ArrowLeft size={18} /><span className="text-sm sm:text-base">Назад</span>
          </button>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900">{title}</h1>
          <button onClick={() => setShowPreview(!showPreview)} className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm sm:text-base">
            {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}<span className="hidden sm:inline">{showPreview ? 'Скрыть' : 'Показать'}</span>
          </button>
        </div>

        {error && <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-4">
          <div className={showPreview ? 'lg:col-span-7' : 'lg:col-span-12'}>
            <div className="bg-white rounded-lg shadow p-3 sm:p-4 md:p-6">
              {children}
            </div>
          </div>

          {showPreview && (
            <div className="lg:col-span-5">
              <div className="bg-white rounded-lg shadow p-3 sm:p-4 md:p-6 sticky top-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">{previewTitle}</h3>
                <div className="flex justify-center">{preview}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface CreatorActionsProps {
  /** Идёт сохранение — блокирует кнопку. */
  loading: boolean;
  /** Подпись кнопки сохранения (например «Создать вид»). */
  submitLabel: string;
  onCancel: () => void;
}

/** Строка кнопок «Сохранить / Отмена» внизу формы конструктора. */
export const CreatorActions = ({ loading, submitLabel, onCancel }: CreatorActionsProps) => (
  <div className="flex gap-4 pt-4 border-t border-gray-200">
    <button type="submit" disabled={loading} className="flex-1 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:bg-gray-400">
      {loading ? 'Сохранение...' : submitLabel}
    </button>
    <button type="button" onClick={onCancel} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
      Отмена
    </button>
  </div>
);

export default CreatorShell;
