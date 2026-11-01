export const TIERS = [
  'Challenger', 'Grandmaster', 'Master', 'Diamond', 'Emerald', 'Platinum',
  'Gold', 'Silver', 'Bronze', 'Iron', 'Unranked',
] as const
export type Tier = (typeof TIERS)[number]

export const REGIONS = [
  'BR', 'NA', 'LAN', 'LAS', 'EUW', 'EUNE', 'TR', 'RU', 'KR', 'JP', 'OCE', 'SEA', 'VN', 'TW',
] as const

export interface AccountBan {
  permanent: boolean
  until: number | null
}

export interface GameRestriction {
  gamesRemaining: number | null
  until: number | null
}

/** Last reading from Riot. It can only be read while the account is signed in. */
export interface AccountStatus {
  checkedAt: number
  ban: AccountBan | null
  chat: GameRestriction | null
  ranked: GameRestriction | null
  honorLevel: number | null
}

/** Stored in the encrypted vault. Never crosses to the renderer as is. */
export interface Account {
  id: string
  username: string
  password: string
  riotId: string
  region: string
  tier: Tier
  division: string
  lp: number
  note: string
  status?: AccountStatus
}

/** What the interface is allowed to see: everything except the password. */
export type PublicAccount = Omit<Account, 'password'>

/** Edit form payload. An empty password keeps the stored one. */
export type AccountInput = Omit<Account, 'id'> & { id?: string }

export interface VaultStatus {
  exists: boolean
  unlocked: boolean
}

export type LoginStep =
  | 'closing-league'
  | 'opening-client'
  | 'signing-out'
  | 'signing-in'
  | 'verification'
  | 'launching-game'
  | 'done'

export type LoginErrorCode =
  | 'client-missing'
  | 'league-running'
  | 'game-running'
  | 'rejected'
  | 'banned'
  | 'rate-limited'
  | 'captcha-rejected'
  | 'mismatch'
  | 'timeout'
  | 'cancelled'
  | 'client-elevated'
  | 'failed'

export type LoginResult = { ok: true } | { ok: false; code: LoginErrorCode }

export interface Api {
  status(): Promise<VaultStatus>
  create(master: string): Promise<void>
  unlock(master: string): Promise<boolean>
  lock(): Promise<void>
  list(): Promise<PublicAccount[]>
  save(input: AccountInput): Promise<PublicAccount[]>
  remove(id: string): Promise<PublicAccount[]>
  login(id: string, launchGame: boolean, closeLeague: boolean): Promise<LoginResult>
  cancelLogin(): Promise<void>
  exportBackup(): Promise<boolean>
  importBackup(): Promise<boolean>
  onLoginStep(listener: (step: LoginStep) => void): () => void
  onLocked(listener: () => void): () => void
  onAccountsChanged(listener: (accounts: PublicAccount[]) => void): () => void
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
}
