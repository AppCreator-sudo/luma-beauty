# Карта U-09 — опубликовано 14.10.2026 19:41:05

Asia/Novosibirsk. Прямое разрешение пользователя: **«публикуй»** после локальной доводки U-09-02/03/05. Версия **`20261014-v2-map-reference`**, current `/opt/atelie/releases/20261014-v2-map-reference`. Служба active, health OK; публичный HTTPS карты — 200. [Доказательства](ui-checks/2026-10-14-map-release/README.md), [фактический результат](ui-checks/2026-10-14-map-release/release-result.json).

## Что опубликовано

Принятый [review-01 карты](ui-concepts/2026-10-14-luma/map-review-01/README.md): общая зелёная шапка/ветка, кремовые панели, бордовая запись, круглые фото, desktop карта/список и mobile переключатель/фильтры; старой нижней панели на /map нет. Сохранены поиск, направление, ближайший час, группы, ручная догрузка, карточка настоящей услуги/времени/цены/сотрудника, профиль/запись и история возврата.

По прямым уточнениям добавлены SVG-капли с острым кончиком и единый реальный рейтинг мастера/салона: среднее, число отзывов, «Пока без оценок». Учитываются клиентские отзывы по завершённым визитам; салон определяется сохранённым местом визита, не текущим составом сотрудников. Полная публичная страница отзывов/сохранение салона остаются F-07. Исправлены видимость выбранной точки при zoom и ложное пустое сообщение при быстром выборе/приближении.

**Leaflet/OpenStreetMap и SQLite сохранены.** Смена подложки отложена; PostGIS остаётся отдельным этапом F-03. Новые тарифы/ключи/аккаунты/серверные права и реклама не подключались. Локальные данные/тестовые отзывы/секреты не входили в пакет.

## Проверки и сохранность

- Локально: frontend/root build PASS, 5 целевых map/rating тестов PASS, browser 1440/390/320/800 PASS. [Снимки и ограничения](ui-checks/2026-10-14-map-polish/README.md). Старый BUG-002 HTTP-fixture остаётся открытым; выбранные пять тестов не выдаются за полный suite.
- Свежий серверный baseline **19:33:01**: U-08C r2, active/health, SQLite integrity/FK OK. Хеши runtime/package совпали с ожидаемыми. Единственное дополнительное локальное побайтовое отличие workspaces.mjs оказалось переводами строк; файл не отправлялся.
- Создан согласованный SQLite-backup **19:38:32**, затем свежий pre-switch backup. Пакет установлен в отдельный clone предыдущего release; старые hashed assets и node_modules сохранены.
- Первая подготовка остановилась до переключения: в минимальном PATH smoke-процесса не нашёлся runuser. Продолжение исправило PATH, перепроверило staged-файлы/baseline и использовало уже созданные каталоги без удаления. Рабочая служба тогда не останавливалась, откат не потребовался.
- **19:41:04:** полный новый сервер запущен как atelie на отдельной приватной копии БД с удалёнными только в копии sessions/pushes и отдельным VAPID. Health/map API/рейтинг PASS; схема и проверенные бизнес-таблицы после smoke не изменились. Smoke-процесс остановлен.
- **19:41:05:** короткая остановка службы, свежий snapshot, атомарный current и start. Health/map ratings, integrity/FK и неизменность схемы PASS. Каталоги shared/uploads и shared/private-client сохранили inode; данные не подменялись локальной базой. Скрипт имеет восстановление прежнего кода при ошибке после stop/switch.
- Публичная приёмка завершена **19:48:22**: **6 PASS**, JS page errors 0, write requests 0. Карта/настоящая карточка на 1440/390/320, общая ветка, SVG-капля, рейтинг, запись-ссылка, отсутствие нижней панели/overflow; mobile фильтры/меню/scroll-lock и Back. Entry/SW/API и анонимные client endpoints 401 проверены. [Отчёт](ui-checks/2026-10-14-map-release/production-report.json).
- Локальный DNS инструмента не разрешил sslip.io; браузер/API проверены с привязкой имени к подтверждённому IP 13.143.66.1, **с обычной TLS-проверкой исходного имени**. Дополнительно сервер сам получил публичные HTTPS health/карту. Только 320 px повторён с ожиданием загрузки ресурсов 25 секунд после первоначального таймаута 5 секунд; код приложения не менялся.

В production не выполнялись вход/создание визитов/отзывов или иные бизнес-записи. Полные операции проверены локально. Физический OS-жест/GPS/push и общая сквозная приёмка остаются F-08/U-11.

## Версия и резервные копии

- Current/marker: `20261014-v2-map-reference`.
- Предыдущий совместимый release: `/opt/atelie/releases/20261011-v2-client-cabinet-reference-r2`, не изменён.
- Backup: `/opt/atelie/backups/20261014-v2-map-reference/atelie.sqlite` и `pre-switch.sqlite`; SHA256 обеих копий `9f3014c15c09dbdac177a465e5d1d5693194386c00c871b962b45b353b69fd52`.
- Пакет: 108 файлов, 1 263 208 байт, SHA256 `3634ed64615fd6098ce32168d36a06188adddd0d532ce54222831b83640b6d00`. Runtime: server.mjs, lib/map-viewport.mjs, lib/salon-public.mjs, новый lib/review-ratings.mjs; остальные файлы — frontend assets/index и SW. [Манифест](ui-checks/2026-10-14-map-release/package-manifest.json).
- Entry `index-DGD17Jlc.js`; карта `Map-BNxTV3aa.js` / `Map-l3OKkjbZ.css`; worker cache `luma-v2-shell-20261014-v2-map-reference`.
- SHA256 HTML `9a9150667d60ef5fda1b6cf54d44929b0667fd6062925c332cc1cfb72c6804e7`, SW `3f863e683bbfafc9f9969cc2fc85f8cad9db9dc98d7523a7519376d97295e62f`.
- Серверные скрипты состоявшегося выпуска: `/opt/atelie/deploy-20261014-v2-map-reference.py`, продолжение `/opt/atelie/resume-20261014-v2-map-reference.py`. Это датированные действия, не новая SSH-учётная запись/привилегированный сервис. Повторно вслепую не запускать. [Логи](ui-checks/2026-10-14-map-release/deployment.log).

## Откат

Схема не менялась. Проверить, что current всё ещё этот release, атомарно вернуть **предыдущий U-08C r2**, restart и health. **Рабочую базу не откатывать из snapshot:** новые записи после выпуска должны сохраниться. Shared/uploads/private-client и предыдущие release/dependencies не удалять.

```sh
set -euo pipefail
base=/opt/atelie
expected="$base/releases/20261014-v2-map-reference"
previous="$base/releases/20261011-v2-client-cabinet-reference-r2"
link="$base/.current-map-reference-manual-rollback"
[ "$(readlink -f "$base/current")" = "$expected" ]
[ -d "$previous" ]; [ ! -L "$previous" ]
[ ! -e "$link" ]; [ ! -L "$link" ]
ln -s "$previous" "$link"
mv -Tf "$link" "$base/current"
systemctl restart atelie
systemctl is-active atelie
curl -fsS http://127.0.0.1:3100/api/health
```

Следующая задача — **U-10-01**, матрица остаточного UI; уже опубликованную карту повторно не проектировать.
