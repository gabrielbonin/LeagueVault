/**
 * Riot Client automation. The sign-in technique (headless service plus a
 * temporary debuggable renderer filling Riot's own form) follows
 * League Accounts by Tariolle, MIT licensed. See NOTICE.
 *
 * Captcha and 2FA are never bypassed: the Riot window opens for the player.
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import https from 'node:https'
import { createServer } from 'node:net'
import { dirname, join, sep } from 'node:path'
import { promisify } from 'node:util'
import WebSocket from 'ws'
import type { AccountBan, AccountStatus, GameRestriction, LoginErrorCode, LoginStep } from '../shared/types'

const run = promisify(execFile)
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export class LoginError extends Error {
  constructor(readonly code: LoginErrorCode) {
    super(code)
  }
}

export interface LoginRequest {
  username: string
  password: string
  launchGame: boolean
  closeLeague: boolean
  onStep: (step: LoginStep) => void
  onStatus: (status: Partial<AccountStatus>) => void
  signal: AbortSignal
}

function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new LoginError('cancelled')
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    checkCancelled(signal)
    await delay(Math.min(50, end - Date.now()))
  }
  checkCancelled(signal)
}

export function clientPath(): string | null {
  const data = process.env.ProgramData ?? 'C:\\ProgramData'
  try {
    const installs = JSON.parse(readFileSync(join(data, 'Riot Games', 'RiotClientInstalls.json'), 'utf8'))
    for (const key of ['rc_default', 'rc_live']) {
      if (typeof installs[key] === 'string' && existsSync(installs[key])) return installs[key]
    }
  } catch {
    // Fall through to the default location.
  }
  const fallback = 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe'
  return existsSync(fallback) ? fallback : null
}

const lockfilePath = (): string =>
  join(process.env.LOCALAPPDATA ?? '', 'Riot Games', 'Riot Client', 'Config', 'lockfile')

interface Response {
  status: number
  body: any // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** The Riot Client's local HTTPS API, described by its lockfile. */
class LocalApi {
  private readonly agent = new https.Agent({ rejectUnauthorized: false })

  private constructor(
    readonly port: number,
    readonly token: string,
    readonly pid: number,
  ) {}

  static read(path = lockfilePath()): LocalApi | null {
    try {
      const [, pid, port, token] = readFileSync(path, 'utf8').trim().split(':')
      if (!Number(port) || !token) return null
      return new LocalApi(Number(port), token, Number(pid))
    } catch {
      return null
    }
  }

  request(method: string, path: string, payload?: unknown): Promise<Response | null> {
    return new Promise(resolve => {
      const body = payload === undefined ? undefined : JSON.stringify(payload)
      const request = https.request(
        {
          host: '127.0.0.1', port: this.port, path, method, agent: this.agent, timeout: 3000,
          auth: `riot:${this.token}`,
          headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {},
        },
        response => {
          let text = ''
          response.setEncoding('utf8')
          response.on('data', chunk => (text += chunk))
          response.on('end', () => {
            let parsed: unknown = null
            try {
              parsed = JSON.parse(text)
            } catch {
              parsed = null
            }
            resolve({ status: response.statusCode ?? 0, body: parsed })
          })
        },
      )
      request.on('timeout', () => request.destroy())
      request.on('error', () => resolve(null))
      request.end(body)
    })
  }

  get(path: string): Promise<Response | null> {
    return this.request('GET', path)
  }

  async session(): Promise<'signed-in' | 'signed-out' | 'action' | 'unknown'> {
    const response = await this.get('/player-session-lifecycle/v1/session')
    if (response?.status !== 200) return 'unknown'
    const { puuid, loginState, actionRequired } = response.body ?? {}
    if (typeof puuid === 'string' && puuid) return 'signed-in'
    if (loginState === 'PendingLoginStrategy') return 'signed-out'
    return actionRequired === true ? 'action' : 'unknown'
  }

