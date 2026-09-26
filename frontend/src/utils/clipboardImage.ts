const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/** Read a real image file from the clipboard; persistence belongs to the caller. */
export async function readClipboardImageFile(): Promise<File> {
  if (!navigator.clipboard?.read) {
    throw new Error('Буфер обмена недоступен в этом браузере');
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const mime = item.types.find(type => IMAGE_EXTENSIONS[type]);
    if (!mime) continue;
    const blob = await item.getType(mime);
    if (!blob.size) throw new Error('Изображение в буфере пустое');
    return new File([blob], `clipboard.${IMAGE_EXTENSIONS[mime]}`, { type: mime });
  }
  throw new Error('Скопируйте изображение PNG, JPEG, WebP или GIF');
}
