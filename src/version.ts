declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '5.0.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Живой город: ядро и аудит вместимости';
export const APP_RELEASE_NOTES = 'Поселения получают единый городской аудит: реальную вместимость домов, школ, рабочих мест и складов, ограниченную землю, бездомность, перенаселение и причинные городские проблемы. Интерьер больше не создаёт спальные места из воздуха и сохраняет проходы между мебелью.';
