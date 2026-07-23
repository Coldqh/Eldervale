declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '5.7.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Прожитая история мира';
export const APP_RELEASE_NOTES = 'Мир начинается с родовых общин и проживает историю через настоящие системы населения, экономики, экспедиций, городов, цивилизаций и государств. Современные поселения и державы обязаны иметь физическую историю основания.';
