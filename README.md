<div align="center">
  <img src="build/icon.svg" width="112" height="112" alt="mahiko logo" />
  <h1>mahiko</h1>
  <p><strong>Графический интерфейс для OMP — модели, инструменты, reasoning и рабочее пространство в одном desktop-приложении.</strong></p>

  <p>
    <a href="https://github.com/evrytests-maker/mahiko/releases/latest"><img src="https://img.shields.io/github/v/release/evrytests-maker/mahiko?display_name=tag&style=for-the-badge" alt="Latest release" /></a>
    <img src="https://img.shields.io/badge/status-BETA-f59e0b?style=for-the-badge" alt="Beta status" />
    <img src="https://img.shields.io/badge/OMP-17.2.9-111827?style=for-the-badge" alt="OMP 17.2.9" />
    <img src="https://img.shields.io/badge/platform-Linux%20%7C%20Windows-2563eb?style=for-the-badge" alt="Linux and Windows" />
  </p>

  <p>
    <a href="#установка">Установка</a> ·
    <a href="#первый-запуск">Первый запуск</a> ·
    <a href="#возможности">Возможности</a> ·
    <a href="#безопасность-данных-omp">Безопасность данных</a> ·
    <a href="#сборка-из-исходников">Сборка</a>
  </p>
</div>

