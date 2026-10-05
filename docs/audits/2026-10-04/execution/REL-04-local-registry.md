# Локальная сборка и доставка OCI — фактический прогон

Все 9 стадий прошли на Docker Desktop Linux; owned registry, volumes и контейнеры остановлены. Проверялся отдельный commit точной копии разрешённых source inputs `49c18ec36aa9938e101504e4b7fe573b71af21be`, а не HEAD исходного репозитория. Этот результат не разрешает production deployment и не содержит фиктивного CI run. Полный receipt: [REL-04-local-registry.json](REL-04-local-registry.json).

| Компонент | Холодная сборка | Повтор 1 / 2 | Полный encoded payload |
|---|---:|---:|---:|
| Backend | 39,31 с | 3,38 / 1,52 с | 19 468 485 B |
| Frontend | 76,35 с | 1,74 / 1,77 с | 185 592 738 B |
| Worker | 24,20 с | 1,81 / 1,55 с | 81 416 300 B |

Холодная сборка использует no-cache и новый scope dependency cache; образы основы уже присутствовали. Повторные сборки сохраняют runtime config/layers и baked identity. BuildKit attestation timestamps меняют индексный digest — это сохранено в receipt. Повторная публикация одного архива сохраняет digest.

Полный frontend payload вырос с 184 133 587 до 185 592 738 B (+0,79%). Размеры image inspect в одном локальном daemon: 421 775 315 → 425 434 226 B. Сокращение полной поставки не доказано. При изменении frontend compile argument новые объекты реестра занимают 5 436 117 B; слой media 153 844 336 B переиспользован, backend и worker digest сохранены. Это реальный hash-checked HTTP payload, без headers/TLS и без утверждения, что Docker скачивал все байты в пустой кеш.

Неверный plan и повреждённый архив отвергнуты до публикации; отсутствие manifest отвергнуто при pull, отсутствие layer — реестром с MANIFEST_BLOB_UNKNOWN. Полный clone restore, семь migration fault scenarios и legacy adoption/rollback учитываются отдельно. Следующая metadata reader-capability правка меняет source identity и требует нового exact image proof перед финальной выкаткой.
