import { readFileSync, writeFileSync } from 'node:fs'

const RELEASES_API = 'https://api.github.com/repos/gabrielbonin/LeagueVault/releases?per_page=10'
export const RELEASES_PAGE = 'https://github.com/gabrielbonin/LeagueVault/releases'

interface Release {
  tag_name: string
  draft: boolean
}

const numbers = (version: string): number[] =>
  version.replace(/^v/, '').split('-')[0].split('.').map(Number)

export function isNewer(candidate: string, current: string): boolean {
  const [a, b] = [numbers(candidate), numbers(current)]
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return false
}

/** The newest published tag above `current`, pre-releases included. */
export function newestRelease(releases: Release[], current: string): string | null {
  return releases
    .filter(release => !release.draft)
    .map(release => release.tag_name)
    .reduce<string | null>((best, tag) => (isNewer(tag, best ?? current) ? tag : best), null)
}

/** Only reads the public release list: nothing about the accounts is sent. */
export async function fetchNewestRelease(current: string): Promise<string | null> {
  const response = await fetch(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LeagueVault' },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  return newestRelease(await response.json() as Release[], current)
}

/** On unless the user turned it off; a missing or broken file counts as on. */
export function readCheckUpdates(path: string): boolean {
  try {
    return (JSON.parse(readFileSync(path, 'utf8')) as { checkUpdates?: boolean }).checkUpdates !== false
  } catch {
    return true
  }
}

export function writeCheckUpdates(path: string, enabled: boolean): void {
  writeFileSync(path, JSON.stringify({ checkUpdates: enabled }))
}
