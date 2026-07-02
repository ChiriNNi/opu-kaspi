import { useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store'
import './PstNav.css'

const TABS = [
  { label: 'Мойка',    path: '/pst' },
  { label: 'Обучение', path: null },
  { label: 'Чек-лист', path: '/checklist' },
]

export default function PstNav() {
  const { user, logout } = useStore()
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="pstnav-outer">
      <div className="pstnav-island">

        {/* Strip */}
        <div className="pstnav-strip">
          <svg className="pstnav-eye" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="pstnav-role">Профиль уборщика</span>
          <span className="pstnav-online">Online</span>
        </div>

        {/* Main row */}
        <div className="pstnav-row">
          <img src="/logo_IC_group.png" alt="IC Group" className="pstnav-logo" />

          {/* Tabs */}
          <nav className="pstnav-tabs">
            {TABS.map(t => {
              const active = t.path && location.pathname === t.path
              return (
                <button
                  key={t.label}
                  className={`pstnav-tab ${active ? 'active' : ''} ${!t.path ? 'disabled' : ''}`}
                  onClick={() => t.path && navigate(t.path)}
                  disabled={!t.path}
                >
                  {t.label}
                </button>
              )
            })}
          </nav>

          {/* User + logout */}
          <div className="pstnav-actions">
            <button className="pstnav-name-pill">
              <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" width="14" height="14">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              <span>{user?.full_name || user?.phone || 'Профиль'}</span>
            </button>
            <button className="pstnav-logout-btn" onClick={logout} title="Выйти">
              <svg fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" width="16" height="16">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6A2.25 2.25 0 005.25 5.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
              </svg>
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
