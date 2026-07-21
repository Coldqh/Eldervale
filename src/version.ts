declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '4.2.1';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Единый симуляционный контур и целостная миграция';
export const APP_RELEASE_NOTES = 'Worker, fallback и новый прямой прогон используют один порядок систем. Семьи больше не разрываются при переезде, старые жилищные переселения отключены, работа, дом и имущество обновляются атомарно.';
