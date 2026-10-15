# Повторная проверка опубликованных цен — 15.10.2026

Цены уже вошли в выпуск `20261015-v2-master-portfolio` 18:40:02+07. При продолжении обнаружен более новый коммит/выпуск, поэтому старый отдельный пакет цен повторно не развёртывался.

- [Сервер](server-status.json) проверен 2026-10-15T19:29:25+07:00: current=/opt/atelie/releases/20261015-v2-master-portfolio, entry=index-C5Wrh_NG.js, SW=luma-v2-shell-20261015-v2-master-portfolio, active/health/integrity/FK OK, backup существует.
- [7 публичных проверок](report.json) PASS: actual entry/SW/health, реальные цены с «от» у мастера/салона в ближайшем окне и прайсе на 1440/390/320. JS errors0, business writes0. Только анонимные GET, настройки/записи/фото не менялись.
- Локальная компоновка кабинетов ранее [проверена отдельно](../2026-10-15-service-prices/README.md); эта повторная приёмка не подменяет приватные локальные проверки.
- GitHub main [bc1af39](https://github.com/AppCreator-sudo/luma-beauty/commit/bc1af397023551b86cdff6d49e47cdc40b26fdd1) совпал с локальным HEAD при fetch/ls-remote 19:29+07.

| Прайс | Desktop1440 | Mobile390 | Mobile320 |
| --- | --- | --- | --- |
| Мастер | [1440](master-1440.png) | [390](master-390.png) | [320](master-320.png) |
| Салон | [1440](salon-1440.png) | [390](salon-390.png) | [320](salon-320.png) |

Приложение этим проходом не изменялось; новая миграция/публикация не выполнялась.
