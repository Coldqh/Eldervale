declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.0.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Прожитая история';
export const APP_RELEASE_NOTES = 'Единый журнал решений и изменений состояния, психика жителей с чертами, ценностями, эмоциями, целями, обязательствами, тайнами и репутацией, а также исторические события, которые реально меняют мир.';
