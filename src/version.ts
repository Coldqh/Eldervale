declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '5.3.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Цивилизации и технологические эпохи';
export const APP_RELEASE_NOTES = 'Государства и поселения связаны с постоянными цивилизациями, которые переживают смену границ, накапливают технологии и переходят между эпохами. Ресурсы, рецепты, технологии и эпохи вынесены в проверяемые контент-пакеты со стабильными ID.';
