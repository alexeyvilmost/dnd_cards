import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, ImagePlus } from 'lucide-react';
import { imagesApi, type StandaloneImageRequest } from '../api/imagesApi';
import ImageUploader from './ImageUploader';

// Общий блок смены изображения в детальном окне сущности (как у заклинаний):
// превью + «Перегенерировать» (ИИ) + «Загрузить», с частичным PUT сущности.
// Универсальная иконка-подсказка для ИИ (совпадает со стилем иконок заклинаний).
export const ICON_EXTRA =
  'Thin elegant strokes of energy. The symbol occupies about two-thirds of the frame, centered, with clear margins on all sides.';

interface Props {
  entityId: string;
  initialUrl: string;
  /** Частичный PUT сущности с новым image_url; возвращает сохранённый url. */
  persist: (id: string, url: string) => Promise<string>;
  /** Параметры ИИ-генерации; без него кнопка «Перегенерировать» не показывается. */
  generateReq?: StandaloneImageRequest;
  /** Рендер превью карточки с текущим изображением. */
  renderPreview: (imageUrl: string) => ReactNode;
  onUpdated?: (url: string) => void;
}

export default function EntityImageEditor({ entityId, initialUrl, persist, generateReq, renderPreview, onUpdated }: Props) {
  const [imageUrl, setImageUrl] = useState(initialUrl);
  const [busy, setBusy] = useState<null | 'gen' | 'save'>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    setImageUrl(initialUrl);
    setError(null);
    setShowUpload(false);
    setBusy(null);
  }, [entityId, initialUrl]);

  const applyImage = async (url: string) => {
    if (!url) return;
    setBusy('save');
    setError(null);
    try {
      const saved = await persist(entityId, url);
      setImageUrl(saved || url);
      onUpdated?.(saved || url);
      setShowUpload(false);
    } catch (e) {
      console.error(e);
      setError('Не удалось сохранить изображение');
    } finally {
      setBusy(null);
    }
  };

  const handleGenerate = async () => {
    if (!generateReq) return;
    setBusy('gen');
    setError(null);
    try {
      const res = await imagesApi.generateStandalone(generateReq);
      if (!res.image_url) throw new Error('нет image_url');
      const saved = await persist(entityId, res.image_url);
      setImageUrl(saved || res.image_url);
      onUpdated?.(saved || res.image_url);
    } catch (e) {
      console.error(e);
      setError('Не удалось перегенерировать изображение');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {renderPreview(imageUrl)}
      <div className="w-full max-w-xs space-y-2">
        <div className="flex gap-2">
          {generateReq && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={busy !== null}
              className="edm-btn edm-btn--sm edm-btn--grow"
              title="Сгенерировать иконку (ИИ)"
            >
              <RefreshCw size={16} className={busy === 'gen' ? 'animate-spin' : ''} />
              <span>{busy === 'gen' ? 'Генерация…' : 'Перегенерировать'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowUpload((v) => !v)}
            disabled={busy !== null}
            className="edm-btn edm-btn--sm edm-btn--grow"
            title="Загрузить своё изображение"
          >
            <ImagePlus size={16} />
            <span>Загрузить</span>
          </button>
        </div>
        {busy === 'save' && <p className="edm-hint">Сохранение…</p>}
        {error && <p className="edm-hint edm-hint--error">{error}</p>}
        {showUpload && <ImageUploader onImageUpload={(url) => applyImage(url)} />}
      </div>
    </>
  );
}
