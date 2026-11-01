import { useCallback, useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import {
  REGIONS, TIERS,
  type AccountInput, type AccountStatus, type GameRestriction, type LoginErrorCode, type LoginStep,
  type PublicAccount, type SeasonRank, type Tier, type VaultStatus,
} from '../../shared/types'

const LOGIN_STEPS: [LoginStep, string][] = [
  ['closing-league', 'Fechando o League'],
  ['opening-client', 'Abrindo o Riot Client'],
  ['signing-out', 'Saindo da conta atual'],
  ['connecting', 'Conectando à tela de login'],
  ['typing', 'Preenchendo os dados'],
  ['confirming', 'Confirmando o login'],
  ['launching-game', 'Abrindo o League'],
]

const ERROR_TEXT: Record<LoginErrorCode, string> = {
  'client-missing': 'Riot Client não encontrado neste PC.',
  'league-running': 'O League está aberto.',
  'game-running': 'Há uma partida em andamento. Termine antes de trocar de conta.',
  rejected: 'A Riot recusou o login. Confira o usuário e a senha.',
  banned: 'Esta conta está banida, então o League não foi aberto.',
  'rate-limited': 'Muitas tentativas. Aguarde um pouco.',
  'captcha-rejected': 'O captcha foi recusado. Tente novamente.',
  mismatch: 'O Riot Client entrou em outra conta.',
  timeout: 'O login demorou demais.',
  cancelled: 'Login cancelado.',
  'client-elevated': 'Não consegui fechar o Riot Client. Ele pode estar rodando como administrador.',
  failed: 'Não foi possível concluir o login.',
}

const TIER_COLOR: Record<Tier, string> = {
  Challenger: '#f4d67a', Grandmaster: '#e0524d', Master: '#b45fd6', Diamond: '#6f9cff', Emerald: '#2fc48d',
  Platinum: '#2fb6c4', Gold: '#d8a93f', Silver: '#a9b5bd', Bronze: '#a9704a', Iron: '#7a7470', Unranked: '#56606a',
}

const EMPTY: AccountInput = {
  username: '', password: '', riotId: '', region: 'BR', tier: 'Unranked', division: '', lp: 0, note: '',
}

function Titlebar() {
  return (
    <header className="titlebar">
      <div className="brand"><span className="crest" /> LEAGUE VAULT</div>
      <div className="window-controls">
        <button aria-label="Minimizar" onClick={() => window.api.windowControl('minimize')}>–</button>
        <button aria-label="Maximizar" onClick={() => window.api.windowControl('maximize')}>▢</button>
        <button aria-label="Fechar" onClick={() => window.api.windowControl('close')}>✕</button>
      </div>
    </header>
  )
}

/** Password input that warns when Caps Lock is on. */
function PasswordInput({ value, onChange, placeholder, autoFocus }: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  autoFocus?: boolean
}) {
  const [capsLock, setCapsLock] = useState(false)
  const check = (event: KeyboardEvent | MouseEvent): void => setCapsLock(event.getModifierState('CapsLock'))
  return (
    <div className="password">
      <input
        type="password" placeholder={placeholder} autoFocus={autoFocus} value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={check} onKeyUp={check} onClick={check} onBlur={() => setCapsLock(false)}
      />
      {capsLock && <span className="caps" role="status">⇪ Caps Lock ativado</span>}
    </div>
  )
}

function SecurityHelp() {
  return (
    <details className="help" open>
      <summary>Por que uma senha mestra?</summary>
      <ul>
        <li><b>Protege as senhas das suas contas.</b> Elas ficam criptografadas neste PC e só abrem com a senha mestra.</li>
        <li><b>Mesmo com o arquivo do cofre, ninguém lê as contas sem ela.</b> Nem outros programas do seu PC, nem quem usar seu computador.</li>
        <li><b>Nada sai do seu PC.</b> Não existe servidor nem conta online.</li>
        <li><b>O cofre trava sozinho</b> depois de 15 minutos sem uso.</li>
        <li><b>Por isso, não há como recuperá-la.</b> Se esquecer, você perde o cofre e precisa cadastrar as contas de novo. Guarde num lugar seguro.</li>
      </ul>
    </details>
  )
}

