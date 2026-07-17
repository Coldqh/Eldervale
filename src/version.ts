declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.8.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Повседневная жизнь';
export const APP_RELEASE_NOTES = 'У жителей появился распорядок утра, дня, вечера и ночи, реальные встречи, бытовые события, личная лента и перемещения по локальной карте.';
