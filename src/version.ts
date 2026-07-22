declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '5.4.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Живые города';
export const APP_RELEASE_NOTES = 'Районы получают разные планы улиц и застройки, здания распределяются по назначению, а жители больше не сворачиваются в одну клетку рынка. Новый мир по умолчанию создаётся с новым ключом.';
