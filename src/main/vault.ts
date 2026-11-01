import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { argon2id } from 'hash-wasm'
import type { Account, AccountInput, AccountStatus, PublicAccount, RankReading } from '../shared/types'

const AAD = Buffer.from('leaguevault-v1')
const KDF = { iterations: 3, memorySize: 64 * 1024, parallelism: 1, hashLength: 32 }

interface VaultFile {
  version: 1
  kdf: typeof KDF & { salt: string }
  iv: string
  tag: string
  data: string
}

async function deriveKey(master: string, kdf: VaultFile['kdf']): Promise<Buffer> {
  const hash = await argon2id({
    password: master,
    salt: Buffer.from(kdf.salt, 'base64'),
    iterations: kdf.iterations,
    memorySize: kdf.memorySize,
    parallelism: kdf.parallelism,
    hashLength: kdf.hashLength,
    outputType: 'binary',
  })
  return Buffer.from(hash)
}

function publicView({ password: _password, ...rest }: Account): PublicAccount {
  return rest
}

function parseFile(raw: string): VaultFile {
  const file = JSON.parse(raw) as VaultFile
  if (file.version !== 1 || !file.kdf?.salt || !file.iv || !file.tag || !file.data) {
    throw new Error('invalid vault file')
  }
  return file
}

/** AES-256-GCM vault keyed by Argon2id. Only the derived key stays in memory. */
export class Vault {
  private key: Buffer | null = null
  private kdf: VaultFile['kdf'] | null = null
  private accounts: Account[] = []

  constructor(private readonly path: string) {}

  get exists(): boolean {
    return existsSync(this.path)
  }

  get unlocked(): boolean {
    return this.key !== null
  }

  async create(master: string): Promise<void> {
    if (this.exists) throw new Error('vault already exists')
    if (master.length < 8) throw new Error('master password too short')
    this.kdf = { ...KDF, salt: randomBytes(16).toString('base64') }
    this.key = await deriveKey(master, this.kdf)
    this.accounts = []
    this.persist()
  }

  /** False on a wrong password or a tampered file. */
  async unlock(master: string): Promise<boolean> {
    const file = parseFile(readFileSync(this.path, 'utf8'))
    const key = await deriveKey(master, file.kdf)
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'))
      decipher.setAAD(AAD)
      decipher.setAuthTag(Buffer.from(file.tag, 'base64'))
      const plain = Buffer.concat([decipher.update(Buffer.from(file.data, 'base64')), decipher.final()])
      this.accounts = JSON.parse(plain.toString('utf8')) as Account[]
      plain.fill(0)
    } catch {
      key.fill(0)
      return false
    }
    this.key = key
    this.kdf = file.kdf
    return true
  }

  lock(): void {
    this.key?.fill(0)
    this.key = null
    this.kdf = null
    this.accounts = []
  }

  list(): PublicAccount[] {
    this.requireUnlocked()
    return this.accounts.map(publicView)
  }

  /** Main-process only: the login flow is the single reader of a password. */
  get(id: string): Account | undefined {
    this.requireUnlocked()
    return this.accounts.find(account => account.id === id)
  }

  save(input: AccountInput): PublicAccount[] {
    this.requireUnlocked()
    const current = input.id ? this.accounts.find(account => account.id === input.id) : undefined
    const password = input.password || current?.password
    if (!input.username.trim() || !password) throw new Error('username and password are required')
    const account: Account = { ...input, id: current?.id ?? randomUUID(), username: input.username.trim(), password }
    this.accounts = current
      ? this.accounts.map(existing => (existing.id === account.id ? account : existing))
      : [...this.accounts, account]
    this.persist()
    return this.list()
  }

  /** `'missing'` keeps the last rank and flags the Riot ID. */
  updateRank(id: string, rank: RankReading | 'missing'): PublicAccount[] | null {
    const account = this.key ? this.accounts.find(item => item.id === id) : undefined
    if (!account) return null
    if (rank === 'missing') {
      account.rankMissing = true
    } else {
      Object.assign(account, rank, { rankMissing: false, rankCheckedAt: Date.now() })
    }
    this.persist()
    return this.list()
  }

  /** Merges a reading from Riot. A locked or deleted account is left alone. */
  updateStatus(id: string, status: Partial<AccountStatus>): PublicAccount[] | null {
    const account = this.key ? this.accounts.find(item => item.id === id) : undefined
    if (!account) return null
    account.status = {
      ban: null, chat: null, ranked: null, honorLevel: null,
      ...account.status, ...status, checkedAt: Date.now(),
    }
    this.persist()
    return this.list()
  }

  remove(id: string): PublicAccount[] {
    this.requireUnlocked()
    this.accounts = this.accounts.filter(account => account.id !== id)
    this.persist()
    return this.list()
  }

  /** A backup is the encrypted file itself: it opens with the same master password. */
  exportTo(path: string): void {
    this.requireUnlocked()
    writeFileSync(path, readFileSync(this.path))
  }

  importFrom(path: string): void {
    const raw = readFileSync(path, 'utf8')
    parseFile(raw)
    this.lock()
    this.writeAtomic(raw)
  }

  /** Deletes the vault for good. Exported backups are not touched. */
  destroy(): void {
    this.lock()
    rmSync(this.path, { force: true })
    rmSync(`${this.path}.tmp`, { force: true })
  }

  private requireUnlocked(): void {
    if (!this.key) throw new Error('vault is locked')
  }

  private persist(): void {
    if (!this.key || !this.kdf) throw new Error('vault is locked')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(AAD)
    const data = Buffer.concat([cipher.update(JSON.stringify(this.accounts), 'utf8'), cipher.final()])
    const file: VaultFile = {
      version: 1,
      kdf: this.kdf,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    }
    this.writeAtomic(JSON.stringify(file))
  }

  private writeAtomic(contents: string): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temp = `${this.path}.tmp`
    writeFileSync(temp, contents, { mode: 0o600 })
    renameSync(temp, this.path)
  }
}
