# Транспорт явного удаления V1/V2 через Docker

Добавлен createRetirementCommand в существующий Docker deployment adapter. Он переиспользует проверенное подключение работающего backend и binding из защищённой копии; отдельного источника DATABASE_URL нет. Транспорт применяется отдельным retirement controller и не вызывается обычной выкаткой.

Разрешены только metadata, execute, reconcile и inspect для точного executor digest. Metadata запускается без сети и DB env. Остальные команды получают ограниченный JSON через stdin, а DSN — только через private child environment. Подменённые image/flags/source/schema, изменившийся active.json и нездоровый backend блокируются до команды. После неизвестного исхода нужен существующий read-only reconciliation; ошибки не раскрывают DSN. Оставшийся контейнер удаляется только после совпадения собственного имени и метки.

246 связанных проверок на Windows, 46 целевых в настоящем Linux контейнере, 0 failures/skips. Семь новых случаев проверяют перечисленные границы, включая соединение controller с транспортом: отказ внешней проверки архива не создаёт intent и не отправляет SQL. Linux source read-only, сеть none, cleanup stopped.

Это проверка инфраструктурного транспорта с синтетическими Docker-ответами, а не доказательство удаления таблиц или принятия опубликованного executor. Для production entry point остаются настоящие свежие backup/archive restore и прежний/новый OCI readers после удаления. Никакой DDL на TimeWeb не запускался; productionReady=false. Изменение сохранено отдельно от готового frontend-only коммита a1614e16.
