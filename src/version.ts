declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '4.2.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Расы, миграция и население';
export const APP_RELEASE_NOTES = 'Единый каталог рас, состав населения государств и поселений, реальные семейные переселения из-за голода, войн, эпидемий, климата и работы.';
