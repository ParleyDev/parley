import { desktop, desktopBridge } from './desktop'
import { getPrefs, subscribePrefs } from './prefs'

/**
 * App icons (Settings → Appearance): the Parley mark on a choice of tiles. The browser tab icon follows the choice;
 * the desktop app also changes its window, taskbar and tray icon. An installed web app keeps the icon it was
 * installed with (browsers fix that at install time).
 */
const MARK = 'M151.117 803.03 C151.227 654.363 151.556 505.696 151.775 357.03 L151.869 293.828 C151.89 279.09 151.138 264.07 152.757 249.395 C156.589 214.649 174.048 181.703 199.572 158.102 C220.046 139.17 247.219 126.343 275.067 123.23 C294.408 121.069 314.408 122.408 333.849 122.408 L449.088 122.408 L577.285 122.408 C606.639 122.408 636.516 120.817 665.781 123.208 C705.245 126.433 744.522 138.754 778.606 158.872 C800.606 171.858 823.593 190.019 840.476 209.332 C845.995 215.646 851.791 222.121 856.761 228.889 C858.91 231.816 860.501 235.321 862.89 238.056 C866.527 242.219 868.979 247.05 871.911 251.689 C884.817 272.104 894.233 293.944 901.862 316.83 C913.33 351.233 915.333 386.555 915.069 422.497 C914.909 444.32 910.279 466.744 904.598 487.705 C875.148 596.358 782.571 682.167 668.33 691.039 C646.48 692.735 624.478 692.6 602.574 692.718 L520.034 693.162 C479.384 693.381 446.982 691.823 410.433 713.073 C385.778 727.408 366.596 748.27 345.954 767.668 C325.976 786.443 306.274 805.99 286.87 825.16 C273.658 838.213 259.236 850.413 246.077 863.572 C233.944 875.705 221.442 887.296 209.041 899.025 C202.696 905.026 196.836 912.591 188.789 916.36 C183.842 918.678 178.332 918.517 172.975 918.243 C162.05 917.686 153.045 905.602 151.965 895.528 C150.992 886.461 151.609 876.945 151.46 867.824 C151.106 846.225 151.101 824.632 151.117 803.03 Z M313.836 359.652 C312.332 380.816 313.796 402.623 313.796 423.846 L313.796 554.833 L313.796 600.489 C313.796 604.432 312.097 613.859 317.986 614.398 C324.326 614.977 341.025 594.046 346.54 589.309 C363.918 574.382 379.903 557.852 397.423 543.115 C407.996 534.222 419.246 525.068 432.144 519.612 C462.048 506.963 482.719 507.552 514.288 507.379 L590.646 506.959 C607.318 506.868 624.271 507.675 640.8 505.104 C686.937 497.927 722.978 458.171 726.816 411.787 C731.162 359.269 701.662 309.035 649.615 294.593 C625.439 287.885 598.861 290.67 574.021 290.67 L444.231 290.67 L405.553 290.67 C373.845 290.67 352.772 293.328 330.928 318.553 C321.269 329.707 314.891 344.811 313.836 359.652 Z'

export interface AppIcon { id: string; label: string; bg: string | [string, string] | null; fg: string }
export const APP_ICONS: AppIcon[] = [
  { id: 'default', label: 'Classic', bg: null, fg: '#6d5dfc' },
  { id: 'violet', label: 'Violet', bg: '#6d5dfc', fg: '#ffffff' },
  { id: 'midnight', label: 'Midnight', bg: '#0f1424', fg: '#8b7dff' },
  { id: 'sunset', label: 'Sunset', bg: ['#ff7a59', '#c7368f'], fg: '#ffffff' },
  { id: 'aurora', label: 'Aurora', bg: ['#2b1a4f', '#0f8b8d'], fg: '#e7fffb' },
  { id: 'mint', label: 'Mint', bg: '#12b886', fg: '#ffffff' },
  { id: 'mono', label: 'Mono', bg: '#111214', fg: '#ffffff' },
  { id: 'paper', label: 'Paper', bg: '#f4f1ea', fg: '#222222' },
]

/** The icon as SVG: the mark alone (Classic) or on a rounded tile. */
export function iconSvg(icon: AppIcon): string {
  if (!icon.bg) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="123 110 820 820"><path fill="${icon.fg}" d="${MARK}"/></svg>`
  const grad = Array.isArray(icon.bg)
  const fill = grad ? 'url(#g)' : icon.bg
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${grad ? `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${(icon.bg as string[])[0]}"/><stop offset="1" stop-color="${(icon.bg as string[])[1]}"/></linearGradient></defs>` : ''}<rect width="1024" height="1024" rx="224" fill="${fill}"/><path fill="${icon.fg}" transform="translate(166 166) scale(0.844) translate(-123 -110)" d="${MARK}"/></svg>`
}
export const iconUrl = (icon: AppIcon) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg(icon))

/** The icon drawn to a PNG (for the desktop shell). */
async function png(icon: AppIcon, size = 256): Promise<Uint8Array> {
  const img = new Image(); img.src = iconUrl(icon); await img.decode()
  const c = document.createElement('canvas'); c.width = c.height = size
  c.getContext('2d')!.drawImage(img, 0, 0, size, size)
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))
  return new Uint8Array(await (blob ?? new Blob()).arrayBuffer())
}

let applied = ''
function apply() {
  const id = getPrefs().appIcon
  if (id === applied) return
  applied = id
  const icon = APP_ICONS.find((i) => i.id === id) ?? APP_ICONS[0]
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (link) { link.href = icon.id === 'default' ? '/favicon.svg' : iconUrl(icon); link.dataset.appIcon = icon.id }
  if (desktopBridge()) {
    if (icon.id === 'default') desktop.appIcon(new Uint8Array())
    else void png(icon).then((b) => desktop.appIcon(b)).catch(() => {})
  }
}

export function initAppIcon() {
  // The shell starts with its own icon; only a chosen one needs sending.
  applied = 'default'
  if (getPrefs().appIcon !== 'default') apply()
  subscribePrefs(apply)
}
