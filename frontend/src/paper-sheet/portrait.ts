/** Keep imported portraits printable without embedding the original, potentially
 * huge source file in every autosaved JSON document. There is no input-file
 * quota; the rendered image is adapted to the sheet's actual resolution. */
export async function preparePaperPortrait(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Изображение повреждено.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не может обработать изображение.');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    let width = Math.max(1, Math.round(image.naturalWidth * scale));
    let height = Math.max(1, Math.round(image.naturalHeight * scale));
    for (let attempt = 0; attempt < 8; attempt++) {
      canvas.width = width;
      canvas.height = height;
      context.drawImage(image, 0, 0, width, height);
      const portrait = canvas.toDataURL('image/webp', Math.max(0.55, 0.9 - attempt * 0.05));
      if (portrait.length <= 6_000_000) return portrait;
      width = Math.max(1, Math.round(width * 0.75));
      height = Math.max(1, Math.round(height * 0.75));
    }
    throw new Error('Изображение не удалось подготовить для листа.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
