import { describe, expect, it } from 'vitest'
import { leagueRegion } from '../src/main/riot'

const regions = { BR: { rso_platform_id: 'BR1' }, EUW: { rso_platform_id: 'EUW1' }, KR: { rso_platform_id: 'KR' } }

describe('leagueRegion', () => {
  it('keeps a region the account plays on', () => {
    expect(leagueRegion({ lol: { cpid: 'BR1' } }, regions, 'BR')).toBeNull()
  })
  it('switches to the account platform', () => {
    expect(leagueRegion({ lol: { cpid: 'EUW1' } }, regions, 'BR')).toBe('EUW')
  })
  it('handles regions named after their platform', () => {
    expect(leagueRegion({ lol: { cpid: 'KR' } }, regions, 'BR')).toBe('KR')
  })
  it('changes nothing without a known League platform', () => {
    expect(leagueRegion({}, regions, 'BR')).toBeNull()
  })
})
