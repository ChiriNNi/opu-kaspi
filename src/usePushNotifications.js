import { useState, useEffect } from 'react'
import api from './api'

const PUSH_KEY = 'push_subscribed'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)))
}

export function usePushNotifications() {
  const [supported, setSupported] = useState(false)
  const [permission, setPermission] = useState('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const ok = 'serviceWorker' in navigator && 'PushManager' in window
    setSupported(ok)
    if (ok) {
      setPermission(Notification.permission)
      setSubscribed(localStorage.getItem(PUSH_KEY) === '1')
    }
  }, [])

  const subscribe = async () => {
    if (!supported) return
    setLoading(true)
    try {
      const perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') return

      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const keyRes = await api.get('/push/vapid-key')
      const vapidKey = urlBase64ToUint8Array(keyRes.data.publicKey)

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidKey
      })

      const json = sub.toJSON()
      await api.post('/push/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys
      })

      localStorage.setItem(PUSH_KEY, '1')
      setSubscribed(true)
    } catch (err) {
      console.error('[Push] subscribe error:', err)
    } finally {
      setLoading(false)
    }
  }

  const unsubscribe = async () => {
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      if (reg) {
        const sub = await reg.pushManager.getSubscription()
        if (sub) {
          await api.delete('/push/subscribe', { data: { endpoint: sub.endpoint } })
          await sub.unsubscribe()
        }
      }
      localStorage.removeItem(PUSH_KEY)
      setSubscribed(false)
    } catch (err) {
      console.error('[Push] unsubscribe error:', err)
    } finally {
      setLoading(false)
    }
  }

  return { supported, permission, subscribed, loading, subscribe, unsubscribe }
}