function LockScreen({ exists, onDone }: { exists: boolean; onDone: () => void }) {
  const [master, setMaster] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setError('')
    if (!exists && master.length < 8) return setError('Use pelo menos 8 caracteres.')
    if (!exists && master !== confirm) return setError('As senhas não são iguais.')
    setBusy(true)
    try {
      if (exists) {
        if (await window.api.unlock(master)) onDone()
        else setError('Senha mestra incorreta.')
      } else {
        await window.api.create(master)
        onDone()
      }
    } finally {
      setBusy(false)
      setMaster('')
      setConfirm('')
    }
  }

  return (
    <main className="lock">
      <form className="lock-card" onSubmit={submit}>
        <h1>{exists ? 'COFRE TRAVADO' : 'CRIE SEU COFRE'}</h1>
        <p>{exists
          ? 'Digite sua senha mestra para acessar as contas.'
          : 'Crie a senha que vai proteger todas as suas contas.'}</p>
        {!exists && <SecurityHelp />}
        {!exists && (
          <p className="disclaimer">
            Projeto independente, sem afiliação com a Riot Games. Use por sua conta e risco: não nos responsabilizamos
            por banimentos, penalidades ou perda de contas.
          </p>
        )}
        <PasswordInput placeholder="Senha mestra" autoFocus value={master} onChange={setMaster} />
        {!exists && <PasswordInput placeholder="Repita a senha mestra" value={confirm} onChange={setConfirm} />}
        {error && <div className="error">{error}</div>}
        <button className="gold" disabled={busy}>{busy ? 'AGUARDE...' : exists ? 'DESTRAVAR' : 'CRIAR COFRE'}</button>
      </form>
    </main>
  )
}

function AccountForm({ initial, onClose, onSaved }: {
  initial: AccountInput
  onClose: () => void
  onSaved: (accounts: PublicAccount[]) => void
}) {
  const [form, setForm] = useState(initial)
  const [error, setError] = useState('')
  const set = <K extends keyof AccountInput>(key: K, value: AccountInput[K]): void => setForm({ ...form, [key]: value })
  const editing = Boolean(initial.id)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!form.username.trim() || (!editing && !form.password)) return setError('Informe usuário e senha.')
    if (form.riotId.trim() && !/.+#.+/.test(form.riotId)) return setError('Use o Riot ID no formato Nome#TAG.')
    onSaved(await window.api.save(form))
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" onSubmit={submit} onMouseDown={e => e.stopPropagation()}>
        <h2>{editing ? 'EDITAR CONTA' : 'ADICIONAR CONTA'}</h2>
        <label>Usuário da Riot<input autoFocus value={form.username} onChange={e => set('username', e.target.value)} /></label>
        <label>Senha<PasswordInput placeholder={editing ? 'Deixe vazio para manter a atual' : ''} value={form.password} onChange={value => set('password', value)} /></label>
        <div className="row">
          <label>Riot ID<input placeholder="Nome#TAG" value={form.riotId} onChange={e => set('riotId', e.target.value)} /></label>
          <label>Região<select value={form.region} onChange={e => set('region', e.target.value)}>{REGIONS.map(r => <option key={r}>{r}</option>)}</select></label>
        </div>
        <p className="hint">O elo, a divisão e os PDL vêm do Riot ID e da região, automaticamente.</p>
        <label>Anotação<input placeholder="ex.: duo com Leo" value={form.note} onChange={e => set('note', e.target.value)} /></label>
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>CANCELAR</button>
          <button className="gold">SALVAR</button>
        </div>
      </form>
    </div>
  )
}

function remaining(until: number): string {
  const hours = Math.max(1, Math.ceil((until - Date.now()) / 3_600_000))
  return hours > 48 ? `${Math.ceil(hours / 24)}D` : `${hours}H`
}

function restrictionText({ gamesRemaining, until }: GameRestriction): string {
  return [gamesRemaining !== null && `${gamesRemaining}P`, until !== null && until > Date.now() && remaining(until)]
    .filter(Boolean).join(' · ')
}

