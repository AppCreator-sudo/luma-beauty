# Утверждённый UI — эталоны и реализация

## Актуальный этап — опубликовано и отправлено в GitHub, 15.10.2026

**Опубликовано 15.10.2026 14:31:04 +07:00**, `20261015-v2-profile-service-polish`: U-06-03 (профили/адрес/узор/две кнопки/footer), U-07-01 (карточки/бейджи/рейтинг), U-09-06 (направления услуг и выбор на карте). [Release/backup/откат](RELEASE_20261015_PROFILE_SERVICE_POLISH.md), [18 публичных проверок](ui-checks/2026-10-15-profile-service-release/README.md): PASS, JS/write errors0. Сохранность прежних данных и shared media подтверждена, миграция service-directions-v1 проверена на отдельной рабочей копии.

**U-06-04 завершена. GitHub синхронизирован:** [кодовый коммит 25266c8](https://github.com/AppCreator-sudo/luma-beauty/commit/25266c84aefbcdb74e268bcd277cf8e038bc33e4), remote `main` подтверждён 2026-10-15T14:41:35+07:00. [Отчёт синхронизации](GITHUB_SYNC_20261015.md). Документарная точка продолжения оформляется отдельным последующим коммитом.

**Следующая задача — [U-10-01: матрица остаточных маршрутов, ролей и состояний](tasks/U-10-01.md)**. Уже опубликованное повторно не проектировать; следующий экран/расхождение сначала сверять с утверждёнными эталонами. Общие U-10/U-11 ещё не завершены. Роли, SQLite/Leaflet/OSM и естественный scrollbar сохранены.

## История до текущего этапа

## Предыдущий выпуск — общие профили, 14.10.2026

**Опубликовано 2026-10-14T22:17:50+07:00, `20261014-v2-public-profiles-unified`.** U-06-01/BUG-007/F-13/F-07/U-06-02: единая компактная композиция мастера/салона, действия в строку, совпадающий preview/палитры/узор, обучение/поиск моделей, салонные рейтинг/отзывы и избранное в «Мастера и салоны». Миграция проверена на приватной копии; исходные бизнес-данные и shared media сохранены. [Release/backup/откат](RELEASE_20261014_PUBLIC_PROFILES_UNIFIED.md), [14 публичных проверок](ui-checks/2026-10-14-public-profiles-release/README.md): PASS, JS/write errors0.

**Последнее UI-решение:** убрать scrollbar-gutter:stable и пустой отступ справа. Естественный сдвиг при обычном scrollbar допустим. BUG-006 — историческое решение; компенсацию не восстанавливать. [Контракт](V2_PUBLIC_PROFILES_UNIFIED.md). **Следующая задача — [U-10-01](tasks/U-10-01.md)**, матрица остаточных маршрутов/ролей/состояний. Выпуск профилей повторять не нужно; общий UI ещё не закрыт.


Актуализировано **14.10.2026**, Asia/Novosibirsk. **Утверждённый UI = внешность ресурса.** Журнал определяет точный макет, перенесённый код и остаток. Очередь только в [карточках](tasks/README.md).

## Договор переноса

- Зелёный/молочный/бордовый/золото, существующая шапка и ветка-логотип. Главная сохраняет свою опубликованную fullscreen композицию.
- Открыть PNG до кода. Утверждённое уточнение важнее старого предложения; review-01 каталога не принят.
- Отсутствующую функцию/компоновку или расхождение сначала показать с конкретным решением. Новое не добавлять молча, действующее без обсуждения не удалять.
- PNG/manifest неизменны; уточнения отдельным review с фактом согласования. Desktop/mobile вместе, 44 px, круглые аватары, reduced-motion, без overflow/старой нижней панели.
- `implementationStatus` внутри исходных reference-manifest — датированный снимок момента согласования, не текущая очередь. Статус фактического переноса читать в этом журнале/карточке/RELEASE; исходный manifest не переписывать ради нового статуса.
- Реальные данные/функции. «Менеджер» — владелец; staff внутри салона. Фиктивные цифры/фото клиентов из концепта не копировать.

## Опубликованные экраны: точные источники

| Область / ID | Что открыть | Код и доказательства |
| --- | --- | --- |
| Общая основа U-00/U-02 | [Пять исходных PNG](ui-concepts/2026-10-10-luma/README.md), [cabinet.png](ui-concepts/2026-10-10-luma/cabinet.png) | [Brand](../frontend/src/components/Brand.tsx), [PublicHeader](../frontend/src/components/PublicHeader.tsx), [MenuOverlay](../frontend/src/components/MenuOverlay.tsx). Общий слой не закрывает все маршруты |
| Главная U-01 | [Fullscreen/механика](RELEASE_20261010_HOME_FULLSCREEN.md), [финальная правка](RELEASE_20261010_HOME_POLISH.md) | [Home](../frontend/src/pages/Home.tsx). Не возвращать split-layout/старый логотип; медиа F-05-03 |
| Мастер U-03 | [Desktop](ui-concepts/2026-10-10-luma/cabinet-review-01/desktop.png), [mobile](ui-concepts/2026-10-10-luma/cabinet-review-01/mobile.png), [решения](V2_CABINET_REFERENCE_AUDIT.md) | [MasterCabinet](../frontend/src/components/MasterCabinet.tsx), [выпуск](RELEASE_20261010_CABINET_REFERENCE.md). Заявки/подготовка/инициалы/бордовые кнопки приняты |
| Календарь U-04 | [calendar.png](ui-concepts/2026-10-10-luma/calendar.png), [mobile/editor review-01](ui-concepts/2026-10-10-luma/calendar-review-01/README.md), [решения](V2_CALENDAR_REFERENCE_AUDIT.md) | [CalendarWorkspace](../frontend/src/components/CalendarWorkspace.tsx), [выпуск](RELEASE_20261010_CALENDAR_REFERENCE.md). Полное редактирование, контакт read-only; без комнат/выбора напоминаний |
| Салон U-05 | [review-01 desktop/mobile/разделы](ui-concepts/2026-10-10-luma/salon-cabinet-review-01/README.md), [решения](V2_SALON_CABINET_REFERENCE_AUDIT.md) | [SalonOwnerCabinet](../frontend/src/components/SalonOwnerCabinet.tsx), [выпуск](RELEASE_20261010_SALON_CABINET_REFERENCE.md). «Менеджер», owner-only |
| Уточнение профилей 14.10 U-06-01/BUG-007/F-13/F-07 | [Контракт](V2_PUBLIC_PROFILES_UNIFIED.md), [опубликованные снимки](ui-checks/2026-10-14-public-profiles-release/README.md) | Общие PublicPageIdentity/cover/reviews и палитры/preview. Салон по мастерскому оформлению, естественная прокрутка без gutter; [выпуск](RELEASE_20261014_PUBLIC_PROFILES_UNIFIED.md) |
| Публичные профили U-06 | [master.png](ui-concepts/2026-10-10-luma/master.png), [salon.png](ui-concepts/2026-10-10-luma/salon.png), [mobile review-01](ui-concepts/2026-10-11-luma/public-pages-review-01/README.md), [решения](V2_PUBLIC_PAGES_REFERENCE_AUDIT.md) | [Profile](../frontend/src/pages/Profile.tsx), [PublicSalon](../frontend/src/pages/PublicSalon.tsx), [выпуск](RELEASE_20261011_PUBLIC_PROFILES_REFERENCE.md). Окно перед галереей, адрес/описание/стаж |
| Каталог/Вдохновение U-07 | **[review-03 desktop/mobile](ui-concepts/2026-10-11-luma/catalog-works-review-03/README.md)**, [решения](V2_CATALOG_WORKS_REFERENCE_AUDIT.md) | [CatalogMasterCard](../frontend/src/components/CatalogMasterCard.tsx), [MasonryGrid](../frontend/src/components/MasonryGrid.tsx), [ShowMore](../frontend/src/components/ShowMore.tsx), [выпуск](RELEASE_20261011_CATALOG_WORKS_REFERENCE.md). Каталог 3/1, masonry 4/2, «Показать ещё» |
| Работа U-07 | Четвёртый mobile-экран **[review-02](ui-concepts/2026-10-11-luma/catalog-works-review-02/README.md)** + desktop/контракт U-07 | [WorkPage в Profile.tsx](../frontend/src/pages/Profile.tsx). Полное фото/миниатюры/автор/услуга/сохранение/запись. review-02 не заменяет review-03 сеток |
| Меню/Back/вход U-07N | [auth review-02](ui-concepts/2026-10-11-luma/auth-review-02/README.md), [контракт навигации](V2_NAVIGATION_AUTH_REFERENCE.md) | [Auth](../frontend/src/pages/Auth.tsx), MenuOverlay, [выпуск](RELEASE_20261011_NAVIGATION_AUTH_REFERENCE.md). Крупные роли, провайдеры «Скоро», Back по истории |
| Запись U-08 | **[review-01 desktop/mobile/состояния](ui-concepts/2026-10-11-luma/booking-review-01/README.md)**, [решения](V2_BOOKING_REFERENCE_AUDIT.md) | [Booking](../frontend/src/pages/Booking.tsx) (VisitPage), PublicSalon.tsx (SalonBookingPage), [BookingReference](../frontend/src/components/BookingReference.tsx), [выпуск r2](RELEASE_20261011_BOOKING_REFERENCE.md) |
| Клиент U-08C | **[review-01 семь разделов](ui-concepts/2026-10-11-luma/client-cabinet-review-01/README.md)** + **[review-02 дополнения](ui-concepts/2026-10-11-luma/client-cabinet-review-02/README.md)**, [решения](V2_CLIENT_CABINET_REFERENCE_AUDIT.md) | [ClientCabinet](../frontend/src/components/ClientCabinet.tsx), [ClientVisit](../frontend/src/components/ClientVisit.tsx), [ClientSettings](../frontend/src/components/ClientSettings.tsx), [выпуск r2](RELEASE_20261011_CLIENT_CABINET_REFERENCE.md) |

cabinet-review-01 не содержит README; ссылки идут прямо на PNG. VisitPage/CalendarPage/SalonBookingPage — экспорты Booking.tsx/Studio.tsx/PublicSalon.tsx, не отдельные файлы.

## Карта U-09 — опубликована

**U-09-02/03/05, 14.10.2026 19:41:05:** `20261014-v2-map-reference` после отдельного «публикуй». Принятый [review-01 desktop/mobile/состояния](ui-concepts/2026-10-14-luma/map-review-01/README.md), [контракт](V2_MAP_REFERENCE_AUDIT.md). По прямому уточнению пользователя добавлены единый рейтинг мастера/салона, число отзывов, «Пока без оценок» и SVG-капли; исправлены zoom/положение выбранной точки и ложное пустое состояние. Общая шапка/ветка, фильтры, карта/список/карточка/Back; прежняя нижняя панель/footer на /map убраны. Leaflet/OSM/SQLite сохранены; API дополнен агрегатами рейтинга без миграции.

[Release/backup/откат](RELEASE_20261014_MAP_REFERENCE.md), [локальные снимки](ui-checks/2026-10-14-map-polish/README.md), [публичный отчёт](ui-checks/2026-10-14-map-release/README.md): 6 PASS, page errors/write requests 0. Frontend/root build, 5 целевых server-тестов и browser четырёх размеров PASS; старый BUG-002 остаётся открытым. Исходные PNG сохранены. Смена провайдера U-09-04 отложена, PostGIS отдельно F-03. Следующая задача U-10-01.

## BUG-006 — общая шапка без сдвига

Опубликовано **14.10.2026 20:09:38**, `20261014-v2-header-alignment`. Сохранена принятая шапка; устранён сдвиг 7,5 px при исчезновении scrollbar на карте одной общей CSS-настройкой scrollbar-gutter:stable. Главная вне правила. [Release/проверки/откат](RELEASE_20261014_HEADER_ALIGNMENT.md), [измерения](ui-checks/2026-10-14-header-alignment/README.md): 0 px на пяти ширинах local/public, включая видимую desktop-полосу; mobile menu/Back и регрессия карты PASS. Runtime/данные не менялись, исходные PNG сохранены.

## Открытые части

| Задача | Источник | Остаток |
| --- | --- | --- |
| [U-10-01 матрица](tasks/U-10-01.md) | [Роутер](../frontend/src/main.tsx), [Shell](../frontend/src/components/Shell.tsx) | Остатки по маршрутам/ролям/состояниям, без вымышленных страниц |
| U-10-02…10 | По самостоятельным карточкам | Старые формы/ветки, согласовать отсутствующие компоновки |
| [U-11-01](tasks/U-11-01.md)/[02](tasks/U-11-02.md) | Матрица U-10 и принятые эталоны | Очистка старой оболочки/нижней панели, сквозная приёмка |

**BUG-001 закрыт** 11.10.2026 00:09:54: [выпуск](RELEASE_20261011_SIDEBAR_BACKGROUND.md). Старое «не исправлено» из истории больше не действует.

## Ведение журнала

Уточнение: ID карточки → точный review → дата/ответ пользователя → компонент → проверка → фактический выпуск. Не заменять утверждение словами «похоже на концепт». Один экран не закрывает весь раздел/все состояния.

Последний UI — исправление шапки `20261014-v2-header-alignment`, 14.10.2026 20:09:38. Физический Back/push отдельно F-08; полноценные отзывы/сохранение салона и удаление клиента — отдельные решения. [Исторический журнал](archive/README.md) не текущая очередь.
