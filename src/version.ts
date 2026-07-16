declare const __APP_VERSION__: string;

const viteEnv = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env;

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '3.1.0';
export const VERSION_URL = `${viteEnv?.BASE_URL ?? '/Eldervale/'}version.json`;
export const APP_RELEASE_NAME = 'Живое общество';
export const APP_RELEASE_NOTES = 'Социальные связи с доверием, привязанностью, страхом и напряжением; браки, разводы, тайные связи, долги, обещания, решения свидетелей и судей, вербовка через знакомства, семейная миграция, наследование и распад вымерших государств.';
