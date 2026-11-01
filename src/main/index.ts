import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { AccountInput, AccountStatus, LoginResult, LoginStep } from '../shared/types'
import { fetchRank } from './ranks'
import { login, LoginError, readLeagueStatus } from './riot'
import { Vault } from './vault'

const AUTO_LOCK_MS = 15 * 60 * 1000
const RANK_REFRESH_MS = 30 * 60 * 1000
const RANK_REQUEST_GAP_MS = 1500

let window: BrowserWindow | null = null
let vault: Vault
let lockTimer: NodeJS.Timeout | null = null
let loginAbort: AbortController | null = null
let rankTimer: NodeJS.Timeout | null = null
let refreshingRanks = false

function updateStatus(id: string, status: Partial<AccountStatus>): void {
  const accounts = vault.updateStatus(id, status)
  if (accounts) window?.webContents.send('vault:changed', accounts)
}

async function refreshRank(id: string, region: string, riotId: string): Promise<void> {
  const rank = await fetchRank(region, riotId)
  const accounts = rank ? vault.updateRank(id, rank) : null
  if (accounts) window?.webContents.send('vault:changed', accounts)
}

/** One account at a time, so OP.GG is not hammered. */
async function refreshRanks(): Promise<void> {
  if (refreshingRanks || !vault.unlocked) return
  refreshingRanks = true
  window?.webContents.send('ranks:refreshing', true)
  try {
    for (const { id, region, riotId } of vault.list()) {
      if (!vault.unlocked) break
      if (!riotId.trim()) continue
      await refreshRank(id, region, riotId)
      await new Promise(resolve => setTimeout(resolve, RANK_REQUEST_GAP_MS))
    }
  } finally {
    refreshingRanks = false
    window?.webContents.send('ranks:refreshing', false)
  }
}

function startRankRefresh(): void {
  if (rankTimer) clearInterval(rankTimer)
  rankTimer = setInterval(() => void refreshRanks(), RANK_REFRESH_MS)
  void refreshRanks()
}

function lockNow(): void {
  if (rankTimer) clearInterval(rankTimer)
  rankTimer = null
  vault.lock()
  window?.webContents.send('vault:locked')
}

function touch(): void {
  if (lockTimer) clearTimeout(lockTimer)
  if (vault.unlocked) lockTimer = setTimeout(lockNow, AUTO_LOCK_MS)
}

/** Every handler counts as activity for the auto-lock timer. */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R): void {
  ipcMain.handle(channel, (_event, ...args) => {
    const result = fn(...(args as A))
    touch()
    return result
  })
}

function registerIpc(): void {
  handle('vault:status', () => ({ exists: vault.exists, unlocked: vault.unlocked }))
  handle('vault:create', async (master: string) => {
    await vault.create(master)
    startRankRefresh()
  })
  handle('vault:unlock', async (master: string) => {
    const unlocked = await vault.unlock(master)
    if (unlocked) startRankRefresh()
    return unlocked
  })
  handle('vault:lock', lockNow)
  handle('vault:list', () => vault.list())
  handle('vault:save', (input: AccountInput) => {
    const accounts = vault.save(input)
    const saved = accounts.find(item => item.username === input.username.trim() && item.region === input.region)
    if (saved?.riotId.trim()) void refreshRank(saved.id, saved.region, saved.riotId)
    return accounts
  })
  handle('ranks:refresh', refreshRanks)
  handle('vault:remove', (id: string) => vault.remove(id))

  handle('vault:export', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(window!, {
      defaultPath: 'leaguevault-backup.json',
      filters: [{ name: 'Backup do LeagueVault', extensions: ['json'] }],
    })
    if (canceled || !filePath) return false
    vault.exportTo(filePath)
    return true
  })

  handle('vault:import', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window!, {
      filters: [{ name: 'Backup do LeagueVault', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (canceled || !filePaths[0]) return false
    vault.importFrom(filePaths[0])
    return true
  })

  handle('riot:login', async (id: string, launchGame: boolean, closeLeague: boolean): Promise<LoginResult> => {
    const account = vault.get(id)
    if (!account) return { ok: false, code: 'failed' }
    loginAbort = new AbortController()
    try {
      await login({
        username: account.username,
        password: account.password,
        launchGame,
        closeLeague,
        signal: loginAbort.signal,
        onStep: (step: LoginStep) => window?.webContents.send('riot:step', step),
        onStatus: status => updateStatus(id, status),
      })
      if (launchGame) {
        void readLeagueStatus(account.username).then(reading => {
          if (!reading) return
          updateStatus(id, reading.status)
          const accounts = reading.rank && vault.updateRank(id, reading.rank)
          if (accounts) window?.webContents.send('vault:changed', accounts)
        })
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, code: error instanceof LoginError ? error.code : 'failed' }
    } finally {
      loginAbort = null
    }
  })
  handle('riot:cancel', () => loginAbort?.abort())

  ipcMain.on('window:control', (_event, action: string) => {
    if (action === 'minimize') window?.minimize()
    if (action === 'close') window?.close()
    if (action === 'maximize') {
      if (window?.isMaximized()) window.unmaximize()
      else window?.maximize()
    }
  })
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1180,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#010a13',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  window.once('ready-to-show', () => window?.show())
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

if (!app.requestSingleInstanceLock()) app.quit()

app.on('second-instance', () => {
  if (window?.isMinimized()) window.restore()
  window?.focus()
})
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => vault?.lock())

void app.whenReady().then(() => {
  vault = new Vault(join(app.getPath('userData'), 'vault.json'))
  registerIpc()
  createWindow()
})
