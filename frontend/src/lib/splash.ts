/** CSS background for an invite page: the splash under a dark wash, URL quoted and encoded so it cannot break out of url(). None without a splash. */
export const splashBackground = (url: string | null | undefined): string | undefined =>
  url ? `linear-gradient(rgb(0 0 0 / .45), rgb(0 0 0 / .45)), url("${encodeURI(url).replace(/[()'"]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}")` : undefined
