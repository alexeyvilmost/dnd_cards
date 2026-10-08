# Исправление чтения последнего серверного выпуска

CI 37695273578 для 667affa4 завершился успешно: 39 проверок, 948 единиц работы, 17,05 минуты. Публикация 37697320207/1 собрала три образа, но отказала на этапе predecessor-refresh. Успешного release-candidate в этой попытке нет; продовая БД и контейнеры не заменялись.

Последний реальный deployment artifact 37693544430/1 — запись удаления V1/V2. Он содержит manifest.json, deployment.json и retirement-observation.json. Публикующий CLI требовал обычный active-projection.json и не передавал retirement observation в канонический валидатор baseline. Локальная проверка самого producer ранее не покрывала этот CLI-переход.

CLI теперь читает оба фактических формата. Для retirement он использует existing verifyBaseline и verifiedRetirementBaseline, сохраняя установленную схему и реальные component launches. Не создаётся поддельный ordinary projection. Отсутствующая observation, неподтверждённый hash, другая попытка/control SHA и конкурирующая projection отклоняются. Обычный mixed predecessor сохраняет прежнюю проверку.

Проверки: 47 связанных Windows contracts прошли до добавления последнего ordinary-loader case; после него весь текущий CLI-набор из 10 tests прошёл на Windows и Linux без skips. Связанные Linux baseline/projection/CLI contracts ранее прошли 27 tests. Оригинальные файлы реальной записи 37693544430/1 прочитаны локально: получено точное activeHash e751b1cc181f93cbe9e162ad9ddf4d445b441b7b28a526ef3e194efbffb31e38 и 308 migration identities. Это локальная проверка чтения, не новый успешный workflow или выкатка.

После коммита исправления требуется реальная успешная цепочка нового exact-source CI → публикация → серверная репетиция → full release. Исходный план из 29 задач пока не объявлен завершённым. Рабочая БД не восстанавливается; на сервере сохраняются две полные копии.
