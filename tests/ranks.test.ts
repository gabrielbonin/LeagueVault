import { describe, expect, it } from 'vitest'
import { opggUrl, parseOpgg, toRank, UNRANKED } from '../src/main/ranks'

const page = (description: string): string =>
  `<meta name="description" content="${description}"><img src="profile_icons/profileIcon6.jpg">`

describe('parseOpgg', () => {
  it('reads an apex tier without division', () => {
    expect(parseOpgg(page('Hide on bush#KR1 / Challenger 2,181 LP / 448Win 371Lose')))
      .toEqual({ tier: 'Challenger', division: '', lp: 2181 })
  })
  it('converts numeric divisions', () => {
    expect(parseOpgg(page('Foo#BR1 / Gold 2 48 LP / 10Win 9Lose')))
      .toEqual({ tier: 'Gold', division: 'II', lp: 48 })
  })
  it('reads an unranked profile', () => {
    expect(parseOpgg(page('Foo#BR1 / Lv. 83'))).toEqual(UNRANKED)
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
