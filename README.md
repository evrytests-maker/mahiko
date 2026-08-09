<div align="center">
  <img src="build/icon.svg" width="104" height="104" alt="Логотип mahiko" />
  <h1>mahiko</h1>
  <p><strong>Desktop-интерфейс для OMP: модели, инструменты, reasoning и рабочее пространство — без постоянного переключения в терминал.</strong></p>
  <p>
    <a href="#статус-проекта"><img src="https://img.shields.io/badge/status-beta-f59e0b?style=flat-square" alt="Статус: beta" /></a>
    <a href="omp.lock.json"><img src="https://img.shields.io/badge/OMP-17.2.9-111827?style=flat-square" alt="OMP 17.2.9" /></a>
    <a href=".github/workflows/build-linux.yml"><img src="https://img.shields.io/github/actions/workflow/status/evrytests-maker/mahiko/build-linux.yml?branch=main&amp;label=Linux&amp;style=flat-square" alt="Статус сборки Linux" /></a>
    <a href=".github/workflows/build-windows.yml"><img src="https://img.shields.io/github/actions/workflow/status/evrytests-maker/mahiko/build-windows.yml?branch=main&amp;label=Windows&amp;style=flat-square" alt="Статус сборки Windows" /></a>
  </p>
  <p>
    <a href="#быстрый-старт">Быстрый старт</a> ·
    <a href="#первый-запуск">Первый запуск</a> ·
    <a href="#возможности">Возможности</a> ·
    <a href="#безопасность-и-данные-omp">Безопасность</a> ·
    <a href="#разработка">Разработка</a>
  </p>
</div>

> [!WARNING]
> mahiko находится в стадии beta. Интерфейс, локальные настройки и состав пакетов ещё могут меняться. Не храните единственную копию важных данных в beta-приложении.

## Что это