  async userinfo(): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
    const response = await this.get('/rso-auth/v1/authorization/userinfo')
    if (response?.status !== 200) return null
    const info = response.body?.userInfo
    try {
      return typeof info === 'string' ? JSON.parse(info) : info
    } catch {
      return null
    }
  }

  async username(): Promise<string | null> {
    const name = (await this.userinfo())?.username
    return typeof name === 'string' && name ? name : null
  }
}

/** Riot Client region to use so League signs in where the account plays. */
export function leagueRegion(
  info: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  regions: Record<string, { rso_platform_id?: string }>,
  current: string,
): string | null {
  const accounts = [info?.lol, ...(Array.isArray(info?.lol_region) ? info.lol_region : [])]
  const platforms: string[] = accounts
    .filter(account => account && account.active !== false && typeof account.cpid === 'string')
    .map(account => account.cpid)
  if (!platforms.length) return null
  if (platforms.includes(regions[current]?.rso_platform_id ?? '')) return null
  const platform = platforms[0]
  const region = regions[platform]?.rso_platform_id
    ? platform
    : Object.keys(regions).find(key => regions[key].rso_platform_id === platform)
  return region && region !== current ? region : null
}

async function followLeagueRegion(api: LocalApi): Promise<void> {
  const [info, locale, regions] = await Promise.all([
    api.userinfo(),
    api.get('/riotclient/region-locale'),
    api.get('/data-store/v1/system-settings/region_data'),
  ])
  if (!info || locale?.status !== 200 || regions?.status !== 200) return
  const region = leagueRegion(info, regions.body, locale.body?.region)
  if (region) await api.request('PUT', '/riotclient/region-locale', { region, locale: locale.body?.locale })
}

interface RunningProcess {
  name: string
  pid: number
  path: string
}

async function processes(names: string[]): Promise<RunningProcess[]> {
  const filter = names.map(name => `Name='${name}'`).join(' or ')
  const script =
    `Get-CimInstance Win32_Process -Filter "${filter}" | ` +
    'Select-Object Name,ProcessId,ExecutablePath | ConvertTo-Json -Compress'
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true })
  if (!stdout.trim()) return []
  const parsed = JSON.parse(stdout)
  return (Array.isArray(parsed) ? parsed : [parsed]).map(item => ({
    name: item.Name, pid: item.ProcessId, path: item.ExecutablePath ?? '',
  }))
}

const kill = (pid: number): Promise<unknown> =>
  run('taskkill.exe', ['/F', '/PID', String(pid)], { windowsHide: true }).catch(() => undefined)

/** Ends the Riot Client of this installation only, never game processes. */
async function stopClient(service: string, signal: AbortSignal): Promise<void> {
  const root = dirname(service).toLowerCase() + sep
  const running = async (): Promise<RunningProcess[]> =>
    (await processes(['RiotClientServices.exe', 'Riot Client.exe'])).filter(process =>
      process.path.toLowerCase().startsWith(root),
    )
  for (const process of await running()) await kill(process.pid)
  const start = Date.now()
  while ((await running()).length) {
    if (Date.now() - start > 10_000) throw new LoginError('client-elevated')
    await sleep(200, signal)
  }
}

function startService(service: string, headless: boolean): void {
  spawn(service, headless ? ['--headless'] : [], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('no port'))))
    })
  })

/** Runs inside Riot's renderer. Fills the official form; returns no secrets. */
const RENDERER_SCRIPT = `(() => {
  const field = name => document.querySelector('input[name="' + name + '"]');
  const props = input => input && input[Object.keys(input).find(k => k.startsWith('__reactProps$'))];
  const action = name => window.riotInvoke({ request: JSON.stringify({ name, params: [] }) });
  globalThis.__leagueVault = {
    ready: () => !!field('username') && !!field('password')
      && document.querySelector('[data-testid="login-form"]')?.dataset.loggingIn === 'false',
    fill(username, password) {
      action('Window.Minimize');
      for (const [name, value] of [['username', username], ['password', password]]) {
        const input = field(name);
        if (typeof props(input)?.onChange !== 'function' || input.disabled) return false;
        input.value = value;
        props(input).onChange({ target: input, currentTarget: input });
      }
      return true;
    },
    submit() {
      const form = field('password')?.form;
      if (!form) return false;
      form.requestSubmit();
      return true;
    },
    status() {
      const tooltip = document.querySelector('[data-testid="login-form-error-tooltip"]');
      if (field('password') && !field('password').value && tooltip) return 'rejected';
      const overlay = document.querySelector('[aria-label="hcaptcha challenge"]');
      const visible = overlay && overlay.getBoundingClientRect().width > 0
        && getComputedStyle(overlay).visibility !== 'hidden' && getComputedStyle(overlay).opacity !== '0';
      return visible ? 'verification' : 'pending';
    },
    show() { action('Window.Restore'); action('Window.Show'); },
  };
  return true;
})()`

