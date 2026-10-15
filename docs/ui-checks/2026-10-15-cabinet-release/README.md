# Публикация кабинетов — 15.10.2026

**Опубликовано 2026-10-15T17:24:19+07:00. 27 публичных проверок PASS**, JS errors0, записей бизнес-данных0. [Release/backup/откат](../../RELEASE_20261015_CABINET_REFINEMENT.md). Приватные сценарии предварительно [проверены локально](../2026-10-15-cabinet-refinement/README.md).

- [Манифест](package-manifest.json): точные файлы/хеши/entry и подтверждённый baseline.
- [Серверный результат](server-result.json), [этапы публикации](deployment-log.txt): smoke на отдельной консистентной рабочей копии под atelie, 40 исходных бизнес-таблиц неизменны, схема совпадает с production, integrity/FK и media OK.
- [Финальная проверка сервера](final-server-status.json): current/active/health, integrity/FK и пять прежних колонок графика подтверждены повторно 2026-10-15T17:31:04+07:00.
- [Итоговый браузерный отчёт](production-report.json), [повторяемая проверка](verify-published.mjs): выбор чипа без перехода, сохранённое время до контакта, доступные сотрудники, общая шапка/нет нижней панели/нет overflow на 1440,390,320. На production без авторизации и отправки заявок.
- [Историческая попытка селектора](previous-selector-attempt.json): неверный .master-row заменён на существующий .people .person, код сайта не менялся.
- [Историческая попытка guard](previous-preview-guard-attempt.json): 27 проверок UI/API прошли, guard остановил автоматический POST invitations/preview. Итоговый runner отдельно учитывает эти заблокированные read-preview запросы; они не отправлены серверу. Остальные POST запрещены.

Снимки ниже — реальный опубликованный UI. Для кабинетов с данными используются локальные снимки из соседнего отчёта, поскольку рабочие данные/настройки специально не менялись.

| Сценарий | Desktop1440 | Mobile390 | Mobile320 |
| --- | --- | --- | --- |
| Мастер: выбор окна | [1440](master-window-1440.png) | [390](master-window-390.png) | [320](master-window-320.png) |
| Мастер: контакт | [1440](master-contact-1440.png) | [390](master-contact-390.png) | [320](master-contact-320.png) |
| Салон: выбор окна | [1440](salon-window-1440.png) | [390](salon-window-390.png) | [320](salon-window-320.png) |
| Салон: контакт | [1440](salon-contact-1440.png) | [390](salon-contact-390.png) | [320](salon-contact-320.png) |
| Вход | [1440](login-1440.png) | [390](login-390.png) | [320](login-320.png) |
| Первый кабинет мастера | [1440](new-master-1440.png) | [390](new-master-390.png) | [320](new-master-320.png) |
| Первый кабинет салона | [1440](new-salon-1440.png) | [390](new-salon-390.png) | [320](new-salon-320.png) |
| Гостевой календарь | [1440](guest-calendar-1440.png) | [390](guest-calendar-390.png) | [320](guest-calendar-320.png) |
| Доступ | [1440](access-1440.png) | [390](access-390.png) | [320](access-320.png) |
| Приглашение без кода | [1440](join-1440.png) | [390](join-390.png) | [320](join-320.png) |

Повтор из корня: `node docs/ui-checks/2026-10-15-cabinet-release/verify-published.mjs`. Нужны Playwright и Chrome, сеть до origin. Runner не пишет в рабочую БД. Физический жест телефона и общий U-11 остаются отдельными.
