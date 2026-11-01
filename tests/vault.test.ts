import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Vault } from '../src/main/vault'
import type { AccountInput } from '../src/shared/types'

const MASTER = 'correct horse battery'
const account: AccountInput = {
  username: 'smurf1', password: 'SECRET_PASSWORD_123', riotId: 'Name#BR1', region: 'BR',
  tier: 'Gold', division: 'II', lp: 40, note: '',
}

describe('Vault', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'leaguevault-'))
    path = join(dir, 'vault.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('never writes the password in clear text', async () => {
    const vault = new Vault(path)
    await vault.create(MASTER)
    vault.save(account)
    const raw = readFileSync(path, 'utf8')
    expect(raw).not.toContain('SECRET_PASSWORD_123')
    expect(raw).not.toContain('smurf1')
  })

  it('reopens with the right master password only', async () => {
    const vault = new Vault(path)
    await vault.create(MASTER)
    vault.save(account)
    vault.lock()

    const other = new Vault(path)
    expect(await other.unlock('wrong password')).toBe(false)
    expect(other.unlocked).toBe(false)
    expect(await other.unlock(MASTER)).toBe(true)
    expect(other.list()[0].username).toBe('smurf1')
  })

  it('does not expose passwords through list()', async () => {
    const vault = new Vault(path)
    await vault.create(MASTER)
    const [listed] = vault.save(account)
    expect(listed).not.toHaveProperty('password')
    expect(JSON.stringify(vault.list())).not.toContain('SECRET_PASSWORD_123')
  })

  it('keeps the stored password when an edit leaves it empty', async () => {
    const vault = new Vault(path)
    await vault.create(MASTER)
    const [saved] = vault.save(account)
    vault.save({ ...saved, password: '', note: 'duo' })
    const stored = vault.get(saved.id)
    expect(stored?.password).toBe('SECRET_PASSWORD_123')
    expect(stored?.note).toBe('duo')
  })

  it('rejects a tampered file', async () => {
    const vault = new Vault(path)
    await vault.create(MASTER)
    vault.save(account)
    vault.lock()
    const file = JSON.parse(readFileSync(path, 'utf8'))
    const data = Buffer.from(file.data, 'base64')
    data[0] ^= 1
    file.data = data.toString('base64')
    writeFileSync(path, JSON.stringify(file))
    expect(await new Vault(path).unlock(MASTER)).toBe(false)
  })

  it('refuses to work while locked', async () => {
    const vault = new Vault(path)
    await vault.create(MASTER)
    vault.lock()
    expect(() => vault.list()).toThrow('locked')
  })

  it('restores a backup with the same master password', async () => {
    const vault = new Vault(path)
    await vault.create(MASTER)
    vault.save(account)
    const backup = join(dir, 'backup.json')
    vault.exportTo(backup)

    const second = new Vault(join(dir, 'other', 'vault.json'))
    second.importFrom(backup)
    expect(await second.unlock(MASTER)).toBe(true)
    expect(second.list()).toHaveLength(1)
  })
}, 30000)