/** Minimal DevTools client. Expressions can contain credentials: never log them. */
class Cdp {
  private sequence = 0
  private readonly pending = new Map<number, (message: any) => void>() // eslint-disable-line @typescript-eslint/no-explicit-any

  private constructor(private readonly socket: WebSocket) {
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString())
      this.pending.get(message.id)?.(message)
      this.pending.delete(message.id)
    })
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url)
      socket.once('open', () => resolve(new Cdp(socket)))
      socket.once('error', reject)
    })
  }

  eval(expression: string): Promise<unknown> {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new LoginError('failed'))
      }, 15_000)
      this.pending.set(id, message => {
        clearTimeout(timer)
        if (message.error || message.result?.exceptionDetails) reject(new LoginError('failed'))
        else resolve(message.result?.result?.value)
      })
      this.socket.send(JSON.stringify({
        id, method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }))
    })
  }

  close(): void {
    try {
      this.socket.send(JSON.stringify({ id: 0, method: 'Browser.close' }))
      this.socket.close()
    } catch {
      // Already gone.
    }
  }
}

/** The temporary Riot window. Always replaced by a normal one when done. */
class Renderer {
  cdp: Cdp | null = null
  private child: ChildProcess | null = null
  private normal: { ux: string; args: string[] } | null = null
  private needsRestore = false

  constructor(private readonly service: string) {}

  async signIn(request: LoginRequest): Promise<void> {
    const { username, password, onStep, signal } = request
    this.needsRestore = true
    await stopClient(this.service, signal)
    startService(this.service, true)

    const start = Date.now()
    let api: LocalApi | null = null
    for (;;) {
      checkCancelled(signal)
      if (Date.now() - start > 45_000) throw new LoginError('timeout')
      api = LocalApi.read()
      const session = await api?.session()
      if (session === 'signed-out') break
      if (session === 'signed-in') {
        const name = await api?.username()
        if (name?.toLowerCase() === username.toLowerCase()) return
        throw new LoginError('mismatch')
      }
      await sleep(300, signal)
    }
    if (!api) throw new LoginError('failed')

    const root = dirname(this.service)
    const data = join(process.env.LOCALAPPDATA ?? '', 'Riot Games', 'Riot Client')
    const [machine, session] = await Promise.all([
      api.get('/riotclient/machine-id'),
      api.get('/product-session/v1/host-session/id'),
    ])
    if (machine?.status !== 200 || session?.status !== 200) throw new LoginError('failed')
    const ux = join(root, 'RiotClientElectron', 'Riot Client.exe')
    const args = [
      `--app-port=${api.port}`,
      `--remoting-auth-token=${api.token}`,
      `--app-pid=${api.pid}`,
      `--machine-id=${machine.body}`,
      `--session-id=${session.body}`,
      `--app-root=${root}`,
      `--user-data-root=${data}`,
      `--log-dir=${join(data, 'Logs', 'Riot Client UX Logs')}`,
      '--crashpad-environment=prod',
      '--enable-hardware-acceleration',
    ]
    this.normal = { ux, args }

    const port = await freePort()
    this.child = spawn(ux, [
      ...args,
      '--allow-chrome-dev-tools',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
    ], { stdio: 'ignore' })
    this.cdp = await Cdp.connect(await this.debuggerUrl(port, signal))
    await this.cdp.eval(RENDERER_SCRIPT)

    const ready = Date.now()
    while ((await this.cdp.eval('globalThis.__leagueVault.ready()')) !== true) {
      if (Date.now() - ready > 30_000) throw new LoginError('failed')
      await sleep(200, signal)
    }
    await sleep(1500, signal) // Riot's own auth setup settles after the form appears.

    const fill = `globalThis.__leagueVault.fill(...${JSON.stringify([username, password])})`
    if ((await this.cdp.eval(fill)) !== true) throw new LoginError('failed')
    await sleep(300, signal)
    if ((await this.cdp.eval('globalThis.__leagueVault.submit()')) !== true) throw new LoginError('failed')

    await this.awaitResult(api, username, onStep, signal)
  }

