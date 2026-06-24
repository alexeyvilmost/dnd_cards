import { getFontEmbedCSS, type Options } from 'html-to-image';

const CARD_FONT = 'Pangolin';
/** Размеры, встречающиеся на карточке (заголовок, описание, футер). */
const CARD_FONT_SIZES_PX = [10, 11, 12, 13, 14, 16, 18, 20, 22, 24];

/** Дожидается загрузки Pangolin — document.fonts.ready этого не гарантирует для webfont. */
export async function waitForCardFonts(): Promise<void> {
  await document.fonts.ready;
  await Promise.all(
    CARD_FONT_SIZES_PX.map((size) => document.fonts.load(`400 ${size}px ${CARD_FONT}`))
  );
}

export async function waitForCardImages(container: HTMLElement): Promise<void> {
  await Promise.all(
    Array.from(container.querySelectorAll('img')).map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener('load', () => resolve(), { once: true });
            img.addEventListener('error', () => resolve(), { once: true });
          })
    )
  );
}

/** ~400+ DPI при захвате карты 198×280 px (реальный размер 52.5×74.25 mm). */
export const CARD_EXPORT_PIXEL_RATIO = 5;

export async function getCardCaptureOptions(node: HTMLElement): Promise<Options> {
  await waitForCardFonts();
  await waitForCardImages(node);
  const fontEmbedCSS = await getFontEmbedCSS(node);
  return {
    pixelRatio: CARD_EXPORT_PIXEL_RATIO,
    backgroundColor: '#ffffff',
    cacheBust: true,
    fontEmbedCSS,
  };
}
