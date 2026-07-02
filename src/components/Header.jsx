import { Menu, LogOut, User } from 'lucide-react'
import { useStore } from '../store'
import './Header.css'

export default function Header({ onMenuClick }) {
  const { user, logout } = useStore()

  return (
    <header className="header">
      <div className="header-content">
        <button className="menu-btn" onClick={onMenuClick}>
          <Menu size={24} />
        </button>
        <div className="header-logo">
          <h1>IC Group</h1>
          <span className="subtitle">Admin Panel</span>
        </div>
        <div className="header-right">
          <div className="user-info">
            <User size={20} />
            <span>{user?.phone || 'User'}</span>
          </div>
          <button className="logout-btn" onClick={logout} title="Logout">
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </header>
  )
}
