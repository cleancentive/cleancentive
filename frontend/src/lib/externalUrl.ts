/**
 * The site a mirrored cleanup comes from, as people would name it: the bare
 * host, without the www that nobody reads out loud.
 */
export function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
