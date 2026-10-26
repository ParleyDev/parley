import { api } from './api'

/**
 * Built-in slash commands, typed at the start of the composer. Most rewrite the message before it is sent; /nick
 * changes your server nickname instead of sending anything. An unknown /word is sent as typed.
 */
export interface SlashCommand {
  name: string
  /** What the command takes, shown after its name in the menu. */
  args?: string
  description: string
  /** Only in server channels. */
  guildOnly?: boolean
}

export const COMMANDS: SlashCommand[] = [
  { name: 'shrug', args: '[message]', description: 'Appends ¯\\_(ツ)_/¯ to your message' },
  { name: 'tableflip', args: '[message]', description: 'Appends (╯°□°)╯︵ ┻━┻ to your message' },
  { name: 'unflip', args: '[message]', description: 'Appends ┬─┬ノ( º _ ºノ) to your message' },
  { name: 'lenny', args: '[message]', description: 'Appends ( ͡° ͜ʖ ͡°) to your message' },
  { name: 'me', args: '<message>', description: 'Displays your message in italics' },
  { name: 'spoiler', args: '<message>', description: 'Hides your message behind a spoiler' },
  { name: 'nick', args: '[new nickname]', description: 'Changes your nickname in this server (leave empty to reset)', guildOnly: true },
]

/** The command menu for the text typed so far: `/` and a partial name, before any space. */
export function commandMatches(text: string, inGuild: boolean): SlashCommand[] {
  const m = /^\/([a-z]*)$/i.exec(text)
  if (!m) return []
  const q = m[1].toLowerCase()
  return COMMANDS.filter((c) => (inGuild || !c.guildOnly) && c.name.startsWith(q))
}

// Kaomoji carry markdown characters; escaped so they render as typed.
const FACES: Record<string, string> = {
  shrug: '¯\\\\\\_(ツ)\\_/¯',
  tableflip: '(╯°□°)╯︵ ┻━┻',
  unflip: '┬─┬ノ( º \\_ ºノ)',
  lenny: '( ͡° ͜ʖ ͡°)',
}

export type CommandResult =
  | { kind: 'send'; content: string }
  | { kind: 'done'; toast: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' }

/** Run a built-in command: what to send, or what happened. `none` means it isn't a command (send as typed). */
export async function runCommand(text: string, ctx: { guildId: string | null; userId: string | undefined }): Promise<CommandResult> {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text)
  if (!m) return { kind: 'none' }
  const name = m[1].toLowerCase()
  const rest = (m[2] ?? '').trim()
  const cmd = COMMANDS.find((c) => c.name === name)
  if (!cmd) return { kind: 'none' }
  if (FACES[name]) return { kind: 'send', content: rest ? `${rest} ${FACES[name]}` : FACES[name] }
  if (name === 'me') return rest ? { kind: 'send', content: `_${rest}_` } : { kind: 'error', message: 'Type a message after /me' }
  if (name === 'spoiler') return rest ? { kind: 'send', content: `||${rest}||` } : { kind: 'error', message: 'Type a message after /spoiler' }
  if (name === 'nick') {
    if (!ctx.guildId || !ctx.userId) return { kind: 'error', message: '/nick only works in a server' }
    try {
      await api.patch(`/guilds/${ctx.guildId}/members/${ctx.userId}`, { nickname: rest || null })
      return { kind: 'done', toast: rest ? `Your nickname is now ${rest}` : 'Your nickname was reset' }
    } catch (e) { return { kind: 'error', message: (e as Error).message } }
  }
  return { kind: 'none' }
}
