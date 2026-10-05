# AI-03 — совместимость после обработки ошибок Axios

Независимый review обнаружил разрыв протокола: `imagesApi` превращает AxiosError
в безопасный `ImageAPIError`, но `imageJobs` проверял только
`error.response.status/data.outcome`. Ответ 404 старого backend на capabilities
не включал legacy path; явный `not_started`/`rejected` обычного POST ошибочно
оставался неизвестной платной попыткой.

Исправление сохраняет в `ImageAPIError` только проверенный числовой HTTP status
и ранее существующий разрешённый outcome. Сырые body/headers/config/prompt не
сохраняются. Capability reader понимает typed status обоих реальных клиентов:
`ImageAPIError` и `ApiRequestError` общего `cardsApi`. Очистка legacy attempt
разрешена только при явном `not_started`/`rejected`; unknown/not_saved по-прежнему
требуют осознанного подтверждения нового платного запроса.

Проверка: **35/35 PASS**, 4 файла, 0 skip;
`outputs/testing/image-interceptor-regression.json`. Регресс использует реальные
Axios clients и response interceptors; заменён только transport adapter,
внешняя сеть не вызывается. Проверены все три маршрута генерации, capability 404,
не-404 отказ без POST, сохранение unknown, удаление явного rejected/not_started,
следующая осознанная попытка и отсутствие приватного ответа в typed error.

Первый адресный запуск был 34/35: третий маршрут дополнительно выявил уже
нормализованный `ApiRequestError` общего клиента. Исправлен общий reader status;
assertions всех трёх маршрутов сохранены. Новая полная сборка или отдельный stack
этим срезом не запускались; общий fresh core выполняет root после freeze.
