# BUG-006 — доказательства исправления шапки

Опубликовано **14.10.2026 20:09:38**, Asia/Novosibirsk. [Release/откат](../../RELEASE_20261014_HEADER_ALIGNMENT.md).

- [Local до](local-before.json) / [после](local-after.json): навигация сдвигалась на 7,5 px из-за scrollbar 15 px; после исправления 0 px на пяти ширинах.
- [Публичные пять ширин](production.json), [отдельно desktop 1365×650 с видимой полосой](production-scrollbar.json): 0 px; главная вне нового правила, mobile menu/Back/no overflow PASS.
- [Регрессия карты](map-regression.json): fresh synthetic SQLite, четыре разрешения, настоящие API/сценарии; page errors 0.
- [Baseline](baseline.json), [frontend-only package](package-manifest.json), [deployment](deployment.log), [результат](release-result.json). Runtime/БД/загрузки не менялись; backup/откат сохранены.
- [Read-only измеритель](check-header-alignment.mjs). Запуск из корня; по умолчанию local fixture localhost:3250. Для публичной проверки указать LUMA_HEADER_ORIGIN и LUMA_HEADER_PHASE=published. Скрипт отключает hide-scrollbars, блокирует методы записи и не отключает TLS-проверку. Перед будущим запуском сверять реальный host/IP; это датированный probe выпуска.

Оригинальные PNG эталонов сохранены. Нет новой концепции, миграции или смены карты. Физические жесты/общая приёмка остаются F-08/U-11.
