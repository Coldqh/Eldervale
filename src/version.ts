declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.4.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Быстрый живой мир';
export const APP_RELEASE_NOTES = 'Симуляция получила постоянные индексы, событийное обновление систем, ускоренный многолетний режим и профилировщик фаз. Архив объединяет животных, ресурсы, предметы, поля, здания и заведения по типам вместо сотен одинаковых записей.';
