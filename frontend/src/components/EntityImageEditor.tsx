import { useEffect, useState, type ReactNode } from 'react';
import { ClipboardPaste, ImagePlus } from 'lucide-react';
import { imagesApi } from '../api/imagesApi';
import ImageUploader from './ImageUploader';
import { useEntityDetail } from '../contexts/entityDetail';
import { useContentPermissions } from '../hooks/useContentPermissions';
import { readClipboardImageFile } from '../utils/clipboardImage';

// Общий блок смены изображения в детальном окне сущности.
// Вставка из буфера сохраняет оригинальный файл в Storage, без data URL в БД.

interface Props {
  entityType: 'spell' | 'action' | 'effect' | 'feat';
  entityId: string;
  author?: string;
  initialUrl: string;
  /** Частичный PUT сущности с новым image_url; возвращает сохранённый url. */
  persist: (id: string, url: string) => Promise<string>;
  /** Рендер превью карточки с текущим изображением. */
  renderPreview: (imageUrl: string) => ReactNode;
  onUpdated?: (url: string) => void;
}

export default function EntityImageEditor({ entityType, entityId, author, initialUrl, persist, renderPreview, onUpdated }: Props) {
  const { readOnly = false } = useEntityDetail();
  const { canEdit } = useContentPermissions();
  const locked = readOnly || !canEdit({ author });
  const [imageUrl, setImageUrl] = useState(initialUrl);
  const [busy, setBusy] = useState<null | 'paste' | 'save'>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    setImageUrl(initialUrl);
    setError(null);
    setShowUpload(false);
    setBusy(null);
  }, [entityId, initialUrl]);

  const applyImage = async (url: string) => {
    if (locked || !url) return;
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

  const handlePaste = async () => {
    if (locked) return;
    setBusy('paste');
    setError(null);
    try {
      const file = await readClipboardImageFile();
      const result = await imagesApi.uploadImage(entityType, entityId, file);
      if (!result.success || !result.image_url) throw new Error('Не удалось загрузить изображение');
      setImageUrl(result.image_url);
      onUpdated?.(result.image_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось вставить изображение');
    } finally {
      setBusy(null);
    }
  };

  if (locked) return <>{renderPreview(imageUrl)}</>;

  return (
    <>
      {renderPreview(imageUrl)}
      <div className="w-full max-w-sm space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handlePaste}
            disabled={busy !== null}
            className="edm-btn edm-btn--sm edm-btn--grow"
          >
            <ClipboardPaste size={16} />
            <span>{busy === 'paste' ? 'Загрузка…' : 'Вставить из буфера'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowUpload((v) => !v)}
            disabled={busy !== null}
            className="edm-btn edm-btn--sm edm-btn--grow"
            aria-description="Загрузить своё изображение"
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
