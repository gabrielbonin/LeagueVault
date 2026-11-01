import { describe, expect, it } from 'vitest'
import { fetchMmr, opggUrl, parseOpgg, parseSeasons, toRank, UNRANKED } from '../src/main/ranks'

const page = (description: string): string =>
  `<meta name="description" content="${description}"><img src="profile_icons/profileIcon6.jpg">`

describe('parseOpgg', () => {
  it('reads an apex tier without division', () => {
    expect(parseOpgg(page('Hide on bush#KR1 / Challenger 2,181 LP / 448Win 371Lose')))
      .toMatchObject({ tier: 'Challenger', division: '', lp: 2181 })
  })
  it('converts numeric divisions', () => {
    expect(parseOpgg(page('Foo#BR1 / Gold 2 48 LP / 10Win 9Lose')))
      .toMatchObject({ tier: 'Gold', division: 'II', lp: 48 })
  })
  it('reads an unranked profile', () => {
    expect(parseOpgg(page('Foo#BR1 / Lv. 83'))).toMatchObject({ ...UNRANKED, level: 83 })
  })
  it('returns null for a page that is not a profile', () => {
    expect(parseOpgg('<html>blocked</html>')).toBeNull()
  })
})

describe('toRank', () => {
  it('normalizes the League client values', () => {
    expect(toRank('PLATINUM', 'II', 48)).toEqual({ tier: 'Platinum', division: 'II', lp: 48 })
  })
  it('treats empty and unknown tiers as unranked', () => {
    expect(toRank('', 'NA', 0)).toEqual(UNRANKED)
    expect(toRank('NONE', 'NA', 0)).toEqual(UNRANKED)
  })
})

describe('opggUrl', () => {
  it('encodes the name and joins the tag', () => {
    expect(opggUrl('KR', 'Hide on bush#KR1')).toBe('https://op.gg/lol/summoners/kr/Hide%20on%20bush-KR1')
  })
  it('keeps hashes inside the name', () => {
    expect(opggUrl('BR', 'a#b#BR1')).toBe('https://op.gg/lol/summoners/br/a%23b-BR1')
  })
})

describe('parseSeasons', () => {
  const entry = (season: string, high: string, final: string): string =>
    `"season":"${season}","rank_entries":{"high_rank_info":${high},"rank_info":${final}}`
  const payload = [
    entry('S2025 ', '{"tier":"platinum 4","value":"PLATINUM","division":4,"lp":"25"}', '{"tier":"gold 4","value":"GOLD","division":4,"lp":null}'),
    entry('S2024', '{"tier":"diamond 2","value":"DIAMOND","division":2,"lp":"1,057"}', '{"tier":"diamond 3","value":"DIAMOND","division":3,"lp":"10"}'),
    entry('S2023', '{"tier":"silver 1","value":"SILVER","division":1,"lp":"3"}', 'null'),
  ].join(',')

  it('takes the final rank of the newest season', () => {
    expect(parseSeasons(payload).lastSeason).toEqual({ season: 'S2025', tier: 'Gold', division: 'IV', lp: null })
  })
  it('takes the highest rank of all seasons as the peak', () => {
    expect(parseSeasons(payload).peak).toEqual({ season: 'S2024', tier: 'Diamond', division: 'II', lp: 1057 })
  })
  it('copes with a profile without history', () => {
    expect(parseSeasons('<html></html>')).toEqual({ lastSeason: null, peak: null })
  })
})

describe('parseOpgg stats', () => {
  it('reads the record and promotes a current rank above the peak', () => {
    const history = '"season":"S2025","rank_entries":{"high_rank_info":{"value":"GOLD","division":1,"lp":"3"},"rank_info":null}'
    const rank = parseOpgg(page('Foo#BR1 / Platinum 4 10 LP / 448Win 371Lose Win rate 55%') + history)
    expect(rank).toMatchObject({ wins: 448, losses: 371 })
    expect(rank?.peak).toMatchObject({ season: 'Atual', tier: 'Platinum' })
  })
})

describe('fetchMmr', () => {
  it('never queries regions the source does not cover', async () => {
    await expect(fetchMmr('BR', 'Foo#BR1')).resolves.toBeNull()
  })
})
