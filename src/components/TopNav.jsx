import { Link, useLocation } from 'react-router-dom'
import { useStore } from '../store'
import { LogOut, User } from 'lucide-react'
import './TopNav.css'

const ALL_SECTIONS = [
  { key: 'checklists', label: 'Чек-Листы',   paths: ['/checklists', '/objects'],         roles: ['admin', 'partner', 'curator', 'auditor'] },
  { key: 'training',   label: 'Обучение',     paths: ['/training'],                       roles: ['admin', 'partner', 'auditor', 'curator'] },
  { key: 'washing',    label: 'Мойка',        paths: ['/', '/pst-reports', '/locations'], roles: ['admin', 'partner', 'auditor'] },
  { key: 'users',      label: 'Пользователи', paths: ['/users'],                          roles: ['admin', 'partner', 'auditor'] },
  { key: 'realization', label: 'Реализация',   paths: ['/realization', '/realization/rates'], roles: ['admin'] },
]

const SUB_PAGES = {
  checklists: [
    { label: 'Чек-Листы', path: '/checklists', roles: ['admin', 'partner', 'curator', 'auditor'] },
    { label: 'Объекты',   path: '/objects',    roles: ['admin', 'partner', 'curator'] },
  ],
  washing: [
    { label: 'Отчёты',    path: '/pst-reports', roles: ['admin', 'partner', 'curator', 'auditor'] },
    { label: 'Постоматы', path: '/locations',   roles: ['admin', 'partner', 'curator', 'auditor'] },
  ],
  realization: [
    { label: 'Отчёт',              path: '/realization',       roles: ['admin'] },
    { label: 'Стоимость постомата', path: '/realization/rates', roles: ['admin'] },
  ],
}

const ROLE_LABEL = {
  admin:   'Администратор',
  partner: 'Партнёр',
  curator: 'Куратор',
  auditor: 'Аудитор',
}

export default function TopNav() {
  const { user, logout } = useStore()
  const location = useLocation()
  const role = user?.role || 'admin'

  const sections = ALL_SECTIONS.filter(s => s.roles.includes(role))
  const activeSection = sections.find(s => s.paths.includes(location.pathname)) || sections[0]
  const rawSub = SUB_PAGES[activeSection?.key] || []
  const subPages = rawSub.filter(p => p.roles.includes(role))

  const firstPathOf = (section) => {
    const sub = (SUB_PAGES[section.key] || []).filter(p => p.roles.includes(role))
    return sub.length > 0 ? sub[0].path : section.paths[0]
  }

  return (
    <div className="topnav-wrap">
      <div className="topnav-top">
        <div className="topnav-brand">
          <span className="brand-name">IC Group</span>
          <span className="brand-sub">{ROLE_LABEL[role] || role}</span>
        </div>

        <nav className="topnav-main">
          {sections.map(s => {
            const active = s.key === activeSection?.key
            return (
              <Link key={s.key} to={firstPathOf(s)} className={`tnav-item ${active ? 'active' : ''}`}>
                {s.label}
              </Link>
            )
          })}
        </nav>

        <div className="topnav-user">
          <div className="topnav-user-info">
            <User size={14} />
            <span>{user?.full_name || user?.phone || 'User'}</span>
          </div>
          <button className="topnav-logout" onClick={logout} title="Выйти">
            <LogOut size={15} />
          </button>
        </div>
      </div>

      {subPages.length > 0 && (
        <nav className="topnav-sub">
          {subPages.map(p => (
            <Link key={p.path} to={p.path} className={`tsub-item ${location.pathname === p.path ? 'active' : ''}`}>
              {p.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}
