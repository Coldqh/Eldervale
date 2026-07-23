declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '6.1.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Живые институты';
export const APP_RELEASE_NOTES = 'Городские советы, купцы, мастера и политические общины принимают решения через конкретных людей, поддержку, сопротивление, деньги и физическое исполнение.';