  private async debuggerUrl(port: number, signal: AbortSignal): Promise<string> {
    const start = Date.now()
    while (Date.now() - start < 30_000) {
      checkCancelled(signal)
      try {
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<Record<string, string>>
        const page = targets.find(target => target.type === 'page' && target.title === 'Riot Client')
        const url = page?.webSocketDebuggerUrl
        if (url?.startsWith(`ws://127.0.0.1:${port}/devtools/page/`)) return url
      } catch {
        // Renderer still starting.
      }
      await sleep(200, signal)
    }
    throw new LoginError('failed')
  }

  private async awaitResult(
    api: LocalApi, username: string, onStep: (step: LoginStep) => void, signal: AbortSignal,
  ): Promise<void> {
    const start = Date.now()
    let shown = false
    for (;;) {
      checkCancelled(signal)
      if (Date.now() - start > 300_000) throw new LoginError('timeout')
      if ((await api.session()) === 'signed-in') {
        const name = await api.username()
        if (name) {
          if (name.toLowerCase() === username.toLowerCase()) return
          throw new LoginError('mismatch')
        }
      }
      const state = await this.cdp?.eval('globalThis.__leagueVault.status()')
      if (state === 'rejected') throw new LoginError('rejected')
      const auth = shown ? null : await api.get('/rso-authenticator/v1/authentication')
      if (!shown && (state === 'verification' || auth?.body?.type === 'multifactor')) {
        await this.cdp?.eval('globalThis.__leagueVault.show()')
        onStep('verification')
        shown = true
      }
      await sleep(300, signal)
    }
  }

  closeDebugger(): void {
    this.cdp?.close()
    this.cdp = null
    this.child?.kill()
    this.child = null
  }

  replacedByGame(): void {
    this.needsRestore = false
  }

  /** Reopens a normal Riot window; a debuggable one must never stay behind. */
  async restore(): Promise<void> {
    this.closeDebugger()
    if (!this.needsRestore) return
    this.needsRestore = false
    await delay(500)
    if (this.normal && LocalApi.read()) spawn(this.normal.ux, this.normal.args, { detached: true, stdio: 'ignore' }).unref()
    else startService(this.service, false)
  }
}

async function ensureLeagueClosed(closeLeague: boolean, onStep: (step: LoginStep) => void): Promise<void> {
  const running = await processes(['LeagueClient.exe', 'LeagueClientUx.exe', 'League of Legends.exe'])
  if (running.some(process => process.name === 'League of Legends.exe')) throw new LoginError('game-running')
  if (!running.length) return
  if (!closeLeague) throw new LoginError('league-running')
  onStep('closing-league')
  for (const process of running) await kill(process.pid)
}

async function awaitProductContext(signal: AbortSignal): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < 60_000) {
    const body = (await LocalApi.read()?.get('/player-session-lifecycle/v1/session'))?.body
    if (body?.loginState === 'PendingProductContext' && body?.actionRequired !== true) return
    await sleep(300, signal)
  }
  throw new LoginError('timeout')
}

