# A161: состав образов и реальный выбор проверок

Реальный CI37585930719/1 скачал подтверждённый baseline D229 и выпустил planning artifact11465584619. Матрица требует сборку только frontend, а backend/rules-worker переиспользует. Однако eligibility=full, причина unsafe-or-worker-input-path: консервативная политика uiPathKind не разрешает облегчённую проверку API/cache adapters и JSON-отчётов. Пересечение изменённых файлов с worker closure пустое.

Прежняя локальная component selection корректна только для состава сборки. Она ошибочно трактовалась как достаточное подтверждение облегчённого frontend-only протокола; эта оценка исправлена. A161 проходит настоящий extended набор и полную host-репетицию. Никакие allowlist/gates не ослаблены, deployment acceptance пока не заявляется. Для REL-03/REL-05 нужен отдельный полезный presentation-only checkpoint с неизменными API/движком и действительным frontend-proof-reuse acceptance.