/** Chips for the last reading; `P` is games left and `H`/`D` time left. */
function Penalties({ status }: { status?: AccountStatus }) {
  if (!status) return <div className="penalties unknown">Status: entre na conta para verificar</div>
  const chips: [string, string][] = []
  const { ban, chat, ranked, honorLevel } = status
  if (ban?.permanent) chips.push(['Banida permanentemente', 'Banimento permanente'])
  else if (ban?.until && ban.until > Date.now()) chips.push([`Banida ${remaining(ban.until)}`, 'Banimento temporário'])
  const chatText = chat && restrictionText(chat)
  if (chatText) chips.push([`Chat ${chatText}`, 'Restrição de chat'])
  const rankedText = ranked && restrictionText(ranked)
  if (rankedText) chips.push([`Ranqueada ${rankedText}`, 'Restrição de ranqueada'])
  if (honorLevel !== null && honorLevel < 2) chips.push(['Honra baixa', `Honra nível ${honorLevel}`])
  const checked = `Verificado em ${new Date(status.checkedAt).toLocaleString('pt-BR')}`
  if (!chips.length) return <div className="penalties clean" title={checked}>✓ Sem penalidades</div>
  return (
    <div className="penalties" title={checked}>
      <span>PENALIDADES ATIVAS</span>
      <div>{chips.map(([text, title]) => <b key={text} title={title}>{text}</b>)}</div>
    </div>
  )
}

const EMBLEM_URL = 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default'

/** Riot's emblem, loaded at runtime and never bundled; a badge when offline. */
function Emblem({ tier }: { tier: Tier }) {
  const [failed, setFailed] = useState(false)
  if (tier !== 'Unranked' && !failed) {
    return <img className="emblem-image" alt="" src={`${EMBLEM_URL}/${tier.toLowerCase()}.png`} onError={() => setFailed(true)} />
  }
  return <div className="emblem" style={{ '--tier': TIER_COLOR[tier] } as React.CSSProperties}><span>{tier === 'Unranked' ? '—' : tier[0]}</span></div>
}

function seasonText({ tier, division, lp }: SeasonRank): string {
  return [tier, division, lp ? `${lp} PDL` : ''].filter(Boolean).join(' ')
}

