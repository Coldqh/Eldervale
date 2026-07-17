declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.6.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Реальные сражения';
export const APP_RELEASE_NOTES = 'Пространственные сражения на уровне подразделений: построения, мораль, усталость, бегство, реальные раненые, пленные, трофеи, обозы и последствия поля боя.';
