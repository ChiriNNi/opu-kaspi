import { useState } from 'react'
import { Bell, X } from 'lucide-react'
import { usePushNotifications } from '../usePushNotifications'
import './NotificationBanner.css'

// Баннер подписки на пуши для всех вошедших (офисные роли — через Layout).
// Браузер требует жест пользователя для requestPermission, поэтому это кнопка, а не авто-подписка.
export default function NotificationBanner() {
  const { supported, permission, subscribed, loading, subscribe } = usePushNotifications()
  const [dismissed, setDismissed] = useState(localStorage.getItem('push_banner_dismissed') === '1')

  if (!supported || subscribed || permission === 'denied' || dismissed) return null

  return (
    <div className="notif-banner">
      <Bell size={16} className="notif-banner-ico" />
      <span className="notif-banner-text">Включите уведомления — чтобы не пропускать эфиры и задачи</span>
      <button className="notif-banner-btn" onClick={subscribe} disabled={loading}>
        {loading ? 'Подключение…' : 'Включить'}
      </button>
      <button
        className="notif-banner-x"
        onClick={() => { localStorage.setItem('push_banner_dismissed', '1'); setDismissed(true) }}
        title="Скрыть"
      >
        <X size={15} />
      </button>
    </div>
  )
}
