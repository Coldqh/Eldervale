declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '5.8.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Носители знаний';
export const APP_RELEASE_NOTES = 'Технологии больше не доступны всей цивилизации мгновенно. Практики принадлежат конкретным мастерам, книгам и учреждениям, переносятся переселенцами и учениками и могут быть утрачены вместе с последним носителем.';
