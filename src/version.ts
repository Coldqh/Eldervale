declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '5.5.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Основание поселений';
export const APP_RELEASE_NOTES = 'Семьи могут покинуть переполненный город, пройти физический маршрут, разбить лагерь и основать новое поселение с домами, полями, складом, дорогой и местной властью.';
