# Englify — сайт для изучения английского с ИИ

Упражнения генерирует ИИ. По умолчанию используется **Pollinations.ai** — бесплатный API без ключа и регистрации; альтернативно можно включить **Claude Code CLI** (работает по подписке Claude, тоже без API-ключа). Вход через Google, Premium-подписка через DonationAlerts, дизайн в стиле Google Material.

## Запуск

```bash
cd englify
npm install
npm start
# → http://localhost:3000
```

Требования: Node.js 18+. (Claude Code нужен только если выбран провайдер `claude`, см. ниже.)

Пока Google Client ID не настроен, на сайте доступен **тестовый вход** (кнопка «Войти (тестовый режим)») — можно сразу пользоваться и проверять генерацию.

## Настройка (config.json)

Скопируйте `config.example.json` → `config.json` и заполните нужные поля. Всё опционально: без конфига сайт работает в тестовом режиме.

### 1. Вход через Google

1. Откройте [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials).
2. Create Credentials → **OAuth client ID** → тип **Web application**.
3. В *Authorized JavaScript origins* добавьте `http://localhost:3000` (и ваш домен, если есть).
4. Скопируйте Client ID в поле `googleClientId` в `config.json`, перезапустите сервер.

После этого тестовый вход автоматически отключается, остаётся только Google.

### 2. Платная подписка через DonationAlerts

Как это работает: у каждого пользователя есть личный код вида `EN-A1B2C3`. Он отправляет донат с этим кодом в сообщении, сервер раз в 1,5 минуты проверяет донаты через DonationAlerts API и активирует Premium на 30 дней.

1. Зайдите на [donationalerts.com/application/clients](https://www.donationalerts.com/application/clients) и создайте приложение:
   - Redirect URI: `http://localhost:3000/api/da/callback` (или ваш домен).
2. Впишите в `config.json`: `daClientId`, `daClientSecret`, `daDonateUrl` (ссылка на вашу страницу доната, например `https://www.donationalerts.com/r/ваш_ник`).
3. Впишите свой email в `adminEmails`, войдите на сайт через Google этим аккаунтом.
4. Откройте `http://localhost:3000/api/da/connect` — один раз авторизуйтесь в DonationAlerts. Готово.

Цена и длительность: `premiumPriceRub` (по умолчанию 199 ₽) и `premiumDays` (30 дней). Проверяется только валюта RUB; донат в другой валюте с кодом тоже активирует подписку.

Выдать Premium вручную (от имени администратора):

```bash
curl -X POST http://localhost:3000/api/admin/grant -H "Content-Type: application/json" \
  -H "Cookie: <ваша сессия>" -d "{\"email\":\"user@gmail.com\",\"days\":30}"
```

### 3. Генерация заданий (ИИ)

Провайдер выбирается полем `aiProvider` в `config.json`:

- **`auto`** (по умолчанию) — сначала пробует локальную Ollama, если её нет — Pollinations.
- **`ollama`** — локальный ИИ [Ollama](https://ollama.com): бесплатно, без лимитов, без интернета и блокировок. Установка: `winget install Ollama.Ollama`, затем `ollama pull qwen2.5:3b`. Модель настраивается полем `ollamaModel`.
- **`pollinations`** — [Pollinations.ai](https://pollinations.ai), бесплатный веб-API без ключа и регистрации. ⚠️ Хостится на CloudFront, который у некоторых российских провайдеров блокируется.
- **`claude`** — Claude Code CLI (`claude -p`) по вашей подписке Claude. Требуется установленный и залогиненный Claude Code. Модель — поле `claudeModel` (`sonnet`/`haiku`/`opus`).

Готовые упражнения складываются в пул (`data/db.json`), пачками по 6. Пока пул пуст, показываются встроенные базовые задания.

## Что внутри

- Типы заданий: тест, пропуски, перевод (с ИИ-проверкой свободного варианта), конструктор предложений, аудирование (озвучка браузером).
- Уровни A1–C1, XP, стрики, точность, дневной лимит для бесплатного плана (`freeDailyLimit`).
- Хранилище — простой JSON-файл `data/db.json` (создаётся автоматически).

## ⚠️ Важно про провайдер `claude`

Режим `aiProvider: "claude"` использует вашу личную подписку Claude. По условиям Anthropic она предназначена для личного использования — **перепродавать доступ к генерации третьим лицам нельзя**. Для публичного сервиса используйте `pollinations` (по умолчанию) или Claude API с API-ключом.
