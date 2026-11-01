import { describe, expect, it } from 'vitest'
import { banFrom, inInstallation, isRunning, leagueRegion, restrictionFrom } from '../src/main/riot'

const regions = { BR: { rso_platform_id: 'BR1' }, EUW: { rso_platform_id: 'EUW1' }, KR: { rso_platform_id: 'KR' } }

describe('isRunning', () => {
  it('tells a live process from the pid of a stale lockfile', () => {
    expect(isRunning(process.pid)).toBe(true)
    expect(isRunning(99_999_999)).toBe(false)
  })
})

describe('inInstallation', () => {
  const service = 'C:/Riot Games/Riot Client/RiotClientServices.exe'

  it('matches the Riot paths despite the different slashes', () => {
    expect(inInstallation(service, 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe')).toBe(true)
    expect(inInstallation(service, 'c:\\riot games\\riot client\\RiotClientElectron\\Riot Client.exe')).toBe(true)
  })
  it('leaves other installations alone', () => {
    expect(inInstallation(service, 'D:\\Riot Games\\Riot Client\\RiotClientServices.exe')).toBe(false)
    expect(inInstallation(service, 'C:\\Riot Games\\Riot Client 2\\RiotClientServices.exe')).toBe(false)
  })
  it('ignores a process without a readable path', () => {
    expect(inInstallation(service, '')).toBe(false)
  })
})

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

describe('banFrom', () => {
  const now = 1000
  const lol = (type: string, expirationMillis = 0) => ({ type, scope: 'lol', dat: { expirationMillis } })

  it('reads a timed League ban', () => {
    expect(banFrom({ ban: { restrictions: [lol('TIME_BAN', 5000)] } }, now)).toEqual({ permanent: false, until: 5000 })
  })
  it('prefers a permanent ban', () => {
    expect(banFrom({ ban: { restrictions: [lol('TIME_BAN', 5000), lol('PERMANENT_BAN')] } }, now))
      .toEqual({ permanent: true, until: null })
  })
  it('ignores expired bans and other games', () => {
    const valorant = { type: 'TIME_BAN', scope: 'valorant', dat: { expirationMillis: 5000 } }
    expect(banFrom({ ban: { restrictions: [lol('TIME_BAN', 500), valorant] } }, now)).toBeNull()
  })
  it('handles accounts without restrictions', () => {
    expect(banFrom({}, now)).toBeNull()
  })
})

describe('restrictionFrom', () => {
  it('reads remaining games and time', () => {
    expect(restrictionFrom({ gamesRemaining: 18, expirationMillis: 5000 }, 1000)).toEqual({ gamesRemaining: 18, until: 5000 })
  })
  it('accepts other names for the games counter', () => {
    expect(restrictionFrom({ rankedRestrictionGamesRemaining: 5 }, 1000)?.gamesRemaining).toBe(5)
  })
  it('treats zeroed fields as no restriction', () => {
    expect(restrictionFrom({ gamesRemaining: 0, expirationMillis: 0 }, 1000)).toBeNull()
  })
})
