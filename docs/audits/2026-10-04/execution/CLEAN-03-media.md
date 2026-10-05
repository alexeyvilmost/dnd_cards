# CLEAN-03: медиа и Git, локальное доказательство

Статус: конвейер и локальные проверки реализованы; включение по умолчанию
выключено. Часть PWA/nginx/build integration принадлежит корневому агенту.
Полное принятие CLEAN-03 не заявляется без общего UI/print/OCI результата.

## Изменения

- Read-only inventory исходников, runtime URL, литеральных ссылок, точных
  дублей, текущего dist, Git archive gzip и fsck: `media-inventory.mjs`.
- Полноразмерные lossless+exact PNG→WebP в новый output, RGBA/ICC/hash proof:
  `build-media-variants.mjs`. Оригиналы не перезаписываются; существующие
  каталоги результатов не заменяются.
- Нативная проверка полностью прозрачных цветных пикселей/ICC и отдельный
  настоящий Chrome canvas compare всех вариантов.
- Build adapter без Sharp в обычной сборке: проверяет все оригиналы и файлы,
  эмитит SHA-256 WebP через Rollup, не пишет бинарники в tracked public.
- Default-OFF immutable mapping `mediaVariants.ts`; одна presentation-only
  seam в `TacticalBattleMap.backgroundImage`. Состояния и старые URL сохранены.
- Релизный retention ограничен nginx immutable URLs, включает новые WebP;
  content hash/name collision/symlink guard. Старые retained файлы не удаляются.

## Измерения и честные ограничения

Инвентарь: public 155 121 376 B (285), references 36 871 926 B (23).
Архив HEAD tar 291 215 360 B, gzip 224 233 168 B. Точные текущие исходники всех
308 файлов проверены повторно после конверсии — без изменений.

Первый эксперимент (`media-lossless-20261004-v1`) дал 93 native-exact варианта.
Это **не готовый для сборки набор**: Chrome сравнение завершилось `failed`,
70/93 пар отличаются. Отчёт `CLEAN-03-media-browser.json` оставлен без
переписывания. Дополнительный полный повтор в диагностическом режиме:
`CLEAN-03-media-alpha-diagnostic.json` — те же 70 failures, 14 829 161 differing
pixels / 26 174 359 differing channel bytes; max delta 255, ноль различий
непрозрачных пикселей и альфа. Пять частично прозрачных полов имели max delta 2,
три атласа/объекта из battle-maps — 128. Все 19 записей приведены в JSON.

На основании свойства исходника исключена **вся** partial-alpha группа —
76 файлов, включая шесть совпавших в первой проверке. Ещё 42 PNG оставлены
оригиналами по metadata/depth/color ограничениям. Новый полный проход 135 PNG
занял 13 534 мс на текущем ноутбуке (не CI benchmark).

Второй набор `outputs/maintenance/media-lossless-20261004-v2`: 17 вариантов,
42 818 912→29 448 348 B (−31,23%). Среди них 11 карт:
35 277 787→24 557 492 B (−30,39%). Все 17 пар совпали в настоящем Chrome:
`CLEAN-03-media-browser-v2.json`. Манифест proof:
`CLEAN-03-variants-manifest.json`; агрегат: `CLEAN-03-variants-summary.json`.
Адаптер требует `alphaPolicy=opaque_or_binary_alpha_only`, поэтому старый v1
не может случайно попасть в включённую сборку. Диагностика старого кандидата
не выдаёт ни плагина, ни runtime-манифеста.

Возможная экономия касается запросов именно выбранных карт; не все карты
загружаются разом. У остальных вариантов ещё нет consumer seam. Сохранение
оригиналов означает **+29,4 МБ** в enabled dist, **0 удалённых байт Git**.
Фактические Docker context transfers, cache hits, clone/pull latency и размеры
production не измерены. Cross-browser/human visual/print acceptance остаётся
до default-ON. Включённая UI сборка и проверка фонового URL выполняются
корневым агентом, их результат — отдельное evidence.

## Проверки

```text
node --test scripts/maintenance/media-inventory.test.mjs scripts/maintenance/build-media-variants.test.mjs scripts/release/retained-assets.test.mjs
node scripts/maintenance/check-media-encoder.mjs <pinned sharp module>
node scripts/maintenance/check-media-browser.mjs outputs/maintenance/media-lossless-20261004-v2 <new report>
node scripts/maintenance/media-inventory.mjs --verify docs/audits/2026-10-04/execution/CLEAN-03-media-manifest.json
cd frontend
node node_modules/vitest/vitest.mjs run src/utils/mediaVariants.test.ts
```

Native proof: alpha0 скрытые RGB сохраняются; partial alpha возвращает original;
ICC 480 B сохраняется побайтно. Resolver 4/4 PASS, без пропусков. Финальные
три Node suites выше — 16/16 PASS, 0 skip; scoped `git diff --check` — PASS.
Подробные условия воспроизведения/отката — `docs/media-storage.md` и
`docs/git-maintenance.md`.

Ни commit/push, ни TimeWeb, ни удаление/преобразование прежних медиа/Git objects
не выполнялись. Только новые локальные варианты/отчёты и изменения кода.

## OCI provenance follow-up

Реализован разрешённый планом fail-closed вариант до расширения release schema.
`frontendMediaVariants:false` — единственный поддержанный CI config; неизвестные
поля запрещены. Frontend fingerprint/build args теперь явно включают
`VITE_MEDIA_VARIANTS:'0'`. Plan, CI image CLI, baked identity и Dockerfile
отклоняют enabled/bundle. Обычная локальная enabled UI сборка остаётся отдельным
испытанием, а не OCI release artifact. Исходники приложения не менялись.

`scripts/release/media-build-inputs.mjs` подготовил новый локальный комплект
`outputs/maintenance/media-oci-input-20261004-v2`: 18 файлов (manifest + 17 WebP),
29 507 508 B. Полный record: `CLEAN-03-oci-media-inputs.json`; schema
`media-build-input-proposal`, deployable false. Bundle fingerprint
`sha256:b7c9a812753d56f8c0aac28dc43047f127784f5a052f8eb07867d9b7fbec590f`,
manifest hash `sha256:e4a16d54d1cf6fbd2d7f7b60a1b83eb45c091c0e82d3163d3da39f71788f26ec`.
Все файлы перепроверены; browser report покрывает весь точный URL set.
Неизвестные файлы bundle не копируются. Исходный bundle не меняется.

Дополнительные адресные suites `media-build-inputs`, `ci-release`,
`validate-manifest`, `measure-local` — 32/32 PASS, 0 skip. Actual COPY closure
в текущем дереве прошла для всех трёх компонентов. Оценки source context на
этот момент: backend 23 717 993 B /393 files, frontend 167 368 996 B /1295,
worker 8 106 941 B /604. Это scanner estimates, не Docker transfer/размер образа.

Открытая часть описана в `docs/media-storage.md`: versioned manifest extension,
named context + полный original closure в build stage, включённая OCI сборка,
реальные digests/HTTP/retention/rollback/cache checks. Новая схема не изображается
завершённой, и никаких вызовов Docker/registry/TimeWeb не было.