function AccountCard({ account, disabled, onLogin, onEdit, onDelete }: {
  account: PublicAccount
  disabled: boolean
  onLogin: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [name, tag] = account.riotId.split('#')
  const ranked = account.tier !== 'Unranked'
  const games = (account.wins ?? 0) + (account.losses ?? 0)
  const winRate = games ? Math.round(((account.wins ?? 0) / games) * 100) : 0
  return (
    <article className="card">
      <div className="card-head">
        <h3>{name || account.username}{tag && <small> #{tag}</small>}</h3>
        <div className="card-tools">
          <button aria-label="Editar" title="Editar" onClick={onEdit}>✎</button>
          <button aria-label="Excluir" title="Excluir" onClick={onDelete}>🗑</button>
        </div>
      </div>
      <div className="card-meta">
        <span className="region">{account.region}</span>
        {account.level !== undefined && <span className="level">Nível <b>{account.level}</b></span>}
        <span className="login-name">{account.username}</span>
      </div>
      <div className="card-rank">
        <Emblem tier={account.tier} />
        <div>
          <strong style={{ color: TIER_COLOR[account.tier] }}>{ranked ? `${account.tier} ${account.division}`.trim().toUpperCase() : 'SEM ELO'}</strong>
          {ranked && <span className="lp">{account.lp} PDL</span>}
          {ranked && <div className="bar"><i style={{ width: `${Math.min(account.lp, 100)}%`, background: TIER_COLOR[account.tier] }} /></div>}
        </div>
      </div>
      <dl className="stats">
        {games > 0 && <div><dt>Win rate</dt><dd className={winRate >= 50 ? 'good' : 'bad'}>{winRate}% <small>{account.wins}V {account.losses}D</small></dd></div>}
        {account.lastSeason && <div><dt>Temporada passada</dt><dd>{seasonText(account.lastSeason)}</dd></div>}
        {account.peak && <div><dt>Pico</dt><dd>{seasonText(account.peak)} <small>{account.peak.season}</small></dd></div>}
        {account.mmr && <div title={`Estimativa do whatismymmr.com. A Riot não divulga o MMR. Próximo de ${account.mmr.closestRank}.`}><dt>MMR estimado</dt><dd>~{account.mmr.avg} <small>±{account.mmr.err}</small></dd></div>}
      </dl>
      {account.rankMissing && <div className="rank-missing">Riot ID não encontrado no OP.GG. Confira o nome e a região.</div>}
      {!account.riotId.trim() && <div className="rank-missing">Adicione o Riot ID para ver o elo.</div>}
      <Penalties status={account.status} />
      <p className="note">{account.note || ' '}</p>
      <button className="login" disabled={disabled} onClick={onLogin}>› ENTRAR</button>
    </article>
  )
}

function LoginProgress({ account, step, launchGame, closedLeague }: {
  account: PublicAccount
  step: LoginStep
  launchGame: boolean
  closedLeague: boolean
}) {
  const steps = LOGIN_STEPS.filter(([id]) =>
    (id !== 'closing-league' || closedLeague) && (id !== 'launching-game' || launchGame))
  const verification = step === 'verification'
  const shown: LoginStep = verification ? 'confirming' : step
  const current = step === 'done' ? steps.length : steps.findIndex(([id]) => id === shown)
  return (
    <div className="login-screen" role="status">
      <div className="login-side">
        <div className="login-mark" aria-hidden="true"><i /><i /><i /></div>
        <h2>ENTRANDO</h2>
        <span>{account.riotId || account.username}</span>
      </div>
      <div className="login-steps">
        <div className="login-bar"><i style={{ width: `${(Math.max(current, 0) / steps.length) * 100}%` }} /></div>
        <ol>
          {steps.map(([id, label], index) => (
            <li key={id} className={index < current ? 'done' : index === current ? 'active' : ''}>
              <span className="dot">{index < current ? '✓' : ''}</span>{label}
            </li>
          ))}
        </ol>
        {verification && <p className="verify">A Riot pediu uma verificação. Resolva o captcha ou o 2FA na janela dela.</p>}
        <button className="ghost" onClick={() => void window.api.cancelLogin()}>CANCELAR</button>
      </div>
    </div>
  )
}

function Vault({ onLock }: { onLock: () => void }) {
  const [accounts, setAccounts] = useState<PublicAccount[]>([])
  const [search, setSearch] = useState('')
  const [region, setRegion] = useState('')
  const [tier, setTier] = useState<Tier | ''>('')
  const [launchGame, setLaunchGame] = useState(true)
  const [editing, setEditing] = useState<AccountInput | null>(null)
  const [step, setStep] = useState<LoginStep | null>(null)
  const [closedLeague, setClosedLeague] = useState(false)
  const [loggingIn, setLoggingIn] = useState<PublicAccount | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const [askClose, setAskClose] = useState<PublicAccount | null>(null)

  useEffect(() => { void window.api.list().then(setAccounts) }, [])
  useEffect(() => window.api.onLoginStep(setStep), [])
  useEffect(() => window.api.onAccountsChanged(setAccounts), [])
  useEffect(() => window.api.onRanksRefreshing(setRefreshing), [])

  const visible = useMemo(() => {
    const query = search.toLowerCase()
    return accounts.filter(a =>
      (!region || a.region === region) && (!tier || a.tier === tier)
      && [a.username, a.riotId, a.note].some(text => text.toLowerCase().includes(query)))
  }, [accounts, search, region, tier])

  const distribution = useMemo(
    () => TIERS.map(t => [t, accounts.filter(a => a.tier === t).length] as const), [accounts])

  async function doLogin(account: PublicAccount, closeLeague = false): Promise<void> {
    setMessage('')
    setAskClose(null)
    setClosedLeague(closeLeague)
    setLoggingIn(account)
    setStep('opening-client')
    const result = await window.api.login(account.id, launchGame, closeLeague)
    setStep(null)
    setLoggingIn(null)
    if (result.ok) setMessage(`Entrou em ${account.riotId || account.username}.`)
    else if (result.code === 'league-running') setAskClose(account)
    else setMessage(ERROR_TEXT[result.code])
  }

  async function remove(account: PublicAccount): Promise<void> {
    if (confirm(`Excluir a conta ${account.riotId || account.username}?`)) setAccounts(await window.api.remove(account.id))
  }

  return (
    <div className="vault">
      <aside className="sidebar">
        <button className="gold add" onClick={() => setEditing(EMPTY)}>＋ ADICIONAR CONTA</button>
        <h4>DISTRIBUIÇÃO DE ELO</h4>
        <ul className="tiers">
          {distribution.map(([name, count]) => (
            <li key={name}>
              <button className={tier === name ? 'active' : ''} onClick={() => setTier(tier === name ? '' : name)}>
                <i style={{ background: TIER_COLOR[name] }} />{name}<b>{count}</b>
              </button>
            </li>
          ))}
        </ul>
        <div className="side-actions">
          <button disabled={refreshing} onClick={() => void window.api.refreshRanks()}>{refreshing ? '↻ Atualizando elos...' : '↻ Atualizar elos'}</button>
          <button onClick={() => void window.api.importBackup().then(done => done && onLock())}>⇩ Importar backup</button>
          <button onClick={() => void window.api.exportBackup()}>⇧ Exportar backup</button>
          <button onClick={() => void window.api.lock().then(onLock)}>🔒 Travar cofre</button>
        </div>
      </aside>
      <main className="content">
        <div className="content-head">
          <div><span className="eyebrow">SUAS CONTAS</span><h1>CONTAS</h1></div>
          <label className="check"><input type="checkbox" checked={launchGame} onChange={e => setLaunchGame(e.target.checked)} /> Abrir o League após entrar</label>
        </div>
        <div className="filters">
          <input placeholder="Buscar nome, tag ou usuário..." value={search} onChange={e => setSearch(e.target.value)} />
          <select value={region} onChange={e => setRegion(e.target.value)}>
            <option value="">Todas as regiões</option>{REGIONS.map(r => <option key={r}>{r}</option>)}
          </select>
          <span className="count">{visible.length} de {accounts.length} contas</span>
        </div>
        {message && <div className="toast" role="status">{message}</div>}
        {accounts.length === 0
          ? <div className="empty">Nenhuma conta ainda. Clique em <b>Adicionar conta</b>.</div>
          : (
            <section className="grid">
              {visible.map(account => (
                <AccountCard
                  key={account.id} account={account} disabled={step !== null}
                  onLogin={() => void doLogin(account)}
                  onEdit={() => setEditing({ ...account, password: '' })}
                  onDelete={() => void remove(account)}
                />
              ))}
            </section>
          )}
      </main>

      {editing && <AccountForm initial={editing} onClose={() => setEditing(null)} onSaved={list => { setAccounts(list); setEditing(null) }} />}

      {step && loggingIn && (
        <LoginProgress account={loggingIn} step={step} launchGame={launchGame} closedLeague={closedLeague} />
      )}

      {askClose && (
        <div className="modal-backdrop">
          <div className="modal progress">
            <p>O League está aberto. Fechar para trocar de conta?</p>
            <div className="modal-actions">
              <button className="ghost" onClick={() => setAskClose(null)}>NÃO</button>
              <button className="gold" onClick={() => void doLogin(askClose, true)}>FECHAR E ENTRAR</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const refresh = useCallback(() => { void window.api.status().then(setStatus) }, [])

  useEffect(refresh, [refresh])
  useEffect(() => window.api.onLocked(refresh), [refresh])

  return (
    <div className="app">
      <Titlebar />
      {status && (status.unlocked
        ? <Vault onLock={refresh} />
        : <LockScreen exists={status.exists} onDone={refresh} />)}
    </div>
  )
}
