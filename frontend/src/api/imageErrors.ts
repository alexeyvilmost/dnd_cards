export const IMAGE_GENERATION_TIMEOUT_MS = 180_000;

export class ImageAPIError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly source: 'application' | 'provider' | 'network' | 'storage' | 'persistence',
    readonly requestId?: string,
    readonly providerRequestId?: string,
    readonly outcome?: 'not_started' | 'rejected' | 'unknown' | 'not_saved',
    readonly status?: number,
  ) {
    super(requestId ? `${message} Номер запроса: ${requestId}` : message);
    this.name = 'ImageAPIError';
  }
}

const messages: Record<string, string> = {
  image_jobs_disabled: 'Новые фоновые задания временно выключены. Сохранённые задания доступны в истории.',
  image_job_interrupted: 'Связь с исполнителем прервалась. Результат неизвестен; автоматического повтора не будет. Проверьте историю генерации.',
  image_job_conflict: 'Этот запрос уже использован для другого изображения.',
  image_job_limit: 'Лимит заданий генерации исчерпан. Попробуйте позже.',
  image_job_save_unknown: 'Сохранение задания не подтверждено. Повторите тот же запрос, чтобы проверить его статус.',
  image_job_access_revoked: 'Права на генерацию изменились. Задание остановлено.',
  image_prompt_invalid: 'Заполните описание изображения длиной до 32 КБ.',
  content_admin_required: 'Генерация доступна администратору контента.',
  image_provider_not_configured: 'Сервис генерации не настроен.',
  image_region_unavailable: 'OpenAI отклонил запрос из-за региональной доступности. Администратору нужно проверить поддерживаемое размещение и доступ аккаунта.',
  image_provider_authentication: 'Сервис генерации отклонил ключ API. Обратитесь к администратору.',
  image_provider_permission: 'Нет доступа к модели генерации. Администратору нужно проверить права проекта и проверку организации.',
  image_provider_forbidden: 'Сервис генерации вернул отказ 403. Причину можно уточнить по номеру запроса.',
  image_provider_limit: 'Достигнуто ограничение запросов или бюджета генерации. Обратитесь к администратору.',
  image_model_unavailable: 'Модель генерации недоступна для проекта.',
  image_provider_invalid_request: 'Сервис генерации отклонил параметры изображения.',
  image_network_error: 'Не получен ответ сервиса генерации. Результат запроса может быть неизвестен; проверьте его перед повторным запуском.',
  image_timeout: 'Время ожидания генерации истекло. Проверьте результат перед повторным запуском.',
  image_cancelled: 'Запрос отменён. Результат генерации может быть неизвестен.',
  image_provider_error: 'Не удалось получить изображение от сервиса генерации.',
  image_provider_invalid_response: 'Сервис генерации вернул ответ без изображения. Проверьте результат перед повторным запуском.',
  image_storage_not_configured: 'Хранилище изображений не настроено. Генерация не запущена.',
  image_download_failed: 'Изображение создано, но не получено для сохранения. Повторная генерация оплачивается отдельно.',
  image_storage_failed: 'Изображение создано, но не сохранено в хранилище. Повторная генерация оплачивается отдельно.',
  image_persistence_unknown: 'Не удалось подтвердить сохранение изображения. Обновите сущность и проверьте результат перед повтором.',
  image_entity_invalid: 'Сначала сохраните поддерживаемую сущность, затем генерируйте изображение.',
  image_entity_not_found: 'Сущность уже недоступна. Изображение не привязано.',
  image_entity_unavailable: 'Не удалось проверить сущность. Генерация не запущена.',
};

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(value) ? value : undefined;
}

export function imageAPIError(status: number | undefined, data: unknown, requestId?: unknown, transportCode?: unknown): ImageAPIError {
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const code = typeof body.code === 'string' && Object.hasOwn(messages, body.code)
    ? body.code
    : transportCode === 'ERR_CANCELED' ? 'image_cancelled'
    : transportCode === 'ECONNABORTED' || transportCode === 'ETIMEDOUT' ? 'image_timeout'
    : status === 403 ? 'content_admin_required' : !status ? 'image_network_error' : 'image_request_failed';
  const source = body.source === 'provider' || body.source === 'network' || body.source === 'storage' || body.source === 'persistence' ? body.source : 'application';
  const outcome = body.outcome === 'not_started' || body.outcome === 'rejected' || body.outcome === 'unknown' || body.outcome === 'not_saved'
    ? body.outcome : !status ? 'unknown' : undefined;
  return new ImageAPIError(
    status === 401 ? 'Для работы с изображениями нужно войти в аккаунт.' : messages[code] ?? 'Не удалось выполнить запрос изображения.',
    code, !status ? 'network' : source,
    safeId(body.request_id) ?? safeId(requestId), safeId(body.provider_request_id), outcome,
    typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined,
  );
}
