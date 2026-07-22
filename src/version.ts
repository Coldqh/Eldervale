declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '5.1.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Городской источник истины';
export const APP_RELEASE_NOTES = 'Городское состояние стало постоянным и единым: жильё, проблемы и очередь проектов сохраняются в мире, снимки интерфейса ничего не изменяют, каждый город рассчитывается один раз за месяц, а строительство использует единый API и реальную свободную землю.';
