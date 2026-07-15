import { useEffect, useState, useMemo, useRef } from 'react'
import { useStore } from '../store'
import api from '../api'
import {
  UserPlus, Trash2, Pencil, RefreshCw, X, Eye, EyeOff,
  ShieldCheck, User, UserCheck, Wifi, WifiOff, MapPin, Search,
  Check, Clock, Upload, FileText, AlertCircle, KeyRound, Copy
} from 'lucide-react'
import './Users.css'

const fmtDate = (v) => v
  ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(v))
  : '—'

const fmtPhone = (v) => {
  if (!v) return '—'
  const d = v.replace(/\D/g, '')
  if (d.length === 11) return `${d[0]} ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7)}`
  if (d.length === 12) return `+${d[0]} ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7)}`
  return v
}

const isOnline = (lastSeen) => {
  if (!lastSeen) return false
  return (Date.now() - new Date(lastSeen).getTime()) < 10 * 60 * 1000
}

// ── Location picker for cleaners ──────────────────────────────────────────────
function LocationPicker({ selectedIds, onChange }) {
  const [locations, setLocations] = useState([])
  const [locSearch, setLocSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/locations/cleaning?limit=300').then(r => {
      setLocations(r.data.locations || [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    if (!locSearch.trim()) return locations
    const q = locSearch.toLowerCase()
    return locations.filter(l =>
      l.name.toLowerCase().includes(q) || l.city.toLowerCase().includes(q)
    )
  }, [locations, locSearch])

  const toggle = (id) => {
    const ids = selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id]
    onChange(ids)
  }

  const selectedLocs = locations.filter(l => selectedIds.includes(l.id))

  return (
    <div className="u-loc-picker">
      <div className="u-loc-picker-label">
        <MapPin size={12} /> Объекты Kaspi Bank
        {selectedIds.length > 0 && <span className="u-loc-count">{selectedIds.length} выбрано</span>}
      </div>

      {selectedLocs.length > 0 && (
        <div className="u-loc-tags">
          {selectedLocs.map(l => (
            <span key={l.id} className="u-loc-tag">
              {l.city} · {l.name.slice(0, 28)}{l.name.length > 28 ? '…' : ''}
              <button type="button" onClick={() => toggle(l.id)}><X size={10} /></button>
            </span>
          ))}
        </div>
      )}

      <input
        className="u-loc-search"
        placeholder="Поиск по городу или адресу..."
        value={locSearch}
        onChange={e => setLocSearch(e.target.value)}
      />

      <div className="u-loc-list">
        {loading ? (
          <div className="u-loc-empty">Загрузка...</div>
        ) : filtered.length === 0 ? (
          <div className="u-loc-empty">Ничего не найдено</div>
        ) : filtered.map(l => {
          const checked = selectedIds.includes(l.id)
          return (
            <label key={l.id} className={`u-loc-item ${checked ? 'checked' : ''}`}>
              <input type="checkbox" checked={checked} onChange={() => toggle(l.id)} />
              <span className="u-loc-city">{l.city}</span>
              <span className="u-loc-name">{l.name}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ── User modal ────────────────────────────────────────────────────────────────
function UserModal({ user, defaultRole, onClose, onSaved, allUsers = [], callerRole }) {
  const isNew = !user
  const [form, setForm] = useState(
    user
      ? {
          phone: user.phone,
          iin: user.iin || '',
          full_name: user.full_name || '',
          role: user.role,
          is_active: user.is_active,
          cleaning_location_ids: user.cleaning_location_ids || [],
          partner_id: user.partner_id ?? null,
          curator_id: user.curator_id ?? null,
        }
      : { phone: '', iin: '', full_name: '', role: defaultRole || 'cleaner', is_active: true, cleaning_location_ids: [], partner_id: null, curator_id: null }
  )
  const [showPwd, setShowPwd] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const isCleaner = form.role === 'cleaner'

  const partners  = useMemo(() => allUsers.filter(u => u.role === 'partner'), [allUsers])
  const curators  = useMemo(() => allUsers.filter(u => u.role === 'curator'), [allUsers])

  const submit = async (e) => {
    e.preventDefault()
    if (isNew && !form.phone) return setError('Введите номер телефона')
    setLoading(true); setError('')
    try {
      const payload = { ...form }
      if (!isCleaner) { payload.cleaning_location_ids = []; payload.partner_id = null; payload.curator_id = null }
      if (isNew) {
        await api.post('/users', payload)
      } else {
        await api.put(`/users/${user.id}`, payload)
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сохранения')
    } finally { setLoading(false) }
  }

  return (
    <div className="u-backdrop" onClick={onClose}>
      <div className={`u-modal ${isCleaner ? 'u-modal-wide' : ''}`} onClick={e => e.stopPropagation()}>
        <div className="u-modal-header">
          <span>{isNew ? 'Новый пользователь' : 'Редактировать'}</span>
          <button className="u-close" onClick={onClose}><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="u-form">
          {error && <div className="u-error">{error}</div>}

          <div className="u-form-row">
            <label>Телефон
              <input
                value={fmtPhone(form.phone)}
                onChange={e => {
                  let v = e.target.value.replace(/[^\d+]/g, '')
                  if (v.startsWith('+')) v = '+' + v.slice(1).replace(/\D/g,'').slice(0, 11)
                  else v = v.replace(/\D/g,'').slice(0, 11)
                  set('phone', v)
                }}
                placeholder="+7 777 123 4567"
                inputMode="tel"
                maxLength={16}
              />
            </label>
            <label>ИИН
              <input
                value={form.iin}
                onChange={e => set('iin', e.target.value.replace(/\D/g,'').slice(0,12))}
                placeholder="123456789012"
                inputMode="numeric"
                maxLength={12}
              />
            </label>
          </div>
          <label>Полное имя
            <input value={form.full_name} onChange={e => set('full_name', e.target.value)} placeholder="Иван Иванов" />
          </label>

          {isNew && (
            <div className="u-no-pwd-hint">
              Пароль пользователь установит сам при первом входе
            </div>
          )}

          <div className="u-form-row">
            {(!isNew || !defaultRole) && (
              <label>Роль
                <select value={form.role} onChange={e => set('role', e.target.value)}
                  disabled={callerRole === 'auditor'}>
                  <option value="cleaner">Клинер (уборка)</option>
                  {!['partner','auditor'].includes(callerRole) && <option value="curator">Куратор</option>}
                  {!['partner','auditor'].includes(callerRole) && <option value="auditor">Аудитор</option>}
                  {!['partner','auditor'].includes(callerRole) && <option value="kaspi">Kaspi-сотрудник</option>}
                  {!['partner','auditor'].includes(callerRole) && <option value="partner">Партнёр</option>}
                  {!['partner','auditor'].includes(callerRole) && <option value="admin">Администратор</option>}
                </select>
              </label>
            )}
            <label>Статус
              <select value={form.is_active} onChange={e => set('is_active', e.target.value === 'true')}>
                <option value="true">Активен</option>
                <option value="false">Заблокирован</option>
              </select>
            </label>
          </div>

          {isCleaner && (
            <div className="u-form-row">
              <label>Партнёр
                <select value={form.partner_id ?? ''} onChange={e => set('partner_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Не назначен —</option>
                  {partners.map(p => <option key={p.id} value={p.id}>{p.full_name || p.phone}</option>)}
                </select>
              </label>
              <label>Куратор
                <select value={form.curator_id ?? ''} onChange={e => set('curator_id', e.target.value ? Number(e.target.value) : null)}>
                  <option value="">— Не назначен —</option>
                  {curators.map(c => <option key={c.id} value={c.id}>{c.full_name || c.phone}</option>)}
                </select>
              </label>
            </div>
          )}

          {isCleaner && (
            <LocationPicker
              selectedIds={form.cleaning_location_ids}
              onChange={ids => set('cleaning_location_ids', ids)}
            />
          )}

          <div className="u-form-footer">
            <button type="button" className="u-btn-cancel" onClick={onClose}>Отмена</button>
            <button type="submit" className="u-btn-submit" disabled={loading}>
              {loading ? 'Сохранение...' : isNew ? 'Создать' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Pending registrations ─────────────────────────────────────────────────────
function PendingSection() {
  const [regs, setRegs] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(null)

  const load = async () => {
    setLoading(true)
    try { const d = await api.get('/self/pending'); setRegs(d.data.registrations || []) }
    catch {} finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const act = async (id, action) => {
    setProcessing(id)
    try {
      await api.post(`/self/pending/${id}/${action}`)
      load()
    } catch (e) {
      alert(e.response?.data?.error || 'Ошибка')
    } finally { setProcessing(null) }
  }

  const pending = regs.filter(r => r.status === 'pending')
  const done = regs.filter(r => r.status !== 'pending')

  return (
    <div className="u-pending-section">
      <div className="u-pending-header">
        <span>Заявки на регистрацию</span>
        {pending.length > 0 && <span className="u-pending-badge">{pending.length}</span>}
        <button className="u-btn-refresh" style={{ marginLeft: 'auto' }} onClick={load} title="Обновить">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {loading ? (
        <div className="u-empty">Загрузка...</div>
      ) : pending.length === 0 && done.length === 0 ? (
        <div className="u-empty">Заявок нет</div>
      ) : (
        <table className="u-reg-table">
          <thead>
            <tr>
              <th>Имя</th>
              <th>ИИН</th>
              <th>Телефон</th>
              <th>Партнёр</th>
              <th>Объекты</th>
              <th>Дата</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {[...pending, ...done].map(r => (
              <tr key={r.id} className={`u-reg-row ${r.status}`}>
                <td className="u-reg-col-name">{r.full_name || '—'}</td>
                <td className="u-reg-col-iin">{r.iin || '—'}</td>
                <td className="u-reg-col-phone">{fmtPhone(r.phone)}</td>
                <td className="u-reg-col-partner">{r.partner_name || '—'}</td>
                <td className="u-reg-col-locs">
                  {Array.isArray(r.locations) && r.locations.length > 0
                    ? r.locations.map(l => <span key={l.id} className="u-reg-loc-tag">{l.city} · {l.name.slice(0, 28)}</span>)
                    : r.location_name
                      ? <span className="u-reg-loc-tag">{r.location_city} · {r.location_name.slice(0, 28)}</span>
                      : <span className="u-reg-col-empty">—</span>
                  }
                </td>
                <td className="u-reg-col-date">{new Date(r.created_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
                <td className="u-reg-col-status">
                  {r.status === 'pending' ? (
                    <div className="u-reg-actions">
                      <button className="u-reg-btn approve" disabled={processing === r.id} onClick={() => act(r.id, 'approve')}><Check size={12} /> Одобрить</button>
                      <button className="u-reg-btn reject" disabled={processing === r.id} onClick={() => act(r.id, 'reject')}><X size={12} /> Откл.</button>
                    </div>
                  ) : (
                    <span className={`u-reg-status-badge ${r.status}`}>
                      {r.status === 'approved' ? <><Check size={11} /> Одобрено</> : <><X size={11} /> Отклонено</>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ── CSV Import ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g,''))
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/"/g,''))
    const obj = {}
    headers.forEach((h, i) => { obj[h] = vals[i] || '' })
    return obj
  }).filter(r => r.phone)
}

function ImportModal({ onClose, onDone }) {
  const fileRef = useRef(null)
  const [rows, setRows] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const parsed = parseCSV(ev.target.result)
      setRows(parsed); setResult(null); setErr('')
    }
    reader.readAsText(file, 'utf-8')
  }

  const doImport = async () => {
    setLoading(true); setErr('')
    try {
      const d = await api.post('/self/import', { users: rows })
      setResult(d.data)
      onDone()
    } catch (e) {
      setErr(e.response?.data?.error || 'Ошибка импорта')
    } finally { setLoading(false) }
  }

  return (
    <div className="u-backdrop" onClick={onClose}>
      <div className="u-modal u-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="u-modal-header">
          <span>Импорт сотрудников из CSV</span>
          <button className="u-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="u-form">
          <div className="u-import-hint">
            <FileText size={13} />
            CSV колонки: <code>iin, phone, full_name, role</code>
            <span className="u-import-hint-note">Разделитель — запятая. Первая строка — заголовки. Роль по умолчанию: cleaner</span>
          </div>
          <input type="file" ref={fileRef} accept=".csv" onChange={handleFile} style={{ display: 'none' }} />
          <button className="u-btn-file" onClick={() => fileRef.current?.click()}>
            <Upload size={14} /> Выбрать CSV файл
          </button>

          {rows.length > 0 && !result && (
            <>
              <div className="u-import-preview">
                <div className="u-import-count">Найдено записей: {rows.length}</div>
                <div className="u-import-table-wrap">
                  <table className="u-import-table">
                    <thead><tr><th>ИИН</th><th>Телефон</th><th>Имя</th><th>Роль</th></tr></thead>
                    <tbody>
                      {rows.slice(0, 10).map((r, i) => (
                        <tr key={i}>
                          <td>{r.iin || '—'}</td>
                          <td>{fmtPhone(r.phone)}</td>
                          <td>{r.full_name || '—'}</td>
                          <td>{r.role || 'cleaner'}</td>
                        </tr>
                      ))}
                      {rows.length > 10 && <tr><td colSpan={4} className="u-import-more">...и ещё {rows.length - 10}</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
              {err && <div className="u-error">{err}</div>}
              <div className="u-form-footer">
                <button className="u-btn-cancel" onClick={onClose}>Отмена</button>
                <button className="u-btn-submit" onClick={doImport} disabled={loading}>
                  {loading ? 'Импорт...' : `Импортировать ${rows.length} записей`}
                </button>
              </div>
            </>
          )}

          {result && (
            <div className="u-import-result">
              <div className="u-import-stat green"><Check size={14} /> Создано: {result.created}</div>
              <div className="u-import-stat blue"><RefreshCw size={14} /> Обновлено: {result.updated}</div>
              {result.errors?.length > 0 && (
                <div className="u-import-errors">
                  <AlertCircle size={13} /> Ошибки ({result.errors.length}):
                  {result.errors.map((e, i) => <div key={i} className="u-import-err-item">{e}</div>)}
                </div>
              )}
              <button className="u-btn-submit" onClick={onClose}>Готово</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Временный пароль ──────────────────────────────────────────────────────────
function TempPasswordModal({ user, onClose }) {
  const [pwd, setPwd]     = useState(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]   = useState(false)

  const generate = async () => {
    setLoading(true)
    try {
      const res = await api.post(`/users/${user.id}/temp-password`)
      setPwd(res.data.temp_password)
    } catch (e) {
      alert(e.response?.data?.error || 'Ошибка')
    } finally { setLoading(false) }
  }

  const copy = () => {
    navigator.clipboard.writeText(pwd)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="u-backdrop" onClick={onClose}>
      <div className="u-modal" onClick={e => e.stopPropagation()}>
        <div className="u-modal-header">
          <span>Временный пароль</span>
          <button className="u-close" onClick={onClose}><X size={18}/></button>
        </div>
        <div className="u-form">
          <div className="u-tmp-user">
            <div className="u-tmp-avatar">{(user.full_name || user.phone)[0].toUpperCase()}</div>
            <div>
              <div className="u-tmp-name">{user.full_name || '—'}</div>
              <div className="u-tmp-phone">{fmtPhone(user.phone)}</div>
            </div>
          </div>

          {!pwd ? (
            <>
              <p className="u-tmp-hint">
                Будет сгенерирован простой 4-значный пароль. Клинер должен будет его сменить при следующем входе.
              </p>
              <button className="u-btn-submit" onClick={generate} disabled={loading} style={{ marginTop: 4 }}>
                <KeyRound size={15} /> {loading ? 'Генерация...' : 'Сгенерировать'}
              </button>
            </>
          ) : (
            <>
              <p className="u-tmp-hint">Сообщите клинеру этот пароль. После входа он будет обязан его сменить.</p>
              <div className="u-tmp-pwd-wrap">
                <span className="u-tmp-pwd">{pwd}</span>
                <button className="u-tmp-copy" onClick={copy} title="Скопировать">
                  {copied ? <Check size={14}/> : <Copy size={14}/>}
                </button>
              </div>
              {copied && <div className="u-tmp-copied">Скопировано!</div>}
            </>
          )}

          <button className="u-btn-cancel" onClick={onClose} style={{ alignSelf: 'center' }}>Закрыть</button>
        </div>
      </div>
    </div>
  )
}

const ROLE_LABELS = { admin: 'Админ', partner: 'Партнёр', curator: 'Куратор', cleaner: 'Клинер', auditor: 'Аудитор', kaspi: 'Kaspi-сотрудник' }

const ROLE_PILLS = [
  { key: 'admin',   label: 'Админы' },
  { key: 'partner', label: 'Партнёры' },
  { key: 'curator', label: 'Кураторы' },
  { key: 'auditor', label: 'Аудиторы' },
  { key: 'kaspi',   label: 'Kaspi' },
  { key: 'cleaner', label: 'Клинеры' },
]

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Users() {
  const { users, fetchUsers, deleteUser, loading, error, clearError, user: me } = useStore()
  const [modal, setModal]       = useState(null)
  const [tmpModal, setTmpModal] = useState(null) // user object for temp password
  const [mainTab, setMainTab]   = useState('staff') // staff | pending
  const [roleTab, setRoleTab]   = useState('cleaner')
  const [showImport, setShowImport] = useState(false)
  const [search, setSearch]     = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterOnline, setFilterOnline] = useState('')

  const isAdmin   = me?.role === 'admin'
  const isAuditor = me?.role === 'auditor'

  useEffect(() => { clearError(); fetchUsers() }, [])

  const handleDelete = async (u) => {
    if (!window.confirm(`Удалить пользователя ${u.phone}?`)) return
    try { await deleteUser(u.id) } catch {}
  }

  const handleSaved = () => { setModal(null); fetchUsers() }

  const filteredUsers = useMemo(() => {
    let list = users.filter(u => u.role === roleTab)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(u =>
        (u.full_name || '').toLowerCase().includes(q) ||
        (u.phone || '').includes(q) ||
        (u.iin || '').includes(q)
      )
    }
    if (filterStatus === 'active')   list = list.filter(u => u.is_active)
    if (filterStatus === 'blocked')  list = list.filter(u => !u.is_active)
    if (filterOnline === 'online')   list = list.filter(u => isOnline(u.last_seen_at))
    if (filterOnline === 'offline')  list = list.filter(u => !isOnline(u.last_seen_at))
    return list
  }, [users, roleTab, search, filterStatus, filterOnline])

  const hasFilters = search || filterStatus || filterOnline
  const resetFilters = () => { setSearch(''); setFilterStatus(''); setFilterOnline('') }
  const roleCount = (role) => users.filter(u => u.role === role).length
  const isCleaner = roleTab === 'cleaner'

  return (
    <div className="u-page">
      <div className="u-header">
        <div>
          <h1>Пользователи</h1>
          <p>{users.length} {users.length === 1 ? 'пользователь' : users.length < 5 ? 'пользователя' : 'пользователей'}</p>
        </div>
        <div className="u-header-right">
          <button className="u-btn-refresh" onClick={fetchUsers} title="Обновить">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
          {isAdmin && (
            <button className="u-btn-import" onClick={() => setShowImport(true)} title="Импорт CSV">
              <Upload size={15} /> CSV
            </button>
          )}
          <button className="u-btn-create" onClick={() => setModal('create')}>
            <UserPlus size={16} /> Создать
          </button>
        </div>
      </div>

      {/* ── Центрированные главные вкладки ── */}
      <div className="u-main-tabs-wrap">
        <div className="u-main-tabs">
          <button
            className={`u-main-tab ${mainTab === 'staff' ? 'active' : ''}`}
            onClick={() => setMainTab('staff')}
          >
            Сотрудники
            <span className="u-main-tab-count">{users.length}</span>
          </button>
          <button
            className={`u-main-tab ${mainTab === 'pending' ? 'active' : ''}`}
            onClick={() => setMainTab('pending')}
          >
            Заявки
          </button>
        </div>
      </div>

      {error && (
        <div className="u-error-banner">
          {error === 'Admin access required' ? 'Выйдите и войдите снова — нужны права администратора' : error}
        </div>
      )}

      {mainTab === 'pending' && <PendingSection />}

      {mainTab === 'staff' && <>
        {/* ── Роли (пилюли) ── */}
        <div className="u-role-pills">
          {ROLE_PILLS.map(p => (
            <button
              key={p.key}
              className={`u-role-pill ${roleTab === p.key ? 'active' : ''}`}
              onClick={() => { setRoleTab(p.key); setSearch('') }}
            >
              {p.label}
              {roleCount(p.key) > 0 && (
                <span className="u-role-pill-count">{roleCount(p.key)}</span>
              )}
            </button>
          ))}
        </div>

        <div className="u-toolbar">
          <div className="u-search-wrap">
            <Search size={13} className="u-search-ico" />
            <input
              className="u-search-inp"
              placeholder="Поиск по имени, телефону, ИИН..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && <button className="u-search-clr" onClick={() => setSearch('')}><X size={12} /></button>}
          </div>
          <div className="u-filters">
            <select className="u-filter-sel" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">Любой статус</option>
              <option value="active">Активен</option>
              <option value="blocked">Заблокирован</option>
            </select>
            <select className="u-filter-sel" value={filterOnline} onChange={e => setFilterOnline(e.target.value)}>
              <option value="">Онлайн / офлайн</option>
              <option value="online">Онлайн</option>
              <option value="offline">Не в сети</option>
            </select>
            {hasFilters && (
              <button className="u-filter-reset" onClick={resetFilters}><X size={12} /> Сброс</button>
            )}
          </div>
        </div>
        {hasFilters && (
          <div className="u-filter-summary">Показано {filteredUsers.length}</div>
        )}

        <div className="u-table-wrap">
          <table className="u-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Статус</th>
                <th>Телефон</th>
                <th>Имя</th>
                {isCleaner && <th>ИИН</th>}
                {isCleaner && <th>Партнёр</th>}
                {isCleaner && <th>Куратор</th>}
                {isCleaner && <th>Объекты</th>}
                <th>Аккаунт</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 ? (
                <tr><td colSpan={isCleaner ? 11 : 7} className="u-empty">Загрузка...</td></tr>
              ) : filteredUsers.length === 0 ? (
                <tr><td colSpan={isCleaner ? 11 : 7} className="u-empty">
                  {hasFilters ? 'Никого не найдено' : `Нет ${ROLE_PILLS.find(t=>t.key===roleTab)?.label?.toLowerCase() || ''}`}
                </td></tr>
              ) : filteredUsers.map(u => {
                const online = isOnline(u.last_seen_at)
                const locCount = (u.cleaning_location_ids || []).length
                return (
                  <tr key={u.id}>
                    <td className="u-num">{u.id}</td>
                    <td>
                      <span className={`u-online ${online ? 'on' : 'off'}`}>
                        {online ? <Wifi size={13}/> : <WifiOff size={13}/>}
                        {online ? 'Онлайн' : 'Не в сети'}
                      </span>
                    </td>
                    <td className="u-phone">{fmtPhone(u.phone)}</td>
                    <td>{u.full_name || '—'}</td>
                    {isCleaner && (
                      <td className="u-iin">{u.iin || '—'}</td>
                    )}
                    {isCleaner && (
                      <td>
                        {u.partner_name
                          ? <span className="u-sup-badge partner">{u.partner_name}</span>
                          : <span className="u-loc-dash">—</span>}
                      </td>
                    )}
                    {isCleaner && (
                      <td>
                        {u.curator_name
                          ? <span className="u-sup-badge curator">{u.curator_name}</span>
                          : <span className="u-loc-dash">—</span>}
                      </td>
                    )}
                    {isCleaner && (
                      <td>
                        {locCount > 0
                          ? <span className="u-loc-badge"><MapPin size={11} /> {locCount} объект{locCount === 1 ? '' : locCount < 5 ? 'а' : 'ов'}</span>
                          : <span className="u-loc-badge empty">Не назначены</span>}
                      </td>
                    )}
                    <td>
                      {!u.last_seen_at
                        ? <span className="u-acc-badge pending">Не активирован</span>
                        : <span className={`u-acc-badge ${u.is_active ? 'active' : 'inactive'}`}>
                            {u.is_active ? 'Активен' : 'Заблокирован'}
                          </span>
                      }
                    </td>
                    <td className="u-actions">
                      {(isAdmin ? true : isCleaner) && (
                        <button className="u-act-btn key" onClick={() => setTmpModal(u)} title="Временный пароль">
                          <KeyRound size={14}/>
                        </button>
                      )}
                      <button className="u-act-btn" onClick={() => setModal(u)} title="Редактировать">
                        <Pencil size={14}/>
                      </button>
                      {!isAuditor && (
                        <button className="u-act-btn danger" onClick={() => handleDelete(u)} title="Удалить">
                          <Trash2 size={14}/>
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </>}{/* end mainTab === 'staff' */}

      {(modal === 'create' || (modal && modal.id)) && (
        <UserModal
          user={modal === 'create' ? null : modal}
          defaultRole={modal === 'create' ? (isAuditor ? 'cleaner' : roleTab) : undefined}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
          allUsers={users}
          callerRole={me?.role}
        />
      )}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onDone={() => { fetchUsers(); setShowImport(false) }} />
      )}
      {tmpModal && (
        <TempPasswordModal user={tmpModal} onClose={() => setTmpModal(null)} />
      )}
    </div>
  )
}
