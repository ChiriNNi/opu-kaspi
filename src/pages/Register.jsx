import { useState, useEffect, useRef, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { Search, Check, Clock, ChevronRight, Eye, EyeOff } from 'lucide-react'
import './Register.css'

const API = import.meta.env.VITE_API_URL || 'https://opu.ic-group.kz'

async function apiFetch(path, opts = {}) {
  const r = await fetch(`${API}/api/self${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data.error || 'Ошибка запроса')
  return data
}

// ── Location multi-picker (filtered by partner) ───────────────────────────────
function LocPicker({ partnerId, selectedIds, onChange }) {
  const [locs, setLocs] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!partnerId) { setLocs([]); return }
    setLoading(true)
    fetch(`${API}/api/self/partner-locations/${partnerId}`)
      .then(r => r.json()).then(d => setLocs(d.locations || [])).catch(() => setLocs([])).finally(() => setLoading(false))
  }, [partnerId])

  const filtered = useMemo(() => {
    if (!search.trim()) return locs
    const q = search.toLowerCase()
    return locs.filter(l => l.name.toLowerCase().includes(q) || l.city.toLowerCase().includes(q))
  }, [locs, search])

  const toggle = (id) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id])
  }

  if (!partnerId) return null

  return (
    <div className="reg-field">
      <label>Объекты <span className="reg-field-hint">{selectedIds.length > 0 ? `выбрано ${selectedIds.length}` : 'необязательно'}</span></label>
      <div className="reg-loc-picker">
        <div className="reg-loc-search-wrap">
          <Search size={12} />
          <input className="reg-loc-search" placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="reg-loc-list">
          {loading && <div className="reg-loc-empty">Загрузка...</div>}
          {!loading && filtered.length === 0 && <div className="reg-loc-empty">Нет объектов</div>}
          {filtered.map(l => {
            const checked = selectedIds.includes(l.id)
            return (
              <label key={l.id} className={`reg-loc-item ${checked ? 'checked' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(l.id)} />
                <span className="reg-loc-city">{l.city}</span>
                <span className="reg-loc-name">{l.name}</span>
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Password field ────────────────────────────────────────────────────────────
function PwdInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="reg-pwd-wrap">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder || '••••••••'}
        minLength={6}
      />
      <button type="button" onClick={() => setShow(v => !v)}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function Register() {
  const navigate = useNavigate()
  const { setAuth } = useStore()

  const normPhone = (v) => { const d = v.replace(/\D/g,''); return d.length === 11 ? `+${d}` : d.length === 10 ? `+7${d}` : `+${d}` }

  const [step, setStep] = useState('check') // check | set-password | not-found | pending | approved
  const [iin, setIin] = useState('')
  const [phone, setPhone] = useState('')
  const [foundUser, setFoundUser] = useState(null) // { full_name, role }
  const [fullName, setFullName] = useState('')
  const [partnerId, setPartnerId] = useState('')
  const [locationIds, setLocationIds] = useState([])
  const [partners, setPartners] = useState([])
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [requestId, setRequestId] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const pollRef = useRef(null)

  // Load partners once
  useEffect(() => {
    apiFetch('/partners').then(d => setPartners(d.partners || [])).catch(() => {})
  }, [])

  // Poll when pending
  useEffect(() => {
    if (step !== 'pending' || !requestId) return
    pollRef.current = setInterval(async () => {
      try {
        const d = await apiFetch(`/status/${requestId}`)
        if (d.status === 'approved') {
          clearInterval(pollRef.current)
          setStep('approved')
        } else if (d.status === 'rejected') {
          clearInterval(pollRef.current)
          setErr('Запрос отклонён партнёром. Обратитесь к руководителю.')
          setStep('check')
        }
      } catch {}
    }, 5000)
    return () => clearInterval(pollRef.current)
  }, [step, requestId])

  const handleCheck = async (e) => {
    e.preventDefault()
    setErr('')
    if (iin.trim().length < 12) return setErr('ИИН — 12 цифр')
    if (!phone.trim()) return setErr('Введите номер телефона')
    setLoading(true)
    try {
      const d = await apiFetch('/check', { method: 'POST', body: JSON.stringify({ iin: iin.trim(), phone: normPhone(phone) }) })
      if (d.found) {
        if (d.has_password) {
          setErr('Ваш аккаунт уже активен — войдите с паролем.')
        } else {
          setFoundUser(d)
          setStep('set-password')
        }
      } else {
        setStep('not-found')
      }
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSetPassword = async (e) => {
    e.preventDefault()
    setErr('')
    if (password.length < 6) return setErr('Минимум 6 символов')
    if (password !== password2) return setErr('Пароли не совпадают')
    setLoading(true)
    try {
      const d = await apiFetch('/set-password', {
        method: 'POST',
        body: JSON.stringify({ iin: iin.trim(), phone: normPhone(phone), password })
      })
      setAuth(d.token, d.user)
      navigate(d.user.role === 'cleaner' ? '/work' : '/', { replace: true })
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRequest = async (e) => {
    e.preventDefault()
    setErr('')
    if (!fullName.trim()) return setErr('Введите ваше имя')
    if (!partnerId) return setErr('Выберите партнёра')
    setLoading(true)
    try {
      const d = await apiFetch('/request', {
        method: 'POST',
        body: JSON.stringify({ iin: iin.trim(), phone: normPhone(phone), full_name: fullName.trim(), partner_id: partnerId, location_ids: locationIds })
      })
      setRequestId(d.request_id)
      setStep('pending')
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSetPasswordAfterApproval = async (e) => {
    e.preventDefault()
    setErr('')
    if (password.length < 6) return setErr('Минимум 6 символов')
    if (password !== password2) return setErr('Пароли не совпадают')
    setLoading(true)
    try {
      const d = await apiFetch('/set-password', {
        method: 'POST',
        body: JSON.stringify({ iin: iin.trim(), phone: normPhone(phone), password })
      })
      setAuth(d.token, d.user)
      navigate('/work', { replace: true })
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="reg-page">
      <div className="reg-box">
        {/* Header */}
        <div className="reg-header">
          <div className="reg-logo">IC Group</div>
          <div className="reg-steps">
            <span className={`reg-step-dot ${step === 'check' ? 'active' : ['set-password','not-found','pending','approved'].includes(step) ? 'done' : ''}`} />
            <span className="reg-step-line" />
            <span className={`reg-step-dot ${['not-found','pending','approved'].includes(step) ? 'active' : step === 'approved' ? 'done' : ''}`} />
            <span className="reg-step-line" />
            <span className={`reg-step-dot ${step === 'approved' || step === 'set-password' ? 'active' : ''}`} />
          </div>
        </div>

        {/* ── Step 1: check ── */}
        {step === 'check' && (
          <form onSubmit={handleCheck} className="reg-form">
            <h2>Первый вход</h2>
            <p className="reg-sub">Введите ваш ИИН и номер телефона</p>
            {err && <div className="reg-err">{err}</div>}
            <div className="reg-field">
              <label>ИИН</label>
              <input
                value={iin}
                onChange={e => setIin(e.target.value.replace(/\D/g, '').slice(0, 12))}
                placeholder="123456789012"
                inputMode="numeric"
                maxLength={12}
                required
              />
              <span className="reg-field-hint">{iin.length}/12</span>
            </div>
            <div className="reg-field">
              <label>Номер телефона</label>
              <input
                value={(() => {
                  const d = phone.replace(/\D/g, '').slice(0, 11)
                  if (d.length <= 1) return d
                  if (d.length <= 4) return `${d[0]} ${d.slice(1)}`
                  if (d.length <= 7) return `${d[0]} ${d.slice(1,4)} ${d.slice(4)}`
                  if (d.length <= 9) return `${d[0]} ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7)}`
                  return `${d[0]} ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7,9)} ${d.slice(9)}`
                })()}
                onChange={e => setPhone(e.target.value.replace(/\D/g,'').slice(0, 11))}
                placeholder="7 777 123 4567"
                inputMode="numeric"
                maxLength={15}
                required
              />
            </div>
            <button type="submit" className="reg-btn-primary" disabled={loading}>
              {loading ? 'Проверка...' : 'Продолжить'} {!loading && <ChevronRight size={15} />}
            </button>
            <div className="reg-login-link">
              Уже есть пароль? <Link to="/login">Войти</Link>
            </div>
          </form>
        )}

        {/* ── Step 2a: set password (found in DB, no password) ── */}
        {step === 'set-password' && (
          <form onSubmit={handleSetPassword} className="reg-form">
            <div className="reg-found-badge">
              <Check size={16} /> Найден в системе
            </div>
            <h2>Привет, {foundUser?.full_name?.split(' ')[0] || 'сотрудник'}!</h2>
            <p className="reg-sub">Придумайте пароль для входа в систему</p>
            {err && <div className="reg-err">{err}</div>}
            <div className="reg-field">
              <label>Новый пароль</label>
              <PwdInput value={password} onChange={setPassword} placeholder="Минимум 6 символов" />
            </div>
            <div className="reg-field">
              <label>Повторите пароль</label>
              <PwdInput value={password2} onChange={setPassword2} />
            </div>
            <button type="submit" className="reg-btn-primary" disabled={loading}>
              {loading ? 'Сохранение...' : 'Войти в систему'} {!loading && <ChevronRight size={15} />}
            </button>
            <button type="button" className="reg-btn-back" onClick={() => { setStep('check'); setErr('') }}>
              ← Назад
            </button>
          </form>
        )}

        {/* ── Step 2b: not found — request access ── */}
        {step === 'not-found' && (
          <form onSubmit={handleRequest} className="reg-form">
            <h2>Запрос доступа</h2>
            <p className="reg-sub">Вас нет в базе. Заполните форму — партнёр подтвердит вашу заявку.</p>
            {err && <div className="reg-err">{err}</div>}
            <div className="reg-field">
              <label>Ваше имя</label>
              <input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Иван Иванов"
                required
              />
            </div>
            <div className="reg-field">
              <label>Ваш партнёр / руководитель</label>
              <select value={partnerId} onChange={e => { setPartnerId(e.target.value); setLocationIds([]) }} required>
                <option value="">— выберите партнёра —</option>
                {partners.map(p => (
                  <option key={p.id} value={p.id}>{p.full_name} ({p.phone_hint})</option>
                ))}
              </select>
            </div>
            <LocPicker partnerId={partnerId} selectedIds={locationIds} onChange={setLocationIds} />
            <button type="submit" className="reg-btn-primary" disabled={loading}>
              {loading ? 'Отправка...' : 'Отправить заявку'} {!loading && <ChevronRight size={15} />}
            </button>
            <button type="button" className="reg-btn-back" onClick={() => { setStep('check'); setErr('') }}>
              ← Назад
            </button>
          </form>
        )}

        {/* ── Step 3: pending ── */}
        {step === 'pending' && (
          <div className="reg-form reg-pending">
            <div className="reg-pending-icon"><Clock size={32} /></div>
            <h2>Ожидание подтверждения</h2>
            <p className="reg-sub">
              Запрос отправлен партнёру. Как только он одобрит — вы автоматически перейдёте к следующему шагу.
            </p>
            <div className="reg-pending-pulse">
              <span /><span /><span />
            </div>
            <p className="reg-pending-note">Страница проверяет статус каждые 5 секунд</p>
          </div>
        )}

        {/* ── Step 4: approved — set password ── */}
        {step === 'approved' && (
          <form onSubmit={handleSetPasswordAfterApproval} className="reg-form">
            <div className="reg-found-badge green">
              <Check size={16} /> Заявка одобрена!
            </div>
            <h2>Придумайте пароль</h2>
            <p className="reg-sub">Теперь установите пароль для входа</p>
            {err && <div className="reg-err">{err}</div>}
            <div className="reg-field">
              <label>Новый пароль</label>
              <PwdInput value={password} onChange={setPassword} placeholder="Минимум 6 символов" />
            </div>
            <div className="reg-field">
              <label>Повторите пароль</label>
              <PwdInput value={password2} onChange={setPassword2} />
            </div>
            <button type="submit" className="reg-btn-primary" disabled={loading}>
              {loading ? 'Сохранение...' : 'Войти в систему'} {!loading && <ChevronRight size={15} />}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
