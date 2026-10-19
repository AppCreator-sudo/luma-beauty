# Вход и загрузка портфолио — выпуск 18.10.2026

**Опубликовано 2026-10-18T21:28:12+07:00, Asia/Novosibirsk**, по прямому поручению пользователя «если всё ок, пуш на сервер без избыточного тестирования». [Рабочая страница входа](https://atelie-13-143-66-1.sslip.io/v2/auth). [Карточка U-10-25](tasks/U-10-25.md).

Current `/opt/atelie/releases/20261018-v2-auth-upload-stability`, frontend `index-D4kBlu6Z.js`, SW `luma-v2-shell-20261018-v2-auth-upload-stability`. Предыдущая версия `20261015-v2-master-refinement` сохранена. GitHub push не выполнялся.

## Изменения

[BUG-018](tasks/BUG-018.md): переключение входа и регистрации сохраняет общие заголовки, описание, вкладки и левую композицию. На desktop поля неподвижны; на mobile плавно раскрывается только фактический выбор роли, без180px пустоты во входе. Введённые данные, роли, Back/Forward, keyboard focus и reduced motion сохранены; утверждённая концепция не менялась.

[U-10-04](tasks/U-10-04.md), BUG-013…017: новый черновик портфолио начинается с первого шага, отправка блокирует дубли/закрытие формы, ограничение стороны фото применяется до resize, подтверждение сохранения не пропадает при отказе обновления, сетевая ошибка понятна по-русски. Роли, схема и провайдер карты прежние. Другие открытые U-10/U-11 и BUG-009/010/012 не закрыты.

## Проверки и сохранность

Локально: [Auth96/96 и18PNG](ui-checks/2026-10-18-auth-stability/README.md), [портфолио115+16 browser-пунктов и9HTTP-тестов](ui-checks/2026-10-15-master-upload/README.md), обе сборки PASS,172 утверждённых эталона неизменны. Полный suite повторно не запускался. Перед упаковкой обновлён SWtag, `node --check public/sw.js` PASS.

[Manifest](ui-checks/2026-10-18-auth-upload-release/package-manifest.json): 139 файлов, SHA256 архива `6a677751cdc63047cbf57ebaf5da02db452ebd4bf0b81717b3960ed46dafeb3e`. [Preflight](ui-checks/2026-10-18-auth-upload-release/preflight-result.json): свежая серверная копия,45таблиц/205строк без sessions/pushes, схема и бизнес-данные сохранены,9GET-проверок; изолированный процесс остановлен, копия удалена.

[Publish](ui-checks/2026-10-18-auth-upload-release/publish-result.json): свежая резервная копия и атомарный switch сохранили47таблиц/209строк на момент переключения, shared inode, сеансы и медиа. Схема не менялась. [Audit](ui-checks/2026-10-18-auth-upload-release/audit-result.json): active/health,139хешей, integrity/FK PASS. База и uploads не заменялись локальной копией.

[ProductionAuth](ui-checks/2026-10-18-auth-upload-release/README.md):11/11 PASS,4/4PNG просмотрены,1366×620 и390×844. Entry/SWtag совпадают, JS errors0/overflow0,40GET/HEAD, реальных writes0. Новые аккаунты/QA-сеансы не создавались, браузер закрыт, cookies очищены. Проверка опубликованного портфолио с настоящей отправкой не выполнялась: сохранность кода подтверждена manifest и ранее выполненной целевой приёмкой.

## Backup и откат

Закрытая резервная копия `/opt/atelie/backups/20261018-v2-auth-upload-stability/`: `atelie.sqlite`, свежий `pre-switch.sqlite`, `files.tar.gz` с uploads/vapid, env и служебные manifest/results. SHA256 pre-switch.sqlite `3641e666ac77d05c8d29074194a6707fcb1b7b368ad94acc974d0cc33c74b054`.

Совместимый откат: остановить `atelie`, атомарно вернуть current на `/opt/atelie/releases/20261015-v2-master-refinement`, запустить службу и проверить health/версию. Сохранять текущие shared БД/uploads и новые действия пользователей. Восстанавливать старый snapshot для обычного отката кода не требуется. Откат не понадобился.

Документы завершены 2026-10-18T21:31:10+07:00; следующая [U-10-06](tasks/U-10-06.md), только оставшиеся состояния профессионального PushButton.
