# PERF-04 — обновление PWA и ранее не загруженный chunk

PASS в реальном Chrome, обычные сборки (не profiling и не mock shell). Версия A: test_22b875c9d2f46f4833e5b51d, manifest 2a562f13aab53051d724f6c8b5aaf88dc2136f816a10795dd202a98ba392fe83. Версия B: test_84e3129763ed412fd5aea3af, manifest 7857a429897a5f9c8138a03e815e0249a4312e0155aa53ba43a2e1fecf0f46d9. Сервер API отдельного owned stand: test_20703e67ee6019b29652e920; cleanup stopped. Все файлы двух сборок проверены по полному manifest до и после посещения.

1. Установлен настоящий service worker A; после reload он управляет вкладкой.
2. На том же origin подложен B, update worker временно удержан на A. Уже открытая вкладка реальным меню открывает ранее не посещённый «Экспорт». 3 старых immutable assets загружены из retainImmutableAssets; был хотя бы один ранее не загруженный JS chunk.
3. Разрешён новый sw.js, вызван настоящий registration.update(). Автоматическое обновление загрузило новый entry B; вкладка осталась под управлением worker.
4. Ноль JS errors, ноль новых пропавших assets, ноль API-мутаций при пассивном обновлении. Сохранённые входные сборки неизменны.

Отдельно зафиксирован старый /icons/fire.png: 404 существовал до переключения. Это отсутствующий декоративный URL каталога, не потерянный chunk; он не скрыт из receipt. Gate запрещает все новые и все immutable asset misses.

[Квитанция и точные retained URLs](PERF-04-pwa-update.json). Прямой запуск: check-pwa-update.mjs; можно использовать --candidate-run с уже проверенной owned обычной сборкой, избегая повторной сборки. Профиль не измеряет latency и не заменяет paid pending-command crash/replay proofs. Fail-closed несовместимого rules bootstrap дополнительно покрыт существующим App.rules-lab.test.ts; этот PWA сценарий не имитировал повреждённые правила.
