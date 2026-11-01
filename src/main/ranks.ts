import { TIERS, type Account, type MmrEstimate, type RankReading, type SeasonRank, type Tier } from '../shared/types'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const ROMAN: Record<string, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }
const APEX: Tier[] = ['Challenger', 'Grandmaster', 'Master']
/** Regions whose OP.GG address differs from the name shown in the app. */
const OPGG_REGION: Record<string, string> = { SEA: 'sg' }
/** Any other subdomain silently serves NA data, so never query outside these. */
const MMR_REGION: Record<string, string> = { NA: 'na', EUW: 'euw', EUNE: 'eune', KR: 'kr' }

export const UNRANKED: RankReading = { tier: 'Unranked', division: '', lp: 0 }

export function toRank(tier: string, division: string, lp: number): RankReading {
  const name = TIERS.find(item => item.toLowerCase() === tier.trim().toLowerCase())
  if (!name || name === 'Unranked') return UNRANKED
  const upper = division.trim().toUpperCase()
  return { tier: name, division: APEX.includes(name) ? '' : (ROMAN[upper] ?? upper), lp }
}

/** Parses the JSON object that starts at `start`, ignoring what follows it. */
function readObject(text: string, start: number): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (inString) {
      if (char === '\\') index++
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth++
    } else if (char === '}' && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, index + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

function seasonRank(season: string, entry: any): SeasonRank | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof entry?.value !== 'string') return null
  const lp = entry.lp === null || entry.lp === undefined ? NaN : Number(String(entry.lp).replace(/,/g, ''))
  const { tier, division } = toRank(entry.value, String(entry.division ?? ''), 0)
  return tier === 'Unranked' ? null : { season, tier, division, lp: Number.isNaN(lp) ? null : lp }
}

const score = ({ tier, division, lp }: Pick<SeasonRank, 'tier' | 'division' | 'lp'>): number =>
  (TIERS.length - TIERS.indexOf(tier)) * 100_000
  + (5 - (Object.values(ROMAN).indexOf(division) + 1)) * 10_000
  + (lp ?? 0)

/** Newest first. Each entry holds the rank a season ended on and its peak. */
export function parseSeasons(payload: string): { lastSeason: SeasonRank | null; peak: SeasonRank | null } {
  const marker = /"season":"([^"]+)","rank_entries":/g
  let lastSeason: SeasonRank | null = null
  let peak: SeasonRank | null = null
  let first = true
  for (let match = marker.exec(payload); match; match = marker.exec(payload)) {
    const season = match[1].trim()
    const entries = readObject(payload, match.index + match[0].length)
    if (first) lastSeason = seasonRank(season, entries?.rank_info)
    first = false
    const high = seasonRank(season, entries?.high_rank_info)
    if (high && (!peak || score(high) > score(peak))) peak = high
  }
  return { lastSeason, peak }
}

/** Reads the summary OP.GG puts in its page description. */
export function parseOpgg(html: string): RankReading | null {
  if (!html.includes('profile_icons/profileIcon')) return null
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
  const rank = description.match(
    /\b(Challenger|Grandmaster|Master|Diamond|Emerald|Platinum|Gold|Silver|Bronze|Iron)\s*(IV|III|II|I|[1-4])?\s+([\d,]+)\s*LP\b/i,
  )
  const current = rank ? toRank(rank[1], rank[2] ?? '', Number(rank[3].replace(/,/g, ''))) : UNRANKED
  const record = description.match(/([\d,]+)\s*Win\s+([\d,]+)\s*Lose/)
  const level = description.match(/\bLv\.\s*(\d+)/)
  const payload = html.replace(/\\"/g, '"').replace(/&quot;/g, '"')
  const { lastSeason, peak } = parseSeasons(payload)
  const currentIsPeak = current.tier !== 'Unranked' && (!peak || score(current) > score(peak))
  const games = [...payload.matchAll(/"startTime":"([^"]+)"/g)].map(match => Date.parse(match[1])).filter(Boolean)
  return {
    ...current,
    ...(games.length ? { latestGameAt: Math.max(...games) } : {}),
    wins: record ? Number(record[1].replace(/,/g, '')) : 0,
    losses: record ? Number(record[2].replace(/,/g, '')) : 0,
    ...(level ? { level: Number(level[1]) } : {}),
    lastSeason,
    peak: currentIsPeak ? { season: 'Atual', tier: current.tier, division: current.division, lp: current.lp } : peak,
  }
}

/**
 * OP.GG only refreshes a profile when someone asks it to, so its rank can lag
 * for days. It replaces a League client reading only with a newer game on file.
 */
export function mergeRank(account: Account, reading: RankReading): RankReading {
  const { latestGameAt, ...rank } = reading
  const stale = !rank.clientRankAt && account.clientRankAt !== undefined
    && (latestGameAt ?? 0) <= account.clientRankAt
  const { tier, division, lp, wins, losses } = stale ? account : rank
  const merged: RankReading = { ...rank, tier, division, lp, wins, losses }
  const peak = rank.peak === undefined ? account.peak : rank.peak
  if (tier !== 'Unranked' && (!peak || score({ tier, division, lp }) > score(peak))) {
    merged.peak = { season: 'Atual', tier, division, lp }
  }
  return merged
}

/** Estimated MMR, or null where the source has no data for this player. */
export async function fetchMmr(region: string, riotId: string): Promise<MmrEstimate | null> {
  const subdomain = MMR_REGION[region]
  const name = riotId.split('#')[0].trim()
  if (!subdomain || !name) return null
  try {
    const response = await fetch(
      `https://${subdomain}.whatismymmr.com/api/v1/summoner?name=${encodeURIComponent(name)}`,
      { headers: { 'user-agent': 'LeagueVault (personal desktop app)' }, signal: AbortSignal.timeout(10_000) },
    )
    if (!response.ok) return null
    const ranked = ((await response.json()) as { ranked?: Partial<MmrEstimate> & { avg?: number | null } }).ranked
    if (typeof ranked?.avg !== 'number') return null
    return { avg: ranked.avg, err: ranked.err ?? 0, closestRank: ranked.closestRank ?? '' }
  } catch {
    return null
  }
}

export function opggUrl(region: string, riotId: string): string {
  const separator = riotId.lastIndexOf('#')
  const name = separator < 0 ? riotId : riotId.slice(0, separator)
  const tag = separator < 0 ? '' : riotId.slice(separator + 1)
  const slug = encodeURIComponent(name.trim()) + (tag.trim() ? `-${encodeURIComponent(tag.trim())}` : '')
  return `https://op.gg/lol/summoners/${OPGG_REGION[region] ?? region.toLowerCase()}/${slug}`
}

/** `'missing'`: OP.GG does not know this Riot ID. `null`: try again later. */
export async function fetchRank(region: string, riotId: string): Promise<RankReading | 'missing' | null> {
  try {
    const response = await fetch(opggUrl(region, riotId), {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    })
    if (response.status === 404) return 'missing'
    if (!response.ok) return null
    const rank = parseOpgg(await response.text())
    return rank && { ...rank, mmr: await fetchMmr(region, riotId) }
  } catch {
    return null
  }
}
