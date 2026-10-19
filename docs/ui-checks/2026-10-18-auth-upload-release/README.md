# Выпуск Auth и портфолио — 18.10.2026

[Release и откат](../../RELEASE_20261018_AUTH_UPLOAD_STABILITY.md). Опубликовано 2026-10-18T21:28:12+07:00; tag `20261018-v2-auth-upload-stability`, entry `index-D4kBlu6Z.js`.

[Manifest](package-manifest.json) · [preflight](preflight-result.json) · [publish](publish-result.json) · [audit](audit-result.json) · [productionbrowser](browser-report.json). Контроллер: [release-auth-upload-stability.py](../../../scripts/release-auth-upload-stability.py), параметризованный серверный сценарий: [release-master-refinement.py](../../../deploy/release-master-refinement.py). Исторические доказательства15.10 не перезаписаны.

**Production11/11 PASS**,1366×620 и390×844;4/4PNG просмотрены. Desktop общие якоря и высота страницы стабильны. Mobile intro/вкладки/орнамент стабильны; providers/form сдвигаются только на180px фактических ролей. Возврат к входу восстанавливает координаты. JS errors0, overflow0, действия44px; entryHTTP200 и новый SWtag совпали. Только40GET/HEAD, writes0, внешних обращений0. Аккаунты, регистрации, загрузки, clipboard и productionQA-сеансы не использовались; cookies очищены, браузер закрыт.

[Вход desktop](auth-login-1366x620.png) · [Регистрация desktop](auth-register-1366x620.png) · [Вход mobile](auth-login-390x844.png) · [Регистрация mobile](auth-register-390x844.png).

[Локальная приёмка Auth96/96](../2026-10-18-auth-stability/README.md), [портфолио115+16/9HTTP](../2026-10-15-master-upload/README.md). Обе сборки и172 эталона PASS; новый SWtag проверен `node --check`. Повтор всего suite не выполнялся. [Проверка документов](docs-validation.json).

Сохранены47таблиц/209строк, бизнес-данные, сеансы и медиа на момент атомарного переключения; shared inode прежний.139файлов совпали с manifest, integrity/FK PASS. Backup и совместимый code-only rollback описаны в release. GitHub не изменялся.
