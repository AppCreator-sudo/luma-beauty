# BUG-006 — шапка без сдвига, опубликовано 14.10.2026 20:09:38

Asia/Novosibirsk. Версия **`20261014-v2-header-alignment`**, current `/opt/atelie/releases/20261014-v2-header-alignment`. Точечное исправление дефекта только что опубликованной карты в рамках действующего поручения на её доводку/выпуск. [Карточка](tasks/BUG-006.md), [доказательства](ui-checks/2026-10-14-header-alignment/README.md).

## Исправление

На прокручиваемых «Мастерах»/«Вдохновении» обычная desktop-полоса занимала 15 px; на карте её не было. Ссылки сдвигались на 7,5 px, действия справа — на 15 px. В общей публичной оболочке добавлено `html:has(.public-reference-header){scrollbar-gutter:stable}`: одинаковое место под полосу сохраняется независимо от высоты страницы. Логотип/шрифты/порядок ссылок не подгоняются отдельными отступами. Главная без PublicHeader под правило не попадает.

Изменение приложения — одна CSS-правка в frontend/src/public-reference.css; новый frontend build и версия SW-cache. **Runtime/backend, package/dependencies, схема SQLite, провайдер карты и данные не менялись.** Старые assets и предыдущий release сохранены.

## Проверка и выпуск

- До правки: local Chromium с обычными scrollbars, ширины 1365/1440/800 — сдвиг nav 7,5 px; справа 15 px. После — **0 px** для трёх ссылок, логотипа и действий, включая 390/320. [До](ui-checks/2026-10-14-header-alignment/local-before.json), [после](ui-checks/2026-10-14-header-alignment/local-after.json).
- Frontend/root build PASS. [Регрессия карты](ui-checks/2026-10-14-header-alignment/map-regression.json) PASS на четырёх размерах: карточки/точки/атрибуция, фильтры/догрузка/Back/запись салона/пустые и ошибочные состояния/reduced-motion. Новых server-тестов для CSS не добавляли.
- Серверный baseline **20:07:25** — предыдущий `20261014-v2-map-reference`, active/health, integrity/FK OK. Пакет только frontend/SW, 104 файла, 1 238 022 байта; SHA256 `00f2e1f782089dadab90c49d531462c3e139c223cc2bcdac908fa6e74feb1773`.
- **20:09:36–38:** consistent backup, clone предыдущего release, проверка неизменности всех runtime-хешей и старых assets, свежий pre-switch snapshot, атомарный current/restart. Active/health/map API/integrity/FK/неизменная схема и inode shared media PASS. [Лог](ui-checks/2026-10-14-header-alignment/deployment.log), [результат](ui-checks/2026-10-14-header-alignment/release-result.json).
- [Публичная проверка](ui-checks/2026-10-14-header-alignment/production.json) PASS на 1365/1440/800/390/320: переходы мастера → вдохновение → карта → мастера, координаты всех элементов одинаковы; mobile menu/Back без overflow; главная сохраняет scrollbar-gutter:auto. Отдельно [1365×650 с настоящей полосой](ui-checks/2026-10-14-header-alignment/production-scrollbar.json) — 0 px сдвига при смене ширины полосы 15 → 0 px.
- Публичный probe анонимный, методы записи блокируются. При локальном DNS-сбое используется подтверждённый IP прежнего сервера с сохранением исходного HTTPS-имени и TLS-проверки. Физический телефон не выдаётся за проверенный.

## Версия и откат

Current `20261014-v2-header-alignment`; entry `index-C7Tvltx2.js`, cache `luma-v2-shell-20261014-v2-header-alignment`. Backup `/opt/atelie/backups/20261014-v2-header-alignment/atelie.sqlite` и `pre-switch.sqlite`, SHA256 `dc46244b050d26b6aaf3091c487e924548c30f93f0c523693813aa3d2c48d1a9`. [Полный манифест](ui-checks/2026-10-14-header-alignment/package-manifest.json).

При необходимости, после проверки current, атомарно вернуть `/opt/atelie/releases/20261014-v2-map-reference`, restart atelie и health. **Базу из backup не восстанавливать:** это frontend-исправление, новые визиты/изменения сохраняются. Предыдущий release и node_modules не удалять. Следующая задача U-10-01.
