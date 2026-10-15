# Простой салон — приёмка рабочего выпуска

Опубликовано **2026-10-15T20:50:16+07:00**. [Release/backup/ограничения отката](../../RELEASE_20261015_SALON_SIMPLICITY.md).

- [Manifest и исходная версия](package-manifest.json): хеши 118 файлов, `index-CbdQYBIA.js`, SW `luma-v2-shell-20261015-v2-salon-simplicity`.
- [Preflight свежей рабочей копии](preflight-result.json): 30 API проверок; 42 прежние таблицы / 146 строк сохранены после исключения сеансов/pushes из тестовой копии.
- [Публикация](release-result.json): 42 таблицы / 151 строка сохранены в рабочем offline-переходе до запуска; schema match с копией, media preserved, 29 GET API проверок.
- [Browser](production-report.json): 16 PASS, 1440/390/320 px, JS errors0, blocked writes0. Проверка только GET/HEAD, без изменения бизнес-данных. Временный сеанс владельца удалён.
- [Финальный аудит](server-audit.json): active/health, 118 хешей, integrity/FK, закрытая резервная копия, QA access removed.

| Опубликованный экран | Desktop 1440 | Mobile 390 | Mobile 320 |
| --- | --- | --- | --- |
| Прайс | [1440](services-1440.png) | [390](services-390.png) | [320](services-320.png) |
| Редактор услуги | [1440](service-editor-1440.png) | [390](service-editor-390.png) | [320](service-editor-320.png) |
| Мастера | [1440](masters-1440.png) | [390](masters-390.png) | [320](masters-320.png) |
| Рабочие графики | [1440](schedule-1440.png) | [390](schedule-390.png) | [320](schedule-320.png) |
| Работы автора | [1440](works-1440.png) | [390](works-390.png) | [320](works-320.png) |
| Публичный салон | [1440](public-salon-1440.png) | [390](public-salon-390.png) | [320](public-salon-320.png) |
| Выбор времени до контакта | [1440](booking-contact-1440.png) | [390](booking-contact-390.png) | [320](booking-contact-320.png) |

Приёмка не отправляла заявки и не создавала услуги/профили в production. Контакты клиентов, секреты и действующие токены в этих отчётах отсутствуют. Старые несовпадающие условия не объединялись; одна прежняя услуга без однозначного направления требует уточнения владельцем в общем прайсе.
