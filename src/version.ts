declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '5.9.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Региональная экономика';
export const APP_RELEASE_NOTES = 'Поселения получили конечные месторождения, хозяйственную специализацию, физические договоры поставок и локальные цены. Разрыв маршрута теперь срывает груз, поднимает стоимость дефицитного сырья и останавливает зависимое производство.';
