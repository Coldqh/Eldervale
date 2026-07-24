declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '6.3.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Физическая добыча';
export const APP_RELEASE_NOTES = 'Охота создаёт физические партии мяса и шкур, рынки платят охотникам, а семьи покупают и расходуют тот же товар.';
