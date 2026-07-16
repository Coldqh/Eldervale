declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '1.9.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Жизнь поселений';
export const APP_RELEASE_NOTES = 'Местная власть, городские бюджеты, стража и патрули, преступления, расследования, суды, тюрьмы, пожарные команды, реальные пожары, районы с безопасностью, чистотой, водой, арендой и бездомностью.';
