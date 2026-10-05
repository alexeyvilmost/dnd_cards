# Windows extraction: происхождение сработавшего minified chunk

После успешных 8 + 7 OCI проверок общий local wrapper остановился в `adapter.prepare`, ещё до изменения схемы основного owned стенда и замены приложений. Windows Defender поместил извлечённый `assets/handler-vj37PAi8.js` в карантин: ThreatID `2147842389`, имя `Trojan:Script/ObfusScript.A!ml`, `DidThreatExecute=false`, действие успешно. Проверки удержания старых assets корректно отказали при исчезновении файла. Старые приложения остались здоровыми, collector и registry очищены. Неуспешный итог wrapper сохранён; успешный receipt collector не переименован в полный PASS.

Происхождение проверено независимо внутри Docker, без исполнения самого chunk и без записи его кода на Windows:

1. Прочитан Vite manifest и точный файл из сохранённого immutable frontend image.
2. Из exact owned source fixture `014f7208…` восстановлена стадия frontend build с прежними pinned base images и build arguments.
3. Временный Rollup `generateBundle` inspector получил состав chunk. Повторная компиляция дала побайтно исходный файл: 471548 байт, SHA256 `f749856c65666f9c2fdb99290a044218a0754485a56abc149f77be55cb0943e3`.
4. Все 52 входящих модуля находятся в `frontend/src`; их длины и SHA256 совпали с неизменяемым source manifest ранее проверенной OCI сборки. Состав и хеши — `REL-05-handler-origin.json`.

Это доказывает связь конкретного chunk с контролируемыми исходниками правил проекта. Это не изменяет вердикт антивируса и не является общим доказательством отсутствия уязвимостей. Карантин не восстанавливался, исключения и настройки Defender не менялись. Последующая проверка Linux deployment adapter должна выполняться на отдельном собственном Linux filesystem, соответствующем окружению сервера; совместимость распространения этого minified файла с Windows Defender остаётся отдельным наблюдением.
