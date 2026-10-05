# Исторический source-release 04678a04

Хэш `sha256:04678a044c4dc809d213e01e392bc0f16562d5103ee96e070089c1edf7e7100b` восстановлен как **семантическая идентичность исходного релиза**, а не SHA исполняемого CJS. Источник — commit `aec0f3205d4bfeee02a6e2b2fcf2132eed4002d5`. Старый `rules-worker/execute.ts` сравнивает `rulesArtifactHash` именно с `certified.artifact.source.release.releaseHash`.

Восстановлены точные байты девяти файлов: generated certificate, его reader/generator, compiler overlay, release identity, source fixture provider, canonical JSON serializer, старый worker adapter и миграция регистрации DB release. Для каждого сохранены commit/tree path, Git blob ID, SHA256 и размер. Checked-in descriptor занимает несколько килобайт; большой исполняемый артефакт не копируется. Recovery пишет новый каталог 0700 с файлами 0600 и отказывается перезаписывать его.

`recoverHistoricalSourceCertification` читает exact Git blobs; `verifyHistoricalSourceCertification` затем проверяет пакет без Git, npm dependencies, обращения к БД или исполнения старых исходников. Пакет находится в `outputs/release-recovery/source-release-04678a04`. Для production capture владелец release adapter использует отдельный защищённый каталог `sourceCertificationDirectories`; все перечисленные файлы и `provenance.json` должны попасть в backup. Одна ссылка на Git commit без этих байтов не заменяет сохранённый recovery пакет.

Пять независимых сверок прошли:

1. Canonical certificate content hash: `sha256:c7d28beda4ee169df4a424c1c547fd12f68dec1756f3cf5083a91a3485bbf22b`.
2. Source projection hash: `sha256:d45f8d97601e6eba0640e6b1c0d95eaf26fc67cb6889187de45a3b5769d187ca`.
3. Историческая формула `SHA256(canonical({id,rulesHash,contentHash}))` возвращает исходный release `sha256:306bcbcac6bfc154b27d067a2ee8b52c9e1f0dd1e0bc96a065f106761c72fda1`.
4. Формула `SHA256(canonical({id,sourceReleaseHash,overlayHash,contentHash}))` возвращает `04678a04…`. Content hash этого релиза: `sha256:4ee64d32fffe6b88e797a10ae89207d5f88c0f2214cc16df043d6b9464e9f056`.
5. Exact raw canonical manifest из архивной Go-миграции даёт `sha256:3dda1b242973905d6793412c1407adedd72779ac8ce73461ee19686b88c122a4`, DB release UUID `54abf005-a210-4ce7-8511-6f03eea02ed7`. Версия certificate — `1.0.0`; `ruleset_releases.artifact_version` — полный `prod-snapshot@2026-08-06.micro-mvp-l1.overlay.1.10.0`, как предписывала отдельная историческая identity repair.

Исходные rules/content hashes взяты из точных старых файлов. Полная повторная компиляция корпуса/PHB, воспроизведение исторических команд или восстановление всех compiler dependencies здесь **не заявлены**. `executable:false`, соответствующие limits в JSON — false. Если тот же хэш встретится в поле, которое действительно означает CJS, этот пакет не разрешает исполнение и не закрывает missing executable.

Три адресных Node-теста прошли без skips: exact Git recovery и Gitless verification, изменения certificate/provenance/unlisted files, неподдержанный hash/неверный commit/symlink root. Тест включён в обязательный core. Логи: `outputs/testing/historical-source-certification.log`; машинное доказательство — [REL-05-historical-source.json](REL-05-historical-source.json). Ни prod БД, ни текущие/старые certificates и история не изменялись. Полный общий набор и фактический production capture остаются следующими проверками root.
