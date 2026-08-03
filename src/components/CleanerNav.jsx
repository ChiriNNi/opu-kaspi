import { useNavigate, useLocation } from 'react-router-dom'
import { useStore } from '../store'
import './CleanerNav.css'

export default function CleanerNav() {
  const { user, logout } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const name = user?.full_name || user?.phone || 'Профиль'
  const onTraining = location.pathname === '/training'

  return (
    <div className="cnav-outer">
      <div className="cnav-island">

        {/* Main row */}
        <div className="cnav-row">
          <img src="/logo_IC_group.png" alt="IC Group" className="cnav-logo" />

          <div className="cnav-nav-links">
            <button
              className={`cnav-nav-link ${!onTraining ? 'active' : ''}`}
              onClick={() => navigate('/work')}
            >
              <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="14" height="14">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              Уборка
            </button>
            <button
              className={`cnav-nav-link ${onTraining ? 'active' : ''}`}
              onClick={() => navigate('/training')}
            >
              <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width="14" height="14">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
              </svg>
              Обучение
            </button>
          </div>

          <div className="cnav-actions">
            <button className="cnav-logout-btn" onClick={logout} title="Выйти">
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
