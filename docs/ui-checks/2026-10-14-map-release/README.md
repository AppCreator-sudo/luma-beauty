# U-09 — production-выпуск карты

Опубликовано **14.10.2026 19:41:05**, Asia/Novosibirsk. Проверено публично до **19:48:22**. Версия `20261014-v2-map-reference`. [Release/откат](../../RELEASE_20261014_MAP_REFERENCE.md).

- [Baseline до выпуска](baseline.json), [точный пакет и хеши](package-manifest.json), [серверный результат](release-result.json).
- [Первый pre-switch запуск](pre-switch-attempt.log): остановлен до изменения рабочей службы из-за PATH smoke-процесса.
- [Продолжение и публикация](deployment.log): приватный smoke PASS, неизменная схема/бизнес-таблицы, backup, атомарное переключение, active/health/integrity/FK/media PASS.
- [Публичный browser/API отчёт](production-report.json): 6 PASS; page errors/write requests 0.
- [1440 px](production-1440.png), [390 px](production-390.png), [320 px](production-320.png). Реальный опубликованный UI и публичные места; фиктивные анкеты на сервер не создавались.
- [Проверочный скрипт](verify-published.mjs). Это датированный read-only probe; перед будущим применением сверить фактический host/release/entry. Он блокирует методы записи и сохраняет TLS-проверку, использует подтверждённый IP при локальном DNS-сбое. Запуск из корня checkout: node docs/ui-checks/2026-10-14-map-release/verify-published.mjs.

Подробная местная функциональная проверка со свежими синтетическими базами — [отдельный отчёт](../2026-10-14-map-polish/README.md). Production проверен анонимно; авторизованные операции/физический телефон/push не выдаются за выполненные. Старый BUG-002 не закрыт. Leaflet/OSM/SQLite сохраняются; смена провайдера отложена.
