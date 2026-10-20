import { useSyncExternalStore } from 'react'
import { STORAGE_PREFIX } from './brand'

/**
 * Message catalogue: keys are the English source strings, so an untranslated key renders as English.
 * `{name}` placeholders are filled from `vars`. The language comes from Settings → Language ('system' follows
 * navigator.language) and applies live; `useT()` re-renders on change. `locale()` is the BCP-47 tag for Intl.
 */
export type Language = 'system' | 'en' | 'es' | 'de' | 'fr' | 'pt-BR' | 'ja'
export type Resolved = Exclude<Language, 'system'>
export const LANGUAGES: { id: Language; label: string; native: string }[] = [
  { id: 'system', label: 'Match system', native: 'Match system' },
  { id: 'en', label: 'English', native: 'English' },
  { id: 'es', label: 'Spanish', native: 'Español' },
  { id: 'de', label: 'German', native: 'Deutsch' },
  { id: 'fr', label: 'French', native: 'Français' },
  { id: 'pt-BR', label: 'Portuguese (Brazil)', native: 'Português (Brasil)' },
  { id: 'ja', label: 'Japanese', native: '日本語' },
]

const es: Record<string, string> = {
  '(optional)': "(opcional)", 'Accessibility': "Accesibilidad", 'Add a Server': "Añadir un servidor", 'Advanced': "Avanzado", 'Already have an account?': "¿Ya tienes una cuenta?", 'App Settings': "Ajustes de la app",
  'Appearance': "Apariencia", 'Authentication code': "Código de autenticación", 'Bookmarks': "Marcadores", 'Chat': "Chat", 'Chat font scaling': "Tamaño del texto del chat", 'Content & Social': "Contenido y social",
  'Continue': "Continuar", 'Create Channel': "Crear canal", 'Create an account': "Crear una cuenta", 'Data & Privacy': "Datos y privacidad", 'Deafen': "Ensordecer", 'Delete Server': "Eliminar servidor",
  'Devices': "Dispositivos", 'Direct Messages': "Mensajes directos", 'Disconnect': "Desconectar", 'Discover': "Descubrir", 'Display name': "Nombre visible", 'Email': "Correo",
  'Email or username': "Correo o nombre de usuario", 'Events': "Eventos", 'Find or start a conversation': "Busca o inicia una conversación", 'Friends': "Amigos", 'Invite People': "Invitar personas", 'Join Voice': "Unirse a voz",
  'Jump to date': "Ir a una fecha", 'Keybinds': "Atajos de teclado", 'Language': "Idioma", 'Leave Server': "Salir del servidor", 'Leave the stage': "Dejar el escenario", 'Log In': "Iniciar sesión",
  'Log Out': "Cerrar sesión", 'Lower Hand': "Bajar la mano", 'Members': "Miembros", 'Message display': "Vista de mensajes", 'Message {name}': "Mensaje a {name}", 'Mute': "Silenciar",
  'My Account': "Mi cuenta", 'Need an account?': "¿Necesitas una cuenta?", 'No permission to connect': "Sin permiso para conectar", 'Notifications': "Notificaciones", 'Password': "Contraseña", 'Pinned Messages': "Mensajes fijados",
  'Please wait…': "Un momento…", 'Privacy Settings': "Ajustes de privacidad", 'Profiles': "Perfiles", 'Raise Hand': "Levantar la mano", 'Register': "Regístrate", 'Server Settings': "Ajustes del servidor",
  'Share Your Screen': "Compartir pantalla", 'Soundboard': "Panel de sonidos", 'Stop Sharing': "Dejar de compartir", 'Streamer Mode': "Modo streamer", 'Switch to this channel': "Cambiar a este canal", 'Theme': "Tema",
  'Turn Off Camera': "Apagar cámara", 'Turn On Camera': "Activar cámara", 'Undeafen': "Dejar de ensordecer", 'Unmute': "Activar micrófono", 'User Settings': "Ajustes de usuario", 'Username': "Nombre de usuario",
  'Voice & Video': "Voz y vídeo", 'Voice Settings': "Ajustes de voz", 'Welcome back!': "¡Bienvenido de nuevo!", 'Reduced motion': "Menos animaciones", 'High contrast': "Alto contraste", 'Cancel': "Cancelar",
  'Save Changes': "Guardar cambios", 'Delete': "Eliminar", 'Search': "Buscar", 'Message Requests': "Solicitudes de mensaje", 'Inbox': "Bandeja de entrada", 'Online': "En línea",
  'Offline': "Desconectado", 'Idle': "Ausente", 'Do Not Disturb': "No molestar", 'Invisible': "Invisible", 'Settings': "Ajustes", 'Done': "Listo",
  'Edit': "Editar", 'Copy': "Copiar", 'Reply': "Responder", 'Forward': "Reenviar", 'Pin Message': "Fijar mensaje", 'Delete Message': "Eliminar mensaje",
  'Edit Message': "Editar mensaje", 'Mark As Read': "Marcar como leído", 'Mute Server': "Silenciar servidor", 'Unmute Server': "Activar servidor", 'Leave Group': "Salir del grupo", 'Join Call': "Unirse a la llamada",
  'Leave Call': "Salir de la llamada", 'Start Voice Call': "Iniciar llamada de voz", 'Start Video Call': "Iniciar videollamada", 'Send a message': "Envía un mensaje", 'Today at {time}': "Hoy a las {time}", 'Yesterday at {time}': "Ayer a las {time}",
  'Match system': "Igual que el sistema",
}
const de: Record<string, string> = {
  '(optional)': "(optional)", 'Accessibility': "Barrierefreiheit", 'Add a Server': "Server hinzufügen", 'Advanced': "Erweitert", 'Already have an account?': "Schon ein Konto?", 'App Settings': "App-Einstellungen",
  'Appearance': "Darstellung", 'Authentication code': "Authentifizierungscode", 'Bookmarks': "Lesezeichen", 'Chat': "Chat", 'Chat font scaling': "Schriftgröße im Chat", 'Content & Social': "Inhalte & Soziales",
  'Continue': "Weiter", 'Create Channel': "Kanal erstellen", 'Create an account': "Konto erstellen", 'Data & Privacy': "Daten & Datenschutz", 'Deafen': "Ton aus", 'Delete Server': "Server löschen",
  'Devices': "Geräte", 'Direct Messages': "Direktnachrichten", 'Disconnect': "Trennen", 'Discover': "Entdecken", 'Display name': "Anzeigename", 'Email': "E-Mail",
  'Email or username': "E-Mail oder Benutzername", 'Events': "Veranstaltungen", 'Find or start a conversation': "Unterhaltung suchen oder starten", 'Friends': "Freunde", 'Invite People': "Leute einladen", 'Join Voice': "Sprachkanal beitreten",
  'Jump to date': "Zu Datum springen", 'Keybinds': "Tastenkürzel", 'Language': "Sprache", 'Leave Server': "Server verlassen", 'Leave the stage': "Bühne verlassen", 'Log In': "Anmelden",
  'Log Out': "Abmelden", 'Lower Hand': "Hand senken", 'Members': "Mitglieder", 'Message display': "Nachrichtenansicht", 'Message {name}': "Nachricht an {name}", 'Mute': "Stummschalten",
  'My Account': "Mein Konto", 'Need an account?': "Noch kein Konto?", 'No permission to connect': "Keine Berechtigung zum Verbinden", 'Notifications': "Benachrichtigungen", 'Password': "Passwort", 'Pinned Messages': "Angeheftete Nachrichten",
  'Please wait…': "Bitte warten…", 'Privacy Settings': "Datenschutzeinstellungen", 'Profiles': "Profile", 'Raise Hand': "Hand heben", 'Register': "Registrieren", 'Server Settings': "Servereinstellungen",
  'Share Your Screen': "Bildschirm teilen", 'Soundboard': "Soundboard", 'Stop Sharing': "Teilen beenden", 'Streamer Mode': "Streamer-Modus", 'Switch to this channel': "Zu diesem Kanal wechseln", 'Theme': "Design",
  'Turn Off Camera': "Kamera ausschalten", 'Turn On Camera': "Kamera einschalten", 'Undeafen': "Ton an", 'Unmute': "Stummschaltung aufheben", 'User Settings': "Benutzereinstellungen", 'Username': "Benutzername",
  'Voice & Video': "Sprache & Video", 'Voice Settings': "Spracheinstellungen", 'Welcome back!': "Willkommen zurück!", 'Reduced motion': "Weniger Bewegung", 'High contrast': "Hoher Kontrast", 'Cancel': "Abbrechen",
  'Save Changes': "Änderungen speichern", 'Delete': "Löschen", 'Search': "Suchen", 'Message Requests': "Nachrichtenanfragen", 'Inbox': "Posteingang", 'Online': "Online",
  'Offline': "Offline", 'Idle': "Abwesend", 'Do Not Disturb': "Nicht stören", 'Invisible': "Unsichtbar", 'Settings': "Einstellungen", 'Done': "Fertig",
  'Edit': "Bearbeiten", 'Copy': "Kopieren", 'Reply': "Antworten", 'Forward': "Weiterleiten", 'Pin Message': "Nachricht anheften", 'Delete Message': "Nachricht löschen",
  'Edit Message': "Nachricht bearbeiten", 'Mark As Read': "Als gelesen markieren", 'Mute Server': "Server stummschalten", 'Unmute Server': "Server lautschalten", 'Leave Group': "Gruppe verlassen", 'Join Call': "Anruf beitreten",
  'Leave Call': "Anruf verlassen", 'Start Voice Call': "Sprachanruf starten", 'Start Video Call': "Videoanruf starten", 'Send a message': "Nachricht senden", 'Today at {time}': "Heute um {time}", 'Yesterday at {time}': "Gestern um {time}",
  'Match system': "Wie das System",
}
const fr: Record<string, string> = {
  '(optional)': "(facultatif)", 'Accessibility': "Accessibilité", 'Add a Server': "Ajouter un serveur", 'Advanced': "Avancé", 'Already have an account?': "Vous avez déjà un compte ?", "App Settings": "Paramètres de l'application",
  'Appearance': "Apparence", "Authentication code": "Code d'authentification", 'Bookmarks': "Favoris", 'Chat': "Chat", 'Chat font scaling': "Taille du texte du chat", 'Content & Social': "Contenu et social",
  'Continue': "Continuer", 'Create Channel': "Créer un salon", 'Create an account': "Créer un compte", 'Data & Privacy': "Données et confidentialité", 'Deafen': "Mettre en sourdine", 'Delete Server': "Supprimer le serveur",
  'Devices': "Appareils", 'Direct Messages': "Messages privés", 'Disconnect': "Se déconnecter", 'Discover': "Découvrir", "Display name": "Nom d'affichage", 'Email': "E-mail",
  "Email or username": "E-mail ou nom d'utilisateur", 'Events': "Événements", 'Find or start a conversation': "Rechercher ou démarrer une conversation", 'Friends': "Amis", 'Invite People': "Inviter des gens", 'Join Voice': "Rejoindre le vocal",
  'Jump to date': "Aller à une date", 'Keybinds': "Raccourcis clavier", 'Language': "Langue", 'Leave Server': "Quitter le serveur", 'Leave the stage': "Quitter la scène", 'Log In': "Se connecter",
  'Log Out': "Se déconnecter", 'Lower Hand': "Baisser la main", 'Members': "Membres", 'Message display': "Affichage des messages", 'Message {name}': "Envoyer un message à {name}", 'Mute': "Couper le micro",
  'My Account': "Mon compte", "Need an account?": "Besoin d'un compte ?", 'No permission to connect': "Pas la permission de se connecter", 'Notifications': "Notifications", 'Password': "Mot de passe", 'Pinned Messages': "Messages épinglés",
  'Please wait…': "Veuillez patienter…", 'Privacy Settings': "Paramètres de confidentialité", 'Profiles': "Profils", 'Raise Hand': "Lever la main", "Register": "S'inscrire", 'Server Settings': "Paramètres du serveur",
  'Share Your Screen': "Partager votre écran", 'Soundboard': "Table de sons", 'Stop Sharing': "Arrêter le partage", 'Streamer Mode': "Mode streamer", 'Switch to this channel': "Passer à ce salon", 'Theme': "Thème",
  'Turn Off Camera': "Désactiver la caméra", 'Turn On Camera': "Activer la caméra", 'Undeafen': "Réactiver le son", 'Unmute': "Réactiver le micro", 'User Settings': "Paramètres utilisateur", "Username": "Nom d'utilisateur",
  'Voice & Video': "Voix et vidéo", 'Voice Settings': "Paramètres vocaux", 'Welcome back!': "Content de vous revoir !", 'Reduced motion': "Animations réduites", 'High contrast': "Contraste élevé", 'Cancel': "Annuler",
  'Save Changes': "Enregistrer", 'Delete': "Supprimer", 'Search': "Rechercher", 'Message Requests': "Demandes de message", 'Inbox': "Boîte de réception", 'Online': "En ligne",
  'Offline': "Hors ligne", 'Idle': "Inactif", 'Do Not Disturb': "Ne pas déranger", 'Invisible': "Invisible", 'Settings': "Paramètres", 'Done': "Terminé",
  'Edit': "Modifier", 'Copy': "Copier", 'Reply': "Répondre", 'Forward': "Transférer", 'Pin Message': "Épingler le message", 'Delete Message': "Supprimer le message",
  'Edit Message': "Modifier le message", 'Mark As Read': "Marquer comme lu", 'Mute Server': "Rendre le serveur muet", 'Unmute Server': "Réactiver le serveur", 'Leave Group': "Quitter le groupe", "Join Call": "Rejoindre l'appel",
  "Leave Call": "Quitter l'appel", 'Start Voice Call': "Démarrer un appel vocal", 'Start Video Call': "Démarrer un appel vidéo", 'Send a message': "Envoyer un message", "Today at {time}": "Aujourd'hui à {time}", 'Yesterday at {time}': "Hier à {time}",
  'Match system': "Comme le système",
}
const ptBR: Record<string, string> = {
  '(optional)': "(opcional)", 'Accessibility': "Acessibilidade", 'Add a Server': "Adicionar um servidor", 'Advanced': "Avançado", 'Already have an account?': "Já tem uma conta?", 'App Settings': "Configurações do app",
  'Appearance': "Aparência", 'Authentication code': "Código de autenticação", 'Bookmarks': "Favoritos", 'Chat': "Chat", 'Chat font scaling': "Tamanho da fonte do chat", 'Content & Social': "Conteúdo e social",
  'Continue': "Continuar", 'Create Channel': "Criar canal", 'Create an account': "Criar uma conta", 'Data & Privacy': "Dados e privacidade", 'Deafen': "Desativar áudio", 'Delete Server': "Excluir servidor",
  'Devices': "Dispositivos", 'Direct Messages': "Mensagens diretas", 'Disconnect': "Desconectar", 'Discover': "Descobrir", 'Display name': "Nome de exibição", 'Email': "E-mail",
  'Email or username': "E-mail ou nome de usuário", 'Events': "Eventos", 'Find or start a conversation': "Encontre ou inicie uma conversa", 'Friends': "Amigos", 'Invite People': "Convidar pessoas", 'Join Voice': "Entrar na voz",
  'Jump to date': "Ir para a data", 'Keybinds': "Atalhos de teclado", 'Language': "Idioma", 'Leave Server': "Sair do servidor", 'Leave the stage': "Sair do palco", 'Log In': "Entrar",
  'Log Out': "Sair", 'Lower Hand': "Abaixar a mão", 'Members': "Membros", 'Message display': "Exibição de mensagens", 'Message {name}': "Conversar com {name}", 'Mute': "Silenciar",
  'My Account': "Minha conta", 'Need an account?': "Precisa de uma conta?", 'No permission to connect': "Sem permissão para conectar", 'Notifications': "Notificações", 'Password': "Senha", 'Pinned Messages': "Mensagens fixadas",
  'Please wait…': "Aguarde…", 'Privacy Settings': "Configurações de privacidade", 'Profiles': "Perfis", 'Raise Hand': "Levantar a mão", 'Register': "Cadastrar", 'Server Settings': "Configurações do servidor",
  'Share Your Screen': "Compartilhar sua tela", 'Soundboard': "Painel de sons", 'Stop Sharing': "Parar de compartilhar", 'Streamer Mode': "Modo streamer", 'Switch to this channel': "Mudar para este canal", 'Theme': "Tema",
  'Turn Off Camera': "Desligar câmera", 'Turn On Camera': "Ligar câmera", 'Undeafen': "Ativar áudio", 'Unmute': "Ativar microfone", 'User Settings': "Configurações de usuário", 'Username': "Nome de usuário",
  'Voice & Video': "Voz e vídeo", 'Voice Settings': "Configurações de voz", 'Welcome back!': "Bem-vindo de volta!", 'Reduced motion': "Menos animações", 'High contrast': "Alto contraste", 'Cancel': "Cancelar",
  'Save Changes': "Salvar alterações", 'Delete': "Excluir", 'Search': "Buscar", 'Message Requests': "Solicitações de mensagem", 'Inbox': "Caixa de entrada", 'Online': "Online",
  'Offline': "Offline", 'Idle': "Ausente", 'Do Not Disturb': "Não perturbe", 'Invisible': "Invisível", 'Settings': "Configurações", 'Done': "Concluído",
  'Edit': "Editar", 'Copy': "Copiar", 'Reply': "Responder", 'Forward': "Encaminhar", 'Pin Message': "Fixar mensagem", 'Delete Message': "Excluir mensagem",
  'Edit Message': "Editar mensagem", 'Mark As Read': "Marcar como lida", 'Mute Server': "Silenciar servidor", 'Unmute Server': "Reativar servidor", 'Leave Group': "Sair do grupo", 'Join Call': "Entrar na chamada",
  'Leave Call': "Sair da chamada", 'Start Voice Call': "Iniciar chamada de voz", 'Start Video Call': "Iniciar chamada de vídeo", 'Send a message': "Enviar uma mensagem", 'Today at {time}': "Hoje às {time}", 'Yesterday at {time}': "Ontem às {time}",
  'Match system': "Igual ao sistema",
}
const ja: Record<string, string> = {
  '(optional)': "（任意）", 'Accessibility': "アクセシビリティ", 'Add a Server': "サーバーを追加", 'Advanced': "詳細設定", 'Already have an account?': "アカウントをお持ちですか？", 'App Settings': "アプリの設定",
  'Appearance': "外観", 'Authentication code': "認証コード", 'Bookmarks': "ブックマーク", 'Chat': "チャット", 'Chat font scaling': "チャットの文字サイズ", 'Content & Social': "コンテンツとソーシャル",
  'Continue': "続行", 'Create Channel': "チャンネルを作成", 'Create an account': "アカウントを作成", 'Data & Privacy': "データとプライバシー", 'Deafen': "スピーカーミュート", 'Delete Server': "サーバーを削除",
  'Devices': "デバイス", 'Direct Messages': "ダイレクトメッセージ", 'Disconnect': "切断", 'Discover': "見つける", 'Display name': "表示名", 'Email': "メール",
  'Email or username': "メールまたはユーザー名", 'Events': "イベント", 'Find or start a conversation': "会話を探す・始める", 'Friends': "フレンド", 'Invite People': "友達を招待", 'Join Voice': "ボイスに参加",
  'Jump to date': "日付へ移動", 'Keybinds': "キー割り当て", 'Language': "言語", 'Leave Server': "サーバーから退出", 'Leave the stage': "ステージを降りる", 'Log In': "ログイン",
  'Log Out': "ログアウト", 'Lower Hand': "手を下ろす", 'Members': "メンバー", 'Message display': "メッセージの表示", 'Message {name}': "{name} にメッセージを送信", 'Mute': "ミュート",
  'My Account': "マイアカウント", 'Need an account?': "アカウントが必要ですか？", 'No permission to connect': "接続する権限がありません", 'Notifications': "通知", 'Password': "パスワード", 'Pinned Messages': "ピン留めされたメッセージ",
  'Please wait…': "お待ちください…", 'Privacy Settings': "プライバシー設定", 'Profiles': "プロフィール", 'Raise Hand': "挙手", 'Register': "登録", 'Server Settings': "サーバー設定",
  'Share Your Screen': "画面を共有", 'Soundboard': "サウンドボード", 'Stop Sharing': "共有を停止", 'Streamer Mode': "配信者モード", 'Switch to this channel': "このチャンネルに切り替え", 'Theme': "テーマ",
  'Turn Off Camera': "カメラをオフ", 'Turn On Camera': "カメラをオン", 'Undeafen': "スピーカーミュート解除", 'Unmute': "ミュート解除", 'User Settings': "ユーザー設定", 'Username': "ユーザー名",
  'Voice & Video': "音声・ビデオ", 'Voice Settings': "音声設定", 'Welcome back!': "おかえりなさい！", 'Reduced motion': "動きを減らす", 'High contrast': "ハイコントラスト", 'Cancel': "キャンセル",
  'Save Changes': "変更を保存", 'Delete': "削除", 'Search': "検索", 'Message Requests': "メッセージリクエスト", 'Inbox': "受信トレイ", 'Online': "オンライン",
  'Offline': "オフライン", 'Idle': "退席中", 'Do Not Disturb': "取り込み中", 'Invisible': "オフライン表示", 'Settings': "設定", 'Done': "完了",
  'Edit': "編集", 'Copy': "コピー", 'Reply': "返信", 'Forward': "転送", 'Pin Message': "メッセージをピン留め", 'Delete Message': "メッセージを削除",
  'Edit Message': "メッセージを編集", 'Mark As Read': "既読にする", 'Mute Server': "サーバーをミュート", 'Unmute Server': "サーバーのミュート解除", 'Leave Group': "グループから退出", 'Join Call': "通話に参加",
  'Leave Call': "通話から退出", 'Start Voice Call': "音声通話を開始", 'Start Video Call': "ビデオ通話を開始", 'Send a message': "メッセージを送信", 'Today at {time}': "今日 {time}", 'Yesterday at {time}': "昨日 {time}",
  'Match system': "システムに合わせる",
}

