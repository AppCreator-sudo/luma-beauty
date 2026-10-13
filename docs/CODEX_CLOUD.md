# Luma Beauty — подготовка Codex Cloud

Актуальное поручение 14.10.2026: пользователь требует полный перенос с существующими секретами и рабочей базой в private GitHub. Новая SSH-учётная запись отменена. Использовать [полную инструкцию](CLOUD_SERVER_ACCESS.md). Этот блок имеет приоритет над прежним вариантом передачи через vault и ожиданием разрешения новой учётной записи.

Дополнение 14.10.2026: пользователь подтвердил разработку/публикацию и полную рабочую копию. [OPS-04](tasks/OPS-04.md): защищённый пакет проверен, [импорт и права](CLOUD_SERVER_ACCESS.md). Серверная учётная запись/привилегированный помощник требуют отдельного разрешения после отказа автоматической проверки; не установлены. Среда ещё не создана. Нижние инструкции описывают базовую пустую среду; для согласованной копии использовать CLOUD_SERVER_ACCESS.

Актуализировано 14.10.2026 по [официальной инструкции текущих Cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments). Это подготовка разработки, не перенос production и не публикация облачной среды от имени пользователя.

## После появления репозитория GitHub

1. В Codex выбрать **Work in → Cloud → Select environment → Create environment** либо Settings → Codex Cloud → Environments → Create environment.
2. Подключить GitHub при запросе, выбрать закрытый `AppCreator-sudo/luma-beauty`. Доступ в этой задаче к GitHub не доказывает доступ новой cloud-среды к репозиторию; при необходимости разрешить его в настройках GitHub-интеграции.
3. Нажать Get started и передать запрос ниже. Codex проверит установку/запуск; при недостающей конфигурации ответить в настройке среды.
4. Проверить setup report/configuration/files, исправить незавершённое, сохранить и нажать Publish. Только после **Environment published** среда готова для новых cloud-задач.
5. Start a new task → «Прочитай AGENTS.md и текущий checkpoint; выполни первую доступную задачу по плану». Не просить сразу выполнить всю очередь.

## Готовый запрос настройки

```text
Настрой Luma Beauty из выбранного закрытого GitHub репозитория.
Начни с AGENTS.md, docs/NEW_CHAT_GUIDE.md и docs/WORK_CHECKPOINT.md.
Рабочий корень — checkout репозитория, не Windows-путь C:/Users/Admin/Desktop/pwa.
Используй Node.js 22.22.2 (минимум 22.13) и Python 3.
Установи root/frontend dependencies через npm ci и npm --prefix frontend ci.
Linux install script: bash scripts/cloud-setup.sh.
Проверь frontend/root build и python3 scripts/validate-docs.py.
Start skill: npm start с NODE_ENV=development, DATA_DIR=.local-data/cloud,
PORT=3100 и локальным APP_ORIGIN; health /api/health, интерфейс /v2/.
Проверки тестов — только отдельным поручением; исходная suite содержит
известные устаревшие сценарии. Не исправляй их при настройке среды.
Проверь браузер и внешний preview origin: APP_ORIGIN должен совпадать с его URL.
Нужен Chromium для UI-проверок; при отсутствии системных библиотек установи
зависимости Playwright в среде. LUMA_INSTALL_BROWSER=0 допустимо только если
браузер уже предоставлен средой или сейчас нужен лишь backend-проход.
База только .local-data/cloud внутри checkout, production credentials не нужны.
Пустой каталог/кабинет — ожидаемое состояние свежей базы.
Не загружай рабочую базу, SSH-ключи, env production, клиентские фото/сеансы.
Не меняй приложение или тесты в рамках настройки среды и не выпускай сайт.
Найденные ограничения фиксируй карточками; UI-концепция неизменна.
Дай отчёт установки, проверок и открытых ограничений перед Publish.
```

## Локальные переменные перед запуском

На Linux/cloud задать в настройках среды либо перед стартом:

