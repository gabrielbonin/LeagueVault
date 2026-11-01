import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isNewer, newestRelease, readCheckUpdates, writeCheckUpdates } from '../src/main/updates'

describe('isNewer', () => {
  it('compares numerically, not as text', () => {
    expect(isNewer('v0.10.0', '0.9.0')).toBe(true)
    expect(isNewer('v0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('v0.1.0', '0.2.0')).toBe(false)
  })
  it('ignores a pre-release suffix', () => {
    expect(isNewer('v0.2.0-beta.1', '0.1.0')).toBe(true)
  })
})

describe('newestRelease', () => {
  const release = (tag_name: string, draft = false) => ({ tag_name, draft })

  it('picks the highest newer tag', () => {
    expect(newestRelease([release('v0.1.1'), release('v0.3.0'), release('v0.2.0')], '0.1.0')).toBe('v0.3.0')
  })
  it('skips drafts', () => {
    expect(newestRelease([release('v0.9.0', true)], '0.1.0')).toBeNull()
  })
  it('returns null when up to date', () => {
    expect(newestRelease([release('v0.1.0')], '0.1.0')).toBeNull()
  })
})

describe('update setting', () => {
  it('defaults to on and remembers being turned off', () => {
    const dir = mkdtempSync(join(tmpdir(), 'leaguevault-'))
    const path = join(dir, 'settings.json')
    expect(readCheckUpdates(path)).toBe(true)
    writeCheckUpdates(path, false)
    expect(readCheckUpdates(path)).toBe(false)
    writeFileSync(path, 'broken')
    expect(readCheckUpdates(path)).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