mahiko — Electron-клиент для [OMP](https://github.com/can1357/oh-my-pi), рассчитанный на повседневную работу с coding-моделями через графический интерфейс.

Это не отдельный AI-бэкенд и не имитация терминального агента. mahiko запускает настоящий OMP-процесс в RPC-режиме и показывает полученное от него состояние: поток ответа, reasoning, вызовы инструментов, модели, контекст и ошибки.

| mahiko отвечает за | OMP отвечает за |
| --- | --- |
| интерфейс, окна, проекты и управление сессией | модели, провайдеры и выполнение агентного цикла |
| отображение потока, инструментов и ошибок | RPC-события, tool calls и состояние контекста |
| безопасный запуск совместимого процесса | авторизацию и взаимодействие с API провайдера |

Проект поддерживает только официальную закреплённую версию **OMP 17.2.9**. Несовместимый бинарник не запускается в RPC-режиме.

## Быстрый старт

### Из исходников

Нужны Node.js 22, npm и доступ к сети для первой установки закреплённой CLI-версии OMP.

```bash
git clone https://github.com/evrytests-maker/mahiko.git
cd mahiko
npm ci
npm run typecheck
npm test
npm run build:source
npm start
```

`build:source` собирает только Mahiko и не загружает OMP. При первом запуске приложение после явного согласия запускает закреплённый официальный installer OMP 17.2.9.

### Готовая сборка

Когда опубликованный релиз доступен, скачайте подходящий файл на странице [GitHub Releases](https://github.com/evrytests-maker/mahiko/releases). Если страница пуста, используйте сборку из исходников выше.

| Платформа | Артефакт | Запуск |
| --- | --- | --- |
| Windows x64 | `mahiko-<version>-x64-setup.exe` | Запустите мастер установки. |
| Debian / Ubuntu x64 | `mahiko-<version>-amd64.deb` | `sudo apt install ./mahiko-<version>-amd64.deb` |
| Fedora / RHEL x64 | `mahiko-<version>-x86_64.rpm` | `sudo dnf install ./mahiko-<version>-x86_64.rpm` |
| Linux x64 | `mahiko-<version>-x86_64.AppImage` | Выдайте файлу право на запуск и откройте его. |
| Linux x64, архив | `mahiko-<version>-x64.tar.gz` | Распакуйте архив и запустите `mahiko`. |

Готовые пакеты не содержат OMP. При отсутствии совместимой CLI-версии Mahiko предлагает запустить официальный installer OMP 17.2.9. macOS и ARM пока не поддерживаются. Windows может показать SmartScreen: установщик проекта не имеет коммерческой подписи.

## Первый запуск

Настройка проходит в два явных этапа — mahiko ничего не устанавливает и не авторизует без согласия.

### 1. Проверка OMP

Приложение ищет локальный `omp` или `omp.exe` и предлагает одно из действий:

- запустить официальный installer OMP 17.2.9 в режиме binary, если совместимая CLI не найдена;
- использовать уже установленный совместимый `omp` без изменений;
- выйти, не меняя систему.

Installer закреплён на теге `v17.2.9`. Linux устанавливает CLI в `$HOME/.local/bin/omp`, Windows — в `%LOCALAPPDATA%\omp\omp.exe` и добавляет каталог в пользовательский `PATH`. Перед запуском installer существующий целевой executable резервируется; после установки Mahiko проверяет точный вывод `omp/17.2.9` и SHA-256, а при ошибке восстанавливает прежний файл. Системные `/usr/bin`, `/usr/local/bin`, `Program Files` и пакетный менеджер не изменяются.

### 2. Подключение провайдера

После проверки OMP открывается настройка подключений. Вход и регистрация проходят через реальный login-flow OMP; OAuth, CAPTCHA, MFA и согласие провайдера завершаются в системном браузере.

Вернуться к настройке позже можно через раздел **«Подключения»**.

## Возможности

### Чат и контекст

- потоковая выдача ответа и отдельное отображение provider-visible reasoning;
- каталог моделей и доступные уровни thinking непосредственно из OMP;
- остановка запуска кнопкой или клавишей `Esc`;
- повтор запуска, копирование активности, ручное и автоматическое сжатие контекста.

### Инструменты и workbench

- живой поток tool calls со статусами запуска, успеха, ошибки и отмены;
- выбор проекта и ограниченный просмотр его файлов;
- terminal workbench с лимитами времени и объёма вывода;
- browser workbench с навигацией и перезагрузкой;
- интерактивные запросы OMP: `select`, `input`, `editor` и `confirm`.

### Провайдеры и аккаунты

- вход и регистрация через поддерживаемые OMP flow;
- локальные account pools для подключённых OMP-аккаунтов;
- Custom API-провайдеры с проверкой конфигурации и модели;
- перезапуск управляемого RPC-клиента после смены активного пула.

mahiko не приводит все модели к одной шкале reasoning. Интерфейс использует возможности, объявленные выбранной моделью через OMP. Подробнее: [docs/thinking-models.md](docs/thinking-models.md).

## Как это работает

```text
React renderer
      │ typed IPC через изолированный preload
      ▼
Electron main process
      │ OMP RPC protocol v2
      ▼
Pinned OMP 17.2.9
      │ provider API / local model
      ▼
Выбранный провайдер
```

Сначала mahiko пробует `--mode rpc-ui` и protocol v2. Переход к `--mode rpc` происходит только при ошибке готовности предпочтительного режима. Промпт отправляется исключительно после явного действия пользователя, а интерфейс отображает наблюдаемое состояние вместо фиктивных успешных ответов.

Связь элементов интерфейса с backend-действиями описана в [docs/control-matrix.md](docs/control-matrix.md).

## Безопасность и данные OMP

Главное правило: **mahiko запускает официальный installer только для пользовательской CLI `omp` / `omp.exe`**. История, аккаунты, профили и конфигурация не входят в операцию установки. Поэтому Mahiko и терминальная команда `omp` работают с общими сессиями и аккаунтами.

| Данные | Типичное расположение | Поведение mahiko |
| --- | --- | --- |
| Каталог OMP | `~/.omp` / `%USERPROFILE%\.omp` | Не удаляется и не перемещается. |
| Авторизация и настройки | `agent.db`, `config.yml` | Не копируются в репозиторий или пакет. |
| Сессии и история | `sessions`, `history.db`, `blobs` | Сохраняются при замене бинарника. |
| Проектная конфигурация | `<project>/.omp` | Остаётся внутри проекта. |
| Linux CLI | `$HOME/.local/bin/omp` | Устанавливается официальным installer после согласия. |
| Windows CLI | `%LOCALAPPDATA%\omp\omp.exe` | Устанавливается официальным installer; каталог добавляется в пользовательский `PATH`. |
| Пользовательский путь | `PI_CODING_AGENT_DIR` | Считается внешним каталогом данных. |

Дополнительные границы:

- OMP принимается только при точном совпадении версии и контрольной суммы;
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`;
- внешние provider URL открываются только по HTTPS;
- токены и чувствительные поля рекурсивно редактируются в диагностике;
- credentials, sessions и provider state не вендорятся вместе с mahiko.

Полный аудит путей и rollback-механизма: [docs/omp-data-safety.md](docs/omp-data-safety.md).

## Статус проекта

Текущая версия — beta со следующими ограничениями:

- поддерживаются Linux x64 и Windows x64;
- формат внутренних настроек может измениться до стабильного релиза;
- системный OMP в `/usr/bin`, `/usr/local/bin` или `Program Files` автоматически не заменяется;
- CAPTCHA, MFA и provider consent намеренно не автоматизируются;
- функции OMP без безопасного RPC-контракта остаются недоступными вместо имитации результата;
- нативные пакеты окончательно проверяются на целевой ОС, а не только кросс-сборкой.

Проблемы и предложения: [GitHub Issues](https://github.com/evrytests-maker/mahiko/issues).

## Разработка

### Основные команды

| Команда | Назначение |
| --- | --- |
| `npm run dev` | Vite и Electron в режиме разработки |
| `npm run typecheck` | проверка TypeScript для renderer, main и preload |
| `npm test` | unit-, renderer- и process-contract тесты |
| `npm run build` | production-сборка приложения |
| `npm run build:source` | production-сборка Mahiko без загрузки OMP |
| `npm run check:omp` | проверка версии и готовности OMP без отправки промпта |
| `npm run verify:omp-live` | ограниченная live-проверка RPC, stream, tools, cancel и restart |

### Упаковка

```bash
# Linux: AppImage, deb, rpm и tar.gz
npm run dist:linux

# Windows x64: NSIS installer
npm run dist:windows
```

Подробные инструкции: [Linux](docs/linux-build.md) · [Windows](docs/windows-build.md).

### Структура репозитория

```text
src/main/       Electron lifecycle, OMP runtime, RPC и IPC
src/preload/    изолированный типизированный bridge
src/renderer/   React-интерфейс и поток наблюдаемой активности
src/shared/     общие контракты, defaults и редактирование диагностики
scripts/        проверка и live-верификация OMP
build/          иконки и настройка NSIS
docs/           безопасность, упаковка, reasoning и control matrix
```

## Диагностика

Если приложение сообщает о несовместимом OMP, начните с проверки без промпта:

```bash
npm run check:omp
```

Затем убедитесь, что:

1. доступен OMP `17.2.9`;
2. бинарник разрешён к исполнению;
3. `PI_CODING_AGENT_DIR`, если задан, указывает на доступный каталог;
4. провайдер подключён через OMP;
5. выбранная модель поддерживает запрошенный уровень reasoning.

## OMP и лицензия

OMP разработан проектом [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) и распространяется авторами под лицензией MIT. Репозиторий и пакеты mahiko не содержат исполняемых файлов OMP; после явного согласия приложение загружает официальный asset в собственный user-data каталог.

mahiko не является официальным интерфейсом OMP. Версия, URL релизных файлов и контрольные суммы зафиксированы только в [`omp.lock.json`](omp.lock.json).
