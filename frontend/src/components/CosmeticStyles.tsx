import { cosmeticsCss, useCosmetics } from '../lib/cosmetics'

/** The admins' cosmetics as CSS (custom frames and nameplates, and hiding the ones turned off), kept live. */
export default function CosmeticStyles() {
  const list = useCosmetics()
  return <style data-cosmetics-css>{cosmeticsCss(list)}</style>
}
