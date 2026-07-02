import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Users, X, ClipboardList } from 'lucide-react'
import './Sidebar.css'

export default function Sidebar({ open, onClose, collapsed }) {
  const location = useLocation()

  const links = [
    { path: '/',            label: 'Главная',      icon: LayoutDashboard },
    { path: '/pst-reports', label: 'PST Отчёты',   icon: ClipboardList },
    { path: '/users',       label: 'Пользователи', icon: Users },
  ]

  return (
    <>
      {open && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <button className="sidebar-close" onClick={onClose}><X size={24} /></button>
        <nav className="sidebar-nav">
          {links.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              to={path}
              className={`nav-link ${location.pathname === path ? 'active' : ''}`}
              onClick={onClose}
              title={collapsed ? label : undefined}
            >
              <Icon size={20} className="nav-icon" />
              <span className="nav-label">{label}</span>
            </Link>
          ))}
        </nav>
      </aside>
    </>
  )
}
