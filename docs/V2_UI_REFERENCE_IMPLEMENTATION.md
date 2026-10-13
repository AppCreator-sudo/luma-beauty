# Утверждённый UI — эталоны и реализация

Актуализировано **12.10.2026**, Asia/Novosibirsk. **Утверждённый UI = внешность ресурса.** Журнал определяет точный макет, перенесённый код и остаток. Очередь только в [карточках](tasks/README.md).

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
| Публичные профили U-06 | [master.png](ui-concepts/2026-10-10-luma/master.png), [salon.png](ui-concepts/2026-10-10-luma/salon.png), [mobile review-01](ui-concepts/2026-10-11-luma/public-pages-review-01/README.md), [решения](V2_PUBLIC_PAGES_REFERENCE_AUDIT.md) | [Profile](../frontend/src/pages/Profile.tsx), [PublicSalon](../frontend/src/pages/PublicSalon.tsx), [выпуск](RELEASE_20261011_PUBLIC_PROFILES_REFERENCE.md). Окно перед галереей, адрес/описание/стаж |
| Каталог/Вдохновение U-07 | **[review-03 desktop/mobile](ui-concepts/2026-10-11-luma/catalog-works-review-03/README.md)**, [решения](V2_CATALOG_WORKS_REFERENCE_AUDIT.md) | [CatalogMasterCard](../frontend/src/components/CatalogMasterCard.tsx), [MasonryGrid](../frontend/src/components/MasonryGrid.tsx), [ShowMore](../frontend/src/components/ShowMore.tsx), [выпуск](RELEASE_20261011_CATALOG_WORKS_REFERENCE.md). Каталог 3/1, masonry 4/2, «Показать ещё» |
| Работа U-07 | Четвёртый mobile-экран **[review-02](ui-concepts/2026-10-11-luma/catalog-works-review-02/README.md)** + desktop/контракт U-07 | [WorkPage в Profile.tsx](../frontend/src/pages/Profile.tsx). Полное фото/миниатюры/автор/услуга/сохранение/запись. review-02 не заменяет review-03 сеток |
| Меню/Back/вход U-07N | [auth review-02](ui-concepts/2026-10-11-luma/auth-review-02/README.md), [контракт навигации](V2_NAVIGATION_AUTH_REFERENCE.md) | [Auth](../frontend/src/pages/Auth.tsx), MenuOverlay, [выпуск](RELEASE_20261011_NAVIGATION_AUTH_REFERENCE.md). Крупные роли, провайдеры «Скоро», Back по истории |
| Запись U-08 | **[review-01 desktop/mobile/состояния](ui-concepts/2026-10-11-luma/booking-review-01/README.md)**, [решения](V2_BOOKING_REFERENCE_AUDIT.md) | [Booking](../frontend/src/pages/Booking.tsx) (VisitPage), PublicSalon.tsx (SalonBookingPage), [BookingReference](../frontend/src/components/BookingReference.tsx), [выпуск r2](RELEASE_20261011_BOOKING_REFERENCE.md) |
| Клиент U-08C | **[review-01 семь разделов](ui-concepts/2026-10-11-luma/client-cabinet-review-01/README.md)** + **[review-02 дополнения](ui-concepts/2026-10-11-luma/client-cabinet-review-02/README.md)**, [решения](V2_CLIENT_CABINET_REFERENCE_AUDIT.md) | [ClientCabinet](../frontend/src/components/ClientCabinet.tsx), [ClientVisit](../frontend/src/components/ClientVisit.tsx), [ClientSettings](../frontend/src/components/ClientSettings.tsx), [выпуск r2](RELEASE_20261011_CLIENT_CABINET_REFERENCE.md) |

cabinet-review-01 не содержит README; ссылки идут прямо на PNG. VisitPage/CalendarPage/SalonBookingPage — экспорты Booking.tsx/Studio.tsx/PublicSalon.tsx, не отдельные файлы.

## Открытые части

| Задача | Источник | Остаток |
| --- | --- | --- |
| [U-09-01 карта](tasks/U-09-01.md) | [map.png](ui-concepts/2026-10-10-luma/map.png), действующие Map/viewport | Сверка, одобрение mobile/неизвестных состояний, затем [U-09-02 перенос](tasks/U-09-02.md) |
| [U-10-01 матрица](tasks/U-10-01.md) | [Роутер](../frontend/src/main.tsx), [Shell](../frontend/src/components/Shell.tsx) | Остатки по маршрутам/ролям/состояниям, без вымышленных страниц |
| U-10-02…10 | По самостоятельным карточкам | Старые формы/ветки, согласовать отсутствующие компоновки |
| [U-11-01](tasks/U-11-01.md)/[02](tasks/U-11-02.md) | Матрица U-10 и принятые эталоны | Очистка старой оболочки/нижней панели, сквозная приёмка |

**BUG-001 закрыт** 11.10.2026 00:09:54: [выпуск](RELEASE_20261011_SIDEBAR_BACKGROUND.md). Старое «не исправлено» из истории больше не действует.

## Ведение журнала

Уточнение: ID карточки → точный review → дата/ответ пользователя → компонент → проверка → фактический выпуск. Не заменять утверждение словами «похоже на концепт». Один экран не закрывает весь раздел/все состояния.

Последний UI — U-08C r2 11.10.2026 23:15:02. Физический Back/push отдельно F-08; салонный rating/save и удаление клиента — отдельные решения. [Исторический журнал](archive/README.md) не текущая очередь.
