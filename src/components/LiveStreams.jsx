import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { io } from 'socket.io-client'
import { Room, RoomEvent, Track, AudioPresets } from 'livekit-client'
import {
  Radio, Plus, X, Send, Trash2, Clock, Play, Square,
  Users as UsersIcon, Video, Monitor, Camera, Layers,
  Mic, MicOff, VideoOff, AlertCircle, ChevronRight, ChevronDown,
  Youtube, Crown, Volume2, VolumeX, Maximize2, HelpCircle, Languages
} from 'lucide-react'
import api from '../api'
import { useStore } from '../store'
import './LiveStreams.css'

const SOCKET_URL = import.meta.env.VITE_API_URL || 'https://opu.ic-group.kz'
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  {
    // UDP + TCP: мобильные операторы часто блокируют UDP / дают симметричный NAT,
    // тогда соединение встаёт только через TURN-over-TCP. Оба варианта в одном relay.
    urls: [
      'turn:77.246.247.208:3478?transport=udp',
      'turn:77.246.247.208:3478?transport=tcp',
    ],
    username: 'icgroup',
    credential: 'turn_pass_2024',
  },
]

// ── YouTube helpers ───────────────────────────────────────────────────────────
function getYtId(url) {
  if (!url) return ''
  try {
    if (url.includes('youtu.be/')) return url.split('youtu.be/')[1].split(/[?&]/)[0]
    if (url.includes('watch?v=')) return url.split('watch?v=')[1].split('&')[0]
    if (url.includes('/live/')) return url.split('/live/')[1].split(/[?&]/)[0]
    if (url.includes('/embed/')) return url.split('/embed/')[1].split(/[?&]/)[0]
    if (url.includes('/shorts/')) return url.split('/shorts/')[1].split(/[?&]/)[0]
  } catch {}
  return ''
}

function loadYTApi() {
  return new Promise(resolve => {
    if (window.YT && window.YT.Player) { resolve(); return }
    const prev = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve() }
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const s = document.createElement('script')
      s.src = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
  })
}

function fmtTime(iso) {
  const d = new Date(iso)
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
}

