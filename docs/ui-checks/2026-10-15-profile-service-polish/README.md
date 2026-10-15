# Приёмка правок профилей, каталога и карты — 15.10.2026

Локальное приложение + реальные API + Chrome, **только синтетическая SQLite в .cache**. Финальный запуск 2026-10-14T17:57:17.711Z (UTC; дата проекта Asia/Novosibirsk). Build entry `index-BVwlidj0.js`. [Контракт](../../V2_PROFILE_SERVICE_POLISH.md).

## Результат

**23 PASS, JS errors0**, горизонтальное переполнение0 на 1440/390/320. [Машинный отчёт](report.json). Проверены реальные POST/PATCH, сохранение/reload, отказ чужому/гостю, направление фильтра и точная услуга/длительность/цена. В салоне подтверждены стабильный grouped service ID и нужный исполнитель. Back из записи сохраняет услугу.

После визуального просмотра длинного имени исправлены max-height, margin footer и старый mobile grid-row салонного адреса. Финальная проверка ждёт fonts.ready, измеряет настоящий footer, проверяет отсутствие пересечений названия/бейджей и рейтинга/адреса.

## Снимки

- Профили: [мастер desktop](master-1440.png), [салон desktop](salon-1440.png), [мастер mobile](master-390.png), [салон mobile](salon-390.png), [мастер 320](master-320.png), [салон 320](salon-320.png).
- Кнопки/описание/footer: [мастер](master-footer-390.png), [салон](salon-footer-390.png).
- Смешанный каталог с длинными именем/адресом, рейтингами и разными бейджами: [desktop](catalog-1440.png), [mobile 320](catalog-320.png).
- Направления услуг в кабинетах: [мастер desktop](master-services-1440.png), [мастер mobile](master-services-390.png), [салон desktop](owner-services-1440.png), [салон mobile](owner-services-390.png).
- Выбор услуги карты: [мастер desktop](map-service-1440.png), [мастер mobile](map-service-390.png), [мастер 320](map-service-320.png), [салон desktop](salon-map-service-1440.png), [салон mobile](salon-map-service-390.png).

## Повторение

[Runner](../../../scripts/verify-profile-service-polish.mjs) принимает LUMA_POLISH_TEST_ROOT — путь к свежему fixture из tests/fixtures/map-reference-server.mjs. Origin обязан быть localhost; база обязана находиться в .cache. Не запускать на production. На Windows запуск Chrome/child-process требует разрешения песочницы; для unit-тестов работает `node --experimental-test-isolation=none --test tests/service-directions.test.mjs`.

Frontend/root build PASS; 3 direction tests, 2 page-options tests и 3 targeted map regression PASS. Полный suite не повторялся; прежний BUG-002 не скрыт. Физический OS Back не проверен. Эти снимки — реализация уточнения, исходные concept PNG сохранены. **Этот отчёт — локальная проверка**, её тестовые данные не отправлялись на сервер. Позднее [выпуск опубликован и проверен отдельно](../2026-10-15-profile-service-release/README.md).
