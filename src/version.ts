declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '5.6.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Формирование государств';
export const APP_RELEASE_NOTES = 'Поселения образуют политические общины, добиваются автономии, создают союзы, отделяются и основывают новые государства с реальными границами, правительством, дипломатией и войском.';
