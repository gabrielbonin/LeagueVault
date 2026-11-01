import { TIERS, type RankReading, type Tier } from '../shared/types'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const ROMAN: Record<string, string> = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV' }
const APEX: Tier[] = ['Challenger', 'Grandmaster', 'Master']
/** Regions whose OP.GG address differs from the name shown in the app. */
const OPGG_REGION: Record<string, string> = { SEA: 'sg' }

export const UNRANKED: RankReading = { tier: 'Unranked', division: '', lp: 0 }

export function toRank(tier: string, division: string, lp: number): RankReading {
  const name = TIERS.find(item => item.toLowerCase() === tier.trim().toLowerCase())
  if (!name || name === 'Unranked') return UNRANKED
  const upper = division.trim().toUpperCase()
  return { tier: name, division: APEX.includes(name) ? '' : (ROMAN[upper] ?? upper), lp }
}

/** Reads the summary OP.GG puts in its page description. */
export function parseOpgg(html: string): RankReading | null {
  if (!html.includes('profile_icons/profileIcon')) return null
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''
  const rank = description.match(
    /\b(Challenger|Grandmaster|Master|Diamond|Emerald|Platinum|Gold|Silver|Bronze|Iron)\s*(IV|III|II|I|[1-4])?\s+([\d,]+)\s*LP\b/i,
  )
  if (!rank) return UNRANKED
  return toRank(rank[1], rank[2] ?? '', Number(rank[3].replace(/,/g, '')))
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
    return parseOpgg(await response.text())
  } catch {
    return null
  }
}
