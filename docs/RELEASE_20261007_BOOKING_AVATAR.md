# Круглый аватар салона при записи — 7 октября 2026

Опубликовано 22:03:09 Новосибирск / 15:03:09 UTC. Frontend `20261007-v2-booking-avatar`, серверная основа `20261007-v2-inspiration-visibility`. Предыдущий frontend `20261007-v2-profile-motion`; резервная копия `/opt/atelie/backups/20261007-v2-booking-avatar`. PWA кэш `atelie-v2-shell-20261007-booking-avatar`.

В `frontend/src/salon-visual.css` только два booking-правила: `.salon-booking .summary-master .salon-mark` и его `img` получили `border-radius:50%`. Размер 54×54, padding 7 px и contain сохранены. Другие аватары, анимации, API/схема/данные не менялись.

TypeScript/Vite и синтаксис SW прошли. Выпуск проверил frontend-only пакет, хеш, HTML/JS/CSS/SW по HTTP, health ok и active; без перезапуска. На опубликованной странице `/v2/s/saloon/book` браузер подтвердил загруженную фотографию, внешний размер54×54 и радиус50% у рамки/изображения; снимок блока просмотрен. Только чтение, без заполнения формы или записей. Новые тесты/широкий прогон не создавались для двух косметических правил.

Старые хешированные ресурсы и index.html/sw.js/frontend-release.txt сохранены для отката. Локальный исходник `salon-visual.css` до правки в `.cache/booking-avatar-source-before/`. Подготовлен `.cache/rollback-booking-avatar.sh`, восстанавливающий предыдущий frontend с проверкой текущего маркера; не запускался.
