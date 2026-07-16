declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.3.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Физическое население';
export const APP_RELEASE_NOTES = 'Люди и животные занимают отдельные клетки, глобальные популяции раскладываются на локальной карте по отдельным особям, природные ресурсы распределяются несколькими участками, а декоративные поля удалены.';
