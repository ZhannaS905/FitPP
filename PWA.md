# Установка FitPP как PWA

Исправление от 19 октября 2026 года ограничено установкой приложения. CSS, бизнес-логика, Firebase, клиентские данные, посещения и оплаты не меняются.

## Причина

В версии 0daa443 не было manifest и ссылки на него; sw.js удалял собственную регистрацию, а страница только пыталась обновить уже существующий worker. В обычном профиле полного Chromium DevTools вернул `no-manifest`; событие `beforeinstallprompt` отсутствовало.

## Исправление

- manifest.webmanifest: имя FitPP, стабильный id `/FitPP/`, start_url `./`, scope `./`, display `standalone`, исходные цвета и язык ru. URL запуска не содержит временный параметр версии. id явно включает путь GitHub Pages, чтобы другие сайты на том же домене имели отдельную идентичность.
- В index.html подключён manifest и разрешён только manifest-src 'self'. Остальные ограничения CSP сохранены.
- pwa.js регистрирует ./sw.js с областью ./ и updateViaCache: none.
- Worker сохраняет регистрацию и использует только обычную сеть для навигаций внутри области приложения. Он не перехватывает Firebase/API, не кэширует код, не обращается к хранилищам или данным и не добавляет офлайн-запись. Для работы с данными по-прежнему нужен интернет.
- Оригинальные PNG с девушкой сохранены побайтово, без преобразования или обрезки. purpose: any; изображение не объявляется maskable без подготовки отдельного изображения.

SHA-256 исходных иконок:
- icon-192.png, 192×192: f091a3fa7f8d371bc200e44bc3688e3aff0852cd891e40fa3a4fd099708e2d4f
- icon-512.png, 512×512: e89fddf25f4f371568b61f3ac0782c030bd5c1b108cb0dedfba48776bf9a6da0

## Проверка

`node --test tests/pwa.cjs tests/online.cjs tests/payments.cjs tests/renewal.cjs tests/mobile-safety.cjs`: 30 проверок.

`tests/pwa-browser.cjs`: полный Chromium в отдельном обычном профиле с параметрами Pixel 7. Проверяет отсутствие ошибок DevTools, событие beforeinstallprompt, загрузку и размеры иконок, MIME manifest, стабильную идентичность независимо от ?v, активный worker после повторного запуска и сохранность существующего localStorage. Все обращения за пределы тестового origin блокируются, облачный адаптер подменяется заглушкой без входа и данных. Флаг bypass-app-banner-engagement-checks исключает задержку по вовлечённости из автоматического теста; это не обход ошибок manifest.

Для запуска нужен Playwright с полным Chromium (channel: chromium) и переменная FITPP_TEST_URL. Инкогнито не подходит для проверки предложения установки. Подключённый Android-эмулятор Pixel 6 Pro / Android 12 не содержит Chrome; фактическая установка Android WebAPK на пользовательском Pixel не проверена.

Предыдущая версия сохранена веткой backup/pwa-before-0daa443-20261019 и отдельным архивом FitPP-code-before-PWA-0daa443.tar.gz.

Официальные требования и диагностика: https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest и https://developer.chrome.com/blog/update-install-criteria .
