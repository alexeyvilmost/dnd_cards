// Единая проверка пользовательского ID сущности (card_number).
// Раньше regex с сообщением был скопирован в 3 конструктора, а проверка уникальности — в 2.

export const ENTITY_ID_REGEX = /^[a-zA-Z0-9_-]{1,30}$/;

export const ENTITY_ID_FORMAT_ERROR =
  'ID может содержать только латинские буквы, цифры, дефисы и подчеркивания, до 30 символов';

/** Проверка формата ID. Возвращает текст ошибки или null, если формат корректный. */
export function validateEntityIdFormat(id: string): string | null {
  return ENTITY_ID_REGEX.test(id) ? null : ENTITY_ID_FORMAT_ERROR;
}

/**
 * Занят ли ID: ищет точное совпадение card_number среди найденных сущностей.
 * При ошибке запроса считаем ID занятым — безопаснее не дать создать дубль,
 * чем молча его допустить (то же поведение, что и в прежних копиях).
 */
export async function isEntityIdTaken(
  fetchByQuery: (query: string) => Promise<Array<{ card_number?: string }>>,
  id: string,
): Promise<boolean> {
  if (!id || id.trim() === '') return false; // Пустой ID допустим
  try {
    const found = await fetchByQuery(id);
    return found.some((x) => x.card_number === id);
  } catch (err) {
    console.error('Ошибка проверки уникальности ID:', err);
    return true;
  }
}
