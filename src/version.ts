declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '6.4.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Физическое земледелие';
export const APP_RELEASE_NOTES = 'Поля создают реальные партии урожая, амбары покупают и хранят их, а семьи платят за тот же товар и физически расходуют его на питание.';
