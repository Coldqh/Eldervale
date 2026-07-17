declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.5.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Здоровье и демография';
export const APP_RELEASE_NOTES = 'Событийное здоровье: беременность и роды, возрастные этапы, болезни, эпидемии, травмы, лечение, иммунитет и демографические последствия без ежемесячного обхода всех здоровых жителей.';
