declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '6.6.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Физическая финансовая экономика';
export const APP_RELEASE_NOTES = 'Продажи, зарплаты, налоги, государственные расходы и долги проходят через единый журнал проводок между реальными счетами мира.';
