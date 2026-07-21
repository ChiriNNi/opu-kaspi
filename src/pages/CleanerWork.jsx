import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import CleanerNav from '../components/CleanerNav'
import { usePushNotifications } from '../usePushNotifications'
import './CleanerWork.css'

const API = import.meta.env.VITE_API_URL || 'https://opu.ic-group.kz'

const DAYS_RU = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота']
const MONTHS_RU = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря']

function ClockBar() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const h = String(now.getHours()).padStart(2, '0')
  const m = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return (
    <div className="cw-clock-bar">
      <div className="cw-clock-time">{h}:{m}<span className="cw-clock-sec">:{s}</span></div>
      <div className="cw-clock-date">{DAYS_RU[now.getDay()]}, {now.getDate()} {MONTHS_RU[now.getMonth()]}</div>
    </div>
  )
}
const ALMATY = { lat: 43.2364, lng: 76.9099 }
const GEOFENCE_RADIUS = 200

// ── Helpers ──────────────────────────────────────────────────────────────────

function distMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, dL = (lat2 - lat1) * Math.PI / 180, dG = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dL / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dG / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function fmtDate() {
  const d = new Date()
  const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
  const months = ['Января','Февраля','Марта','Апреля','Мая','Июня','Июля','Августа','Сентября','Октября','Ноября','Декабря']
  return { day: d.getDate(), month: months[d.getMonth()], dow: days[d.getDay()] }
}

function getZoneStyle(name) {
  const n = (name || '').toLowerCase()
  if (n.includes('санузл') || n.includes('туалет') || n.includes('убор'))
    return { gradient: 'linear-gradient(135deg,#4C6FFF,#7B5EA7)', tags: ['УБОРНАЯ', 'ПРИОРИТЕТ'] }
  if (n.includes('зал') || n.includes('офис') || n.includes('холл'))
    return { gradient: 'linear-gradient(135deg,#374151,#1F2937)', tags: ['ЗАЛ / ОФИС'] }
  if (n.includes('коридор') || n.includes('прихож') || n.includes('лестн'))
    return { gradient: 'linear-gradient(135deg,#B45309,#92400E)', tags: ['КОРИДОРЫ'] }
  if (n.includes('кухн') || n.includes('столов'))
    return { gradient: 'linear-gradient(135deg,#0D9488,#065F46)', tags: ['КУХНЯ'] }
  return { gradient: 'linear-gradient(135deg,#5A7D20,#3D5A14)', tags: [name?.toUpperCase() || 'ЗОНА'] }
}

// Compress image to under 250kb
async function compressFile(file, maxBytes = 250 * 1024) {
  if (!file.type.startsWith('image/') || file.size <= maxBytes) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    let w = img.naturalWidth, h = img.naturalHeight
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx || !w || !h) return file
    for (let step = 0; step < 8; step++) {
      canvas.width = Math.round(w); canvas.height = Math.round(h)
      ctx.clearRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h)
      for (const q of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
        const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', q))
        if (blob && blob.size <= maxBytes) return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })
      }
      w *= 0.8; h *= 0.8
    }
  } finally { URL.revokeObjectURL(url) }
  return file
}

// ── Inline Camera ─────────────────────────────────────────────────────────────

