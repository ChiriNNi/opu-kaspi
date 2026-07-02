import TopNav from './TopNav'
import NotificationBanner from './NotificationBanner'
import './Layout.css'

export default function Layout({ children }) {
  return (
    <div className="layout">
      <TopNav />
      <NotificationBanner />
      <main className="layout-main">
        <div className="container">
          {children}
        </div>
      </main>
    </div>
  )
}
