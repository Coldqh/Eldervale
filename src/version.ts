declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '4.2.4';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Ленивая загрузка физических интерьеров';
export const APP_RELEASE_NOTES = 'Интерьеры больше не строятся сразу для тысяч зданий во время создания мира. Постоянные комнаты, мебель и назначения материализуются только при реальном использовании здания, а связи жильцов и работников восстанавливаются одним линейным проходом.';
