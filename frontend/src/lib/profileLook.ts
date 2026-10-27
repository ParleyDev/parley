import type { CSSProperties } from 'react'
import { colorFor } from './format'

/** What a profile card is drawn from. */
type Themed = { id: string; theme_primary?: string | null; theme_accent?: string | null }

/** The profile's theme colours: chosen ones, or one derived from the id. */
export function profileColors(u: Themed): { themed: boolean; primary: string; gradient: string } {
  const primary = u.theme_primary ?? colorFor(u.id)
  return { themed: !!u.theme_primary, primary, gradient: `linear-gradient(135deg, ${primary}, ${u.theme_accent ?? primary})` }
}

/**
 * A profile card's surface: the theme gradient under a dark veil when the profile has a theme, else Discord's plain
 * card grey. Shared by the profile popout, the self menu and the profile editor's preview so they always match.
 */
export function profileCardStyle(u: Themed, veil = 0.78): CSSProperties {
  const { themed, primary, gradient } = profileColors(u)
  return themed
    ? { background: `linear-gradient(rgba(17,18,20,${veil}), rgba(17,18,20,${veil})), ${gradient}`, borderColor: primary }
    : { background: '#232428', borderColor: 'rgba(255,255,255,0.06)' }
}
