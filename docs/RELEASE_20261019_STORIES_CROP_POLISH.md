# Истории 24ч и исправление кадрирования — выпуск 19.10.2026

**Опубликовано 2026-10-19T13:38:23+07:00, Asia/Novosibirsk**, по прямому поручению пользователя «пушим всё в гитхаб и на сервер». [Главная страница каталога](https://atelie-13-143-66-1.sslip.io/v2/). [Карточка F-14](tasks/F-14.md), [Карточка BUG-021](tasks/BUG-021.md).

Current `/opt/atelie/releases/20261019-v2-stories-crop-polish`, frontend `index-DC0t1Lof.js`, SW `luma-v2-shell-20261019-v2-stories-crop-polish`. Предыдущая версия `20261018-v2-auth-upload-stability` сохранена.

## Изменения

[F-14](tasks/F-14.md): полноценная функциональность историй (Stories 24ч) для мастеров и салонов:
- Публикация историй через кабинет мастера и владельца салона (`CabinetStories.tsx`) с предпросмотром, подписью и привязкой услуги для быстрой записи.
- Прямая кнопка записи «Записаться» внутри просмотра истории с открытием формы бронирования выбранной услуги без ухода из контекста.
- Полноэкранный плеер (`StoryViewer.tsx`) с прогресс-барами, навигацией тап/клик, паузой при зажатии/наведении, клавиатурным управлением (Space/Esc/Arrows) и поддержкой `prefers-reduced-motion`.
- Кольца историй вокруг аватаров (`StoryRingAvatar.tsx`) в каталоге, карточках мастеров и публичных профилях с автоматической проверкой активных историй.
- Лента историй на главной (`StoriesFeedBar.tsx`) с группировкой по авторам.
- Серверный модуль `lib/stories.mjs`: эндпоинты `/api/stories/active`, `/api/stories/active-slugs`, `/api/stories/:slug`, авто-экспирация через 24 часа с очисткой файлов WebP, валидация прав и типов файлов.

[BUG-021](tasks/BUG-021.md):
- Удалена лишняя точка/ручка изменения размера (`.image-crop-handle`) в диалоге кадрирования аватара (`ImageCropDialog.tsx`), путавшая пользователей при наличии ползунка зума.
- Исправлено масштабирование через ползунок зума: масштаб теперь центрируется относительно текущего центра области кадрирования (дрифт центра < 0.05 px), исключая рывки и сдвиги.

[BUG-019](tasks/BUG-019.md) и [BUG-020](tasks/BUG-020.md):
- Стабильность анимации мобильного меню без мерцания и рывков.
- PushButton: таймаут 8 секунд для сетевых сбоев, корректная обработка состояний загрузки/ошибки.

## Проверки и сохранность

Локально:
- Unit/интеграционные тесты историй: `tests/stories.test.mjs` PASS (1/1).
- Browser E2E историй: `scripts/verify-stories.mjs` PASS на 1440, 390 и 320 px; скриншоты в `docs/ui-checks/2026-10-19-stories/`.
- Проверка кадрирования: `scripts/verify-crop-dialog.mjs` PASS (дрифт 0.02 px, ручки 0); скриншоты в `docs/ui-checks/2026-10-19-crop-fix/`.
- Frontend сборка `npm.cmd --prefix frontend run build` PASS, корневая сборка `npm.cmd run build` PASS.

На сервере:
- [Manifest](ui-checks/2026-10-19-stories-crop-release/package-manifest.json): 146 файлов, SHA256 архива `e537498f873a43183b570d70558680f55278203edaff5198b80be85d1b226b15`.
- [Preflight](ui-checks/2026-10-19-stories-crop-release/preflight-result.json): свежая серверная копия, 45 исходных таблиц/205 строк сохранены, 10 GET-проверок (включая `/api/stories/active`); изолированный процесс остановлен, копия удалена.
- [Publish](ui-checks/2026-10-19-stories-crop-release/publish-result.json): свежая резервная копия и атомарный switch сохранили 47 таблиц/209 строк на момент переключения, shared inode, сеансы и медиа. Безопасная эволюция схемы: создана только таблица `stories` и её 3 индекса.
- [Audit](ui-checks/2026-10-19-stories-crop-release/audit-result.json): active/health, 146 хешей файлов проверены, integrity/FK PASS. База и uploads не заменялись локальной копией.
- Live URL `https://atelie-13-143-66-1.sslip.io/v2/` 200 OK, `index-DC0t1Lof.js` подтверждён, SW tag `20261019-v2-stories-crop-polish` активен, `/api/stories/active` отвечает `[]`.

## Backup и откат

Закрытая резервная копия `/opt/atelie/backups/20261019-v2-stories-crop-polish/`: `atelie.sqlite`, свежий `pre-switch.sqlite`, `files.tar.gz` с uploads/vapid, env и служебные manifest/results. SHA256 pre-switch.sqlite `6248e17d4f98a84c2570588d3b79741d1f0c0e30cb5df8e476797b430426d1ba`.

Совместимый откат: остановить `atelie`, атомарно вернуть current на `/opt/atelie/releases/20261018-v2-auth-upload-stability`, запустить службу и проверить health/версию. Сохранять текущие shared БД/uploads и новые действия пользователей. Откат не понадобился.
