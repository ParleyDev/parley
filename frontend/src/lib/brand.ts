/** Product branding in one place. */
export const APP_NAME = 'Parley'
export const APP_INITIAL = 'P'
export const APP_TAGLINE = 'Talk it out.'
/** localStorage key prefix. */
export const STORAGE_PREFIX = 'parley.'

declare const __APP_VERSION__: string
/** Web client build version (from PARLEY_VERSION at build time). */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
