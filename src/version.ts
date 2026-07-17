declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.4.1';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Масштаб живого мира';
export const APP_RELEASE_NOTES = 'Животные равномерно распределяются по локации, кладбища не пересекают застройку, генерация и сохранение показывают честный прогресс. Год и десятилетие идут квартальными крупными шагами, а частота преступлений и судов зависит от населения, бедности, порядка и работы стражи.';
