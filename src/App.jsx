import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Users from './pages/Users'
import Login from './pages/Login'
import Register from './pages/Register'
import PstPage from './pages/PstPage'
import PstReports from './pages/PstReports'
import Locations from './pages/Locations'
import Checklists from './pages/Checklists'
import Objects from './pages/Objects'
import ChecklistUser from './pages/ChecklistUser'
import CleanerWork from './pages/CleanerWork'
import Training from './pages/Training'
import Placeholder from './pages/Placeholder'
import { useStore } from './store'
import api from './api'
import { Eye, EyeOff } from 'lucide-react'

// ── Принудительная смена пароля ───────────────────────────────────────────────
function ForceChangePassword({ onDone }) {
  const { user, logout } = useStore()
  const [pwd, setPwd]   = useState('')
  const [pwd2, setPwd2] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr]   = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (pwd.length < 4) return setErr('Минимум 4 символа')
    if (pwd !== pwd2)   return setErr('Пароли не совпадают')
    setLoading(true); setErr('')
    try {
      await api.post('/users/me/set-password', { new_password: pwd })
      onDone()
    } catch (e) {
      setErr(e.response?.data?.error || 'Ошибка')
    } finally { setLoading(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 9999, backdropFilter: 'blur(6px)'
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, width: '100%', maxWidth: 380,
        padding: '32px 28px', boxShadow: '0 24px 60px rgba(0,0,0,0.2)', margin: '0 16px'
      }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#1A1D1E', marginBottom: 6 }}>
            Установите новый пароль
          </div>
          <div style={{ fontSize: 13, color: 'rgba(26,29,30,0.5)', lineHeight: 1.5 }}>
            Вы вошли с временным паролем. Пожалуйста, установите постоянный пароль.
          </div>
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {err && (
            <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 12px', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
              {err}
            </div>
          )}
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,29,30,0.5)', marginBottom: 6 }}>Новый пароль</div>
            <div style={{ position: 'relative' }}>
              <input
                type={show ? 'text' : 'password'}
                value={pwd}
                onChange={e => setPwd(e.target.value)}
                placeholder="Минимум 4 символа"
                autoFocus
                style={{
                  width: '100%', padding: '10px 40px 10px 12px', borderRadius: 10,
                  border: '1.5px solid rgba(26,29,30,0.12)', fontSize: 14,
                  fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                  background: '#f8f9f5', color: '#1A1D1E'
                }}
              />
              <button type="button" onClick={() => setShow(v => !v)} style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(26,29,30,0.4)', padding: 2
              }}>
                {show ? <EyeOff size={15}/> : <Eye size={15}/>}
              </button>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(26,29,30,0.5)', marginBottom: 6 }}>Повторите пароль</div>
            <input
              type={show ? 'text' : 'password'}
              value={pwd2}
              onChange={e => setPwd2(e.target.value)}
              placeholder="Повторите пароль"
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: '1.5px solid rgba(26,29,30,0.12)', fontSize: 14,
                fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
                background: '#f8f9f5', color: '#1A1D1E'
              }}
            />
          </div>
          <button type="submit" disabled={loading} style={{
            marginTop: 8, padding: '12px', borderRadius: 12, border: 'none',
            background: '#1A1D1E', color: '#fff', fontSize: 15, fontWeight: 800,
            cursor: 'pointer', fontFamily: 'inherit', transition: 'background 0.15s'
          }}>
            {loading ? 'Сохранение...' : 'Сохранить пароль'}
          </button>
          <button type="button" onClick={logout} style={{
            padding: '8px', background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 13, color: 'rgba(26,29,30,0.4)', fontFamily: 'inherit'
          }}>
            Выйти из аккаунта
          </button>
        </form>
      </div>
    </div>
  )
}

export default function App() {
  const { token, user, checkAuth, setAuth } = useStore()
  const [needsReset, setNeedsReset] = useState(false)
  const location = useLocation()

  useEffect(() => { checkAuth() }, [])

  // Проверяем флаг после загрузки пользователя
  useEffect(() => {
    if (user?.password_reset_required) setNeedsReset(true)
    else setNeedsReset(false)
  }, [user?.password_reset_required])

  const handlePasswordDone = async () => {
    // Обновляем флаг в store через /auth/me
    try {
      const res = await api.get('/auth/me')
      const { setAuth: sa, ..._ } = useStore.getState()
      useStore.setState({ user: res.data.user })
    } catch {}
    setNeedsReset(false)
  }

  if (!token) {
    return (
      <Routes>
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/pst"      element={<PstPage />} />
        <Route path="*"         element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  const role = user?.role

  const renderRoutes = () => {
    // PST page never shows nav — regardless of role
    if (location.pathname === '/pst') return <PstPage />

    if (role === 'cleaner') return (
      <Routes>
        <Route path="/work"     element={<CleanerWork />} />
        <Route path="/training" element={<Training />} />
        <Route path="/pst"      element={<PstPage />} />
        <Route path="*"         element={<Navigate to="/work" replace />} />
      </Routes>
    )

    if (role === 'curator') return (
      <Layout>
        <Routes>
          <Route path="/checklists"  element={<Checklists />} />
          <Route path="/objects"     element={<Objects />} />
          <Route path="/training"    element={<Training />} />
          <Route path="/pst"         element={<PstPage />} />
          <Route path="*"            element={<Navigate to="/checklists" replace />} />
        </Routes>
      </Layout>
    )

    if (role === 'auditor') return (
      <Layout>
        <Routes>
          <Route path="/checklists" element={<Checklists />} />
          <Route path="/training"   element={<Training />} />
          <Route path="/users"      element={<Users />} />
          <Route path="/pst"        element={<PstPage />} />
          <Route path="*"           element={<Navigate to="/checklists" replace />} />
        </Routes>
      </Layout>
    )

    if (role === 'partner') return (
      <Layout>
        <Routes>
          <Route path="/"            element={<Dashboard />} />
          <Route path="/pst-reports" element={<PstReports />} />
          <Route path="/locations"   element={<Locations />} />
          <Route path="/checklists"  element={<Checklists />} />
          <Route path="/objects"     element={<Objects />} />
          <Route path="/users"       element={<Users />} />
          <Route path="/training"    element={<Training />} />
          <Route path="/pst"         element={<PstPage />} />
          <Route path="*"            element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    )

    return (
      <Layout>
        <Routes>
          <Route path="/"            element={<Dashboard />} />
          <Route path="/pst-reports" element={<PstReports />} />
          <Route path="/locations"   element={<Locations />} />
          <Route path="/users"       element={<Users />} />
          <Route path="/checklists"  element={<Checklists />} />
          <Route path="/objects"     element={<Objects />} />
          <Route path="/training"    element={<Training />} />
          <Route path="/pst"         element={<PstPage />} />
          <Route path="/realization" element={<Placeholder title="Реализация" />} />
          <Route path="*"            element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    )
  }

  return (
    <>
      {renderRoutes()}
      {needsReset && <ForceChangePassword onDone={handlePasswordDone} />}
    </>
  )
}
