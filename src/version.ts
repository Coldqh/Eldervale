declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '6.5.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Физическое животноводство';
export const APP_RELEASE_NOTES = 'Домашние животные существуют физическими стадами, потребляют реальные корма и создают молоко, яйца, шерсть, мясо и шкуры только через причинный хозяйственный цикл.';