const CATALOGUES: Record<string, Record<string, string>> = { es, de, fr, 'pt-BR': ptBR, ja }
const IDS: Resolved[] = ['en', 'es', 'de', 'fr', 'pt-BR', 'ja']

const KEY = `${STORAGE_PREFIX}language`
let setting: Language = (() => { try { const v = localStorage.getItem(KEY); return v && (IDS as string[]).includes(v) ? (v as Language) : 'system' } catch { return 'system' } })()
const listeners = new Set<() => void>()

/** The language in effect after resolving 'system'. */
export function resolvedLanguage(l: Language = setting): Resolved {
  if (l !== 'system') return l
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase()
  if (nav.startsWith('pt')) return 'pt-BR'
  const two = nav.slice(0, 2)
  return (IDS.find((id) => id === two) ?? 'en') as Resolved
}
/** BCP-47 tag for Intl formatting: the chosen language, or the browser's own locale when following the system. */
export function locale(): string {
  if (setting === 'system') return typeof navigator !== 'undefined' ? navigator.language : 'en'
  return setting
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
/** Coverage per language (for the Language tab): translated keys out of the catalogue's key set. */
export function coverage(l: Resolved): number { return l === 'en' ? 1 : Object.keys(CATALOGUES[l] ?? {}).length / Object.keys(es).length }
