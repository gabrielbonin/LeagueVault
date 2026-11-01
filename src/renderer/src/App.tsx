import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  REGIONS, TIERS,
  type AccountInput, type LoginErrorCode, type LoginStep, type PublicAccount, type Tier, type VaultStatus,
} from '../../shared/types'

const STEP_TEXT: Record<LoginStep, string> = {
  'closing-league': 'Fechando o League...',
  'opening-client': 'Preparando o Riot Client...',
  'signing-out': 'Saindo da conta atual...',
  'signing-in': 'Entrando na conta...',
  verification: 'Resolva o captcha ou o 2FA na janela da Riot',
  'launching-game': 'Abrindo o League...',
  done: 'Pronto!',
}

const ERROR_TEXT: Record<LoginErrorCode, string> = {
  'client-missing': 'Riot Client não encontrado neste PC.',
  'league-running': 'O League está aberto.',
  'game-running': 'Há uma partida em andamento. Termine antes de trocar de conta.',
  rejected: 'A Riot recusou o login. Confira o usuário e a senha.',
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
          : 'A senha mestra protege todas as contas. Se você esquecê-la, não há como recuperar.'}</p>
        <input type="password" placeholder="Senha mestra" autoFocus value={master} onChange={e => setMaster(e.target.value)} />
        {!exists && <input type="password" placeholder="Repita a senha mestra" value={confirm} onChange={e => setConfirm(e.target.value)} />}
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
    onSaved(await window.api.save(form))
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <form className="modal" onSubmit={submit} onMouseDown={e => e.stopPropagation()}>
        <h2>{editing ? 'EDITAR CONTA' : 'ADICIONAR CONTA'}</h2>
        <label>Usuário da Riot<input autoFocus value={form.username} onChange={e => set('username', e.target.value)} /></label>
        <label>Senha<input type="password" placeholder={editing ? 'Deixe vazio para manter a atual' : ''} value={form.password} onChange={e => set('password', e.target.value)} /></label>
        <label>Riot ID<input placeholder="Nome#TAG" value={form.riotId} onChange={e => set('riotId', e.target.value)} /></label>
        <div className="row">
          <label>Região<select value={form.region} onChange={e => set('region', e.target.value)}>{REGIONS.map(r => <option key={r}>{r}</option>)}</select></label>
          <label>Elo<select value={form.tier} onChange={e => set('tier', e.target.value as Tier)}>{TIERS.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Divisão<select value={form.division} onChange={e => set('division', e.target.value)}>{['', 'I', 'II', 'III', 'IV'].map(d => <option key={d}>{d}</option>)}</select></label>
          <label>PDL<input type="number" min={0} value={form.lp} onChange={e => set('lp', Number(e.target.value))} /></label>
        </div>
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

function Emblem({ tier }: { tier: Tier }) {
  return <div className="emblem" style={{ '--tier': TIER_COLOR[tier] } as React.CSSProperties}><span>{tier === 'Unranked' ? '—' : tier[0]}</span></div>
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
  return (
    <article className="card">
      <div className="card-head">
        <h3>{name || account.username}{tag && <small> #{tag}</small>}</h3>
        <div className="card-tools">
          <button aria-label="Editar" title="Editar" onClick={onEdit}>✎</button>
          <button aria-label="Excluir" title="Excluir" onClick={onDelete}>🗑</button>
        </div>
      </div>
      <div className="card-meta"><span className="region">{account.region}</span><span className="login-name">{account.username}</span></div>
      <div className="card-rank">
        <Emblem tier={account.tier} />
        <div>
          <strong style={{ color: TIER_COLOR[account.tier] }}>{ranked ? `${account.tier} ${account.division}`.trim().toUpperCase() : 'SEM ELO'}</strong>
          {ranked && <span className="lp">{account.lp} PDL</span>}
          {ranked && <div className="bar"><i style={{ width: `${Math.min(account.lp, 100)}%`, background: TIER_COLOR[account.tier] }} /></div>}
        </div>
      </div>
      <p className="note">{account.note || ' '}</p>
      <button className="login" disabled={disabled} onClick={onLogin}>› ENTRAR</button>
    </article>
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
  const [message, setMessage] = useState('')
  const [askClose, setAskClose] = useState<PublicAccount | null>(null)

  useEffect(() => { void window.api.list().then(setAccounts) }, [])
  useEffect(() => window.api.onLoginStep(setStep), [])

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
    setStep('opening-client')
    const result = await window.api.login(account.id, launchGame, closeLeague)
    setStep(null)
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

      {step && (
        <div className="modal-backdrop">
          <div className="modal progress">
            <div className="spinner" />
            <p>{STEP_TEXT[step]}</p>
            <button className="ghost" onClick={() => void window.api.cancelLogin()}>CANCELAR</button>
          </div>
        </div>
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