async function translateToKazakh(text) {
  if (!text?.trim()) return text
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ru|kk`)
  const json = await r.json()
  return json?.responseData?.translatedText || text
}

// Текст/варианты вопроса на выбранном языке с откатом на русский, если казахский не заполнен
function pickQuizLang(q, lang) {
  const text = lang === 'kk' && q.text_kk?.trim() ? q.text_kk : q.text
  const options = lang === 'kk' && q.options_kk?.length === q.options.length
    ? q.options.map((o, i) => (q.options_kk[i]?.trim() ? q.options_kk[i] : o))
    : q.options
  return { text, options }
}

const STREAM_TYPES = [
  { id: 'youtube', label: 'YouTube', icon: Youtube, hint: 'Синхронный показ YouTube видео' },
  { id: 'camera', label: 'Камера', icon: Camera, hint: 'Трансляция с вашей веб-камеры' },
  { id: 'screen', label: 'Экран', icon: Monitor, hint: 'Показ экрана / презентации' },
  { id: 'camera_screen', label: 'Камера + Экран', icon: Layers, hint: 'Экран с камерой в углу' },
]

// ── Главный компонент ─────────────────────────────────────────────────────────
function fmtDuration(start, end) {
  if (!start || !end) return null
  const mins = Math.round((new Date(end) - new Date(start)) / 60000)
  if (mins < 60) return `${mins} мин`
  return `${Math.floor(mins / 60)}ч ${mins % 60}мин`
}

// Секунды просмотра эфира → "1ч 12мин" / "34 сек"
function fmtWatchSeconds(sec) {
  if (!sec || sec < 1) return '< 1 сек'
  if (sec < 60) return `${sec} сек`
  const mins = Math.round(sec / 60)
  if (mins < 60) return `${mins} мин`
  return `${Math.floor(mins / 60)}ч ${mins % 60}мин`
}

// ── WebRTC примитив: соединение с буферизацией ICE ────────────────────────────
// Главный источник хрупкости WebRTC — ICE-кандидаты, пришедшие до setRemoteDescription.
// Этот враппер инкапсулирует буферизацию раз и навсегда, чтобы обе стороны были надёжны.
function makePeer({ onLocalIce, onTrack, onState }) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  const pending = []
  let remoteSet = false
  pc.onicecandidate = (e) => { if (e.candidate) onLocalIce(e.candidate) }
  if (onTrack) pc.ontrack = onTrack
  pc.onconnectionstatechange = () => onState?.(pc.connectionState)
  return {
    pc,
    async setRemote(sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      remoteSet = true
      while (pending.length) { try { await pc.addIceCandidate(pending.shift()) } catch {} }
    },
    addRemoteIce(c) {
      const cand = new RTCIceCandidate(c)
      if (remoteSet) pc.addIceCandidate(cand).catch(() => {})
      else pending.push(cand)
    },
    close() { try { pc.close() } catch {} },
  }
}

// ── Захват медиа по типу трансляции ───────────────────────────────────────────
// Возвращает { stream, cameraStream, screenStream, cleanup, ... } — единая точка
// получения медиа, отделённая от сигналинга. camera_screen собирается через canvas.
async function acquireMedia(streamType) {
  if (streamType === 'camera') {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    return { stream, cameraStream: stream, screenStream: null, cleanup: () => stream.getTracks().forEach(t => t.stop()) }
  }

  if (streamType === 'screen') {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: true,
    })
    if (!stream.getAudioTracks().length) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
        mic.getAudioTracks().forEach(t => stream.addTrack(t))
      } catch {}
    }
    return { stream, cameraStream: null, screenStream: stream, cleanup: () => stream.getTracks().forEach(t => t.stop()) }
  }

  // camera_screen — экран + камера в углу через canvas (1920x1080 Full HD для чёткости текста)
  const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 24 } }, audio: true })

  // На компе без вебки (или если камера занята другим приложением) — ведём только с экрана,
  // не роняем весь эфир. Микрофон всё равно пробуем получить отдельно.
  let cameraStream = null
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 360 }, audio: true })
  } catch {
    // Без камеры: если экран не дал звук — добавляем отдельный микрофон как единственную дорожку
    // (без AudioContext-микшера, поэтому только когда звука экрана ещё нет вообще).
    if (!screenStream.getAudioTracks().length) {
      try {
        const micOnly = await navigator.mediaDevices.getUserMedia({ audio: true })
        micOnly.getAudioTracks().forEach(t => screenStream.addTrack(t))
      } catch {}
    }
  }

  if (!cameraStream) {
    return {
      stream: screenStream, cameraStream: null, screenStream, cleanup: () => screenStream.getTracks().forEach(t => t.stop()),
      noCamera: true, setLayout: () => {},
    }
  }

  // Скрытые video-элементы в DOM (нужны чтобы браузер декодировал кадры в canvas)
  const mkVid = (ms) => {
    const v = document.createElement('video')
    v.srcObject = ms; v.muted = true; v.playsInline = true; v.autoplay = true
    v.style.cssText = 'position:fixed;right:0;bottom:0;width:64px;height:36px;opacity:0.01;pointer-events:none;z-index:-1'
    document.body.appendChild(v)
    return v
  }
  const screenVid = mkVid(screenStream)
  const camVid = mkVid(cameraStream)

  // Ждём первый реальный кадр обоих видео
  await Promise.all([screenVid, camVid].map(v => new Promise(res => {
    let done = false
    const ok = () => { if (!done) { done = true; res() } }
    v.play().catch(() => {})
    if (v.videoWidth > 0) return ok()
    v.onloadeddata = () => { v.play().catch(() => {}); ok() }
    v.oncanplay = () => { v.play().catch(() => {}); ok() }
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(ok)
    setTimeout(ok, 2500)
  })))

  // Держим декодер «горячим» — самоперезапускающийся rVFC
  const pump = (v) => {
    if (!v.requestVideoFrameCallback) return
    const cb = () => { if (v.srcObject) v.requestVideoFrameCallback(cb) }
    v.requestVideoFrameCallback(cb)
  }
  pump(screenVid); pump(camVid)

  const W = 1920, H = 1080
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  // Раскладка переключается на лету: 'both' = экран + камера в углу, 'camera' = только камера.
  // Меняем только отрисовку canvas — транслируемый трек тот же, зрители не переподключаются.
  let layout = 'both'
  // Рисуем видео с заполнением области (cover), без растяжения пропорций.
  const drawCover = (v, dx, dy, dw, dh) => {
    const vw = v.videoWidth, vh = v.videoHeight
    if (!vw || !vh) return
    const scale = Math.max(dw / vw, dh / vh)
    const sw = dw / scale, sh = dh / scale
    const sx = (vw - sw) / 2, sy = (vh - sh) / 2
    try { ctx.drawImage(v, sx, sy, sw, sh, dx, dy, dw, dh) } catch {}
  }
  const draw = () => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)
    if (layout === 'camera') {
      drawCover(camVid, 0, 0, W, H)
      return
    }
    if (screenVid.videoWidth > 0) try { ctx.drawImage(screenVid, 0, 0, W, H) } catch {}
    if (camVid.videoWidth > 0) {
      const PW = 280, PH = 210, PX = W - PW - 16, PY = H - PH - 16, R = 14
      try {
        ctx.save(); ctx.beginPath(); ctx.roundRect(PX, PY, PW, PH, R); ctx.clip()
        drawCover(camVid, PX, PY, PW, PH); ctx.restore()
        ctx.strokeStyle = '#8fc640'; ctx.lineWidth = 4
        ctx.beginPath(); ctx.roundRect(PX, PY, PW, PH, R); ctx.stroke()
      } catch {}
    }
  }
  draw()
  const FPS = 24  // баланс плавности и нагрузки
  const drawInterval = setInterval(draw, 1000 / FPS)  // setInterval работает и в фоне

  const stream = canvas.captureStream(FPS)
  // Микшируем аудио: микрофон + звук экрана в один трек.
  // ВАЖНО 1: AudioContext создаётся 'suspended' → нужен resume() (есть user gesture от клика).
  // ВАЖНО 2: source-узлы нужно УДЕРЖИВАТЬ ссылкой — иначе GC их убьёт и звук пропадёт.
  let audioCtx = null
  const audioNodes = []          // удерживаем узлы от сборщика мусора
  let mixOk = false
  try {
    audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') { try { await audioCtx.resume() } catch {} }
    const dest = audioCtx.createMediaStreamDestination()
    const addSrc = (tracks) => {
      if (!tracks.length) return
      const src = audioCtx.createMediaStreamSource(new MediaStream(tracks))
      src.connect(dest)
      audioNodes.push(src)
    }
    addSrc(cameraStream.getAudioTracks())   // микрофон
    addSrc(screenStream.getAudioTracks())   // звук экрана (если разрешён)
    if (audioNodes.length && dest.stream.getAudioTracks().length) {
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t))
      audioNodes.push(dest)
      mixOk = true
    }
  } catch {}
  // Фолбэк: если микс не вышел — кладём дорожки напрямую
  if (!mixOk) {
    cameraStream.getAudioTracks().forEach(t => stream.addTrack(t))
    screenStream.getAudioTracks().forEach(t => stream.addTrack(t))
  }

  const cleanup = () => {
    clearInterval(drawInterval)
    audioNodes.forEach(n => { try { n.disconnect() } catch {} })  // ссылка на audioNodes держит их живыми
    screenStream.getTracks().forEach(t => t.stop())
    cameraStream.getTracks().forEach(t => t.stop())
    stream.getTracks().forEach(t => t.stop())
    screenVid.srcObject = null; screenVid.remove()
    camVid.srcObject = null; camVid.remove()
    if (audioCtx) audioCtx.close().catch(() => {})
  }

  return {
    stream, cameraStream, screenStream, screenVid, camVid, audioCtx, audioNodes, cleanup, mixOk,
    setLayout: (m) => { layout = m },   // 'both' | 'camera'
  }
}

export default function LiveStreams({ isAdmin }) {
  const [streams, setStreams] = useState([])
  const [history, setHistory] = useState([])
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [editStream, setEditStream] = useState(null)
  const [room, setRoom] = useState(null)
  const [archive, setArchive] = useState(null) // открытый архив

  const load = useCallback(async () => {
    try { const r = await api.get('/live'); setStreams(r.data.streams || []) } catch {}
  }, [])

  const loadHistory = useCallback(async () => {
    if (historyLoaded) return
    try {
      const r = await api.get('/live/history')
      setHistory(r.data.streams || [])
      setHistoryLoaded(true)
    } catch {}
  }, [historyLoaded])

  useEffect(() => {
    load()
    const t = setInterval(load, 20000)
    return () => clearInterval(t)
  }, [load])

  const startStream = async (s) => { await api.post(`/live/${s.id}/start`); load() }
  const endStream = async (s) => {
    if (window.confirm('Завершить эфир?')) {
      await api.post(`/live/${s.id}/end`)
      load()
      setHistoryLoaded(false) // сбросить кэш истории
    }
  }
  const delStream = async (s) => { if (window.confirm('Удалить эфир?')) { await api.delete(`/live/${s.id}`); load() } }

  if (room) {
    return <LiveRoom stream={room} isAdmin={isAdmin} onClose={() => { setRoom(null); load() }} />
  }

  if (archive) {
    return <ArchiveRoom stream={archive} isAdmin={isAdmin} onClose={() => setArchive(null)} />
  }

  const live = streams.filter(s => s.status === 'live')
  const upcoming = streams.filter(s => s.status === 'scheduled')

  const typeInfo = (s) => STREAM_TYPES.find(t => t.id === (s.stream_type || 'youtube'))

  const toggleHistory = () => {
    if (!showHistory) loadHistory()
    setShowHistory(v => !v)
  }

  return (
    <div className="ls-section">
      <div className="ls-head">
        <div className="ls-head-title"><Radio size={16} /> Прямые эфиры</div>
        {isAdmin && (
          <button className="ls-create-btn" onClick={() => { setEditStream(null); setCreateOpen(true) }}>
            <Plus size={14} /> Создать эфир
          </button>
        )}
      </div>

      {/* Нет активных эфиров */}
      {live.length === 0 && upcoming.length === 0 && !isAdmin && (
        <div className="ls-empty-hint">Нет активных эфиров</div>
      )}

      <div className="ls-list">
        {live.map(s => {
          const TIcon = typeInfo(s)?.icon || Video
          return (
            <div key={s.id} className="ls-card live" onClick={() => setRoom(s)}>
              <div className="ls-live-badge"><span className="ls-dot" /> В ЭФИРЕ</div>
              <div className="ls-type-row"><TIcon size={13} className="ls-type-icon" />{typeInfo(s)?.label}</div>
              <div className="ls-card-title">{s.title}</div>
              {s.description && <div className="ls-card-desc">{s.description}</div>}
              <button className="ls-join-btn">Подключиться к эфиру →</button>
              {isAdmin && (
                <div className="ls-admin-row" onClick={e => e.stopPropagation()}>
                  <button className="ls-mini" onClick={() => { setEditStream(s); setCreateOpen(true) }}><HelpCircle size={12} /> Опросник</button>
                  <button className="ls-mini end" onClick={() => endStream(s)}><Square size={12} /> Завершить</button>
                  <button className="ls-mini del" onClick={() => delStream(s)}><Trash2 size={12} /></button>
                </div>
              )}
            </div>
          )
        })}

        {upcoming.map(s => {
          const TIcon = typeInfo(s)?.icon || Video
          return (
            <div key={s.id} className="ls-card upcoming">
              <div className="ls-time"><Clock size={13} /> {fmtTime(s.starts_at)}</div>
              <div className="ls-type-row"><TIcon size={13} className="ls-type-icon" />{typeInfo(s)?.label}</div>
              <div className="ls-card-title">{s.title}</div>
              {s.description && <div className="ls-card-desc">{s.description}</div>}
              {!isAdmin && <div className="ls-soon-hint">Эфир скоро начнётся — придёт уведомление</div>}
              {isAdmin && (
                <div className="ls-admin-row">
                  <button className="ls-mini start" onClick={() => startStream(s)}><Play size={12} /> Начать сейчас</button>
                  <button className="ls-mini" onClick={() => { setEditStream(s); setCreateOpen(true) }}>Изменить</button>
                  <button className="ls-mini del" onClick={() => delStream(s)}><Trash2 size={12} /></button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* История эфиров */}
      <div className="ls-history-section">
        <button className="ls-history-toggle" onClick={toggleHistory}>
          <Clock size={14} />
          <span>История эфиров</span>
          <ChevronDown size={14} style={{ transform: showHistory ? 'rotate(180deg)' : 'none', transition: 'transform .2s', marginLeft: 'auto' }} />
        </button>

        {showHistory && (
          <div className="ls-history-list">
            {!historyLoaded && <div className="ls-hist-loading">Загрузка...</div>}
            {historyLoaded && history.length === 0 && (
              <div className="ls-hist-empty">История эфиров пуста</div>
            )}
            {history.map(s => {
              const TIcon = typeInfo(s)?.icon || Video
              const duration = fmtDuration(s.starts_at, s.ended_at)
              const hasQuiz = !!(s.quiz?.questions?.length)
              return (
                <div key={s.id} className="ls-hist-card" onClick={() => setArchive(s)}>
                  <div className="ls-hist-left">
                    <div className="ls-hist-icon"><TIcon size={16} /></div>
                    <div className="ls-hist-info">
                      <div className="ls-hist-title">{s.title}</div>
                      <div className="ls-hist-meta">
                        {fmtTime(s.starts_at)}
                        {duration && <span className="ls-hist-dur">· {duration}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="ls-hist-stats">
                    {parseInt(s.message_count) > 0 && (
                      <span className="ls-hist-chip chat">💬 {s.message_count}</span>
                    )}
                    {hasQuiz && (
                      <span className="ls-hist-chip quiz">📝 {s.quiz_submissions || 0} прошли</span>
                    )}
                    <ChevronRight size={14} className="ls-hist-arrow" />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateStreamModal
          stream={editStream}
          onClose={() => { setCreateOpen(false); setEditStream(null) }}
          onSaved={() => { setCreateOpen(false); setEditStream(null); load() }}
        />
      )}
    </div>
  )
}

// ── Форма теста в архиве (для тех кто не сдал / не проходил) ─────────────────
function ArchiveQuizForm({ stream, onDone }) {
  const quiz = stream.quiz
  const questions = quiz?.questions || []
  const [answers, setAnswers] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [lang, setLang] = useState(() => localStorage.getItem('ic_quiz_lang') || 'ru')
  const setQuizLang = (l) => { setLang(l); localStorage.setItem('ic_quiz_lang', l) }

  const submit = async () => {
    if (Object.keys(answers).length < questions.length) return
    setLoading(true)
    try {
      const r = await api.post(`/live/${stream.id}/quiz/submit`, { answers })
      const res = { score: r.data.score, total: r.data.total }
      setResult(res)
      onDone(res)
    } catch (e) {
      // 409 — тест уже пройден ранее (гонка/повторный клик); показываем сохранённый результат
      if (e.response?.status === 409) {
        const res = { score: e.response.data.score, total: e.response.data.total }
        setResult(res)
        onDone(res)
      }
    }
    setLoading(false)
  }

  if (result) {
    const pct = Math.round(result.score / result.total * 100)
    const passed = pct >= 70
    return (
      <div className="ar-my-result">
        <div className="ar-my-score-circle" style={{ '--pct': pct }}>
          <span>{result.score}/{result.total}</span>
        </div>
        <div className="ar-my-label">{passed ? '🎉 Тест сдан!' : '😔 Тест не сдан'}</div>
        <div className="ar-my-sub">{pct}% правильных ответов</div>
      </div>
    )
  }

  return (
    <div className="ar-quiz-form">
      <div className="ls-quiz-lang-tabs" style={{ marginBottom: 4 }}>
        <button type="button" className={`ls-quiz-lang-tab ${lang === 'ru' ? 'active' : ''}`} onClick={() => setQuizLang('ru')}>RU</button>
        <button type="button" className={`ls-quiz-lang-tab ${lang === 'kk' ? 'active' : ''}`} onClick={() => setQuizLang('kk')}>ҚАЗ</button>
      </div>
      <div className="ar-prev-fail">Тест можно пройти только один раз — ответы нельзя будет изменить после отправки.</div>
      {questions.map((q, qi) => {
        const { text, options } = pickQuizLang(q, lang)
        return (
        <div key={qi} className="ar-qf-question">
          <div className="ar-qf-text">{qi + 1}. {text}</div>
          <div className="ar-qf-opts">
            {options.map((opt, oi) => (
              <div
                key={oi}
                className={`ar-qf-opt ${answers[qi] === oi ? 'selected' : ''}`}
                onClick={() => setAnswers(prev => ({ ...prev, [qi]: oi }))}
              >
                <span className="ar-qf-dot" />
                {opt}
              </div>
            ))}
          </div>
        </div>
        )
      })}
      <button
        className="ar-qf-submit"
        disabled={Object.keys(answers).length < questions.length || loading}
        onClick={submit}
      >
        {loading ? 'Отправка...' : 'Отправить ответы'}
      </button>
    </div>
  )
}

// ── Просмотр архива эфира ─────────────────────────────────────────────────────
function ArchiveRoom({ stream, isAdmin, onClose }) {
  const { user } = useStore()
  const canSeeAll = ['admin', 'partner', 'auditor'].includes(user?.role)
  const [tab, setTab] = useState('chat')
  const [messages, setMessages] = useState([])
  const [quizResults, setQuizResults] = useState([])
  const [myResult, setMyResult] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedUser, setExpandedUser] = useState(null)

  const hasQuiz = !!(stream.quiz?.questions?.length)
  const TIcon = STREAM_TYPES.find(t => t.id === (stream.stream_type || 'youtube'))?.icon || Video
  const duration = fmtDuration(stream.starts_at, stream.ended_at)

  useEffect(() => {
    const loads = [
      api.get(`/live/${stream.id}/messages`).then(r => setMessages(r.data.messages || [])).catch(() => {}),
    ]
    if (hasQuiz) {
      if (canSeeAll) {
        loads.push(api.get(`/live/${stream.id}/quiz/results`).then(r => setQuizResults(r.data.results || [])).catch(() => {}))
      } else {
        loads.push(api.get(`/live/${stream.id}/quiz/my-result`).then(r => setMyResult(r.data.result)).catch(() => {}))
      }
    }
    if (canSeeAll) {
      loads.push(api.get(`/live/${stream.id}/attendance`).then(r => setAttendance(r.data.attendance || [])).catch(() => {}))
    }
    Promise.all(loads).finally(() => setLoading(false))
  }, [stream.id])

  const avgScore = quizResults.length
    ? (quizResults.reduce((s, r) => s + (r.score / r.total * 100), 0) / quizResults.length).toFixed(0)
    : null
  const passCount = quizResults.filter(r => r.score / r.total >= 0.7).length

  return (
    <div className="ar-wrap">
      {/* Шапка */}
      <div className="ar-header">
        <button className="ar-back" onClick={onClose}><X size={18} /></button>
        <div className="ar-header-info">
          <div className="ar-header-title">
            <TIcon size={14} className="ar-type-icon" />
            {stream.title}
          </div>
          <div className="ar-header-meta">
            {fmtTime(stream.starts_at)}
            {duration && <span>· {duration}</span>}
            {stream.host_name && <span>· {stream.host_name}</span>}
          </div>
        </div>
      </div>

      {/* Табы */}
      <div className="ar-tabs">
        <button className={`ar-tab ${tab === 'chat' ? 'active' : ''}`} onClick={() => setTab('chat')}>
          💬 Чат <span className="ar-tab-count">{messages.length}</span>
        </button>
        {hasQuiz && (
          <button className={`ar-tab ${tab === 'quiz' ? 'active' : ''}`} onClick={() => setTab('quiz')}>
            📝 Тест {canSeeAll && quizResults.length > 0 && <span className="ar-tab-count">{quizResults.length}</span>}
          </button>
        )}
        {canSeeAll && (
          <button className={`ar-tab ${tab === 'attendance' ? 'active' : ''}`} onClick={() => setTab('attendance')}>
            👥 Участники <span className="ar-tab-count">{attendance.length}</span>
          </button>
        )}
      </div>

      {loading && <div className="ar-loading">Загрузка...</div>}

      {!loading && tab === 'chat' && (
        <div className="ar-chat">
          {messages.length === 0 ? (
            <div className="ar-empty">Сообщений не было</div>
          ) : (
            messages.map((m, i) => {
              const isAdmin2 = ['admin', 'partner', 'auditor'].includes(m.user_role)
              const showName = i === 0 || messages[i - 1].user_id !== m.user_id
              return (
                <div key={m.id} className={`ar-msg ${isAdmin2 ? 'host' : ''}`}>
                  {showName && (
                    <div className="ar-msg-name">
                      {m.user_name}
                      {isAdmin2 && <span className="ar-msg-host-tag">ведущий</span>}
                      <span className="ar-msg-time">
                        {new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  <div className="ar-msg-text">{m.message}</div>
                </div>
              )
            })
          )}
        </div>
      )}

      {!loading && tab === 'quiz' && hasQuiz && (
        <div className="ar-quiz">
          {canSeeAll ? (
            <>
              {/* Сводка */}
              <div className="ar-quiz-summary">
                <div className="ar-qsum-card">
                  <div className="ar-qsum-val">{quizResults.length}</div>
                  <div className="ar-qsum-label">прошли тест</div>
                </div>
                <div className="ar-qsum-card green">
                  <div className="ar-qsum-val">{passCount}</div>
                  <div className="ar-qsum-label">сдали (≥70%)</div>
                </div>
                {avgScore && (
                  <div className="ar-qsum-card blue">
                    <div className="ar-qsum-val">{avgScore}%</div>
                    <div className="ar-qsum-label">средний балл</div>
                  </div>
                )}
              </div>

              {/* Список результатов */}
              {quizResults.length === 0 ? (
                <div className="ar-empty">Никто ещё не прошёл тест</div>
              ) : (
                <div className="ar-results-list">
                  {quizResults.map(r => {
                    const pct = Math.round(r.score / r.total * 100)
                    const passed = pct >= 70
                    const isOpen = expandedUser === r.id
                    const userAnswers = r.answers || {}
                    const questions = stream.quiz?.questions || []
                    return (
                      <div key={r.id} className={`ar-result-item ${isOpen ? 'open' : ''}`}>
                        <div className="ar-result-row" onClick={() => setExpandedUser(isOpen ? null : r.id)}>
                          <div className="ar-result-avatar">{(r.full_name || r.phone || '?')[0]}</div>
                          <div className="ar-result-name">{r.full_name || r.phone}</div>
                          <div className="ar-result-score">
                            <div className="ar-score-bar">
                              <div className="ar-score-fill" style={{ width: pct + '%', background: passed ? '#8fc640' : '#ef4444' }} />
                            </div>
                            <span className={`ar-score-val ${passed ? 'pass' : 'fail'}`}>
                              {r.score}/{r.total} · {pct}%
                            </span>
                          </div>
                          <span className={`ar-badge ${passed ? 'pass' : 'fail'}`}>{passed ? '✓ Сдал' : '✗ Не сдал'}</span>
                          <span className="ar-expand-icon">{isOpen ? '▲' : '▼'}</span>
                        </div>
                        {isOpen && (
                          <div className="ar-user-answers">
                            {questions.map((q, qi) => {
                              const chosen = parseInt(userAnswers[qi])
                              const isCorrect = chosen === q.correct
                              return (
                                <div key={qi} className={`ar-ua-q ${isCorrect ? 'correct' : 'wrong'}`}>
                                  <div className="ar-ua-q-text">
                                    <span className={`ar-ua-icon`}>{isCorrect ? '✓' : '✗'}</span>
                                    {qi + 1}. {q.text}
                                  </div>
                                  <div className="ar-ua-opts">
                                    {q.options.map((opt, oi) => (
                                      <div key={oi} className={`ar-ua-opt ${oi === q.correct ? 'right' : ''} ${oi === chosen && !isCorrect ? 'picked-wrong' : ''}`}>
                                        {oi === q.correct && <span>✓</span>}
                                        {oi === chosen && !isCorrect && <span>✗</span>}
                                        {opt}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Вопросы с правильными ответами */}
              <div className="ar-quiz-questions">
                <div className="ar-quiz-q-title">Правильные ответы</div>
                {stream.quiz.questions.map((q, qi) => (
                  <div key={qi} className="ar-quiz-q">
                    <div className="ar-quiz-q-text">{qi + 1}. {q.text}</div>
                    <div className="ar-quiz-opts">
                      {q.options.map((opt, oi) => (
                        <div key={oi} className={`ar-quiz-opt ${oi === q.correct ? 'correct' : ''}`}>
                          {oi === q.correct && <span className="ar-quiz-check">✓</span>}
                          {opt}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            /* Свой результат — тест только один раз, поэтому если попытка уже была, форма больше не показывается */
            myResult ? (
              <div className="ar-my-result">
                <div className="ar-my-score-circle" style={{ '--pct': Math.round(myResult.score / myResult.total * 100) }}>
                  <span>{myResult.score}/{myResult.total}</span>
                </div>
                <div className="ar-my-label">{myResult.score / myResult.total >= 0.7 ? '🎉 Тест сдан!' : '😔 Тест не сдан'}</div>
                <div className="ar-my-sub">{Math.round(myResult.score / myResult.total * 100)}% правильных ответов</div>
              </div>
            ) : (
              <ArchiveQuizForm
                stream={stream}
                onDone={result => setMyResult(result)}
              />
            )
          )}
        </div>
      )}

      {!loading && tab === 'attendance' && canSeeAll && (
        <div className="ar-chat">
          {attendance.length === 0 ? (
            <div className="ar-empty">Никто не заходил в эфир</div>
          ) : (
            <div className="ar-results-list">
              {attendance.map(a => (
                <div key={a.user_id} className="ar-result-item">
                  <div className="ar-result-row" style={{ cursor: 'default' }}>
                    <div className="ar-result-avatar">{(a.full_name || a.phone || '?')[0]}</div>
                    <div className="ar-result-name">
                      {a.full_name || a.phone}
                      {a.last_joined_at && <span className="ar-msg-host-tag" style={{ marginLeft: 6 }}>сейчас в эфире</span>}
                    </div>
                    <span className="ar-score-val pass">{fmtWatchSeconds(a.total_seconds)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Кастомный выбор даты и времени ────────────────────────────────────────────
const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const pad2 = (n) => String(n).padStart(2, '0')

function DateTimePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const fieldRef = useRef(null)
  const popRef = useRef(null)

  // value: "YYYY-MM-DDTHH:mm"
  const parsed = (() => {
    if (value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
      const [d, t] = value.split('T')
      const [y, mo, da] = d.split('-').map(Number)
      const [h, mi] = t.split(':').map(Number)
      return { y, mo: mo - 1, da, h, mi }
    }
    return null
  })()

  const now = new Date()
  const [viewY, setViewY] = useState(parsed?.y ?? now.getFullYear())
  const [viewM, setViewM] = useState(parsed?.mo ?? now.getMonth())

  // Прыгаем календарём на выбранный месяц (например, при пресете «Завтра»)
  useEffect(() => {
    if (parsed) { setViewY(parsed.y); setViewM(parsed.mo) }
  }, [parsed?.y, parsed?.mo])

  // Позиционирование поповера (через портал, fixed) — открывается вниз, при нехватке места вверх
  const computePos = () => {
    const r = fieldRef.current?.getBoundingClientRect()
    if (!r) return
    const W = Math.min(320, Math.max(r.width, 280))
    const H = 360
    const top = (window.innerHeight - r.bottom > H + 12) ? r.bottom + 6 : Math.max(8, r.top - H - 6)
    let left = r.left
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8
    if (left < 8) left = 8
    setPos({ top, left, width: W })
  }
  const toggleOpen = () => { if (!open) computePos(); setOpen(o => !o) }

  // Закрытие по клику вне + по скроллу
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (fieldRef.current?.contains(e.target)) return
      if (popRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('scroll', onScroll, true) }
  }, [open])

  const fmt = (y, mo, da, h, mi) => `${y}-${pad2(mo + 1)}-${pad2(da)}T${pad2(h)}:${pad2(mi)}`

  const selectDay = (da) => {
    onChange(fmt(viewY, viewM, da, parsed?.h ?? 10, parsed?.mi ?? 0))
  }
  const setTime = (h, mi) => {
    const y = parsed?.y ?? viewY, mo = parsed?.mo ?? viewM, da = parsed?.da ?? now.getDate()
    onChange(fmt(y, mo, da, h, mi))
  }

  const prevMonth = () => { if (viewM === 0) { setViewM(11); setViewY(y => y - 1) } else setViewM(m => m - 1) }
  const nextMonth = () => { if (viewM === 11) { setViewM(0); setViewY(y => y + 1) } else setViewM(m => m + 1) }

  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate()
  const firstWeekday = (new Date(viewY, viewM, 1).getDay() + 6) % 7  // Пн = 0
  const isToday = (da) => da === now.getDate() && viewM === now.getMonth() && viewY === now.getFullYear()
  const isPast = (da) => new Date(viewY, viewM, da, 23, 59) < now
  const isSelected = (da) => parsed && parsed.da === da && parsed.mo === viewM && parsed.y === viewY

  const monthLabel = new Date(viewY, viewM).toLocaleString('ru-RU', { month: 'long', year: 'numeric' })
  const display = parsed
    ? new Date(parsed.y, parsed.mo, parsed.da, parsed.h, parsed.mi)
        .toLocaleString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : 'Выберите дату и время'

  const minutes = Array.from(new Set([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, parsed?.mi ?? 0])).sort((a, b) => a - b)

  return (
    <div className={`ls-dtp ${open ? 'open' : ''}`}>
      <button type="button" ref={fieldRef} className={`ls-dtp-field ${parsed ? 'filled' : ''}`} onClick={toggleOpen}>
        <Clock size={16} className="ls-dtp-field-icon" />
        <span className="ls-dtp-field-text">{display}</span>
        <ChevronDown size={16} className="ls-dtp-field-chev" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && pos && createPortal(
        <div className="ls-dtp-pop" ref={popRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1100 }}>
          <div className="ls-dtp-cal-head">
            <button type="button" className="ls-dtp-nav" onClick={prevMonth}>‹</button>
            <span className="ls-dtp-month">{monthLabel}</span>
            <button type="button" className="ls-dtp-nav" onClick={nextMonth}>›</button>
          </div>

          <div className="ls-dtp-wd">
            {WD.map(d => <span key={d} className="ls-dtp-wd-cell">{d}</span>)}
          </div>

          <div className="ls-dtp-days">
            {Array.from({ length: firstWeekday }).map((_, i) => <span key={'b' + i} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const da = i + 1
              return (
                <button
                  key={da}
                  type="button"
                  className={`ls-dtp-day ${isSelected(da) ? 'selected' : ''} ${isToday(da) ? 'today' : ''} ${isPast(da) ? 'past' : ''}`}
                  onClick={() => selectDay(da)}
                >
                  {da}
                </button>
              )
            })}
          </div>

          <div className="ls-dtp-time">
            <Clock size={14} />
            <span className="ls-dtp-time-label">Время</span>
            <select
              className="ls-dtp-sel"
              value={parsed?.h ?? 10}
              onChange={e => setTime(Number(e.target.value), parsed?.mi ?? 0)}
            >
              {Array.from({ length: 24 }).map((_, h) => <option key={h} value={h}>{pad2(h)}</option>)}
            </select>
            <span className="ls-dtp-colon">:</span>
            <select
              className="ls-dtp-sel"
              value={parsed?.mi ?? 0}
              onChange={e => setTime(parsed?.h ?? 10, Number(e.target.value))}
            >
              {minutes.map(mi => <option key={mi} value={mi}>{pad2(mi)}</option>)}
            </select>
          </div>

          <button type="button" className="ls-dtp-done" onClick={() => setOpen(false)}>Готово</button>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Модалка создания/редактирования ──────────────────────────────────────────
function CreateStreamModal({ stream, onClose, onSaved }) {
  const isNew = !stream
  const [title, setTitle] = useState(stream?.title || '')
  const [desc, setDesc] = useState(stream?.description || '')
  const [url] = useState(stream?.youtube_url || '')
  const [streamType] = useState(stream?.stream_type || 'camera_screen')
  const [dt, setDt] = useState(() => {
    if (stream?.starts_at) {
      const d = new Date(stream.starts_at)
      const off = d.getTimezoneOffset() * 60000
      return new Date(d - off).toISOString().slice(0, 16)
    }
    return ''
  })
  const [videoId] = useState(stream?.video_id || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Квиз после эфира (двуязычный: RU + KZ, correct — общий индекс для обоих языков)
  const [quizEnabled, setQuizEnabled] = useState(!!(stream?.quiz?.questions?.length))
  const [questions, setQuestions] = useState(() => {
    if (stream?.quiz?.questions?.length) return stream.quiz.questions
    return [{ text: '', text_kk: '', options: ['', ''], options_kk: ['', ''], correct: 0 }]
  })
  const [quizLang, setQuizLang] = useState('ru')
  const [translating, setTranslating] = useState(false)

  // datetime-local строка из Date (в локальной зоне)
  const toLocalInput = (d) => {
    const off = d.getTimezoneOffset() * 60000
    return new Date(d - off).toISOString().slice(0, 16)
  }
  // Быстрые пресеты времени
  const presets = (() => {
    const now = new Date()
    const inHour = new Date(now.getTime() + 60 * 60000)
    const today18 = new Date(now); today18.setHours(18, 0, 0, 0)
    const tmrw = new Date(now); tmrw.setDate(tmrw.getDate() + 1)
    const tmrw10 = new Date(tmrw); tmrw10.setHours(10, 0, 0, 0)
    const tmrw18 = new Date(tmrw); tmrw18.setHours(18, 0, 0, 0)
    const list = [{ label: 'Через час', d: inHour }]
    if (today18 > now) list.push({ label: 'Сегодня 18:00', d: today18 })
    list.push({ label: 'Завтра 10:00', d: tmrw10 }, { label: 'Завтра 18:00', d: tmrw18 })
    return list
  })()

  const textField = quizLang === 'kk' ? 'text_kk' : 'text'
  const optsField = quizLang === 'kk' ? 'options_kk' : 'options'

  const addQuestion = () => setQuestions(q => [...q, { text: '', text_kk: '', options: ['', ''], options_kk: ['', ''], correct: 0 }])
  const removeQuestion = (qi) => setQuestions(q => q.filter((_, i) => i !== qi))
  const updateQText = (qi, val) => setQuestions(q => q.map((q2, i) => i === qi ? { ...q2, [textField]: val } : q2))
  const updateCorrect = (qi, val) => setQuestions(q => q.map((q2, i) => i === qi ? { ...q2, correct: val } : q2))
  const updateOption = (qi, oi, val) => setQuestions(q => q.map((q2, i) => i !== qi ? q2 : {
    ...q2, [optsField]: (q2[optsField] || []).map((o, j) => j === oi ? val : o)
  }))
  // Опции RU и KZ всегда одной длины (индексы = correct общий для обоих языков)
  const addOption = (qi) => setQuestions(q => q.map((q2, i) => i !== qi ? q2 : {
    ...q2, options: [...q2.options, ''], options_kk: [...(q2.options_kk || q2.options.map(() => '')), '']
  }))
  const removeOption = (qi, oi) => setQuestions(q => q.map((q2, i) => i !== qi ? q2 : {
    ...q2,
    options: q2.options.filter((_, j) => j !== oi),
    options_kk: (q2.options_kk || q2.options.map(() => '')).filter((_, j) => j !== oi),
    correct: q2.correct >= oi && q2.correct > 0 ? q2.correct - 1 : q2.correct
  }))

  const translateQuiz = async () => {
    setTranslating(true)
    try {
      const updated = await Promise.all(questions.map(async (q) => {
        const text_kk = q.text_kk?.trim() ? q.text_kk : await translateToKazakh(q.text)
        const options_kk = await Promise.all(q.options.map(async (o, i) => {
          const existing = q.options_kk?.[i]
          return existing?.trim() ? existing : translateToKazakh(o)
        }))
        return { ...q, text_kk, options_kk }
      }))
      setQuestions(updated)
      setQuizLang('kk')
    } catch {} finally { setTranslating(false) }
  }

  const save = async () => {
    if (!title.trim()) return setError('Введите название')
    if (!dt) return setError('Укажите дату и время начала')
    if (streamType === 'youtube' && !url.trim()) return setError('Вставьте ссылку на YouTube трансляцию')
    if (quizEnabled) {
      for (const q of questions) {
        if (!q.text.trim()) return setError('Заполните текст всех вопросов')
        if (q.options.some(o => !o.trim())) return setError('Заполните все варианты ответов')
      }
    }
    setLoading(true); setError('')
    try {
      const starts_at = dt + ':00+05:00'
      const body = {
        title,
        description: desc || null,
        youtube_url: streamType === 'youtube' ? url : null,
        video_id: videoId || null,
        starts_at,
        stream_type: streamType,
        quiz: quizEnabled ? { questions } : null,
      }
      if (isNew) await api.post('/live', body)
      else await api.put(`/live/${stream.id}`, body)
      onSaved()
    } catch (e) {
      setError(e.response?.data?.error || 'Ошибка сохранения')
    } finally { setLoading(false) }
  }

  return (
    <div className="ls-backdrop" onClick={onClose}>
      <div className="ls-modal" onClick={e => e.stopPropagation()}>
        <div className="ls-modal-head">
          <span>{isNew ? 'Новый эфир' : 'Редактировать эфир'}</span>
          <button className="ls-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ls-form">
          <div className="ls-form-cols">
          <div className="ls-form-main">
          {error && <div className="ls-error">{error}</div>}
          <label>Название
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Разбор уборки санузлов" />
          </label>
          <label>Описание (необязательно)
            <textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} placeholder="О чём будет эфир..." />
          </label>

          <div>
            <div className="ls-type-label">Тип трансляции</div>
            <div className="ls-type-fixed">
              <Layers size={18} />
              <div className="ls-type-fixed-text">
                <span className="ls-type-fixed-label">Камера + Экран</span>
                <span className="ls-type-fixed-hint">Экран с камерой в углу</span>
              </div>
            </div>
          </div>

          <div className="ls-dt-field">
            <div className="ls-dt-label">Дата и время начала *</div>

            <div className="ls-dt-group">
              <div className="ls-dt-sublabel">Быстрый выбор</div>
              <div className="ls-dt-presets">
                {presets.map((p, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`ls-dt-chip ${dt === toLocalInput(p.d) ? 'active' : ''}`}
                    onClick={() => setDt(toLocalInput(p.d))}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ls-dt-group">
              <div className="ls-dt-sublabel">Точное время</div>
              <DateTimePicker value={dt} onChange={setDt} />
            </div>
          </div>
          </div>{/* /ls-form-main */}

          {/* ── Тест после эфира — отдельный островок справа ── */}
          <div className="ls-form-side">
          <div className="ls-quiz-section">
            <button
              type="button"
              className={`ls-quiz-toggle ${quizEnabled ? 'active' : ''}`}
              onClick={() => setQuizEnabled(v => !v)}
            >
              <div className="ls-quiz-toggle-icon">{quizEnabled ? '✓' : '+'}</div>
              <div>
                <div className="ls-quiz-toggle-title">Тест после эфира</div>
                <div className="ls-quiz-toggle-sub">
                  {quizEnabled ? `${questions.length} вопр. — участники пройдут тест когда эфир завершится` : 'Добавить опрос/проверку знаний'}
                </div>
              </div>
            </button>

            {quizEnabled && (
              <div className="ls-quiz-builder">
                <div className="ls-quiz-lang-row">
                  <div className="ls-quiz-lang-tabs">
                    <button type="button" className={`ls-quiz-lang-tab ${quizLang === 'ru' ? 'active' : ''}`} onClick={() => setQuizLang('ru')}>
                      RU
                    </button>
                    <button type="button" className={`ls-quiz-lang-tab ${quizLang === 'kk' ? 'active' : ''}`} onClick={() => setQuizLang('kk')}>
                      ҚАЗ
                    </button>
                  </div>
                  <button type="button" className="ls-quiz-translate-btn" onClick={translateQuiz} disabled={translating}>
                    <Languages size={12} /> {translating ? 'Перевод...' : 'Перевести на казахский'}
                  </button>
                </div>

                {questions.map((q, qi) => (
                  <div key={qi} className="ls-quiz-q">
                    <div className="ls-quiz-q-head">
                      <span className="ls-quiz-q-num">Вопрос {qi + 1}</span>
                      {questions.length > 1 && (
                        <button type="button" className="ls-quiz-q-del" onClick={() => removeQuestion(qi)}>
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    <input
                      className="ls-quiz-q-input"
                      placeholder={quizLang === 'kk' ? 'Сұрақ мәтіні...' : 'Текст вопроса...'}
                      value={q[textField]}
                      onChange={e => updateQText(qi, e.target.value)}
                    />
                    <div className="ls-quiz-opts">
                      {q.options.map((_, oi) => (
                        <div key={oi} className="ls-quiz-opt-row">
                          <button
                            type="button"
                            className={`ls-quiz-radio ${q.correct === oi ? 'correct' : ''}`}
                            onClick={() => updateCorrect(qi, oi)}
                            title="Правильный ответ"
                          />
                          <input
                            className="ls-quiz-opt-input"
                            placeholder={quizLang === 'kk' ? `${oi + 1}-нұсқа` : `Вариант ${oi + 1}`}
                            value={(q[optsField] || [])[oi] || ''}
                            onChange={e => updateOption(qi, oi, e.target.value)}
                          />
                          {q.options.length > 2 && (
                            <button type="button" className="ls-quiz-opt-del" onClick={() => removeOption(qi, oi)}>
                              <X size={11} />
                            </button>
                          )}
                        </div>
                      ))}
                      {q.options.length < 5 && (
                        <button type="button" className="ls-quiz-add-opt" onClick={() => addOption(qi)}>
                          + вариант
                        </button>
                      )}
                    </div>
                    <div className="ls-quiz-correct-hint">● = правильный ответ (общий для RU и ҚАЗ)</div>
                  </div>
                ))}
                <button type="button" className="ls-quiz-add-q" onClick={addQuestion}>
                  <Plus size={14} /> Добавить вопрос
                </button>
              </div>
            )}
          </div>
          </div>{/* /ls-form-side */}
          </div>{/* /ls-form-cols */}

          <div className="ls-form-footer">
            <button className="ls-btn-cancel" onClick={onClose}>Отмена</button>
            <button className="ls-btn-save" onClick={save} disabled={loading}>
              {loading ? 'Сохранение...' : isNew ? 'Создать эфир' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Тест после эфира (для зрителей) ──────────────────────────────────────────
function PostStreamQuiz({ stream, onDone }) {
  const quiz = stream.quiz
  const [answers, setAnswers] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [score, setScore] = useState(null)
  const [loading, setLoading] = useState(false)
  const [lang, setLang] = useState(() => localStorage.getItem('ic_quiz_lang') || 'ru')
  const setQuizLang = (l) => { setLang(l); localStorage.setItem('ic_quiz_lang', l) }

  if (!quiz?.questions?.length) { onDone(); return null }

  const select = (qi, oi) => !submitted && setAnswers(a => ({ ...a, [qi]: oi }))

  const submit = async () => {
    if (Object.keys(answers).length < quiz.questions.length) return
    setLoading(true)
    try {
      const r = await api.post(`/live/${stream.id}/quiz/submit`, { answers })
      setScore(r.data.score)
      setSubmitted(true)
    } catch (e) {
      // 409 — тест уже проходили ранее, показываем сохранённый результат вместо ошибки
      setScore(e.response?.status === 409 ? e.response.data.score : null)
      setSubmitted(true)
    } finally { setLoading(false) }
  }

  if (submitted) {
    const total = quiz.questions.length
    return (
      <div className="psq-wrap">
        <div className="psq-result">
          <div className="psq-result-icon">🎉</div>
          <div className="psq-result-title">Тест пройден!</div>
          {score !== null && (
            <div className="psq-result-score">{score} / {total} правильных ответов</div>
          )}
          <button className="psq-done-btn" onClick={onDone}>Закрыть</button>
        </div>
      </div>
    )
  }

  return (
    <div className="psq-wrap">
      <div className="psq-inner">
        <div className="psq-head-row">
          <div>
            <div className="psq-title">Тест по эфиру</div>
            <div className="psq-sub">Ответьте на вопросы, чтобы подтвердить просмотр</div>
          </div>
          <div className="ls-quiz-lang-tabs">
            <button type="button" className={`ls-quiz-lang-tab ${lang === 'ru' ? 'active' : ''}`} onClick={() => setQuizLang('ru')}>RU</button>
            <button type="button" className={`ls-quiz-lang-tab ${lang === 'kk' ? 'active' : ''}`} onClick={() => setQuizLang('kk')}>ҚАЗ</button>
          </div>
        </div>
        {quiz.questions.map((q, qi) => {
          const { text, options } = pickQuizLang(q, lang)
          return (
          <div key={qi} className="psq-q">
            <div className="psq-q-text"><span className="psq-q-num">{qi + 1}.</span> {text}</div>
            <div className="psq-opts">
              {options.map((opt, oi) => (
                <button
                  key={oi}
                  type="button"
                  className={`psq-opt ${answers[qi] === oi ? 'selected' : ''}`}
                  onClick={() => select(qi, oi)}
                >
                  <span className="psq-opt-letter">{String.fromCharCode(65 + oi)}</span>
                  {opt}
                </button>
              ))}
            </div>
          </div>
          )
        })}
        <button
          className="psq-submit"
          disabled={Object.keys(answers).length < quiz.questions.length || loading}
          onClick={submit}
        >
          {loading ? 'Отправка...' : 'Отправить ответы'}
        </button>
      </div>
    </div>
  )
}

// ── Комната эфира ─────────────────────────────────────────────────────────────
function LiveRoom({ stream, isAdmin, onClose }) {
  const { user } = useStore()
  const canControlRole = ['admin', 'partner', 'auditor'].includes(user?.role)
  // Ведущий — конкретный человек (создатель эфира или тот, кому передали роль), а не любой admin/partner/auditor.
  // Для старых эфиров без host_user_id (созданы до этой фичи) — откат на прежнюю ролевую проверку.
  const [hostUserId, setHostUserId] = useState(stream.host_user_id ?? null)
  const isHost = hostUserId != null ? hostUserId === user?.id : canControlRole
  const canSeeViewers = ['admin', 'partner', 'auditor'].includes(user?.role)
  // youtube ТОЛЬКО если есть реальный ytId в ссылке, иначе — WebRTC
  const ytIdCheck = getYtId(stream.youtube_url || '')
  const streamType = ytIdCheck
    ? 'youtube'
    : (stream.stream_type && stream.stream_type !== 'youtube' ? stream.stream_type : 'camera')
  const isWebRTC = !ytIdCheck

  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [viewers, setViewers] = useState(0)
  const [viewersList, setViewersList] = useState([])
  const [showViewers, setShowViewers] = useState(true)
  const [status, setStatus] = useState(stream.status)
  const [connected, setConnected] = useState(false)
  const [showQuiz, setShowQuiz] = useState(false)
  const [quizLaunched, setQuizLaunched] = useState(false)
  const [socket, setSocket] = useState(null)   // живой объект сокета для дочерних компонентов
  const socketRef = useRef(null)
  const listRef = useRef(null)

  const scrollDown = () => requestAnimationFrame(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  })

  // ── Socket ────────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get(`/live/${stream.id}/messages`).then(r => {
      setMessages(r.data.messages || [])
      scrollDown()
    }).catch(() => {})

    const socket = io(SOCKET_URL, {
      path: '/socket.io',
      auth: { token: localStorage.getItem('token') },
      transports: ['websocket', 'polling']
    })
    socketRef.current = socket
    setSocket(socket)   // отдаём объект детям сразу; socket.io буферизует emit до connect

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join', { streamId: stream.id })
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('chat', (msg) => { setMessages(prev => [...prev, msg]); scrollDown() })
    socket.on('message_deleted', ({ messageId }) => setMessages(prev => prev.filter(m => m.id !== messageId)))
    socket.on('viewers', ({ count }) => setViewers(count))
    socket.on('viewers_list', ({ users }) => setViewersList(users || []))
    socket.on('status', ({ status: s }) => {
      setStatus(s)
      if (s === 'ended' && !isHost && stream.quiz?.questions?.length) {
        setTimeout(() => setShowQuiz(true), 1500)
      }
    })
    // Ведущий запустил тест вручную → у зрителей открывается опрос
    socket.on('quiz_started', () => { if (!isHost) setShowQuiz(true) })
    // Роль ведущего передана другому участнику — обновляем права у всех без перезагрузки
    socket.on('host_changed', ({ hostUserId: newHostId }) => setHostUserId(newHostId))

    return () => {
      socket.emit('leave', { streamId: stream.id })
      socket.disconnect()
      setSocket(null)
    }
  }, [stream.id])

  const send = () => {
    const t = text.trim()
    if (!t || !socketRef.current) return
    socketRef.current.emit('chat', { streamId: stream.id, message: t })
    setText('')
  }
  const onKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }
  const deleteMsg = (m) => {
    if (!isHost) return
    socketRef.current?.emit('delete_message', { streamId: stream.id, messageId: m.id })
  }

  const hasQuiz = !!(stream.quiz?.questions?.length)
  const startQuiz = () => {
    if (!isHost || !hasQuiz) return
    if (!window.confirm('Запустить тест у всех зрителей сейчас?')) return
    socketRef.current?.emit('start_quiz', { streamId: stream.id })
    setQuizLaunched(true)
  }

  const [ending, setEnding] = useState(false)
  const stopStream = async () => {
    if (!isHost) return
    if (!window.confirm('Завершить эфир для всех?')) return
    setEnding(true)
    try {
      await api.post(`/live/${stream.id}/end`)
      onClose()
    } catch {
      setEnding(false)
    }
  }

  const transferHost = async (toUserId, toName) => {
    if (!isHost) return
    if (!window.confirm(`Передать роль ведущего пользователю ${toName || 'выбранному участнику'}?`)) return
    try {
      await api.post(`/live/${stream.id}/transfer-host`, { toUserId })
      // hostUserId обновится у всех, включая нас, через socket-событие host_changed
    } catch (e) {
      alert(e.response?.data?.error || 'Не удалось передать роль ведущего')
    }
  }

  if (showQuiz) {
    return <PostStreamQuiz stream={stream} onDone={onClose} />
  }

  return (
    <div className="lr-room">
      <div className="lr-topbar">
        <button className="lr-back" onClick={onClose}><X size={18} /></button>
        <div className="lr-title">{stream.title}</div>
        <div className="lr-topbar-right">
          {isHost && hasQuiz && status !== 'ended' && (
            <button className="lr-start-quiz" onClick={startQuiz} disabled={quizLaunched}>
              <HelpCircle size={14} /> {quizLaunched ? 'Тест запущен' : 'Начать тест'}
            </button>
          )}
          {isHost && status !== 'ended' && (
            <button className="lr-stop-stream" onClick={stopStream} disabled={ending}>
              <Square size={14} /> {ending ? 'Завершаем...' : 'Остановить эфир'}
            </button>
          )}
          <div className="lr-viewers"><UsersIcon size={13} /> {viewers}</div>
          {canSeeViewers && (
            <button
              className={`lr-viewers-toggle ${showViewers ? 'active' : ''}`}
              onClick={() => setShowViewers(v => !v)}
              title="Участники"
            >
              <UsersIcon size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="lr-body">
        {/* Видео/стрим */}
        <div className="lr-main">
          <div className="lr-video-area">
            {status === 'ended' ? (
              <div className="lr-ended">Эфир завершён</div>
            ) : isWebRTC ? (
              isHost
                ? <BroadcasterView stream={stream} streamType={streamType} socket={socket} active={status === 'live'} />
                : <ViewerWebRTCView stream={stream} socket={socket} />
            ) : (
              <YouTubeRoom stream={stream} isHost={isHost} canControl={canSeeViewers} socket={socket} />
            )}
          </div>
        </div>

        {/* Правая панель: участники + чат */}
        <div className="lr-sidebar">
          {/* Участники (collapsible, только admin/auditor) */}
          {canSeeViewers && (
            <div className={`lr-participants ${showViewers ? 'open' : 'closed'}`}>
              <button className="lr-part-toggle" onClick={() => setShowViewers(v => !v)}>
                <UsersIcon size={13} />
                <span>Участники ({viewersList.length})</span>
                <ChevronDown size={13} style={{ transform: showViewers ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
              </button>
              {showViewers && (
                <div className="lr-vp-list">
                  {viewersList.length === 0
                    ? <div className="lr-vp-empty">Никого нет</div>
                    : viewersList.map((v, i) => {
                        const isHostUser = hostUserId != null ? v.userId === hostUserId : ['admin', 'partner'].includes(v.role)
                        const canBecomeHost = ['admin', 'partner', 'auditor'].includes(v.role)
                        const showTransferBtn = isHost && !isHostUser && canBecomeHost && v.userId !== user?.id
                        return (
                          <div key={v.userId + '-' + i} className="lr-vp-row">
                            <div className={`lr-vp-avatar ${isHostUser ? 'host' : ''}`}>
                              {(v.name || '?')[0]}
                            </div>
                            <div className="lr-vp-name">
                              {v.name}
                              {isHostUser && <span className="lr-vp-host-tag"><Crown size={9} /> ведущий</span>}
                              {v.role === 'auditor' && <span className="lr-vp-aud-tag">аудитор</span>}
                            </div>
                            {showTransferBtn && (
                              <button
                                className="lr-vp-transfer-btn"
                                title="Передать роль ведущего"
                                onClick={() => transferHost(v.userId, v.name)}
                              >
                                Сделать ведущим
                              </button>
                            )}
                          </div>
                        )
                      })}
                </div>
              )}
            </div>
          )}

          {/* Чат */}
          <div className="lr-chat">
          <div className="lr-chat-head">
            Чат {!connected && <span className="lr-reconnect">подключение…</span>}
          </div>
          <div className="lr-messages" ref={listRef}>
            {messages.length === 0 && (
              <div className="lr-empty">Задайте вопрос ведущему — он ответит в эфире</div>
            )}
            {messages.map(m => {
              const mine = m.user_id === user?.id
              const host = ['admin', 'partner', 'auditor'].includes(m.user_role)
              return (
                <div key={m.id} className={`lr-msg ${mine ? 'mine' : ''} ${host ? 'host' : ''}`}>
                  <div className="lr-msg-name">
                    {m.user_name}{host && <span className="lr-host-tag">ведущий</span>}
                    {isHost && !mine && (
                      <button className="lr-msg-del" onClick={() => deleteMsg(m)}><Trash2 size={11} /></button>
                    )}
                  </div>
                  <div className="lr-msg-text">{m.message}</div>
                </div>
              )
            })}
          </div>
          {status !== 'ended' ? (
            <div className="lr-input-row">
              <input
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={onKey}
                placeholder="Написать вопрос..."
                maxLength={1000}
              />
              <button className="lr-send" onClick={send} disabled={!text.trim()}><Send size={16} /></button>
            </div>
          ) : (
            <div className="lr-closed">Эфир завершён — чат закрыт</div>
          )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── YouTube синхро-рум ────────────────────────────────────────────────────────
function YouTubeRoom({ stream, isHost, canControl, socket }) {
  const ytId = getYtId(stream.youtube_url)
  const ytWrapRef = useRef(null)
  const playerRef = useRef(null)
  const pendingRef = useRef(null)
  const socketLiveRef = useRef(null)   // всегда актуальный socket для YT-колбэков
  socketLiveRef.current = socket
  const [started, setStarted] = useState(false)
  // Камера ведущего/аудитора (PiP)
  const [camOn, setCamOn] = useState(false)
  const [camError, setCamError] = useState('')
  const camVideoRef = useRef(null)
  const camStreamRef = useRef(null)
  const camPeersRef = useRef(new Map())     // viewerId -> peer
  const camAnnounceRef = useRef(null)
  // Чужая камера (для зрителей)
  const [remoteCamActive, setRemoteCamActive] = useState(false)
  const remoteCamRef = useRef(null)
  const remotePeerRef = useRef(null)
  const remoteStreamRef = useRef(null)

  const applyPlayback = (data) => {
    if (canControl) return
    const p = playerRef.current
    if (!p || !p.getCurrentTime || !window.YT) { pendingRef.current = data; return }
    const S = window.YT.PlayerState
    const target = Number(data.position) || 0
    if (Math.abs(p.getCurrentTime() - target) > 1.5) p.seekTo(target, true)
    const st = p.getPlayerState()
    if (data.playing && st !== S.PLAYING) p.playVideo()
    if (!data.playing && st === S.PLAYING) p.pauseVideo()
  }

  const broadcastPlayback = () => {
    if (!canControl) return
    const p = playerRef.current, s = socketLiveRef.current
    if (!p || !p.getCurrentTime || !s || !window.YT) return
    const playing = p.getPlayerState() === window.YT.PlayerState.PLAYING
    s.emit('playback', { streamId: stream.id, position: p.getCurrentTime(), playing })
  }

  const togglePlay = () => {
    const p = playerRef.current
    if (!p || !window.YT) return
    if (p.getPlayerState() === window.YT.PlayerState.PLAYING) p.pauseVideo()
    else p.playVideo()
    setTimeout(broadcastPlayback, 200)
  }

  // Приём синхро-состояния (зритель)
  useEffect(() => {
    if (!socket) return
    socket.on('playback', applyPlayback)
    return () => socket.off('playback', applyPlayback)
  }, [socket, canControl])

  // Инициализация YT-плеера
  useEffect(() => {
    if (!ytId) return
    let player = null
    loadYTApi().then(() => {
      if (!ytWrapRef.current) return
      const div = document.createElement('div')
      ytWrapRef.current.appendChild(div)
      player = new window.YT.Player(div, {
        videoId: ytId,
        width: '100%', height: '100%',
        playerVars: {
          rel: 0, modestbranding: 1, playsinline: 1, autoplay: 0,
          controls: canControl ? 1 : 0,
          disablekb: canControl ? 0 : 1,
          fs: canControl ? 1 : 0,
        },
        events: {
          onReady: () => {
            playerRef.current = player
            if (!canControl && pendingRef.current && started) applyPlayback(pendingRef.current)
          },
          onStateChange: () => { if (canControl) broadcastPlayback() }
        }
      })
    })
    return () => { try { player?.destroy() } catch {}; playerRef.current = null }
  }, [ytId, canControl])

  // Ведущий периодически шлёт позицию
  useEffect(() => {
    if (!canControl) return
    const t = setInterval(() => {
      const p = playerRef.current
      if (p?.getPlayerState && window.YT && p.getPlayerState() === window.YT.PlayerState.PLAYING) broadcastPlayback()
    }, 2000)
    return () => clearInterval(t)
  }, [canControl])

  // ── Камера PiP: вещание (ведущий/аудитор) ──
  const startCam = async () => {
    setCamError('')
    try {
      const ms = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      camStreamRef.current = ms
      if (camVideoRef.current) { camVideoRef.current.srcObject = ms; camVideoRef.current.play().catch(() => {}) }
      setCamOn(true)
      if (!socket) return

      socket.off('yt_cam_viewer_joined'); socket.off('yt_cam_answer'); socket.off('yt_cam_ice_b')

      socket.on('yt_cam_viewer_joined', ({ viewerSocketId }) => {
        const old = camPeersRef.current.get(viewerSocketId); if (old) old.close()
        const peer = makePeer({
          onLocalIce: (candidate) => socket.emit('yt_cam_ice', { target: viewerSocketId, candidate }),
          onState: (st) => { if (['failed', 'closed'].includes(st)) { peer.close(); camPeersRef.current.delete(viewerSocketId) } },
        })
        camPeersRef.current.set(viewerSocketId, peer)
        ms.getTracks().forEach(t => peer.pc.addTrack(t, ms))
        peer.pc.createOffer()
          .then(o => peer.pc.setLocalDescription(o))
          .then(() => socket.emit('yt_cam_offer', { target: viewerSocketId, sdp: peer.pc.localDescription }))
          .catch(() => {})
      })
      socket.on('yt_cam_answer', ({ from, sdp }) => camPeersRef.current.get(from)?.setRemote(sdp).catch(() => {}))
      socket.on('yt_cam_ice_b', ({ from, candidate }) => { if (candidate) camPeersRef.current.get(from)?.addRemoteIce(candidate) })

      const announce = () => socket.emit('yt_cam_start', { streamId: stream.id })
      camAnnounceRef.current = announce
      socket.on('connect', announce)
      announce()
    } catch (e) { setCamError(e.message) }
  }

  const stopCam = () => {
    camStreamRef.current?.getTracks().forEach(t => t.stop())
    camStreamRef.current = null
    camPeersRef.current.forEach(p => p.close())
    camPeersRef.current.clear()
    setCamOn(false)
    if (socket) {
      socket.emit('yt_cam_stop', { streamId: stream.id })
      socket.off('yt_cam_viewer_joined'); socket.off('yt_cam_answer'); socket.off('yt_cam_ice_b')
      if (camAnnounceRef.current) socket.off('connect', camAnnounceRef.current)
    }
  }

  // ── Камера PiP: приём (зритель) ──
  useEffect(() => {
    if (canControl || !socket) return
    const onCamReady = ({ broadcasterSocketId }) => {
      setRemoteCamActive(true)
      remotePeerRef.current?.close()
      const peer = makePeer({
        onLocalIce: (candidate) => socket.emit('yt_cam_ice_v', { target: broadcasterSocketId, candidate }),
        onTrack: (e) => {
          remoteStreamRef.current = e.streams[0]
          const v = remoteCamRef.current
          if (v && e.streams[0]) { v.srcObject = e.streams[0]; v.play().catch(() => {}) }
        },
      })
      remotePeerRef.current = peer
      socket.emit('yt_cam_viewer_ready', { streamId: stream.id })
    }
    const onOffer = async ({ from, sdp }) => {
      const peer = remotePeerRef.current
      if (!peer) return
      try {
        await peer.setRemote(sdp)
        const answer = await peer.pc.createAnswer()
        await peer.pc.setLocalDescription(answer)
        socket.emit('yt_cam_answer', { target: from, sdp: answer })
      } catch (e) { console.error('cam offer error', e) }
    }
    const onIce = ({ candidate }) => { if (candidate) remotePeerRef.current?.addRemoteIce(candidate) }
    const onStop = () => {
      setRemoteCamActive(false)
      if (remoteCamRef.current) remoteCamRef.current.srcObject = null
      remoteStreamRef.current = null
      remotePeerRef.current?.close()
      remotePeerRef.current = null
    }
    socket.on('yt_cam_ready', onCamReady)
    socket.on('yt_cam_offer', onOffer)
    socket.on('yt_cam_ice_b', onIce)
    socket.on('yt_cam_ended', onStop)
    return () => { socket.off('yt_cam_ready', onCamReady); socket.off('yt_cam_offer', onOffer); socket.off('yt_cam_ice_b', onIce); socket.off('yt_cam_ended', onStop) }
  }, [socket, canControl, stream.id])

  // Применяем удалённый поток если video смонтировался позже ontrack
  useEffect(() => {
    if (remoteCamActive && remoteCamRef.current && remoteStreamRef.current && !remoteCamRef.current.srcObject) {
      remoteCamRef.current.srcObject = remoteStreamRef.current
      remoteCamRef.current.play().catch(() => {})
    }
  }, [remoteCamActive])

  // Гарантированная остановка камеры при размонтировании
  useEffect(() => () => {
    camStreamRef.current?.getTracks().forEach(t => t.stop())
    camPeersRef.current.forEach(p => p.close())
    camPeersRef.current.clear()
  }, [])

  const enter = () => {
    setStarted(true)
    const p = playerRef.current
    if (!p) return
    try {
      p.unMute?.()
      if (canControl) p.playVideo()
      else if (pendingRef.current) applyPlayback(pendingRef.current)
      else p.playVideo()
    } catch {}
  }

  // Не YouTube — отдаём WebRTC-вьювер
  if (!ytId) return <ViewerWebRTCView stream={stream} socket={socket} />

  return (
    <div className="lr-yt-wrap">
      <div ref={ytWrapRef} className="lr-yt-player" />
      {!canControl && started && <div className="lr-yt-block" />}

      {remoteCamActive && (
        <video ref={remoteCamRef} className="lr-yt-pip remote" autoPlay playsInline />
      )}

      {camOn && (
        <video ref={camVideoRef} className="lr-yt-pip local" autoPlay playsInline muted />
      )}

      {!started && (
        <button className="lr-enter" onClick={enter}>
          <span className="lr-enter-play">▶</span>
          Войти в эфир
          <span className="lr-enter-sub">
            {canControl ? 'вы ведущий/аудитор — управляете показом' : 'видео синхронно с ведущим'}
          </span>
        </button>
      )}

      {canControl && started && (
        <div className="lr-yt-controls">
          <button className="lr-yt-ctrl-btn" onClick={togglePlay} title="Пауза/Воспроизведение">
            <Play size={14} />
          </button>
          <button
            className={`lr-yt-ctrl-btn ${camOn ? 'active' : ''}`}
            onClick={camOn ? stopCam : startCam}
            title={camOn ? 'Выключить камеру' : 'Включить камеру'}
          >
            <Camera size={14} />
          </button>
          {camError && <span className="lr-yt-cam-err">{camError}</span>}
          <span className="lr-yt-ctrl-label">все видят синхронно</span>
        </div>
      )}
      {isHost && started && !canControl && <div className="lr-host-badge">Вы ведущий · все видят синхронно</div>}
    </div>
  )
}

// ── LiveKit Ведущий (публикация в SFU) ───────────────────────────────────────
function BroadcasterView({ stream, streamType, socket, active }) {
  const localVideoRef = useRef(null)
  const mediaRef = useRef(null)         // результат acquireMedia: { stream, cameraStream, screenStream, cleanup, ... }
  const roomRef = useRef(null)          // LiveKit Room
  const [broadcasting, setBroadcasting] = useState(false)
  const [error, setError] = useState('')
  const [micOn, setMicOn] = useState(true)
  const [camOn, setCamOn] = useState(true)
  const [switching, setSwitching] = useState(false)
  const [layout, setLayout] = useState('both')   // camera_screen: 'both' (экран+видео) | 'camera' (только видео)
  const [hasCamera, setHasCamera] = useState(true)   // false, если веб-камеры нет/недоступна — тогда только экран

  const stopBroadcast = useCallback(() => {
    try { roomRef.current?.disconnect() } catch {}
    roomRef.current = null
    mediaRef.current?.cleanup()
    mediaRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    setBroadcasting(false)
  }, [])

  const startBroadcast = async () => {
    setError('')
    let media
    try {
      media = await acquireMedia(streamType)
      mediaRef.current = media
      setHasCamera(!media.noCamera)
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = media.stream
        localVideoRef.current.muted = true
      }
    } catch (e) {
      if (e.name === 'NotAllowedError') setError('Нет доступа к камере/экрану. Разрешите в настройках браузера.')
      else if (e.name === 'NotFoundError') setError('Камера или микрофон не найдены.')
      else setError('Ошибка доступа: ' + (e.message || e))
      return
    }
    try {
      // Токен публикации от бэкенда → подключаемся к комнате SFU и публикуем один поток
      const { data } = await api.post(`/live/${stream.id}/lk-token`)
      const room = new Room({ adaptiveStream: false, dynacast: true })
      roomRef.current = room
      await room.connect(data.url, data.token)
      const vt = media.stream.getVideoTracks()[0]
      const at = media.stream.getAudioTracks()[0]
      if (vt) await room.localParticipant.publishTrack(vt, {
        source: Track.Source.ScreenShare,
        simulcast: true,
        // 3.5 Мбит/с, 30 кадров/с — заметный прирост чёткости и плавности против прежних
        // 2 Мбит/с/24 fps (сервер справляется, запас CPU/RAM большой; на 30 зрителей ≈ 105 Мбит/с).
        videoEncoding: { maxBitrate: 3_500_000, maxFramerate: 30 },
      })
      if (at) await room.localParticipant.publishTrack(at, {
        source: Track.Source.Microphone,
        audioPreset: AudioPresets.music,  // ~64 кбит/с вместо дефолтных ~20 — заметно чище звук
      })
      setBroadcasting(true)
      socket?.emit('webrtc_broadcast_start', { streamId: stream.id })  // совместимость (счётчик/уведомление)
    } catch (e) {
      try { roomRef.current?.disconnect() } catch {}
      roomRef.current = null
      media?.cleanup()
      mediaRef.current = null
      setError('Не удалось выйти в эфир: ' + (e.message || e))
    }
  }

  // Стоп при завершении эфира и при размонтировании
  useEffect(() => { if (active === false && broadcasting) stopBroadcast() }, [active, broadcasting, stopBroadcast])
  useEffect(() => () => stopBroadcast(), [stopBroadcast])

  const toggleMic = () => {
    const src = mediaRef.current
    if (!src) return
    const enabled = !micOn
    const tracks = streamType === 'camera_screen' ? src.cameraStream?.getAudioTracks() : src.stream.getAudioTracks()
    tracks?.forEach(t => { t.enabled = enabled })
    setMicOn(enabled)
  }

  const toggleCam = () => {
    const src = mediaRef.current
    if (!src) return
    const enabled = !camOn
    const tracks = streamType === 'camera_screen' ? src.cameraStream?.getVideoTracks() : src.stream.getVideoTracks()
    tracks?.forEach(t => { t.enabled = enabled })
    setCamOn(enabled)
  }

  const toggleLayout = () => {
    const src = mediaRef.current
    if (!src?.setLayout) return
    const next = layout === 'both' ? 'camera' : 'both'
    src.setLayout(next)
    setLayout(next)
  }

  const switchSource = async () => {
    const src = mediaRef.current
    if (!src) return
    setSwitching(true)
    try {
      const newScreen = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1280, height: 720 }, audio: true })
      if (src.screenVid) {
        // Есть canvas (камера+экран с камерой) — меняем источник у скрытого video,
        // canvas сам рисует новый экран, публикуемый canvas-трек не меняется.
        src.screenStream?.getVideoTracks().forEach(t => t.stop())
        src.screenVid.srcObject = newScreen
        await src.screenVid.play().catch(() => {})
        src.screenStream = newScreen
      } else {
        // Без камеры публикуется сырой видеотрек экрана напрямую — меняем его через LiveKit
        const [newTrack] = newScreen.getVideoTracks()
        const pub = roomRef.current?.localParticipant?.getTrackPublication?.(Track.Source.ScreenShare)
        if (pub?.track) await pub.track.replaceTrack(newTrack)
        src.screenStream?.getVideoTracks().forEach(t => t.stop())
        src.screenStream = newScreen
        src.stream = newScreen
        if (localVideoRef.current) localVideoRef.current.srcObject = newScreen
      }
    } catch {}
    setSwitching(false)
  }

  const typeLabel = streamType === 'camera' ? 'Камера'
    : streamType === 'screen' ? 'Экран'
    : 'Камера + Экран'

  return (
    <div className="webrtc-area">
      <video
        ref={localVideoRef}
        autoPlay
        muted
        playsInline
        className={`webrtc-video ${broadcasting ? '' : 'hidden'}`}
      />
      {!broadcasting ? (
        <div className="webrtc-start-screen">
          <div className="webrtc-start-icon">
            {streamType === 'camera' ? <Camera size={40} /> : streamType === 'screen' ? <Monitor size={40} /> : <Layers size={40} />}
          </div>
          <div className="webrtc-start-title">Готовы начать трансляцию?</div>
          <div className="webrtc-start-sub">Тип: {typeLabel}</div>
          {error && <div className="webrtc-error"><AlertCircle size={14} /> {error}</div>}
          <button className="webrtc-go-btn" onClick={startBroadcast}>
            <Radio size={16} /> Начать трансляцию
          </button>
        </div>
      ) : (
        <div className="webrtc-controls">
          <div className="webrtc-live-badge"><span className="ls-dot" /> В ЭФИРЕ</div>
          <div className="webrtc-ctrl-btns">
            {((streamType === 'camera' || streamType === 'camera_screen') && hasCamera) && (
              <button
                className={`webrtc-ctrl-btn ${!camOn ? 'off' : ''}`}
                onClick={toggleCam}
                title={camOn ? 'Выключить камеру' : 'Включить камеру'}
              >
                {camOn ? <Video size={16} /> : <VideoOff size={16} />}
              </button>
            )}
            <button
              className={`webrtc-ctrl-btn ${!micOn ? 'off' : ''}`}
              onClick={toggleMic}
              title={micOn ? 'Выключить микрофон' : 'Включить микрофон'}
            >
              {micOn ? <Mic size={16} /> : <MicOff size={16} />}
            </button>
            {(streamType === 'camera_screen' && hasCamera) && (
              <button
                className={`webrtc-ctrl-btn layout-toggle ${layout === 'camera' ? 'active' : ''}`}
                onClick={toggleLayout}
                title={layout === 'both' ? 'Показать только камеру' : 'Показать экран + камеру'}
              >
                {layout === 'both' ? <Layers size={16} /> : <Camera size={16} />}
                <span style={{ fontSize: 10, marginLeft: 3 }}>{layout === 'both' ? 'Экран+видео' : 'Видео'}</span>
              </button>
            )}
            {(streamType === 'screen' || streamType === 'camera_screen') && (
              <button
                className="webrtc-ctrl-btn switch-src"
                onClick={switchSource}
                disabled={switching}
                title="Сменить источник экрана"
              >
                <Monitor size={16} />
                {switching ? '...' : <span style={{fontSize:10,marginLeft:3}}>сменить</span>}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── LiveKit Зритель (подписка на SFU) ─────────────────────────────────────────
function ViewerWebRTCView({ stream, socket }) {
  const videoRef = useRef(null)
  const areaRef = useRef(null)          // контейнер для полноэкранного режима
  const roomRef = useRef(null)          // LiveKit Room
  const [connected, setConnected] = useState(false)
  const [waiting, setWaiting] = useState(true)
  const [muted, setMuted] = useState(true)       // стартуем muted → autoplay не блокируется браузером
  const [needTap, setNeedTap] = useState(false)  // если play() всё же заблокирован
  const mutedRef = useRef(true)

  useEffect(() => {
    let cancelled = false
    const attach = (track) => {
      const v = videoRef.current
      if (!v) return
      track.attach(v)            // LiveKit кладёт трек в srcObject элемента (видео+аудио в один <video>)
      v.muted = mutedRef.current
      setConnected(true); setWaiting(false)
      v.play().then(() => setNeedTap(false)).catch(() => setNeedTap(true))
    }
    ;(async () => {
      try {
        const { data } = await api.post(`/live/${stream.id}/lk-token`)
        if (cancelled) return
        const room = new Room({ adaptiveStream: true, dynacast: true })
        roomRef.current = room
        room.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Video || track.kind === Track.Kind.Audio) attach(track)
        })
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          try { track.detach() } catch {}
          if (track.kind === Track.Kind.Video) { setConnected(false); setWaiting(true) }
        })
        room.on(RoomEvent.Disconnected, () => { setConnected(false); setWaiting(true) })
        await room.connect(data.url, data.token)   // autoSubscribe — ждём TrackSubscribed
        if (cancelled) { try { room.disconnect() } catch {} }
      } catch (e) { console.error('viewer livekit error', e) }
    })()
    return () => {
      cancelled = true
      try { roomRef.current?.disconnect() } catch {}
      roomRef.current = null
    }
  }, [stream.id])

  const toggleMute = () => {
    const v = videoRef.current
    if (!v) return
    const next = !muted
    v.muted = next
    mutedRef.current = next
    setMuted(next)
    if (!next) { roomRef.current?.startAudio().catch(() => {}); v.volume = 1; v.play().then(() => setNeedTap(false)).catch(() => {}) }
  }

  const handleTapPlay = () => {
    const v = videoRef.current
    if (!v) return
    v.muted = false
    mutedRef.current = false
    setMuted(false)
    roomRef.current?.startAudio().catch(() => {})
    v.play()
      .then(() => setNeedTap(false))
      .catch((e) => {
        // Не проглатываем ошибку молча — пробуем ещё раз (иногда первый play() гонится с attach())
        console.error('[webrtc] play() after tap failed, retrying', e)
        setTimeout(() => { v.play().then(() => setNeedTap(false)).catch((e2) => console.error('[webrtc] retry failed', e2)) }, 150)
      })
  }

  const goFullscreen = () => {
    const area = areaRef.current
    const v = videoRef.current
    // iOS Safari: фуллскрин только на самом video-элементе
    if (v?.webkitEnterFullscreen && !document.fullscreenEnabled) { v.webkitEnterFullscreen(); return }
    if (document.fullscreenElement) { document.exitFullscreen?.(); return }
    if (area?.requestFullscreen) area.requestFullscreen().catch(() => { v?.webkitEnterFullscreen?.() })
    else v?.webkitEnterFullscreen?.()
  }

  return (
    <div
      className="webrtc-area"
      ref={areaRef}
      onClick={needTap ? handleTapPlay : undefined}
      style={needTap ? { cursor: 'pointer' } : undefined}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        onClick={needTap ? handleTapPlay : undefined}
        className={`webrtc-video ${connected ? '' : 'hidden'}`}
      />

      {connected && !needTap && (
        <button className="webrtc-mute-btn" onClick={toggleMute} title={muted ? 'Включить звук' : 'Выключить звук'}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          {muted && <span className="webrtc-mute-label">Включить звук</span>}
        </button>
      )}

      {connected && !needTap && (
        <button className="webrtc-fs-btn" onClick={goFullscreen} title="На весь экран">
          <Maximize2 size={18} />
        </button>
      )}

      {connected && needTap && (
        <button className="webrtc-tap-play" onClick={handleTapPlay}>
          <div className="webrtc-tap-icon"><Play size={36} /></div>
          <div className="webrtc-tap-text">Нажмите для воспроизведения</div>
        </button>
      )}

      {!connected && (
        <div className="webrtc-waiting">
          <div className="webrtc-wait-spinner" />
          <div className="webrtc-wait-text">
            {waiting ? 'Ожидание ведущего...' : 'Подключение к трансляции...'}
          </div>
        </div>
      )}
    </div>
  )
}
