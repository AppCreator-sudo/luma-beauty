# Мобильная полировка UI, шапка кабинета клиента, подвал карты и компактный лейаут — выпуск 19.10.2026

**Опубликовано 2026-10-19T15:20:00+07:00, Asia/Novosibirsk**, по прямому поручению пользователя «пуш всё на сервер и в гитхаб» и задачам полировки мобильной версии и верстки подвала. [Главная страница каталога](https://atelie-13-143-66-1.sslip.io/v2/).

Current `/opt/atelie/releases/20261019-v2-mobile-ui-polish`, frontend `index-DyOCGIwq.js`, SW `luma-v2-shell-20261019-v2-mobile-ui-polish`. Предыдущая версия `20261019-v2-stories-ui-polish` сохранена.

## Изменения

1. **Устранение лага размытия фона мобильного бокового меню**:
   - В `frontend/src/menu-overlay.css` удален статичный `::backdrop` с задержкой закрытия. Размытие перенесено в анимированный слой `.luma-menu-scrim` (`-webkit-backdrop-filter: blur(5px); backdrop-filter: blur(5px);`), закрывающийся синхронно за 180ms.
2. **Устранение дублирующей кнопки меню в кабинете клиента на desktop**:
   - В `frontend/src/client-cabinet.css` добавлено скрытие кнопки мобильного меню (`.client-cabinet .cabinet-menu-toggle { display: none }`) на экранах шире 800px. Теперь на десктопе отображается только постоянная левая боковая панель, как в кабинетах мастеров и салонов.
3. **Добавление подвала в раздел «Карта»**:
   - В `frontend/src/components/Shell.tsx` снято исключение для карты, `<footer className="site-footer public-reference-footer">` теперь отображается на `/map`.
   - В `frontend/src/map-viewport.css` настроен режим просмотра списком: `.map-reference-main:has(.map-list-view) { height: auto }` и `.map-list-view .map-sidebar { height: auto; overflow: visible }`, обеспечивающие естественную прокрутку страницы вниз к подвалу.
4. **Уменьшение габаритов подвала (компактный лейаут без уменьшения шрифтов)**:
   - В `frontend/src/styles.css`, `frontend/src/public-page-identity.css`, `frontend/src/catalog-reference.css`, `frontend/src/brand.css`: вертикальные отступы подвала сокращены с 56px до 20px (desktop) и 16px (mobile).
   - Убран устаревший нижний отступ 95px на mobile.
   - Мобильный подвал реорганизован в 2-колоночную сетку: логотип и слоган слева, 4 навигационные ссылки справа в 2 столбца, копирайт снизу. Высота мобильного подвала снизилась с 240px+ до ~168px без уменьшения размеров шрифтов.

## Проверки и сохранность

Локально:
- Playwright E2E: проверены высоты подвала (desktop ~109px, mobile ~168px), отсутствие дублирующей кнопки меню в кабинете клиента, наличие подвала на `/map` в режиме карты и списка.
- Frontend сборка `npm.cmd --prefix frontend run build` PASS.
- Корневая сборка `npm.cmd run build` PASS.
- Валидация документации `python scripts/validate-docs.py` PASS.

На сервере:
- [Manifest](ui-checks/2026-10-19-mobile-ui-release/package-manifest.json): 146 файлов, SHA256 архива `2bbfb1cc7da50c839886b93d4d1208c4980d0f65c152322c6cf11ae48ca74eb4`.
- [Preflight](ui-checks/2026-10-19-mobile-ui-release/preflight-result.json): свежая серверная копия, 46 исходных таблиц сохранены, 10 GET-проверок PASS; изолированный процесс остановлен, копия удалена.
- [Publish](ui-checks/2026-10-19-mobile-ui-release/publish-result.json): свежая резервная копия и атомарный switch сохранили 46 таблиц на момент переключения, shared inode, сеансы и медиа.
- [Audit](ui-checks/2026-10-19-mobile-ui-release/audit-result.json): active/health ok, 146 хешей файлов проверены, integrity/FK PASS. База и uploads не заменялись локальной копией.
- Live URL `https://atelie-13-143-66-1.sslip.io/v2/` 200 OK, `index-DyOCGIwq.js` подтверждён, SW tag `20261019-v2-mobile-ui-polish` активен.

## Backup и откат

Закрытая резервная копия `/opt/atelie/backups/20261019-v2-mobile-ui-polish/`: `atelie.sqlite`, свежий `pre-switch.sqlite`, `files.tar.gz` с uploads/vapid, env и служебные manifest/results.

Совместимый откат: остановить `atelie`, атомарно вернуть current на `/opt/atelie/releases/20261019-v2-stories-ui-polish`, запустить службу и проверить health/версию. Сохранять текущие shared БД/uploads и новые действия пользователей. Откат не понадобился.