function InlineCamera({ onCapture, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [count, setCount] = useState(0)
  const [flash, setFlash] = useState(false)
  const [camError, setCamError] = useState('')

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play() }
        setReady(true)
      })
      .catch(err => {
        setCamError(err.name === 'NotAllowedError'
          ? 'Доступ к камере запрещён. Разрешите в настройках браузера.'
          : 'Камера недоступна на этом устройстве.')
      })
    return () => { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()) }
  }, [])

  const snap = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    setFlash(true)
    setTimeout(() => setFlash(false), 120)
    canvas.toBlob(blob => {
      if (!blob) return
      const file = new File([blob], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' })
      onCapture(file)
      setCount(c => c + 1)
    }, 'image/jpeg', 0.88)
  }, [onCapture])

  const done = () => {
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {flash && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0.6, zIndex: 2, pointerEvents: 'none' }} />}
      {camError ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 }}>
          <div style={{ color: '#ff6b6b', fontSize: 15, fontWeight: 700, textAlign: 'center', lineHeight: 1.5 }}>{camError}</div>
          <button onClick={done} style={{ color: '#fff', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 16, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Закрыть</button>
        </div>
      ) : (
        <video ref={videoRef} playsInline muted style={{ flex: 1, width: '100%', objectFit: 'cover' }} />
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      {!camError && (
        <div style={{ padding: '20px 24px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#000' }}>
          <button onClick={done} style={{ color: '#fff', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 16, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Готово {count > 0 && `(${count} фото)`}
          </button>
          <button onClick={snap} disabled={!ready} style={{ width: 72, height: 72, borderRadius: '50%', background: '#7EC850', border: '4px solid #fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px rgba(126,200,80,0.4)', opacity: ready ? 1 : 0.5 }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1A1D1E" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </button>
          <div style={{ width: 80 }} />
        </div>
      )}
    </div>
  )
}

// ── Photo section ─────────────────────────────────────────────────────────────

function PhotoSection({ title, photos, onAdd, onRemove }) {
  const [cameraOpen, setCameraOpen] = useState(false)

  const handleCapture = (file) => {
    const preview = URL.createObjectURL(file)
    onAdd([{ file, preview }])
  }

  return (
    <div className="cw-photo-box">
      {cameraOpen && <InlineCamera onCapture={handleCapture} onClose={() => setCameraOpen(false)} />}
      <div className="cw-photo-box-head">
        <span>{title}</span>
        <span className="cw-photo-count">{photos.length} шт.</span>
      </div>
      <button type="button" className="cw-photo-add" onClick={() => setCameraOpen(true)}>
        <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={16} height={16}>
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
        </svg>
        <span>Снять фото</span>
      </button>
      {photos.length > 0 && (
        <div className="cw-photo-grid">
          {photos.map((p, i) => (
            <div key={i} className="cw-photo-thumb">
              <img src={p.preview} alt="" />
              <button onClick={() => onRemove(i)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CleanerWork() {
  const { token } = useStore()
  const navigate = useNavigate()
  const { supported: pushSupported, subscribed: pushSubscribed, loading: pushLoading, subscribe: pushSubscribe } = usePushNotifications()

  // ── Screens & data ──
  const [screen, setScreen] = useState('start') // 'start' | 'work' | 'done'
  const [gps, setGps] = useState(null)
  const [gpsLoading, setGpsLoading] = useState(true)
  const [gpsError, setGpsError] = useState('')
  const [checklist, setChecklist] = useState(null)   // active checklist (first assigned)
  const [items, setItems] = useState([])              // full item list with zone/completed
  const [checkedMap, setCheckedMap] = useState({})    // itemId -> boolean (local optimistic)
  const [taskPhotos, setTaskPhotos] = useState({})    // "itemId-before/after" -> [{file,preview}]
  const [draftCheck, setDraftCheck] = useState({})   // itemId -> boolean (checkbox tick before submit)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [objectPin, setObjectPin] = useState(null)
  const [trainingDone, setTrainingDone] = useState(false)
  const [trainingProgress, setTrainingProgress] = useState({ done: 0, total: 0 })

  const mapRef = useRef(null)
  const leafletMap = useRef(null)
  const markerRef = useRef(null)
  const pendingPhotoOpsRef = useRef([])   // промисы сжатия фото ещё не попавшие в state — submitStep обязан их дождаться

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const today = fmtDate()

  // ── Check training status ────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/training/videos`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch(`${API}/api/training/quizzes`, { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(([vData, qData]) => {
      const videos = vData.videos || []
      const quizzes = qData.quizzes || []
      if (videos.length === 0) { setTrainingDone(true); setTrainingProgress({ done: 0, total: 0 }); return }
      // Прогресс по видео: если у видео есть квиз — нужно пройти квиз, иначе — просмотреть видео
      const assignedVideoIds = new Set(videos.map(v => v.id))
      const quizByVideo = Object.fromEntries(quizzes.filter(q => assignedVideoIds.has(q.video_id)).map(q => [q.video_id, q]))
      const total = videos.length
      const done = videos.filter(v => {
        const quiz = quizByVideo[v.id]
        return quiz ? quiz.my_attempts > 0 : v.my_completed
      }).length
      setTrainingDone(done === total)
      setTrainingProgress({ done, total })
    }).catch(() => {})
  }, [token])

  // ── Fetch data ───────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/checklists/active`, { headers: { Authorization: `Bearer ${token}` } })
      const data = await res.json()
      const list = data.checklists || []
      const todayDate = new Date().toISOString().slice(0, 10)
      const cl = list.find(c => (c.shift_date || '').slice(0, 10) === todayDate)
      setChecklist(cl || null)
      if (!cl) return

      const detail = await fetch(`${API}/api/checklists/active/${cl.id}`, { headers: { Authorization: `Bearer ${token}` } })
      const dData = await detail.json()
      const clItems = dData.checklist?.items || []
      setItems(clItems)

      const map = {}
      clItems.forEach(it => { map[it.id] = it.completed })
      setCheckedMap(map)
    } catch {}
  }, [token])

  useEffect(() => { loadData() }, [loadData])

  // Polling каждые 30 сек на start-screen + refresh при возврате на вкладку
  useEffect(() => {
    if (screen !== 'start') return
    const interval = setInterval(loadData, 30000)
    const onVisible = () => { if (document.visibilityState === 'visible') loadData() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible) }
  }, [screen, loadData])

  // ── GPS ──────────────────────────────────────────────────────────────────────
  const requestGps = () => {
    if (!navigator.geolocation) { setGpsLoading(false); return }
    setGpsLoading(true); setGpsError('')
    navigator.geolocation.getCurrentPosition(
      p => { setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }); setGpsLoading(false) },
      () => { setGpsError('Разрешите доступ к геолокации'); setGpsLoading(false) },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    )
  }
  useEffect(() => { requestGps() }, [])
  useEffect(() => { window.scrollTo(0, 0) }, [screen])

  // ── Map ──────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !window.L || leafletMap.current) return
    const L = window.L
    const center = objectPin || ALMATY
    const map = L.map(mapRef.current, {
      center: [center.lat, center.lng], zoom: 15,
      zoomControl: false, attributionControl: false,
      dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false,
    })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map)
    const icon = L.divIcon({ html: '<div class="cw-map-pin"></div>', iconSize: [14, 14], iconAnchor: [7, 7], className: '' })
    markerRef.current = L.marker([center.lat, center.lng], { icon }).addTo(map)
    leafletMap.current = map
    return () => { map.remove(); leafletMap.current = null }
  }, [screen]) // re-init when going back to start screen

  // ── Derived ──────────────────────────────────────────────────────────────────
  const zones = [...new Set(items.map(it => it.zone || 'Общая'))].filter(Boolean)
  const totalAll = items.length
  const totalDone = items.filter(it => checkedMap[it.id]).length
  const pct = totalAll ? Math.round((totalDone / totalAll) * 100) : 0

  const pin = objectPin || ALMATY
  const rawDist = gps ? distMeters(gps.lat, gps.lng, pin.lat, pin.lng) : null
  const effectiveR = GEOFENCE_RADIUS + Math.min(gps?.acc ?? 0, 75)
  const inZone = rawDist !== null && rawDist <= effectiveR

  // Flat steps: items not yet done
  const flatSteps = items.map((it, idx) => ({ ...it, stepIdx: idx, style: getZoneStyle(it.zone) }))
  const currentStep = flatSteps.find(s => !checkedMap[s.id])
  const currentStepNum = currentStep ? flatSteps.indexOf(currentStep) + 1 : totalAll
  const isLastStep = flatSteps.filter(s => !checkedMap[s.id]).length === 1

  const photoKey = (itemId, type) => `${itemId}-${type}`
  const getPhotos = (itemId, type) => taskPhotos[photoKey(itemId, type)] || []

  // ── Photo handlers ───────────────────────────────────────────────────────────
  const addPhotos = (itemId, type, items) => {
    if (!items || !items.length) return
    // items — массив {file, preview} от InlineCamera.
    // Сжатие асинхронное — если клинер сразу жмёт "Далее", фото может не успеть
    // попасть в state. Регистрируем промис в pendingPhotoOpsRef, submitStep его дождётся.
    const op = Promise.all(items.map(async ({ file, preview }) => {
      const compressed = await compressFile(file)
      return { file: compressed, preview: URL.createObjectURL(compressed) }
    })).then(arr => {
      const k = photoKey(itemId, type)
      setTaskPhotos(prev => ({ ...prev, [k]: [...(prev[k] || []), ...arr] }))
    }).finally(() => {
      pendingPhotoOpsRef.current = pendingPhotoOpsRef.current.filter(p => p !== op)
    })
    pendingPhotoOpsRef.current.push(op)
  }

  const removePhoto = (itemId, type, idx) => {
    const k = photoKey(itemId, type)
    setTaskPhotos(prev => {
      const current = prev[k] || []
      URL.revokeObjectURL(current[idx].preview)
      return { ...prev, [k]: current.filter((_, i) => i !== idx) }
    })
  }

  // ── Submit step ──────────────────────────────────────────────────────────────
  const submitStep = async () => {
    if (!currentStep || !checklist) return
    setSubmitting(true); setSubmitError('')
    try {
      // Дождаться сжатия всех фото, снятых прямо перед нажатием "Далее" —
      // иначе они не попадут в taskPhotos и потеряются при отправке.
      if (pendingPhotoOpsRef.current.length) await Promise.all(pendingPhotoOpsRef.current)

      // Mark item done — send photos via FormData if any
      const beforeKey = photoKey(currentStep.id, 'before')
      const afterKey  = photoKey(currentStep.id, 'after')
      const allPhotos = [...(taskPhotos[beforeKey] || []), ...(taskPhotos[afterKey] || [])]

      let fetchOpts
      if (allPhotos.length > 0) {
        const fd = new FormData()
        fd.append('completed', 'true')
        fd.append('note', currentStep.title)
        allPhotos.forEach(p => fd.append('photos', p.file))   // все фото, не только последнее
        fetchOpts = { method: 'POST', headers: { Authorization: headers.Authorization }, body: fd }
      } else {
        fetchOpts = { method: 'POST', headers, body: JSON.stringify({ completed: true, note: currentStep.title }) }
      }
      await fetch(`${API}/api/checklists/active/${checklist.id}/items/${currentStep.id}`, fetchOpts)

      // Optimistic update
      setCheckedMap(prev => ({ ...prev, [currentStep.id]: true }))
      setDraftCheck(prev => { const n = { ...prev }; delete n[currentStep.id]; return n })
      // Clear photos for this step
      setTaskPhotos(prev => {
        const n = { ...prev }
        ;[...(prev[beforeKey] || []), ...(prev[afterKey] || [])].forEach(p => URL.revokeObjectURL(p.preview))
        delete n[beforeKey]; delete n[afterKey]
        return n
      })

      // If last step → complete the checklist
      if (isLastStep) {
        await fetch(`${API}/api/checklists/active/${checklist.id}/complete`, { method: 'POST', headers, body: JSON.stringify({}) })
        setScreen('done')
      }
    } catch (e) {
      setSubmitError('Ошибка при сохранении шага. Попробуйте снова.')
    } finally { setSubmitting(false) }
  }

  // ── START screen ─────────────────────────────────────────────────────────────
  if (screen === 'start') {
    const startBlocked = !checklist || totalAll === 0
      ? 'На сегодня нет назначенной смены'
      : gpsLoading ? 'Определяем геопозицию...'
      : gpsError ? gpsError
      : ''

    return (
      <>
        <CleanerNav />
        <div className="cw-page">

          {/* Hero */}
          <div className="cw-hero">
            <div className="cw-hero-top">
              <div className="cw-hero-label">
                <img src="/logo_IC_group.png" alt="" className="cw-hero-logo" />
                <span>Система контроля</span>
              </div>
              <h1 className="cw-hero-title">Уборка</h1>
            </div>
            <div className={`cw-geo-pill ${gps ? 'ok' : gpsLoading ? 'loading' : 'err'}`}>
              <span className={`cw-geo-dot ${gpsLoading ? 'pulse' : ''}`} />
              <span>{gpsLoading ? 'Определение координат...' : gps ? 'Геолокация определена' : (gpsError || 'Геолокация недоступна')}</span>
              {gps && <span className="cw-geo-coords">{gps.lat.toFixed(5)}, {gps.lng.toFixed(5)} · ±{gps.acc} м</span>}
            </div>
            {!gps && !gpsLoading && (
              <button className="cw-geo-retry" onClick={requestGps}>Разрешить геолокацию</button>
            )}
          </div>

          {/* Stats */}
          <div className="cw-stats">
            <div className="cw-stat"><span className="cw-stat-label">Сегодня</span><span className="cw-stat-value">{today.day}</span><span className="cw-stat-sub">{today.month} · {today.dow}</span></div>
            <div className="cw-stat-div" />
            <div className="cw-stat"><span className="cw-stat-label">Зоны</span><span className="cw-stat-value">{zones.length}</span><span className="cw-stat-sub">зоны уборки</span></div>
            <div className="cw-stat-div" />
            <div className="cw-stat"><span className="cw-stat-label">Задачи</span><span className="cw-stat-value">{totalAll}</span><span className="cw-stat-sub">пунктов</span></div>
          </div>

          {/* Object + map */}
          <div className="cw-object-card">
            <div className="cw-object-header">
              <div>
                <div className="cw-object-name">{checklist?.location_name || 'Объект сегодня'}</div>
                <div className="cw-object-sub">радиус {GEOFENCE_RADIUS} м</div>
              </div>
              {inZone && <span className="cw-in-zone">· В зоне</span>}
            </div>
            <div ref={mapRef} className="cw-map" />
          </div>

          {/* Training link — показываем только если есть незавершённые обучения */}
          {trainingProgress.total > 0 && !trainingDone && (
            <button className="cw-training-btn" onClick={() => navigate('/training')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
              <span>Обучение</span>
              {trainingProgress.total > 0 && (
                <span className="cw-training-progress">
                  {trainingProgress.done}/{trainingProgress.total} пройдено
                </span>
              )}
            </button>
          )}

          {/* Actions */}
          <div className="cw-start-actions">
            <button
              className={`cw-start-btn ${startBlocked ? 'blocked' : ''}`}
              disabled={!!startBlocked}
              onClick={() => !startBlocked && setScreen('work')}
            >
              {startBlocked || 'Начать рабочий день →'}
            </button>
            {pushSupported && !pushSubscribed && (
              <button
                className="cw-push-btn"
                onClick={pushSubscribe}
                disabled={pushLoading}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                {pushLoading ? 'Подключение...' : 'Включить уведомления'}
              </button>
            )}
            {pushSupported && pushSubscribed && (
              <div className="cw-push-on">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                Уведомления включены
              </div>
            )}
            {!checklist && (
              <div className="cw-no-shift">
                <div className="cw-no-shift-title">Нет смены на сегодня</div>
              </div>
            )}
          </div>

        </div>
      </>
    )
  }

  // ── DONE screen ──────────────────────────────────────────────────────────────
  if (screen === 'done') {
    return (
      <>
        <CleanerNav />
        <div className="cw-done-page">
          <div className="cw-done-icon">
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={48} height={48}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="cw-done-title">Готово!</h2>
          <p className="cw-done-sub">Отчёт отправлен куратору</p>

          <div className="cw-done-summary">
            {zones.map(z => {
              const zoneItems = items.filter(it => (it.zone || 'Общая') === z)
              const done = zoneItems.filter(it => checkedMap[it.id]).length
              return (
                <div key={z} className="cw-done-zone-row">
                  <div className="cw-done-zone-dot" style={{ background: getZoneStyle(z).gradient }} />
                  <span className="cw-done-zone-name">{z}</span>
                  <span className={`cw-done-zone-pct ${done === zoneItems.length ? 'full' : ''}`}>
                    {done}/{zoneItems.length}
                  </span>
                  {done === zoneItems.length && <span className="cw-done-check">✓</span>}
                </div>
              )
            })}
          </div>

          <button className="cw-done-new-btn" onClick={() => { setScreen('start'); setCheckedMap({}); setDraftCheck({}); loadData() }}>
            Новая смена
          </button>
        </div>
      </>
    )
  }

  // ── WORK screen ──────────────────────────────────────────────────────────────
  return (
    <>
      <CleanerNav />
      <div className="cw-work-page">
        <ClockBar />

        {/* Overall progress */}
        <div className="cw-progress-card">
          <div className="cw-progress-top">
            <div className="cw-progress-pct">{pct}%</div>
            <div className="cw-progress-right">
              <div className="cw-progress-label-row">
                <span className="cw-progress-label">Прогресс смены</span>
                <span className="cw-progress-nums"><span className="green">{totalDone}</span> / {totalAll}</span>
              </div>
              <div className="cw-progress-bar-track">
                <div className="cw-progress-bar-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          {zones.length > 0 && (
            <div className="cw-zones-grid">
              {zones.map(z => {
                const zItems = items.filter(it => (it.zone || 'Общая') === z)
                const zDone = zItems.filter(it => checkedMap[it.id]).length
                const zPct = zItems.length ? Math.round((zDone / zItems.length) * 100) : 0
                const full = zDone === zItems.length
                return (
                  <div key={z} className={`cw-zone-cell ${full ? 'done' : ''}`}>
                    <span className="cw-zone-cell-name">{z.toUpperCase()}</span>
                    <span className={`cw-zone-cell-cnt ${zPct >= 80 ? 'green' : zPct >= 50 ? 'yellow' : 'red'}`}>{zDone}/{zItems.length}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Current step */}
        {currentStep ? (
          <>
            {/* Zone card */}
            <div className="cw-zone-card" style={{ background: currentStep.style.gradient }}>
              <div className="cw-zone-card-deco1" />
              <div className="cw-zone-card-deco2" />
              <div className="cw-zone-card-body">
                <div>
                  <div className="cw-zone-tags">
                    {currentStep.style.tags.map(t => <span key={t} className="cw-zone-tag">{t}</span>)}
                  </div>
                  <div className="cw-zone-card-title">{currentStep.zone || 'Общая'}</div>
                  <div className="cw-zone-card-sub">{checklist?.location_name || 'Ежедневная уборка'}</div>
                </div>
                <div className="cw-step-counter">
                  <span className="cw-step-num">{currentStepNum}</span>
                  <span className="cw-step-total">из {totalAll}</span>
                </div>
              </div>
              <div className="cw-zone-card-bar">
                <div className="cw-zone-card-fill" style={{ width: `${totalAll ? Math.round(((currentStepNum - 1) / totalAll) * 100) : 0}%` }} />
              </div>
            </div>

            {/* Task card */}
            <div className="cw-task-card">
              <div className="cw-task-header">
                <div className="cw-task-meta">
                  <span className="cw-task-pnum">Пункт {currentStepNum}</span>
                  <span className="cw-task-zone-badge">
                    {items.filter(it => (it.zone || 'Общая') === (currentStep.zone || 'Общая') && checkedMap[it.id]).length}
                    /{items.filter(it => (it.zone || 'Общая') === (currentStep.zone || 'Общая')).length}
                  </span>
                </div>
                <button
                  className="cw-task-row"
                  onClick={() => { setSubmitError(''); setDraftCheck(prev => ({ ...prev, [currentStep.id]: !prev[currentStep.id] })) }}
                >
                  <div className="cw-task-icon-box">
                    <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={20} height={20}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                    </svg>
                  </div>
                  <span className="cw-task-title">{currentStep.title}</span>
                  <div className={`cw-task-check ${draftCheck[currentStep.id] ? 'checked' : ''}`}>
                    {draftCheck[currentStep.id] && (
                      <svg fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24" width={14} height={14}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </div>
                </button>
              </div>

              {/* <div className="cw-task-photos">
                <PhotoSection
                  title="ДО"
                  photos={getPhotos(currentStep.id, 'before')}
                  onAdd={files => addPhotos(currentStep.id, 'before', files)}
                  onRemove={idx => removePhoto(currentStep.id, 'before', idx)}
                />
                <PhotoSection
                  title="ПОСЛЕ"
                  photos={getPhotos(currentStep.id, 'after')}
                  onAdd={files => addPhotos(currentStep.id, 'after', files)}
                  onRemove={idx => removePhoto(currentStep.id, 'after', idx)}
                />
              </div> */}
            </div>

            {/* Submit button */}
            <button className={`cw-next-btn ${submitting ? 'loading' : ''}`} onClick={submitStep} disabled={submitting}>
              {submitting
                ? <><span className="cw-spin" />Сохраняем шаг...</>
                : isLastStep ? 'Завершить смену' : 'Перейти к следующему шагу'
              }
            </button>
            <p className="cw-next-hint">Фото отправляются сразу после перехода к следующему шагу.</p>

            {submitError && <div className="cw-error-box">{submitError}</div>}
          </>
        ) : (
          <div className="cw-all-done">
            <div className="cw-all-done-icon">
              <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={32} height={32}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="cw-all-done-title">Все шаги выполнены</p>
            <p className="cw-all-done-sub">Смена завершается автоматически после последнего шага.</p>
          </div>
        )}

      </div>
    </>
  )
}
