declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.7.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Культура, вера и образование';
export const APP_RELEASE_NOTES = 'Культуры, языки, религии, традиции, грамотность, школы, храмы, ассимиляция, обращения и культурные конфликты.';