```sh
export NODE_ENV=development
export DATA_DIR="$PWD/.local-data/cloud"
export PORT=3100
export APP_ORIGIN=http://localhost:3100
unset YANDEX_CLIENT_ID YANDEX_CLIENT_SECRET VK_CLIENT_ID VK_SERVICE_TOKEN
unset TELEGRAM_CLIENT_ID TELEGRAM_CLIENT_SECRET DADATA_API_KEY DADATA_SECRET_KEY
export PROMOTIONS_ENABLED=0
npm start
```

На Windows эквивалентные локальные переменные задаются через `$env:...` в PowerShell. Не применять серверный .env.example без замены production defaults. Если открывается внешний preview URL, APP_ORIGIN задаётся именно этим URL. Это настройка среды, не изменение server.mjs.

## Что сохраняет контекст

В репозитории AGENTS, [карточки/реестр](tasks/README.md), [UI-журнал](V2_UI_REFERENCE_IMPLEMENTATION.md), исходные PNG/уточнения, навыки и RELEASE. Проверка Linux использует `npm`, `python3`, относительные пути от checkout. Исторические Windows-пути внутри старых доказательств не использовать как рабочие команды.

У текущей cloud-среды install script и start skill могут быть записаны самой настройкой после проверки; готовый скрипт проекта помогает воспроизвести установку, но не заменяет её отчёт. Источник: [официальные installation/startup и publish](https://learn.chatgpt.com/docs/environments/cloud-environments).

Не путать с legacy Codex Cloud, у которого отдельные setup/maintenance правила. Текущий guide говорит о опубликованной подготовленной среде и изолированных рабочих пространствах задач. Сохранённое состояние cloud не заменяет Git: важные изменения коммитить/отправлять и обновлять проектную документацию.

## Сеть, ключи и выпуск

Для установки нужны npm/package-manager downloads и Chromium, если он устанавливается. Для самого пустого локального приложения не нужны OAuth/DaData/production SSH. Карта/тайлы требуют разрешённого сетевого доступа для визуального прохода; их блокировка не означает отсутствие функции в коде.

Если позже требуется внешний сервис, согласовать отдельный test credential/домен и настройки среды. Текущая официальная cloud-модель различает environment variables и network secrets; не переносить автоматически устаревшее правило legacy «секреты доступны только setup» на нынешнюю среду. Приватные значения не коммитить.

Production-выпуск остаётся отдельным действием: сверка версии/данных/разрешения и резервная копия. Cloud-agent не имеет производственных реквизитов по умолчанию и не должен искать их в чужих чатах/локальных каталогах.

## Запрос для согласованной полной копии OPS-04

Для текущего выбора пользователя применить вместо запроса пустой среды:

```text
Настрой private Only me среду Luma Beauty из AppCreator-sudo/luma-beauty.
Прочитай AGENTS.md, docs/CLOUD_SERVER_ACCESS.md и текущий checkpoint.
Пользователь 14.10.2026 разрешил полную рабочую копию с реальными данными.
Запроси LUMA_PRIVATE_BUNDLE_KEY через персональные настройки среды;
значение вводится там, не в чат/файлы репозитория.
Установи Node.js 22.22.2, Python 3 и зависимости: bash scripts/cloud-setup.sh.
Запусти node scripts/cloud-private.mjs verify, затем restore и prepare-dev.
Эти команды выполняются один раз; существующий результат не перезаписывать.
Локальный runtime DATA_DIR=$PWD/.local-data/cloud-dev, NODE_ENV=development,
PORT=3100, APP_ORIGIN совпадает с preview URL. Production.env не подключать.
Исходный полный cloud-source не изменять; рабочая копия исключает живые
сеансы/push-подписки и production VAPID. Личные данные не коммитить.
Проверь integrity/FK, health /api/health и /v2/.
Серверная учётная запись пока не активирована: не обходи отказ, не используй
root-пароль и не устанавливай привилегии без зафиксированного разрешения.
После активации проверить node scripts/cloud-server.mjs status из этой среды.
Текущая настройка не разрешает правки приложения/tests/UI или выпуск.
Дай отчёт фактических проверок перед Publish.
```
