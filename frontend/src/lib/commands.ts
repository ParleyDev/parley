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
  /** Only for people who can manage messages here. */
  moderator?: boolean
}

export const COMMANDS: SlashCommand[] = [
  { name: 'shrug', args: '[message]', description: 'Appends ¯\\_(ツ)_/¯ to your message' },
  { name: 'tableflip', args: '[message]', description: 'Appends (╯°□°)╯︵ ┻━┻ to your message' },
  { name: 'unflip', args: '[message]', description: 'Appends ┬─┬ノ( º _ ºノ) to your message' },
  { name: 'lenny', args: '[message]', description: 'Appends ( ͡° ͜ʖ ͡°) to your message' },
  { name: 'me', args: '<message>', description: 'Displays your message in italics' },
  { name: 'spoiler', args: '<message>', description: 'Hides your message behind a spoiler' },
  { name: 'tts', args: '<message>', description: 'Reads your message aloud to everyone viewing the channel' },
  { name: 'nick', args: '[new nickname]', description: 'Changes your nickname in this server (leave empty to reset)', guildOnly: true },
  { name: 'purge', args: '<count> [@user]', description: 'Deletes the newest messages here (up to 100), optionally only one member\u2019s', guildOnly: true, moderator: true },
]

/** The command menu for the text typed so far: `/` and a partial name, before any space. */
export function commandMatches(text: string, inGuild: boolean, moderator = false): SlashCommand[] {
  const m = /^\/([a-z]*)$/i.exec(text)
  if (!m) return []
  const q = m[1].toLowerCase()
  return COMMANDS.filter((c) => (inGuild || !c.guildOnly) && (moderator || !c.moderator) && c.name.startsWith(q))
}

// Kaomoji carry markdown characters; escaped so they render as typed.
const FACES: Record<string, string> = {
  shrug: '¯\\\\\\_(ツ)\\_/¯',
  tableflip: '(╯°□°)╯︵ ┻━┻',
  unflip: '┬─┬ノ( º \\_ ºノ)',
  lenny: '( ͡° ͜ʖ ͡°)',
}

export type CommandResult =
  | { kind: 'send'; content: string; tts?: boolean }
  | { kind: 'done'; toast: string }
  | { kind: 'error'; message: string }
  /** Ask before doing something that can't be undone. */
  | { kind: 'confirm'; title: string; body: string; label: string; action: () => Promise<string> }
  | { kind: 'none' }

/** Run a built-in command: what to send, or what happened. `none` means it isn't a command (send as typed). */
export async function runCommand(text: string, ctx: { guildId: string | null; userId: string | undefined; channelId: string; moderator?: boolean }): Promise<CommandResult> {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text)
  if (!m) return { kind: 'none' }
  const name = m[1].toLowerCase()
  const rest = (m[2] ?? '').trim()
  const cmd = COMMANDS.find((c) => c.name === name)
  if (!cmd || (cmd.moderator && !ctx.moderator)) return { kind: 'none' }
  if (FACES[name]) return { kind: 'send', content: rest ? `${rest} ${FACES[name]}` : FACES[name] }
  if (name === 'me') return rest ? { kind: 'send', content: `_${rest}_` } : { kind: 'error', message: 'Type a message after /me' }
  if (name === 'tts') return rest ? { kind: 'send', content: rest, tts: true } : { kind: 'error', message: 'Type a message after /tts' }
  if (name === 'spoiler') return rest ? { kind: 'send', content: `||${rest}||` } : { kind: 'error', message: 'Type a message after /spoiler' }
  if (name === 'nick') {
    if (!ctx.guildId || !ctx.userId) return { kind: 'error', message: '/nick only works in a server' }
    try {
      await api.patch(`/guilds/${ctx.guildId}/members/${ctx.userId}`, { nickname: rest || null })
      return { kind: 'done', toast: rest ? `Your nickname is now ${rest}` : 'Your nickname was reset' }
    } catch (e) { return { kind: 'error', message: (e as Error).message } }
  }
  if (name === 'purge') {
    // `/purge 20` or `/purge 20 @someone` (the mention arrives as <@id>).
    const pm = /^(\d{1,3})(?:\s+<@([0-9a-f-]{36})>)?$/.exec(rest)
    const n = pm ? Number(pm[1]) : 0
    if (!pm || n < 1 || n > 100) return { kind: 'error', message: 'Usage: /purge <1-100> [@user]' }
    const who = pm[2]
    return {
      kind: 'confirm', title: `Delete ${n} message${n === 1 ? '' : 's'}`, label: 'Delete',
      body: `The newest ${n} message${n === 1 ? '' : 's'}${who ? ' from that member' : ''} in this channel will be deleted for everyone. This can't be undone.`,
      action: async () => {
        const r = await api.post<{ deleted: number }>(`/channels/${ctx.channelId}/messages/bulk-delete`, { limit: n, author_id: who ?? null })
        return `Deleted ${r.deleted} message${r.deleted === 1 ? '' : 's'}`
      },
    }
  }
  return { kind: 'none' }
}
