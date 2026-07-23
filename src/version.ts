declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '5.7.1';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Стабилизация прожитой истории';
export const APP_RELEASE_NOTES = 'Прожитая генерация закреплена полным набором сценарных проверок. Экспедиции, демография, предметы умерших, миграция сохранений и политические общины сохраняют целостность на короткой и многовековой симуляции.';