> [!WARNING]
> **mahiko находится в стадии BETA.** Основные сценарии работают, но интерфейс, формат локальных настроек и состав пакетов ещё могут меняться. Не используйте beta-сборку как единственную копию критически важных данных и сообщайте о найденных проблемах через [GitHub Issues](https://github.com/evrytests-maker/mahiko/issues).

## Что такое mahiko

mahiko — Electron-оболочка над [OMP](https://github.com/can1357/oh-my-pi), ориентированная на работу с coding-моделями без необходимости постоянно находиться в терминальном интерфейсе.

Приложение запускает настоящий OMP-процесс в RPC-режиме и отображает только реально полученное состояние: поток ответа, доступное reasoning, вызовы инструментов, модели, контекст и ошибки. Скрытой симуляции ответов или фиктивных «успешных» операций нет.

В текущем релизе жёстко закреплён официальный **OMP 17.2.9**. Эта версия выбрана намеренно: mahiko проверяет номер версии и SHA-256 бинарника до установки и не запускает несовместимый OMP в RPC-режиме.

## Установка

Готовые сборки находятся на странице [GitHub Releases](https://github.com/evrytests-maker/mahiko/releases/latest).

| Система | Файл | Как запустить |
| --- | --- | --- |
| Windows x64 | `mahiko-0.1.0-x64-setup.exe` | Запустите установщик, выберите каталог и завершите мастер установки. |
| Debian / Ubuntu x64 | `mahiko-0.1.0-amd64.deb` | `sudo apt install ./mahiko-0.1.0-amd64.deb` |
| Fedora / RHEL x64 | `mahiko-0.1.0-x86_64.rpm` | `sudo dnf install ./mahiko-0.1.0-x86_64.rpm` |
| Любой современный Linux x64 | `mahiko-0.1.0-x86_64.AppImage` | `chmod +x mahiko-0.1.0-x86_64.AppImage && ./mahiko-0.1.0-x86_64.AppImage` |
| Распакованная Linux-сборка | `mahiko-0.1.0-x64.tar.gz` | Распакуйте архив и запустите `mahiko`. |

В релиз также входит `SHA256SUMS`:

```bash
sha256sum -c SHA256SUMS
```

> [!NOTE]
> Сейчас публикуются только x64-сборки для Linux и Windows. macOS и ARM пока не входят в поддерживаемую матрицу. Windows может показать предупреждение SmartScreen: проект пока не заявляет коммерческую подпись установщика.

## Первый запуск

Первоначальная настройка выполняется один раз и состоит из двух последовательных этапов.

### 1. Поиск и установка OMP

При первом запуске mahiko показывает небольшое обязательное окно **«Поиск OMP»**.

- Если OMP найден, доступны **«Заменить на версию 17.2.9»** и **«Выход»**.
- Если OMP не найден, доступны **«Установить OMP 17.2.9»** и **«Выход»**.
- Если найденный файл находится в системном каталоге, автоматическая замена блокируется: mahiko не повышает привилегии и не вмешивается в файлы системного пакетного менеджера.

Замена выполняется атомарно: новый бинарник копируется рядом с целевым файлом, проверяется, старый файл временно переименовывается, затем новая версия проверяется повторно. При ошибке предыдущий исполняемый файл восстанавливается.

### 2. Подключение провайдера

После подтверждения OMP открывается настройка провайдеров. Вход и регистрация запускаются через реальный login-flow OMP; OAuth, CAPTCHA, MFA и согласие провайдера завершаются в защищённой странице системного браузера.

После закрытия или завершения настройки её состояние сохраняется — окно провайдеров не появляется при каждом новом запуске. Позже его можно открыть вручную через **Подключения**.

## Возможности

### Общение с моделями

- потоковая выдача ответа без искусственного ожидания завершения;
- переключение моделей через фактический каталог OMP;
- управление thinking/reasoning только доступными для выбранной модели уровнями;
- отдельное отображение provider-visible reasoning без попытки раскрыть скрытые chain-of-thought данные;
- остановка текущего запуска кнопкой или клавишей `Esc`;
- повтор запуска и копирование наблюдаемой активности;
- ручное и автоматическое сжатие контекста.

### Инструменты и рабочее пространство

- поток событий инструментов с состояниями запуска, успеха, ошибки и отмены;
- выбор проекта и ограниченный просмотр его файлов;
- встроенный terminal workbench с лимитом времени и размера вывода;
- встроенный browser workbench с навигацией назад, вперёд и перезагрузкой;
- плавающие окна, изменение размеров и клавиатурное управление;
- интерактивные OMP UI-запросы: select, input, editor и confirm.

### Провайдеры и аккаунты

- список провайдеров поступает непосредственно от OMP;
- вход или регистрация через OAuth/API-key flow провайдера;
- локальные account pools для уже подключённых OMP-аккаунтов;
- добавление Custom API-провайдера с проверкой конфигурации и модели;
- автоматический перезапуск управляемого RPC-клиента после смены активного пула.

### Reasoning разных семейств

mahiko не навязывает всем моделям одинаковую шкалу «думания». Интерфейс читает нормализованные возможности из OMP и корректно отображает доступный reasoning для Gemini, Claude, DeepSeek, Kimi, GLM, MiMo, StepFun и других совместимых провайдеров. Подробности собраны в [docs/thinking-models.md](docs/thinking-models.md).

## Безопасность данных OMP

Главное правило: **mahiko заменяет только исполняемый файл `omp` или `omp.exe`**. Каталоги с чатами, аккаунтами, профилями и конфигурацией не передаются в операции удаления или замены.

| Данные | Типичное расположение | Поведение mahiko |
| --- | --- | --- |
| Основной каталог OMP | `~/.omp` / `%USERPROFILE%\.omp` | Не удаляется и не перемещается. |
| Авторизация и настройки | `~/.omp/agent/agent.db`, `config.yml` | Не копируются в репозиторий или пакет. |
| Сессии и история | `~/.omp/agent/sessions`, `history.db`, `blobs` | Сохраняются при замене бинарника. |
| Профили | `~/.omp/profiles/<name>/agent` | Не изменяются установщиком mahiko. |
| Проектная конфигурация | `<project>/.omp` | Остаётся внутри проекта. |
| Пользовательский путь | `PI_CODING_AGENT_DIR` | Учитывается как внешний каталог данных. |

Официальные standalone-пути бинарника:

- Linux и macOS: `$HOME/.local/bin/omp`;
- Windows: `%LOCALAPPDATA%\omp\omp.exe`.

В коде замены нет рекурсивного удаления. Подробный разбор путей, ограничений и rollback-механизма: [docs/omp-data-safety.md](docs/omp-data-safety.md).

## Архитектура и границы доверия

```text
React renderer
      │ typed IPC through preload
      ▼
Electron main process
      │ OMP RPC protocol v2
      ▼
Pinned OMP 17.2.9
      │ provider APIs / local models
      ▼
Selected model provider
```

Electron запускается с включённой изоляцией:

- `contextIsolation: true`;
- `sandbox: true`;
- `nodeIntegration: false`;
- HTTPS-only открытие внешних provider URL;
- рекурсивное редактирование токенов и чувствительных полей в диагностике;
- fail-closed поведение при несовпадении версии OMP;
- сначала `--mode rpc-ui` и protocol v2, затем совместимый fallback `--mode rpc` только при неготовности первого режима.

Полная связь элементов интерфейса с реальными backend-действиями описана в [docs/control-matrix.md](docs/control-matrix.md).

## Статус BETA и известные ограничения

- Поддерживаются только Windows x64 и Linux x64.
- Форматы внутренних настроек mahiko до стабильного релиза могут измениться.
- Автоматическая замена системного OMP (`/usr/bin`, `/usr/local/bin`, `Program Files`) намеренно запрещена.
- CAPTCHA, MFA и provider consent невозможно и небезопасно автоматизировать внутри приложения.
- Часть команд OMP 17.2.9 не имеет безопасного RPC-контракта; такие кнопки отображаются отключёнными с объяснением, а не имитируют результат.
- Нативная установка пакетов проверяется на соответствующей ОС; кросс-сборка сама по себе не заменяет проверку реальной установки/удаления.

## Сборка из исходников

Требуются Node.js 22, npm и сеть для первоначальной загрузки закреплённого upstream-бинарника OMP. Готовые пакеты уже содержат OMP и ничего не скачивают при обычном запуске.

```bash
git clone https://github.com/evrytests-maker/mahiko.git
cd mahiko
npm ci
npm run typecheck
npm run build:source
npm run check:omp
npm start
```

Команды упаковки:

```bash
# Linux: AppImage, deb, rpm и tar.gz
npm run dist:linux

# Windows x64: NSIS installer
npm run dist:windows
```

Перед упаковкой `scripts/vendor-omp.mjs` загружает asset из официального [релиза OMP v17.2.9](https://github.com/can1357/oh-my-pi/releases/tag/v17.2.9), сверяет размер и SHA-256, и только после этого разрешает сборку. Большие upstream-бинарники не хранятся в Git-истории.

Дополнительные инструкции:

- [Linux build and packages](docs/linux-build.md)
- [Windows build and installer](docs/windows-build.md)
- [OMP executable replacement and data safety](docs/omp-data-safety.md)
- [Thinking controls exposed through OMP](docs/thinking-models.md)

## Структура репозитория

```text
src/main/       Electron main process, OMP lifecycle and filesystem boundaries
src/preload/    isolated typed bridge exposed to the renderer
src/renderer/   React interface and observed activity stream
src/shared/     IPC contracts and diagnostic redaction
scripts/        OMP downloader, integrity checks and live verification
vendor/omp/     pinned manifest and upstream MIT license
build/          icons and NSIS customization
docs/           security, packaging, reasoning and control documentation
.github/        reproducible Linux and Windows build workflows
```

## Диагностика

Если приложение сообщает о несовместимом OMP:

```bash
npm run check:omp
```

Проверьте:

1. что используется OMP `17.2.9`;
2. что бинарник доступен для исполнения;
3. что `PI_CODING_AGENT_DIR` указывает на доступный каталог, если переменная задана;
4. что провайдер действительно подключён через OMP;
5. что выбранная модель поддерживает запрошенный уровень reasoning.

Сообщения об ошибках и предложения принимаются в [GitHub Issues](https://github.com/evrytests-maker/mahiko/issues).

## OMP и лицензирование

OMP разработан проектом [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi). mahiko распространяет неизменённые официальные бинарники OMP 17.2.9 вместе с upstream-лицензией MIT, расположенной в [`vendor/omp/LICENSE`](vendor/omp/LICENSE).

mahiko не заявляет себя официальным интерфейсом проекта OMP. Версия OMP, URL релизных файлов и контрольные суммы зафиксированы в [`omp.lock.json`](omp.lock.json) и [`vendor/omp/manifest.json`](vendor/omp/manifest.json).
