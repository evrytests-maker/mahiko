export const slashCommands = [
  ["/models", "Выбрать модель OMP"],
  ["/settings", "Открыть настройки приложения"],
  ["/session", "Показать реальные файлы проекта"],
  ["/context", "Проверить окно контекста OMP"],
  ["/compact", "Сжать текущую OMP-сессию"],
  ["/login", "Открыть подключение провайдера"],
  ["/tools", "Открыть локальный терминал"],
] as const;

export const settingsTabs = [
  ["Appearance", "VI", "Вид"],
  ["Model", "MO", "Модель"],
  ["Interaction", "IN", "Управление"],
  ["Context", "CO", "Контекст"],
  ["Memory", "ME", "Память"],
  ["Files", "FI", "Файлы"],
  ["Shell", "SH", "Терминал"],
  ["Tools", "TO", "Инструменты"],
  ["Tasks", "TA", "Задачи"],
  ["Providers", "PR", "Провайдеры"],
  ["Plugins", "PL", "Плагины"],
] as const;
