declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '6.0.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Единый закон мира';
export const APP_RELEASE_NOTES = 'История, биология, преступность, торговля, ресурсы, работа и строительство теперь подчиняются единым причинным правилам независимо от режима наблюдения и скорости времени.';
