import { useState, type ReactNode } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';

// Единые классы полей конструкторов — раньше эта пара строк копировалась в каждый конструктор.
export const CREATOR_INPUT_CLS = 'site-control w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2';
export const CREATOR_LABEL_CLS = 'site-label block text-sm font-medium mb-2';

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
    <div className="site-creator-page min-h-screen p-2 sm:p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="site-page-head flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <button onClick={onBack} className="site-button flex items-center space-x-2">
            <ArrowLeft size={18} /><span className="text-sm sm:text-base">Назад</span>
          </button>
          <h1 className="site-heading text-xl sm:text-2xl md:text-3xl">{title}</h1>
          <button onClick={() => setShowPreview(!showPreview)} className="site-button text-sm sm:text-base" aria-label={showPreview ? 'Скрыть превью' : 'Показать превью'}>
            {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}<span className="hidden sm:inline">{showPreview ? 'Скрыть' : 'Показать'}</span>
          </button>
        </div>

        {error && <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 sm:gap-4">
          <div className={showPreview ? 'lg:col-span-7' : 'lg:col-span-12'}>
            <div className="site-surface site-creator-form p-3 sm:p-4 md:p-6">
              {children}
            </div>
          </div>

          {showPreview && (
            <div className="lg:col-span-5">
              <div className="site-surface p-3 sm:p-4 md:p-6 sticky top-6">
                <h3 className="site-heading text-lg mb-4">{previewTitle}</h3>
                <div className="site-creator-preview flex justify-center">{preview}</div>
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
  <div className="flex gap-4 pt-4 border-t border-[var(--site-line)]">
    <button type="submit" disabled={loading} className="site-button site-button-primary flex-1">
      {loading ? 'Сохранение...' : submitLabel}
    </button>
    <button type="button" onClick={onCancel} className="site-button">
      Отмена
    </button>
  </div>
);

export default CreatorShell;
