import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { Eye, EyeOff, HelpCircle, ChevronDown } from 'lucide-react'
import './Login.css'

const API = import.meta.env.VITE_API_URL || 'https://opu.ic-group.kz'

const LOGIN_HELP = {
  ru: [
    'Введите ИИН (12 цифр) и номер телефона, которые вам выдал куратор или администратор.',
    'Нажмите «Продолжить →».',
    'Если входите первый раз — установите пароль (минимум 6 символов) и повторите его.',
    'Если пароль уже есть — просто введите его и нажмите «Войти».',
  ],
  kk: [
    'Кураторыңыз немесе әкімші берген ИИН (12 сан) және телефон нөмірін енгізіңіз.',
    '«Жалғастыру →» түймесін басыңыз.',
    'Бірінші рет кірсеңіз — құпия сөз орнатыңыз (кемінде 6 таңба) және оны қайталап енгізіңіз.',
    'Құпия сөзіңіз бұрыннан бар болса — оны енгізіп, «Кіру» түймесін басыңыз.',
  ],
}

function normPhone(v) {
  const d = v.replace(/\D/g, '')
  // 8XXXXXXXXXX — привычная запись «через 8» (домашний код вместо +7) — заменяем 8 на 7
  if (d.length === 11 && d[0] === '8') return `+7${d.slice(1)}`
  return d.length === 11 ? `+${d}` : d.length === 10 ? `+7${d}` : `+${d}`
}

function fmtPhone(v) {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 1) return d
  if (d.length <= 4) return `${d[0]} ${d.slice(1)}`
  if (d.length <= 7) return `${d[0]} ${d.slice(1,4)} ${d.slice(4)}`
  if (d.length <= 9) return `${d[0]} ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7)}`
  return `${d[0]} ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7,9)} ${d.slice(9)}`
}

