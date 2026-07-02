import { useState, useEffect } from 'react'
import './InstallPrompt.css'

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}
function isInStandaloneMode() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
}

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [showIos, setShowIos] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (isInStandaloneMode()) return
    if (localStorage.getItem('pwa_dismissed')) return

    if (isIos()) {
      setShowIos(true)
      return
    }

    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const dismiss = () => {
    setDismissed(true)
    setDeferredPrompt(null)
    setShowIos(false)
    localStorage.setItem('pwa_dismissed', '1')
  }

  const install = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') dismiss()
    else setDeferredPrompt(null)
  }

  if (dismissed || isInStandaloneMode()) return null

  if (showIos) {
    return (
      <div className="ip-banner">
        <div className="ip-icon">
          <img src="/ic-favicon.png" alt="" />
        </div>
        <div className="ip-text">
          <div className="ip-title">Установить приложение</div>
          <div className="ip-sub">
            Нажмите&nbsp;
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            &nbsp;→ «На экран "Домой"»
          </div>
        </div>
        <button className="ip-close" onClick={dismiss}>✕</button>
      </div>
    )
  }

  if (deferredPrompt) {
    return (
      <div className="ip-banner">
        <div className="ip-icon">
          <img src="/ic-favicon.png" alt="" />
        </div>
        <div className="ip-text">
          <div className="ip-title">Установить приложение</div>
          <div className="ip-sub">Добавить на главный экран</div>
        </div>
        <button className="ip-install" onClick={install}>Установить</button>
        <button className="ip-close" onClick={dismiss}>✕</button>
      </div>
    )
  }

  return null
}
