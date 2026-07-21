declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '4.1.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Климат и природные кризисы';
export const APP_RELEASE_NOTES = 'Погода, сезоны, засухи, морозы, паводки и штормы меняют урожай, цены, здоровье, дороги, торговлю, армии и жизнь поселений.';
