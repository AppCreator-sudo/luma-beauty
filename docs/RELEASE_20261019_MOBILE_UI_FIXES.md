# Исправление мобильного меню, компактность карточек каталога и блокировка меню кабинета клиента на десктопе — выпуск 19.10.2026

**Опубликовано 2026-10-19T16:55:00+07:00, Asia/Novosibirsk**, по прямому поручению пользователя «да+ гитхаб». [Главная страница каталога](https://atelie-13-143-66-1.sslip.io/v2/).

Current `/opt/atelie/releases/20261019-v2-mobile-ui-fixes`, frontend `index-D89ms70a.js`, SW `luma-v2-shell-20261019-v2-mobile-ui-fixes`. Предыдущая версия `20261019-v2-mobile-ui-polish` сохранена.

## Изменения

1. **Компактизация карточек мастеров и салонов в каталоге (`catalog-reference.css`, `compact-catalog.css`)**:
   - Устранено пустое белое пространство под круглым аватаром: блок переведён с растягивающего grid на сбалансированный горизонтальный flex-ряд (аватар 72px / 64px, рядом имя мастера/салона, бейдж, локация и рейтинг). Текстовая колонка и аватар оканчиваются на одном уровне.
   - Услуги и кнопка «Записаться» расположены снизу на всю ширину карточки через тонкий аккуратный разделитель.
2. **Полное отключение выезжающего меню в кабинете клиента на десктопе (`client-cabinet.css`, `ClientCabinet.tsx`, `menu-overlay.css`)**:
   - На экранах >800px кнопка открытия бокового меню скрыта (`display: none !important`), оставлена постоянная левая боковая панель в точности как в кабинетах мастеров и салонов.
   - Шторка заблокирована на уровне CSS (`@media(min-width:801px) { .luma-menu-drawer { display: none !important; } }`) и автоматически закрывается при ресайзе в десктоп.
3. **Устранение пиксельного сдвига и задержки размытия фона мобильного меню (`menu-overlay.css`, `public-reference.css`, `MenuOverlay.tsx`)**:
   - Устранено наложение не совпадающего по размеру клона кнопки: геометрия и субпиксельные координаты кнопки открытия и закрытия приведены к строгому соответствию (`44×44 px`, `border: 1px solid #c7b695`, `border-radius: 50%`, `box-sizing: border-box`).
   - Кнопка закрытия в боковой шторке кабинета зафиксирована внутри шапки шторки (`position: absolute; top: 16px; right: 16px;`).
   - Устранён лаг размытия фона: тяжелый `backdrop-filter: blur(5px)` снят с анимируемого по прозрачности слоя `.luma-menu-scrim` и зафиксирован на статичном `::backdrop`, шторка и подложка закрываются синхронно и плавно на 60fps.
   - Обеспечен надёжный возврат фокуса на кнопку открытия при закрытии меню во всех режимах, включая prefers-reduced-motion.

## Проверки и сохранность

Локально:
- Набор тестов `scripts/verify-menu-motion.mjs`: 38 проверок из 38 PASS (auth, home, client, narrow, desktop, reduced-motion; 0 frame drops, 0 scroll-lock leaks).
- Сборка фронтенда `npm.cmd --prefix frontend run build` PASS.
- Корневая сборка `npm.cmd run build` PASS.
- Документация `python scripts/validate-docs.py` PASS.

На сервере:
- [Manifest](ui-checks/2026-10-19-mobile-ui-fixes/package-manifest.json): 146 файлов, SHA256 архива `e46d7a587490bf9110b08abd16b53eddeb1171f35f1ad42acfb5b113fcd77347`.
- [Preflight](ui-checks/2026-10-19-mobile-ui-fixes/preflight-result.json): свежая копия базы, 46 исходных таблиц сохранены, 10 GET-проверок PASS.
- [Publish](ui-checks/2026-10-19-mobile-ui-fixes/publish-result.json): атомарное переключение current на `20261019-v2-mobile-ui-fixes`, 46 таблиц сохранены, shared inode и медиа интактны.
- [Audit](ui-checks/2026-10-19-mobile-ui-fixes/audit-result.json): active/health ok, 146 файлов проверены, shared DB intact.

## Backup и откат

Резервная копия `/opt/atelie/backups/20261019-v2-mobile-ui-fixes/`: `atelie.sqlite`, `pre-switch.sqlite`, env и служебные файлы. Совместимый откат: остановить службу, вернуть current на `/opt/atelie/releases/20261019-v2-mobile-ui-polish`, запустить службу.
