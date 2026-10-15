# Локальная проверка кабинетов и ближайшего окна — 15.10.2026

**Локально проверено 2026-10-15T17:16:45+07:00. Впоследствии опубликовано 2026-10-15T17:24:19+07:00; [release](../../RELEASE_20261015_CABINET_REFINEMENT.md). GitHub [39ff779](https://github.com/AppCreator-sudo/luma-beauty/commit/39ff779f5be3ec40653d9405bbe408d9b5a9c70b) подтверждён, U-10-15 завершена.** Полный [контракт](../../V2_CABINET_REFINEMENT.md), [матрица аудита](../../V2_COMPACTNESS_AUDIT.md), [задача выпуска](../../tasks/U-10-15.md).

## Результат

- **180 уникальных пунктов browser/API: PASS**, JavaScript errors 0. Основной [report](report.json), дополнительные [edge-report](edge-report.json), открытая форма и сетка [publication-final-report](publication-final-report.json), новые аккаунты/гостевые состояния [inventory-report](inventory-report.json), [сводка](summary.json).
- **18 целевых тестов PASS**: недельные/сменные графики и overrides, миграция/backup/legacy fallback, перенос, права владельца/публикации, изображения, гостевая запись. [TAP](targeted-tests.tap).
- [Frontend build](frontend-build.txt) и [root build](root-build.txt): PASS. Локальный frontend: `/v2/assets/index-CN5klrUV.js`. Сборка не является номером production-выпуска.
- Реальный браузер Chrome: 1440×1000, 390×844, 320×844. Работа с касанием — Chrome/CDP emulation, не физический OS-свайп.
- Изолированная синтетическая SQLite в `.cache/cabinet-refinement-20261015b`, localhost:3257; production БД, фото, SSH и конфигурация не изменялись. Integrity/FK PASS. Тестовый сервер после проверки остановлен; fixture сохранена в .cache. Секретов и данных реальных клиентов в отчёте нет.

## Основные снимки

| Сценарий | Desktop | Mobile |
| --- | --- | --- |
| Настройки мастера | [1440](master-settings-1440.png) | [390](master-settings-390.png), [320](master-settings-320.png) |
| Публикации салона | [1440](salon-3-1440.png) | [390](salon-3-390.png), [320](salon-3-320.png) |
| Второй шаг публикации, один автор | [1440](publication-description-1440.png) | [390](publication-description-390.png), [320](publication-description-320.png) |
| Портфолио кабинета | [1440](master-works-1440.png) | [390](master-works-390.png), [320](master-works-320.png) |
| Редактор страницы мастера | [1440](master-appearance-1440.png) | [390](master-appearance-390.png), [320](master-appearance-320.png) |
| Редактор страницы салона | [1440](edge-salon-media-preview-1440.png) | [390](edge-salon-media-preview-390.png), [320](edge-salon-media-preview-320.png) |
| Круглая область и касание | [1440](avatar-crop-1440.png) | [390](edge-avatar-touch-crop-390.png) |
| Сменный график | [3/3](master-cycle-schedule-1440.png) | [Копирование сотруднику](edge-staff-copy-cycle-390.png) |
| Ближайшее окно мастера | [1440](master-window-selection-1440.png) | [390](master-window-selection-390.png), [320](master-window-selection-320.png) |
| Ближайшее окно салона | [1440](salon-window-selection-1440.png) | [390](salon-window-selection-390.png), [320](salon-window-selection-320.png) |
| Контакт сразу после окна | [Мастер](master-nearest-contact-1440.png) | [Мастер](master-nearest-contact-390.png), [Салон](salon-nearest-contact-390.png) |
| Первая настройка мастера | [1440](inventory-new-master-1440.png) | [390](inventory-new-master-390.png), [320](inventory-new-master-320.png) |
| Создание салона | [1440](inventory-new-salon-1440.png) | [390](inventory-new-salon-390.png), [320](inventory-new-salon-320.png) |
| Личные данные клиента | [1440](edge-client-settings-0-1440.png) | [390](edge-client-settings-0-390.png), [320](edge-client-settings-0-320.png) |

Остальные снимки соответствуют именам пунктов в JSON. `before-inventory-*` — исходные первые формы, `failure.png` — найденное и затем исправленное переполнение портфолио 320 px; это не окончательный экран. Предыдущие попытки в `previous-attempt.json` / `edge-previous-attempt.json` — история проверок, не итоговая сводка: исправлялись точные локаторы, изоляция history и темп тестового обхода (серверный rate limit не ослаблялся).

## Пределы

Полный suite не объявляется зелёным: старые HTTP-fixtures [BUG-002](../../tasks/BUG-002.md) salon-public/workspaces по-прежнему создают сотрудника без обязательных данных. Новые проверки используют настоящий актуальный owner flow. В тестовой схеме client-cabinet добавлена таблица saved_salons для существующего экспорта.

Чистый визуальный проход не заменяет U-11 и физический телефон. Legacy-сотрудники/действующие приглашения и редкие сетевые состояния остаются в общей матрице U-10-01/09/10. При публикации требуется свежий backup и проверка реальной серверной версии; локальную fixture не переносить.

Воспроизведение: свежая fixture `tests/fixtures/map-reference-server.mjs` с отдельными LUMA_MAP_TEST_ROOT/LUMA_MAP_TEST_PORT, затем [основной скрипт](../../../scripts/verify-cabinet-refinement.mjs), [дополнительные сценарии](../../../scripts/verify-cabinet-edge-cases.mjs), [новые аккаунты](../../../scripts/verify-onboarding-density.mjs). Скрипты ограничены `.cache` и localhost. Все три используют LUMA_CABINET_TEST_ROOT для выбора созданной fixture. Приложение предварительно собрать.

Последняя проверка открытой формы 2026-10-15T17:16:45+07:00: устранены старые правила 4/2 колонок, на телефоне галерея под формой идёт одной колонкой, подписи действий не пересекаются. [Воспроизведение](../../../scripts/verify-publication-layout.mjs).
