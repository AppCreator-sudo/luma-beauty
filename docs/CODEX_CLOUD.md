# Luma Beauty — подготовка Codex Cloud

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
