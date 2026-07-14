import { useSiteSettings } from '../settings';

/**
 * Оригинальное (английское) название под основным — единая точка правила показа.
 *
 * Рисуется только если включена настройка «Отображать оригинальные названия» и оригинал задан.
 * Место применения — интерфейсные отображения (тёмный стат-блок), детальные окна и превью при
 * наведении. На печатных карточках предметов (CardPreview) НЕ используется — там намеренно только
 * основное название.
 *
 * Стиль инлайновый, а не классом: превью рендерятся в hover-портале и внутри собственных
 * <style>-блоков разных семейств (.sp-* / .bg3-* / .concept-tip-*), поэтому один инлайновый
 * стиль надёжнее и не требует правок в четырёх CSS.
 */
export const OriginalName = ({
  nameEn,
  size = 'preview',
}: {
  nameEn?: string | null;
  /** preview — под заголовком стат-блока; detail — под крупным заголовком детального окна. */
  size?: 'preview' | 'detail';
}) => {
  const { showOriginalNames } = useSiteSettings();
  const value = nameEn?.trim();
  if (!showOriginalNames || !value) return null;

  return (
    <div
      style={{
        color: '#a59886',
        opacity: 0.75,
        fontStyle: 'italic',
        fontSize: size === 'detail' ? '.95rem' : '.85rem',
        lineHeight: 1.2,
        margin: '.1rem 0 0',
      }}
    >
      {value}
    </div>
  );
};

export default OriginalName;
