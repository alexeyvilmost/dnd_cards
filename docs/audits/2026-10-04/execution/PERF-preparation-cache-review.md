# Независимый review PERF-01/02 preparation cache

Область: `backend/character_preparation_cache.go`, `character_equipment_intent.go`, `roguelike_initiative_options.go`, `roguelike_worker_client.go`; `frontend/src/roguelike/combatCatalog.ts`, `equipmentIntent.ts`, `initiativeOptions.ts`; worker routes и frame-local mirror transport. Review не менял production-код. Проверка низкоуровневого воспроизведения использовала текущий собранный CJS локально, без БД, платных API или production endpoints.

## Найдено и передано владельцу: новый read selector не был доказан старым кешем

**P2, подтверждено.** Старый candidate мог содержать Spell A, загруженное по UUID. Свежая сборка персонажа впервые просит английский alias того же заклинания. В БД уже есть второе заклинание с тем же alias, но оно не входило в старый UUID selector. Проверка fingerprint старых reads проходит; worker видит только A в candidate и возвращает `ready`, без `needs_content`. Публикация нового fingerprint учитывала новый alias, но не проверяла, соответствует ли уже выбранное A действительному разрешению ссылки в БД. Холодный путь такую неоднозначность отклоняет. Аналогично exact `card_number` нового B должен победить английский alias сохранённого A.

Воспроизведение: `outputs/testing/preparation-cache-review-new-alias.json` — prior UUID `ready`, warm alias `ready`, полное alias membership → ошибка неоднозначной ссылки. Это доказательство дефекта исходной комбинации backend candidate + worker, не утверждение, что исправленный backend всё ещё принимает такой результат.

Владелец подтвердил и исправил: `prepareCharacterWorker` принимает candidate только когда все `result.CatalogSelection.Reads` входят в его уже проверенные `candidate.Needs`. Новый selector, `needs_content`, отсутствие selection или новый artifact запускают cold resolver заново, сохраняя уже выбранный artifact. Ошибка нового reader до выдачи identity допускает один cold fallback: подготовка не пишет состояние, RNG команды и итоговая команда не принимаются из отброшенной попытки.

Добавленный владельцем native actual-worker regression проверяет UUID→неоднозначный alias и UUID→exact `card_number` winner, сравнивая warm/cold error codes либо полный результат. Итоговый execution receipt этого теста добавляет владелец PERF после завершения своего прогона; независимый review прочитал guard и assertions, но сам native прогон не запускал.

## Остальные проверенные границы

- Сохраняются только immutable declarations, IDs и dependency reads. Character, inventory/resources, RNG, prepared patches и команды не кешируются. На каждом вызове выполняется каноническая сборка свежего owned character.
- Candidate не делает прежде имевшиеся предметы вновь принадлежащими персонажу: consumed projection гидратирует cards из актуального inventory/bindings. UI и worker используют прежние канонические функции выбора/исполнения.
- Fingerprint проверяет membership и содержимое, а не только timestamp. Native тест владельца дополнительно обнаружил SQL shadowing `source` (имя поля вместо whole row); код исправлен на `to_jsonb(source.*)`, proof suite 3/3 PASS по сообщению владельца. Проверка current SQL подтверждает whole-row форму.
- Caller/owner и persistent rights проверяются до cache read; equipment commit повторяет авторизацию, receipt lookup и актуальный catalog/user/character/run stamp. Принятая команда возвращается по сохранённой квитанции без нового расхода; cache не заменяет эту транзакцию.
- Fresh command выбирает текущий worker artifact, а кеш не прикрепляет его к предыдущему executable. После первого ответа artifact фиксируется на остальные попытки подготовки. Исторические executable и receipts не переписываются.
- LRU ограничен 8 MiB/128 entries, учитывает payload, строки и metadata. На выдаче копируются payload/needs/basic IDs, JSON заново декодируется; mutable maps между запросами не разделяются. Это предел retained entries, а не всего transient/allocator RSS.
- Новый consumed-catalog hash adapter учитывает JS enumeration числовых ключей. Старый Go canonical serializer и исторический worker canonicalStringify не изменены; native equality проверяет полный prepared command/RNG, а warm/cold/evicted — полный ответ.
- Frame-local mirrors не создают отдельного кеша previous response; `catalogSelection` не подменяется ссылкой на прежний запрос.

Других подтверждённых блокирующих semantic/security/idempotency регрессий в просмотренной версии не найдено. Это ограниченный review названных путей; финальные native worker/HTTP receipts и общий core/extended остаются обязательными. Flag по умолчанию выключен.