export default function Login() {
  const [step, setStep] = useState('check') // check | password | setpwd
  const [iin, setIin] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [showPwd, setShowPwd] = useState(false)
  const [userId, setUserId] = useState(null)
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [helpLang, setHelpLang] = useState('ru')
  const { setAuth } = useStore()
  const navigate = useNavigate()

  const handleCheck = async (e) => {
    e.preventDefault()
    if (iin.trim().length < 12) return setError('ИИН должен содержать 12 цифр')
    if (phone.replace(/\D/g,'').length < 10) return setError('Введите корректный номер телефона')
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API}/api/self/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iin: iin.trim(), phone: normPhone(phone) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      if (!d.found) return setError('Пользователь не найден. Обратитесь к куратору.')
      setUserId(d.user_id)
      setFullName(d.full_name || '')
      if (d.has_password) setStep('password')
      else setStep('setpwd')
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: normPhone(phone), password }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Неверный пароль')
      setAuth(d.token, d.user)
      const role = d.user?.role
      if (role === 'cleaner') navigate('/work', { replace: true })
      else navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  const handleSetPassword = async (e) => {
    e.preventDefault()
    if (password.length < 6) return setError('Минимум 6 символов')
    if (password !== password2) return setError('Пароли не совпадают')
    setLoading(true); setError('')
    try {
      const r = await fetch(`${API}/api/self/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iin: iin.trim(), phone: normPhone(phone), password }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Ошибка')
      setAuth(d.token, d.user)
      const role = d.user?.role
      if (role === 'cleaner') navigate('/work', { replace: true })
      else navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  return (
    <div className="lg-page">
      <div className="lg-card">
        <img src="/logo_IC_group.png" alt="IC Group" className="lg-logo-img" />

        {step === 'check' && (
          <>
            <div className="lg-sub">Введите ИИН и номер телефона</div>
            <form onSubmit={handleCheck} className="lg-form">
              {error && <div className="lg-error">{error}</div>}
              <div className="lg-field">
                <label className="lg-label">ИИН</label>
                <div className="lg-input-wrap">
                  <input
                    className="lg-input"
                    placeholder="123456789012"
                    value={iin}
                    onChange={e => setIin(e.target.value.replace(/\D/g,'').slice(0,12))}
                    inputMode="numeric"
                    maxLength={12}
                    autoComplete="off"
                    required
                  />
                </div>
              </div>
              <div className="lg-field">
                <label className="lg-label">Телефон</label>
                <div className="lg-input-wrap">
                  <input
                    className="lg-input"
                    placeholder="7 777 123 4567"
                    value={fmtPhone(phone)}
                    onChange={e => setPhone(e.target.value.replace(/\D/g,'').slice(0,11))}
                    inputMode="numeric"
                    maxLength={15}
                    autoComplete="off"
                    required
                  />
                </div>
              </div>
              <button type="submit" className="lg-btn" disabled={loading}>
                {loading ? 'Проверяем...' : 'Продолжить →'}
              </button>
            </form>
          </>
        )}

        {step === 'password' && (
          <>
            {fullName && <div className="lg-welcome">Привет, {fullName}!</div>}
            <div className="lg-sub">Введите пароль</div>
            <form onSubmit={handleLogin} className="lg-form">
              {error && <div className="lg-error">{error}</div>}
              <div className="lg-field">
                <label className="lg-label">Пароль</label>
                <div className="lg-input-wrap">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    className="lg-input"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    autoFocus
                    required
                  />
                  <button type="button" className="lg-eye" onClick={() => setShowPwd(v => !v)}>
                    {showPwd ? <EyeOff size={15}/> : <Eye size={15}/>}
                  </button>
                </div>
              </div>
              <button type="submit" className="lg-btn" disabled={loading}>
                {loading ? 'Входим...' : 'Войти'}
              </button>
              <button type="button" className="lg-back" onClick={() => { setStep('check'); setError('') }}>
                ← Назад
              </button>
            </form>
          </>
        )}

        {step === 'setpwd' && (
          <>
            {fullName && <div className="lg-welcome">Привет, {fullName}!</div>}
            <div className="lg-sub">Установите пароль для входа</div>
            <form onSubmit={handleSetPassword} className="lg-form">
              {error && <div className="lg-error">{error}</div>}
              <div className="lg-field">
                <label className="lg-label">Новый пароль</label>
                <div className="lg-input-wrap">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    className="lg-input"
                    placeholder="Минимум 6 символов"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoFocus
                    required
                  />
                  <button type="button" className="lg-eye" onClick={() => setShowPwd(v => !v)}>
                    {showPwd ? <EyeOff size={15}/> : <Eye size={15}/>}
                  </button>
                </div>
              </div>
              <div className="lg-field">
                <label className="lg-label">Повторите пароль</label>
                <div className="lg-input-wrap">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    className="lg-input"
                    placeholder="••••••••"
                    value={password2}
                    onChange={e => setPassword2(e.target.value)}
                    required
                  />
                </div>
              </div>
              <button type="submit" className="lg-btn" disabled={loading}>
                {loading ? 'Сохраняем...' : 'Сохранить и войти'}
              </button>
              <button type="button" className="lg-back" onClick={() => { setStep('check'); setError('') }}>
                ← Назад
              </button>
            </form>
          </>
        )}

        <button type="button" className="lg-help-toggle" onClick={() => setHelpOpen(v => !v)}>
          <HelpCircle size={14} />
          <span>Как войти / Қалай кіру керек?</span>
          <ChevronDown size={14} style={{ transform: helpOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s', marginLeft: 'auto' }} />
        </button>

        {helpOpen && (
          <div className="lg-help-box">
            <div className="ls-quiz-lang-tabs" style={{ marginBottom: 10 }}>
              <button type="button" className={`ls-quiz-lang-tab ${helpLang === 'ru' ? 'active' : ''}`} onClick={() => setHelpLang('ru')}>RU</button>
              <button type="button" className={`ls-quiz-lang-tab ${helpLang === 'kk' ? 'active' : ''}`} onClick={() => setHelpLang('kk')}>ҚАЗ</button>
            </div>
            <ol className="lg-help-steps">
              {LOGIN_HELP[helpLang].map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}