export async function login(request: LoginRequest): Promise<void> {
  const { username, launchGame, closeLeague, onStep, signal } = request
  const service = clientPath()
  if (!service) throw new LoginError('client-missing')
  await ensureLeagueClosed(closeLeague, onStep)

  const renderer = new Renderer(service)
  try {
    onStep('opening-client')
    if (!LocalApi.read()) startService(service, true)
    const start = Date.now()
    let signOutSent = false
    let alreadySignedIn = false
    for (;;) {
      checkCancelled(signal)
      if (Date.now() - start > 60_000) throw new LoginError('timeout')
      const api = LocalApi.read()
      const session = await api?.session()
      if (session === 'signed-out') break
      if (session === 'signed-in') {
        const name = await api?.username()
        if (name?.toLowerCase() === username.toLowerCase()) {
          alreadySignedIn = true
          break
        }
        if (name && !signOutSent) {
          onStep('signing-out')
          await api?.request('DELETE', '/player-session-lifecycle/v1/session')
          signOutSent = true
        }
      }
      await sleep(300, signal)
    }

    if (!alreadySignedIn) {
      onStep('signing-in')
      await renderer.signIn(request)
    }
    const ban = banFrom(await LocalApi.read()?.userinfo(), Date.now())
    request.onStatus({ ban })
    if (!launchGame) return
    // Riot disconnects a suspended account as soon as the game starts.
    if (ban) throw new LoginError('banned')

    await awaitProductContext(signal)
    const api = LocalApi.read()
    if (!api) throw new LoginError('failed')
    await followLeagueRegion(api)
    renderer.closeDebugger()
    onStep('launching-game')
    const launch = await api.request('POST', '/product-launcher/v1/products/league_of_legends/patchlines/live', {})
    if (!launch || (launch.status >= 300 && launch.status !== 423)) throw new LoginError('failed')
    renderer.replacedByGame()
  } finally {
    await renderer.restore()
  }
  onStep('done')
}

/** League suspension from Riot's userinfo; chat restrictions do not count. */
export function banFrom(info: any, now: number): AccountBan | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  const restrictions = info?.ban?.restrictions
  if (!Array.isArray(restrictions)) return null
  let until = 0
  for (const restriction of restrictions) {
    if (restriction?.scope !== 'lol') continue
    if (restriction.type === 'PERMANENT_BAN') return { permanent: true, until: null }
    const expires = restriction.type === 'TIME_BAN' ? Number(restriction.dat?.expirationMillis) : 0
    if (expires > now) until = Math.max(until, expires)
  }
  return until ? { permanent: false, until } : null
}

/** Active restriction from a League response; null means there is none. */
export function restrictionFrom(body: any, now: number): GameRestriction | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!body || typeof body !== 'object') return null
  const games = Object.entries(body).find(
    ([key, value]) => /gamesRemaining/i.test(key) && typeof value === 'number',
  )?.[1] as number | undefined
  const expires = Number(body.expirationMillis) || 0
  const active = {
    gamesRemaining: games && games > 0 ? games : null,
    until: expires > now ? expires : null,
  }
  return active.gamesRemaining !== null || active.until !== null ? active : null
}

/**
 * Waits for the League client of `username`, then reads its penalties. They
 * only exist there, for the signed-in account, so this runs after a launch.
 */
export async function readLeagueStatus(username: string): Promise<Partial<AccountStatus> | null> {
  const start = Date.now()
  while (Date.now() - start < 180_000) {
    await delay(3000)
    const [client] = await processes(['LeagueClientUx.exe']).catch(() => [])
    const api = client?.path ? LocalApi.read(join(dirname(client.path), 'lockfile')) : null
    const session = (await api?.get('/lol-login/v1/session'))?.body
    if (!api || session?.state !== 'SUCCEEDED') continue
    if (String(session.username).toLowerCase() !== username.toLowerCase()) return null
    await delay(5000) // Penalties load shortly after the session.
    const [chat, ranked, honor] = await Promise.all([
      api.get('/lol-player-behavior/v1/chat-restriction'),
      api.get('/lol-leaver-buster/v1/ranked-restriction'),
      api.get('/lol-honor-v2/v1/profile'),
    ])
    const level = honor?.status === 200 ? honor.body?.honorLevel : undefined
    return {
      chat: chat?.status === 200 ? restrictionFrom(chat.body, Date.now()) : null,
      ranked: ranked?.status === 200 ? restrictionFrom(ranked.body, Date.now()) : null,
      honorLevel: typeof level === 'number' ? level : null,
    }
  }
  return null
}
