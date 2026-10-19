# Документация Luma Beauty

Последний подтверждённый выпуск — [20261018-v2-auth-upload-stability](RELEASE_20261018_AUTH_UPLOAD_STABILITY.md): BUG-013…018 опубликованы, [production11/11](ui-checks/2026-10-18-auth-upload-release/README.md). [Стабильность входа96/96](ui-checks/2026-10-18-auth-stability/README.md), портфолио115+16/9HTTP. Следующая [BUG-019](tasks/BUG-019.md), проверка мобильного бокового меню; затем [U-10-06](tasks/U-10-06.md), только PushButton. [Остаточная матрица](V2_REMAINING_UI_AUDIT.md).

Актуализировано 14.10.2026 (Asia/Novosibirsk). Начать с инструкции и одной карточки, не со всех старых планов.

| Что нужно | Документ |
| --- | --- |
| Контекст/роли/навыки/алгоритм чата | [NEW_CHAT_GUIDE](NEW_CHAT_GUIDE.md), [AGENTS](../AGENTS.md) |
| Первая доступная задача | [WORK_CHECKPOINT](WORK_CHECKPOINT.md) |
| Отдельные задачи/статусы/зависимости/даты | **[tasks/README](tasks/README.md)**, [registry](tasks/registry.json) |
| Крупные этапы | [PROJECT_ROADMAP](PROJECT_ROADMAP.md) |
| Факты последнего выпуска | [CURRENT_STATE](CURRENT_STATE.md) |
| Точный макет/реализованный компонент | [V2_UI_REFERENCE_IMPLEMENTATION](V2_UI_REFERENCE_IMPLEMENTATION.md) |
| Старые планы/снимки, только история | [Архив](archive/README.md) |

## Спецификации и доказательства

- Роли/кабинеты: [мастер](V2_CABINET_UX.md), [владелец салона](V2_SALON_OWNER_FLOW.md), [совместимость салонов](V2_SALONS.md).
- Клиент: [согласования](V2_CLIENT_CABINET_REFERENCE_AUDIT.md), [выпуск](RELEASE_20261011_CLIENT_CABINET_REFERENCE.md), [QA](ui-checks/2026-10-11-client-cabinet/README.md).
- Карта/адрес: [карта](V2_MAP.md), [геоархитектура](V2_GEO_ARCHITECTURE.md), [адреса](V2_ADDRESSES.md), [целевая форма](V2_ADDRESS_FORM.md).
- Вход/навигация: [вход](V2_AUTH.md), [Back/меню](V2_NAVIGATION_AUTH_REFERENCE.md).
- Будущие изменения, не готовый код: [PostgreSQL](V2_POSTGRES_MIGRATION.md), [чат](V2_CHAT.md), [продвижение](V2_PROMOTIONS.md), [монетизация](MONETIZATION.md), [Telegram](TELEGRAM_NOTIFICATIONS.md). Начало — по F-карточкам/согласованию.
- RELEASE_*.md, исходные PNG/manifest, ui-checks — датированные доказательства. Старые обследования внутри спецификаций не очередь.

Приватные SSH/конфигурационные файлы и fixtures не входят в индекс и не нужны новому чату для ориентирования. Не выводить их содержимое.

Для переноса и старта в облаке: [CODEX_CLOUD](CODEX_CLOUD.md). Код/tests сейчас сохраняются; дальнейшие изменения только отдельными задачами по утверждённому UI.

[Факты подготовки GitHub и открытые условия](TRANSFER_20261014.md).
