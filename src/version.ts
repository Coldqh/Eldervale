declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '2.0.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Государственная машина';
export const APP_RELEASE_NOTES = 'Формы правления, титулы и владения, вассальные договоры, королевский двор, придворные группировки, государственный бюджет, приказы через гонцов, кризисы, мятежи и дипломатические соглашения.';
