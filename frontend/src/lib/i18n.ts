import { useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from './brand'

/**
 * Tiny message catalogue: keys are the English source strings, so an untranslated key renders as English.
 * `{name}` placeholders are filled from `vars`. The language comes from Appearance → Language ('system' follows
 * navigator.language) and applies live; `useT()` re-renders on change.
 */
export type Language = 'system' | 'en' | 'es' | 'de'
export const LANGUAGES: { id: Language; label: string }[] = [
  { id: 'system', label: 'Match system' }, { id: 'en', label: 'English' }, { id: 'es', label: 'Español' }, { id: 'de', label: 'Deutsch' },
]

const es: Record<string, string> = {
  'Welcome back!': '¡Bienvenido de nuevo!', 'Create an account': 'Crear una cuenta', 'Email or username': 'Correo o nombre de usuario', 'Email': 'Correo', 'Username': 'Nombre de usuario',
  'Display name': 'Nombre visible', '(optional)': '(opcional)', 'Password': 'Contraseña', 'Log In': 'Iniciar sesión', 'Continue': 'Continuar', 'Please wait…': 'Un momento…',
  'Need an account?': '¿Necesitas una cuenta?', 'Register': 'Regístrate', 'Already have an account?': '¿Ya tienes una cuenta?', 'Authentication code': 'Código de autenticación',
  'Friends': 'Amigos', 'Direct Messages': 'Mensajes directos', 'Find or start a conversation': 'Busca o inicia una conversación', 'Members': 'Miembros',
  'User Settings': 'Ajustes de usuario', 'App Settings': 'Ajustes de la app', 'My Account': 'Mi cuenta', 'Profiles': 'Perfiles', 'Appearance': 'Apariencia', 'Voice & Video': 'Voz y vídeo', 'Keybinds': 'Atajos de teclado', 'Log Out': 'Cerrar sesión',
  'Voice Settings': 'Ajustes de voz', 'Disconnect': 'Desconectar', 'Add a Server': 'Añadir un servidor', 'Discover': 'Descubrir',
  'Theme': 'Tema', 'Chat font scaling': 'Tamaño del texto del chat', 'Message display': 'Vista de mensajes', 'Accessibility': 'Accesibilidad', 'Language': 'Idioma', 'Reduced motion': 'Menos animaciones', 'High contrast': 'Alto contraste',
  'Message {name}': 'Mensaje a {name}', 'Join Voice': 'Unirse a voz', 'Switch to this channel': 'Cambiar a este canal', 'No permission to connect': 'Sin permiso para conectar',
  'Mute': 'Silenciar', 'Unmute': 'Activar micrófono', 'Deafen': 'Ensordecer', 'Undeafen': 'Dejar de ensordecer', 'Turn On Camera': 'Activar cámara', 'Turn Off Camera': 'Apagar cámara', 'Share Your Screen': 'Compartir pantalla', 'Stop Sharing': 'Dejar de compartir',
  'Raise Hand': 'Levantar la mano', 'Lower Hand': 'Bajar la mano', 'Soundboard': 'Panel de sonidos', 'Leave the stage': 'Dejar el escenario',
  'Pinned Messages': 'Mensajes fijados', 'Bookmarks': 'Marcadores', 'Jump to date': 'Ir a una fecha', 'Events': 'Eventos',
  'Invite People': 'Invitar personas', 'Server Settings': 'Ajustes del servidor', 'Create Channel': 'Crear canal', 'Leave Server': 'Salir del servidor', 'Delete Server': 'Eliminar servidor',
  'Cancel': 'Cancelar', 'Save Changes': 'Guardar cambios', 'Delete': 'Eliminar', 'Search': 'Buscar',
}
const de: Record<string, string> = {
  'Welcome back!': 'Willkommen zurück!', 'Create an account': 'Konto erstellen', 'Email or username': 'E-Mail oder Benutzername', 'Email': 'E-Mail', 'Username': 'Benutzername',
  'Display name': 'Anzeigename', '(optional)': '(optional)', 'Password': 'Passwort', 'Log In': 'Anmelden', 'Continue': 'Weiter', 'Please wait…': 'Bitte warten…',
  'Need an account?': 'Noch kein Konto?', 'Register': 'Registrieren', 'Already have an account?': 'Schon ein Konto?', 'Authentication code': 'Authentifizierungscode',
  'Friends': 'Freunde', 'Direct Messages': 'Direktnachrichten', 'Find or start a conversation': 'Unterhaltung suchen oder starten', 'Members': 'Mitglieder',
  'User Settings': 'Benutzereinstellungen', 'App Settings': 'App-Einstellungen', 'My Account': 'Mein Konto', 'Profiles': 'Profile', 'Appearance': 'Darstellung', 'Voice & Video': 'Sprache & Video', 'Keybinds': 'Tastenkürzel', 'Log Out': 'Abmelden',
  'Voice Settings': 'Spracheinstellungen', 'Disconnect': 'Trennen', 'Add a Server': 'Server hinzufügen', 'Discover': 'Entdecken',
  'Theme': 'Design', 'Chat font scaling': 'Schriftgröße im Chat', 'Message display': 'Nachrichtenansicht', 'Accessibility': 'Barrierefreiheit', 'Language': 'Sprache', 'Reduced motion': 'Weniger Bewegung', 'High contrast': 'Hoher Kontrast',
  'Message {name}': 'Nachricht an {name}', 'Join Voice': 'Sprachkanal beitreten', 'Switch to this channel': 'Zu diesem Kanal wechseln', 'No permission to connect': 'Keine Berechtigung zum Verbinden',
  'Mute': 'Stummschalten', 'Unmute': 'Stummschaltung aufheben', 'Deafen': 'Ton aus', 'Undeafen': 'Ton an', 'Turn On Camera': 'Kamera einschalten', 'Turn Off Camera': 'Kamera ausschalten', 'Share Your Screen': 'Bildschirm teilen', 'Stop Sharing': 'Teilen beenden',
  'Raise Hand': 'Hand heben', 'Lower Hand': 'Hand senken', 'Soundboard': 'Soundboard', 'Leave the stage': 'Bühne verlassen',
  'Pinned Messages': 'Angeheftete Nachrichten', 'Bookmarks': 'Lesezeichen', 'Jump to date': 'Zu Datum springen', 'Events': 'Veranstaltungen',
  'Invite People': 'Leute einladen', 'Server Settings': 'Servereinstellungen', 'Create Channel': 'Kanal erstellen', 'Leave Server': 'Server verlassen', 'Delete Server': 'Server löschen',
  'Cancel': 'Abbrechen', 'Save Changes': 'Änderungen speichern', 'Delete': 'Löschen', 'Search': 'Suchen',
}
const CATALOGUES: Record<string, Record<string, string>> = { es, de }

const KEY = `${STORAGE_PREFIX}language`
let setting: Language = (() => { try { const v = localStorage.getItem(KEY); return v === 'en' || v === 'es' || v === 'de' ? v : 'system' } catch { return 'system' } })()
const listeners = new Set<() => void>()

/** The language in effect after resolving 'system'. */
export function resolvedLanguage(l: Language = setting): 'en' | 'es' | 'de' {
  if (l !== 'system') return l
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase()
  return nav.startsWith('es') ? 'es' : nav.startsWith('de') ? 'de' : 'en'
}
export const getLanguage = () => setting
export function setLanguage(l: Language) {
  setting = l
  try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
  document.documentElement.lang = resolvedLanguage(l)
  listeners.forEach((f) => f())
}
export function initLanguage() { document.documentElement.lang = resolvedLanguage() }

/** Translate a source string with optional `{placeholders}`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const lang = resolvedLanguage()
  let out = (lang === 'en' ? undefined : CATALOGUES[lang]?.[key]) ?? key
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replace(`{${k}}`, String(v))
  return out
}

/** Hook form: re-renders the component when the language changes. */
export function useT(): typeof t {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, getLanguage)
  return t
}
export function useLanguage(): Language {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, getLanguage)
}
