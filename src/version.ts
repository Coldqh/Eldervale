declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.2.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Физические армии';
export const APP_RELEASE_NOTES = 'Армии размещаются только вне поселений: полевые лагеря состоят из реальных палаток и служб, каждый живой солдат получает отдельную позицию, а походные армии отображаются колоннами и боевыми построениями.';
