import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { useStore } from '../store'
import api from '../api'
import CleanerNav from '../components/CleanerNav'
import LiveStreams from '../components/LiveStreams'
import {
  Play, Plus, Trash2, Edit2, RefreshCw, X, Check, BarChart2,
  BookOpen, Video, Users, ChevronDown, Clock, Award,
  AlertCircle, Eye, CheckCircle2, HelpCircle, ArrowLeft, MapPin,
  Calendar, Flag, ChevronRight, UserCheck, Target
} from 'lucide-react'
import './Training.css'

const fmtSec = (s) => {
  if (!s) return '—'
  const m = Math.floor(s / 60), sec = s % 60
  return m > 0 ? `${m} мин ${sec > 0 ? sec + ' с' : ''}` : `${sec} с`
}
const fmtDate = (v) => v ? new Date(v).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'

function toYouTubeEmbed(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return `https://www.youtube.com/embed/${u.pathname.slice(1)}`
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v') || (u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null)
      if (v) return `https://www.youtube.com/embed/${v}`
    }
  } catch {}
  return null
}
function classifyUrl(url) {
  if (!url) return 'none'
  if (toYouTubeEmbed(url)) return 'youtube'
  if (/\.(mp4|webm|ogg|mov)(\?|$)/i.test(url)) return 'direct'
  return 'link'
}
function getYoutubeThumbnail(url) {
  if (!url) return null
  try {
    const u = new URL(url)
    let vid = null
    if (u.hostname === 'youtu.be') vid = u.pathname.slice(1)
    else if (u.hostname.includes('youtube.com')) {
      vid = u.searchParams.get('v') || (u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null)
    }
    if (vid) return `https://img.youtube.com/vi/${vid}/hqdefault.jpg`
  } catch {}
  return null
}

async function translateToKazakh(text) {
  if (!text?.trim()) return text
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=ru|kk`)
  const json = await r.json()
  return json?.responseData?.translatedText || text
}

// ── Video Player ───────────────────────────────────────────────────────────────
function getYouTubeId(url) {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1)
    if (u.hostname.includes('youtube.com')) {
      return u.searchParams.get('v') || (u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : null)
    }
  } catch {}
  return null
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

function VideoPlayer({ video, onClose }) {
  const type = classifyUrl(video.video_url)
  const ytId = type === 'youtube' ? getYouTubeId(video.video_url) : null
  const ytContainerRef = useRef(null)
  const ytPlayerRef = useRef(null)
  const watchRef = useRef(0)       // accumulated real watch seconds
  const playingRef = useRef(null)  // timestamp when playback started

  const flushWatch = () => {
    if (playingRef.current) {
      watchRef.current += Math.round((Date.now() - playingRef.current) / 1000)
      playingRef.current = null
    }
  }

  // Send progress on unmount
  useEffect(() => {
    return () => {
      flushWatch()
      const sec = watchRef.current
      if (sec > 0) {
        api.post(`/training/videos/${video.id}/progress`, { watch_seconds: sec, completed: sec >= 30 }).catch(() => {})
      }
    }
  }, [video.id])

  // YouTube IFrame API tracking
  useEffect(() => {
    if (!ytId) return
    let player = null
    loadYTApi().then(() => {
      if (!ytContainerRef.current) return
      const div = document.createElement('div')
      ytContainerRef.current.appendChild(div)
      player = new window.YT.Player(div, {
        videoId: ytId,
        width: '100%',
        height: '100%',
        playerVars: { rel: 0, modestbranding: 1, autoplay: 1 },
        events: {
          onStateChange: (e) => {
            const S = window.YT.PlayerState
            if (e.data === S.PLAYING) {
              playingRef.current = Date.now()
            } else if (e.data === S.PAUSED || e.data === S.ENDED || e.data === S.BUFFERING) {
              flushWatch()
            }
          }
        }
      })
      ytPlayerRef.current = player
    })
    return () => {
      try { player?.destroy() } catch {}
      ytPlayerRef.current = null
    }
  }, [ytId])

  return (
    <div className="vp-backdrop" onClick={onClose}>
      <div className="vp-modal" onClick={e => e.stopPropagation()}>
        <div className="vp-head">
          <span className="vp-title">{video.title}</span>
          <button className="tr-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="vp-body">
          {type === 'youtube' && (
            <div ref={ytContainerRef} className="vp-yt-container" />
          )}
          {type === 'direct' && (
            <video className="vp-frame" controls autoPlay
              onPlay={() => { playingRef.current = Date.now() }}
              onPause={flushWatch}
              onEnded={flushWatch}
            >
              <source src={video.video_url} />
            </video>
          )}
          {(type === 'link' || type === 'none') && (
            <div className="vp-noplay">
              <Play size={28} />
              <p>{type === 'none' ? 'Ссылка не указана' : 'Прямое воспроизведение недоступно'}</p>
              {type === 'link' && <a href={video.video_url} target="_blank" rel="noreferrer" className="vp-ext-link">Открыть →</a>}
            </div>
          )}
        </div>
        {video.description && <div className="vp-desc">{video.description}</div>}
      </div>
    </div>
  )
}

// ── Video Modal (edit/create) ──────────────────────────────────────────────────
function VideoModal({ video, onClose, onSaved }) {
  const isNew = !video
  const toLocalDT = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const [form, setForm] = useState({
    title: video?.title || '',
    description: video?.description || '',
    video_url: video?.video_url || '',
    scheduled_at: toLocalDT(video?.scheduled_at),
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.title) return setError('Укажите название')
    setLoading(true); setError('')
    try {
      const payload = {
        ...form,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
      }
      if (isNew) await api.post('/training/videos', payload)
      else await api.put(`/training/videos/${video.id}`, payload)
      onSaved()
    } catch (err) { setError(err.response?.data?.error || 'Ошибка') }
    finally { setLoading(false) }
  }
  return (
    <div className="tr-backdrop" onClick={onClose}>
      <div className="tr-modal" onClick={e => e.stopPropagation()}>
        <div className="tr-modal-head">
          <span>{isNew ? 'Добавить вебинар' : 'Редактировать вебинар'}</span>
          <button className="tr-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="tr-form">
          {error && <div className="tr-error">{error}</div>}
          <label>Название *<input value={form.title} onChange={e => set('title', e.target.value)} placeholder="Стандарты уборки санузлов" /></label>
          <label>Ссылка на видео<input value={form.video_url} onChange={e => set('video_url', e.target.value)} placeholder="https://youtube.com/..." /></label>
          <label>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Calendar size={12} /> Дата и время вебинара (необязательно)</span>
            <input type="datetime-local" value={form.scheduled_at} onChange={e => set('scheduled_at', e.target.value)} />
          </label>
          <label>Описание<textarea rows={3} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Краткое описание..." /></label>
          <div className="tr-form-footer">
            <button type="button" className="tr-btn-cancel" onClick={onClose}>Отмена</button>
            <button type="submit" className="tr-btn-save" disabled={loading}>{loading ? 'Сохранение...' : isNew ? 'Добавить' : 'Сохранить'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Quiz Modal (create/edit) ───────────────────────────────────────────────────
function QuizModal({ quiz, videoTitle, onClose, onSaved }) {
  const isNew = !quiz?.id
  const [title, setTitle] = useState(quiz?.title || '')
  const [questions, setQuestions] = useState(
    quiz?.questions?.length ? quiz.questions : [{ text: '', options: ['', '', '', ''], correct: 0 }]
  )
  const [loading, setLoading] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [error, setError] = useState('')

  const addQ = () => setQuestions(qs => [...qs, { text: '', options: ['', '', '', ''], correct: 0 }])
  const delQ = (i) => setQuestions(qs => qs.filter((_, idx) => idx !== i))
  const setQ = (i, patch) => setQuestions(qs => qs.map((q, idx) => idx === i ? { ...q, ...patch } : q))
  const setOpt = (qi, oi, val) => setQuestions(qs => qs.map((q, idx) => idx === qi
    ? { ...q, options: q.options.map((o, j) => j === oi ? val : o) } : q))

  const translateAll = async () => {
    if (!questions.some(q => q.text.trim())) return setError('Введите вопросы для перевода')
    setTranslating(true); setError('')
    try {
      const texts = [title, ...questions.flatMap(q => [q.text, ...q.options])]
      const translated = await Promise.all(texts.map(t => translateToKazakh(t)))
      let i = 0
      setTitle(translated[i++])
      setQuestions(questions.map(q => ({ ...q, text: translated[i++], options: q.options.map(() => translated[i++]) })))
    } catch { setError('Ошибка перевода') }
    finally { setTranslating(false) }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!title.trim()) return setError('Укажите название')
    const valid = questions.filter(q => q.text.trim() && q.options.some(o => o.trim()))
    if (!valid.length) return setError('Добавьте хотя бы один вопрос с вариантами')
    setLoading(true); setError('')
    try {
      const payload = { title, video_id: quiz?.video_id || null, questions: valid }
      if (isNew) await api.post('/training/quizzes', payload)
      else await api.put(`/training/quizzes/${quiz.id}`, payload)
      onSaved()
    } catch (err) { setError(err.response?.data?.error || 'Ошибка') }
    finally { setLoading(false) }
  }

  return (
    <div className="tr-backdrop" onClick={onClose}>
      <div className="tr-modal tr-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="tr-modal-head">
          <div>
            <div>{isNew ? 'Создать тест' : 'Редактировать тест'}</div>
            {videoTitle && <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>к видео: {videoTitle}</div>}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="tr-kz-btn" onClick={translateAll} disabled={translating}>
              {translating ? <><RefreshCw size={12} className="spin" /> Перевод...</> : <>🇰🇿 На казахский</>}
            </button>
            <button className="tr-close" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <form onSubmit={submit} className="tr-form">
          {error && <div className="tr-error">{error}</div>}
          <label>Название теста *<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Тест по уборке санузлов" /></label>
          <div className="tr-questions">
            {questions.map((q, qi) => (
              <div key={qi} className="tr-question-block">
                <div className="tr-q-head">
                  <span className="tr-q-num">Вопрос {qi + 1}</span>
                  {questions.length > 1 && <button type="button" className="tr-q-del" onClick={() => delQ(qi)}><Trash2 size={12} /></button>}
                </div>
                <input className="tr-q-text" value={q.text} onChange={e => setQ(qi, { text: e.target.value })} placeholder="Текст вопроса..." />
                <div className="tr-options">
                  {q.options.map((opt, oi) => (
                    <label key={oi} className={`tr-option ${q.correct === oi ? 'correct' : ''}`}>
                      <input type="radio" name={`q-${qi}-correct`} checked={q.correct === oi} onChange={() => setQ(qi, { correct: oi })} />
                      <input className="tr-opt-inp" value={opt} onChange={e => setOpt(qi, oi, e.target.value)} placeholder={`Вариант ${oi + 1}`} />
                      {q.correct === oi && <Check size={12} className="tr-correct-mark" />}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="tr-add-q-btn" onClick={addQ}><Plus size={13} /> Добавить вопрос</button>
          <div className="tr-form-footer">
            <button type="button" className="tr-btn-cancel" onClick={onClose}>Отмена</button>
            <button type="submit" className="tr-btn-save" disabled={loading || translating}>{loading ? 'Сохранение...' : isNew ? 'Создать' : 'Сохранить'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Quiz Take Modal ────────────────────────────────────────────────────────────
function QuizTakeModal({ quiz, onClose }) {
  const [answers, setAnswers] = useState({})
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [startTime] = useState(Date.now())
  const questions = quiz.questions || []

  const submit = async () => {
    const unanswered = questions.findIndex((_, i) => answers[i] === undefined)
    if (unanswered >= 0) { alert(`Ответьте на вопрос ${unanswered + 1}`); return }
    setLoading(true)
    try {
      const r = await api.post(`/training/quizzes/${quiz.id}/attempt`, {
        answers, time_spent_sec: Math.round((Date.now() - startTime) / 1000)
      })
      setResult(r.data); setSubmitted(true)
    } catch { alert('Ошибка при отправке') }
    finally { setLoading(false) }
  }

  return (
    <div className="tr-backdrop" onClick={!submitted ? undefined : onClose}>
      <div className="tr-modal tr-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="tr-modal-head">
          <span>{quiz.title}</span>
          <button className="tr-close" onClick={onClose}><X size={16} /></button>
        </div>
        {submitted ? (
          <div className="qt-result">
            <div className={`qt-score-circle ${result.score / result.total >= 0.7 ? 'pass' : 'fail'}`}>
              <span className="qt-score-num">{result.score}/{result.total}</span>
              <span className="qt-score-pct">{Math.round((result.score / result.total) * 100)}%</span>
            </div>
            <div className="qt-result-label">{result.score / result.total >= 0.7 ? '✓ Тест пройден' : '✗ Тест не пройден'}</div>
            <p className="qt-result-hint">{result.score / result.total >= 0.7 ? 'Отлично!' : 'Ниже 70%. Рекомендуем пересмотреть видео.'}</p>
            <button className="tr-btn-save" onClick={onClose}>Закрыть</button>
          </div>
        ) : (
          <div className="tr-form">
            <div className="qt-progress">
              <span>{Object.keys(answers).length} из {questions.length} отвечено</span>
              <div className="qt-prog-bar"><div className="qt-prog-fill" style={{ width: `${(Object.keys(answers).length / questions.length) * 100}%` }} /></div>
            </div>
            <div className="tr-questions">
              {questions.map((q, qi) => (
                <div key={qi} className="tr-question-block">
                  <div className="tr-q-head"><span className="tr-q-num">Вопрос {qi + 1}</span></div>
                  <div className="qt-q-text">{q.text}</div>
                  <div className="tr-options">
                    {(q.options || []).filter(o => o).map((opt, oi) => (
                      <label key={oi} className={`tr-option take ${answers[qi] === oi ? 'selected' : ''}`} onClick={() => setAnswers(a => ({ ...a, [qi]: oi }))}>
                        <div className={`qt-radio ${answers[qi] === oi ? 'checked' : ''}`} />
                        <span className="qt-opt-text">{opt}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="tr-form-footer">
              <button className="tr-btn-cancel" onClick={onClose}>Отмена</button>
              <button className="tr-btn-save" onClick={submit} disabled={loading}>{loading ? 'Отправка...' : 'Завершить тест'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Assign Training Modal ──────────────────────────────────────────────────────
function AssignTrainingModal({ video, onClose }) {
  const [targetType, setTargetType] = useState('all')
  const [targetIds, setTargetIds] = useState([])
  const [note, setNote] = useState('')
  const [deadline, setDeadline] = useState('')
  const [loading, setLoading] = useState(false)
  const [lists, setLists] = useState({ users: [], locations: [], partners: [] })
  const [search, setSearch] = useState('')
  const [userResults, setUserResults] = useState({}) // userId -> { score, total_questions, completed_at }

  useEffect(() => {
    Promise.all([
      api.get('/users').catch(() => ({ data: { users: [] } })),
      api.get('/locations/cleaning?limit=300').catch(() => ({ data: { locations: [] } })),
      api.get(`/training/videos/${video.id}/user-results`).catch(() => ({ data: { results: [] } })),
    ]).then(([ur, lr, rr]) => {
      const us = ur.data.users || []
      setLists({
        users: us.filter(u => u.role === 'cleaner' && u.is_active),
        locations: lr.data.locations || [],
        partners: us.filter(u => u.role === 'partner' && u.is_active),
      })
      const byUser = {}
      ;(rr.data.results || []).forEach(r => { byUser[r.user_id] = r })
      setUserResults(byUser)
    })
  }, [])

  const toggleId = (id) => setTargetIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const currentList = targetType === 'individual' ? lists.users
    : targetType === 'location' ? lists.locations
    : targetType === 'partner' ? lists.partners : []

  const filtered = search.trim()
    ? currentList.filter(i => (i.full_name || i.name || '').toLowerCase().includes(search.toLowerCase()) || (i.city || '').toLowerCase().includes(search.toLowerCase()))
    : currentList

  const submit = async () => {
    setLoading(true)
    try {
      await api.post(`/training/videos/${video.id}/assign`, {
        target_type: targetType,
        target_ids: targetIds,
        note: note || null,
        deadline: deadline || null,
      })
      onClose()
    } catch { alert('Ошибка при назначении') }
    finally { setLoading(false) }
  }

  const targetLabels = { all: 'Всем', location: 'По адресу', individual: 'Индивидуально', partner: 'Партнёрам' }

  return (
    <div className="tr-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="tr-modal tr-modal-wide" onClick={e => e.stopPropagation()}>
        <div className="tr-modal-head">
          <div>
            <div>Назначить обучение</div>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 400 }}>{video.title}</div>
          </div>
          <button className="tr-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="tr-form">
          <div className="asn-type-row">
            {Object.entries(targetLabels).map(([k, v]) => (
              <button key={k} className={`asn-type-btn ${targetType === k ? 'active' : ''}`}
                onClick={() => { setTargetType(k); setTargetIds([]); setSearch('') }}>
                {k === 'all' && <Users size={13} />}
                {k === 'location' && <MapPin size={13} />}
                {k === 'individual' && <Award size={13} />}
                {k === 'partner' && <BookOpen size={13} />}
                {v}
              </button>
            ))}
          </div>

          {targetType !== 'all' && (
            <div className="asn-list-box">
              <input className="asn-search" placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
              <div className="asn-sel-count">{targetIds.length > 0 ? `Выбрано: ${targetIds.length}` : 'Выберите из списка'}</div>
              <div className="asn-list">
                {filtered.map(item => {
                  const id = item.id
                  const label = item.full_name || item.name
                  const sub = item.city || item.phone || ''
                  const checked = targetIds.includes(id)
                  const result = targetType === 'individual' ? userResults[id] : null
                  const pct = result ? Math.round(result.score / result.total_questions * 100) : null
                  return (
                    <label key={id} className={`asn-row ${checked ? 'checked' : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleId(id)} />
                      <div className="asn-row-info">
                        <span className="asn-row-name">{label}</span>
                        {sub && <span className="asn-row-sub">{sub}</span>}
                      </div>
                      {result && (
                        <span className={`asn-result-badge ${pct >= 70 ? 'pass' : 'fail'}`}>
                          {result.score}/{result.total_questions} — {pct}%
                        </span>
                      )}
                    </label>
                  )
                })}
                {filtered.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Ничего не найдено</div>}
              </div>
            </div>
          )}

          {targetType === 'all' && (
            <div className="asn-all-hint">
              <Users size={20} style={{ color: '#8fc640' }} />
              <p>Обучение будет назначено всем активным клинерам</p>
            </div>
          )}

          <div className="tr-form-row">
            <label style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Flag size={12} /> Дедлайн (необязательно)</span>
              <input type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className="asn-note" style={{ padding: '8px 12px' }} />
            </label>
            <label style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
              Заметка (необязательно)
              <textarea rows={2} value={note} onChange={e => setNote(e.target.value)} className="asn-note" placeholder="Пройти до конца недели..." />
            </label>
          </div>

          <div className="tr-form-footer">
            <button className="tr-btn-cancel" onClick={onClose}>Отмена</button>
            <button className="tr-btn-save" onClick={submit} disabled={loading || (targetType !== 'all' && targetIds.length === 0)}>
              {loading ? 'Назначение...' : `Назначить${targetType !== 'all' ? ` (${targetIds.length})` : ' всем'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Detail view ────────────────────────────────────────────────────────────────
function QuizAttemptDetail({ attempt, quiz }) {
  const questions = quiz?.questions || []
  if (!questions.length || !attempt.answers) return null
  return (
    <div className="qa-detail">
      {questions.map((q, idx) => {
        const selected = attempt.answers[String(idx)]
        const correct = q.correct
        const isWrong = selected !== undefined && Number(selected) !== Number(correct)
        if (!isWrong) return null
        return (
          <div key={idx} className="qa-wrong-item">
            <div className="qa-wrong-q">✗ {q.text}</div>
            <div className="qa-wrong-answers">
              <span className="qa-ans user-ans">Ответил: {q.options?.[selected] || `Вариант ${selected}`}</span>
              <span className="qa-ans correct-ans">Верно: {q.options?.[correct] || `Вариант ${correct}`}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function TrainingDetail({ video, quiz, analytics, isAdmin, isCleaner, onBack, onEditVideo, onDeleteVideo, onEditQuiz, onDeleteQuiz, onAddQuiz, onRefreshAnalytics }) {
  const [playerOpen, setPlayerOpen] = useState(false)
  const [takeQuiz, setTakeQuiz] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [expandedAttempt, setExpandedAttempt] = useState(null)

  const qStat = quiz ? analytics?.quizzes?.find(q => q.id === quiz.id) : null
  const userVideoDetails = (analytics?.user_video_details || []).filter(u => u.video_id === video.id)
  const userQuizDetails = (analytics?.user_quiz_details || []).filter(u => u.quiz_id === quiz?.id)
  const wrongAnswers = (analytics?.wrong_answers || []).filter(w => w.quiz_id === quiz?.id)
  const quizWithQs = quiz ? (analytics?.quizzes?.find(q => q.id === quiz.id) || quiz) : null

  return (
    <div className={isCleaner ? 'td-page-cleaner' : 'td-page'}>
      <div className="td-topbar">
        <button className="td-back" onClick={onBack}><ArrowLeft size={16} /> Назад</button>
        <div className="td-topbar-title">{video.title}</div>
        {isAdmin && (
          <div className="td-topbar-actions">
            <button className="tr-act-btn assign-btn" onClick={() => setAssignOpen(true)} title="Назначить обучение">
              <Users size={13} /> Назначить
            </button>
            <button className="tr-act-btn" onClick={onEditVideo}><Edit2 size={13} /></button>
            <button className="tr-act-btn danger" onClick={onDeleteVideo}><Trash2 size={13} /></button>
          </div>
        )}
      </div>

      <div className={isCleaner ? 'td-body-cleaner' : 'td-body'}>
        <div className="td-left">
          <div className="td-video-card">
            {video.video_url && (
              <div className="td-thumb" onClick={() => setPlayerOpen(true)} style={{ cursor: 'pointer' }}>
                {getYoutubeThumbnail(video.video_url) && (
                  <img src={getYoutubeThumbnail(video.video_url)} alt="" className="td-thumb-bg" />
                )}
                <div className="td-play-btn"><Play size={28} fill="white" /></div>
                {video.duration_sec > 0 && <span className="tr-duration">{fmtSec(video.duration_sec)}</span>}
              </div>
            )}
            <div className="td-video-footer">
              {video.description && <p className="td-video-desc">{video.description}</p>}
              {video.video_url && (
                <button className="td-watch-btn" onClick={() => setPlayerOpen(true)}>
                  <Play size={14} /> Смотреть
                </button>
              )}
            </div>
          </div>

          <div className="td-quiz-card">
            <div className="td-quiz-card-head">
              <HelpCircle size={15} className="td-quiz-icon" />
              <span className="td-quiz-card-title">Тест к видео</span>
              {isAdmin && quiz && (
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                  <button className="tr-act-btn" onClick={onEditQuiz}><Edit2 size={12} /></button>
                  <button className="tr-act-btn danger" onClick={onDeleteQuiz}><Trash2 size={12} /></button>
                </div>
              )}
            </div>
            {quiz ? (
              <>
                <div className="td-quiz-name">{quiz.title}</div>
                <div className="td-quiz-meta">{(quiz.questions || []).length} вопросов</div>
                <button className="td-take-btn" onClick={() => setTakeQuiz(true)}>Пройти тест</button>
              </>
            ) : (
              <div className="td-no-quiz">
                {isAdmin
                  ? <button className="tr-add-quiz-btn" onClick={onAddQuiz}><Plus size={12} /> Добавить тест к этому видео</button>
                  : <span className="tr-no-quiz">Тест не добавлен</span>}
              </div>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="td-right">
            <div className="td-an-head">
              <span>Аналитика</span>
              <button className="tr-btn-refresh" onClick={onRefreshAnalytics}><RefreshCw size={13} /></button>
            </div>

            {/* Video views */}
            <div className="td-an-section">
              <div className="td-an-section-title"><Eye size={12} /> Просмотры</div>
              {!analytics ? (
                <div className="td-an-empty">Загрузка...</div>
              ) : userVideoDetails.length === 0 ? (
                <div className="td-an-empty">Никто не смотрел</div>
              ) : (
                <div className="td-an-list">
                  {userVideoDetails.map(u => (
                    <div key={u.user_id} className="td-an-row">
                      <div className="an-u-avatar sm">{(u.full_name || '?')[0]}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="td-an-name">{u.full_name || u.phone}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{fmtSec(u.watch_seconds)}</div>
                      </div>
                      {u.completed
                        ? <span className="an-done-badge"><CheckCircle2 size={10} /> Досмотрел</span>
                        : <span className="an-prog-badge"><Eye size={10} /> Открывал</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quiz stats */}
            {quiz && (
              <div className="td-an-section">
                <div className="td-an-section-title"><BookOpen size={12} /> Результаты теста</div>
                {qStat && (
                  <div className="td-an-qsummary">
                    <div className="td-an-stat"><span className="td-an-stat-val">{qStat.attempts_count || 0}</span><span className="td-an-stat-label">попыток</span></div>
                    <div className="td-an-stat"><span className="td-an-stat-val">{Math.round(qStat.avg_score || 0)}%</span><span className="td-an-stat-label">средний балл</span></div>
                  </div>
                )}
                {wrongAnswers.length > 0 && (
                  <div className="td-wrong">
                    <div className="an-wrong-title"><AlertCircle size={11} /> Чаще ошибались</div>
                    {wrongAnswers.slice(0, 3).map((w, i) => (
                      <div key={i} className="an-wrong-row">
                        <span className="an-wrong-q">{w.question_text?.slice(0, 55)}{w.question_text?.length > 55 ? '…' : ''}</span>
                        <span className="an-wrong-cnt">{w.wrong_count}×</span>
                      </div>
                    ))}
                  </div>
                )}
                {!analytics ? (
                  <div className="td-an-empty">Загрузка...</div>
                ) : userQuizDetails.length === 0 ? (
                  <div className="td-an-empty">Никто не проходил</div>
                ) : (
                  <div className="td-an-list">
                    {userQuizDetails.map((u, i) => {
                      const key = `${u.user_id}-${u.quiz_id}-${i}`
                      const isExpanded = expandedAttempt === key
                      const hasWrong = u.score < u.total_questions
                      return (
                        <div key={key} className="td-an-attempt">
                          <div
                            className={`td-an-row ${hasWrong ? 'clickable' : ''}`}
                            onClick={() => hasWrong && setExpandedAttempt(isExpanded ? null : key)}
                          >
                            <div className="an-u-avatar sm quiz">{(u.full_name || '?')[0]}</div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="td-an-name">{u.full_name || u.phone}</div>
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                {u.score}/{u.total_questions} · {new Date(u.completed_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                                {u.time_spent_sec > 0 && ` · ${fmtSec(u.time_spent_sec)}`}
                              </div>
                            </div>
                            <span className={`an-score-badge ${u.score_pct >= 70 ? 'good' : 'bad'}`}>{Math.round(u.score_pct)}%</span>
                            {hasWrong && <ChevronDown size={12} style={{ color: '#94a3b8', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform .2s', flexShrink: 0 }} />}
                          </div>
                          {isExpanded && <QuizAttemptDetail attempt={u} quiz={quizWithQs} />}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {playerOpen && <VideoPlayer video={video} onClose={() => setPlayerOpen(false)} />}
      {takeQuiz && <QuizTakeModal quiz={quiz} onClose={() => setTakeQuiz(false)} />}
      {assignOpen && <AssignTrainingModal video={video} onClose={() => setAssignOpen(false)} />}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Training() {
  const { user } = useStore()
  const isAdmin = ['admin', 'partner', 'auditor'].includes(user?.role)
  const isCleaner = user?.role === 'cleaner'

  const [videos, setVideos] = useState([])
  const [quizzes, setQuizzes] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)   // video object or null

  const [showVideoModal, setShowVideoModal] = useState(false)
  const [editVideo, setEditVideo] = useState(null)
  const [showQuizModal, setShowQuizModal] = useState(false)
  const [editQuiz, setEditQuiz] = useState(null)

  const loadAll = useCallback(async () => {
    try {
      const [vr, qr] = await Promise.all([api.get('/training/videos'), api.get('/training/quizzes')])
      setVideos((vr.data.videos || []).sort((a, b) => b.id - a.id))
      setQuizzes(qr.data.quizzes || [])
    } catch {} finally { setLoading(false) }
  }, [])

  const loadAnalytics = useCallback(async () => {
    if (!isAdmin) return
    try { const r = await api.get('/training/analytics'); setAnalytics(r.data) } catch {}
  }, [isAdmin])

  useEffect(() => { loadAll(); if (isAdmin) loadAnalytics() }, [])

  const quizByVideo = useMemo(() => {
    const m = {}
    quizzes.forEach(q => { if (q.video_id) m[q.video_id] = q })
    return m
  }, [quizzes])

  // Analytics lookup per video
  const anByVideo = useMemo(() => {
    const m = {}
    if (!analytics) return m
    ;(analytics.videos || []).forEach(v => { m[v.id] = v })
    return m
  }, [analytics])

  const deleteVideo = async (v) => {
    if (!window.confirm('Удалить видео?')) return
    await api.delete(`/training/videos/${v.id}`)
    setSelected(null); loadAll()
  }
  const deleteQuiz = async (q) => {
    if (!window.confirm('Удалить тест?')) return
    await api.delete(`/training/quizzes/${q.id}`)
    loadAll(); loadAnalytics()
  }

  // If a video is selected → show detail view
  if (selected) {
    const quiz = quizByVideo[selected.id] || null
    return (
      <>
        {isCleaner && <CleanerNav />}
        <TrainingDetail
          video={selected}
          quiz={quiz}
          analytics={analytics}
          isAdmin={isAdmin}
          isCleaner={isCleaner}
          onBack={() => setSelected(null)}
          onEditVideo={() => { setEditVideo(selected); setShowVideoModal(true) }}
          onDeleteVideo={() => deleteVideo(selected)}
          onEditQuiz={() => { setEditQuiz(quiz); setShowQuizModal(true) }}
          onDeleteQuiz={() => deleteQuiz(quiz)}
          onAddQuiz={() => { setEditQuiz({ video_id: selected.id }); setShowQuizModal(true) }}
          onRefreshAnalytics={loadAnalytics}
        />
        {showVideoModal && (
          <VideoModal
            video={editVideo}
            onClose={() => { setShowVideoModal(false); setEditVideo(null) }}
            onSaved={() => { setShowVideoModal(false); setEditVideo(null); loadAll(); setSelected(v => videos.find(vv => vv.id === v?.id) || v) }}
          />
        )}
        {showQuizModal && (
          <QuizModal
            quiz={editQuiz}
            videoTitle={selected.title}
            onClose={() => { setShowQuizModal(false); setEditQuiz(null) }}
            onSaved={() => { setShowQuizModal(false); setEditQuiz(null); loadAll() }}
          />
        )}
      </>
    )
  }

  // List view
  return (
    <>
      {isCleaner && <CleanerNav />}
      <div className={`tr-page ${isCleaner ? 'tr-page-cleaner' : ''}`}>
        {!isCleaner && (
          <div className="tr-header">
            <div>
              <h1>Обучение</h1>
              <p>Вебинары и тесты для сотрудников</p>
            </div>
            {isAdmin && (
              <button className="tr-btn-create" onClick={() => { setEditVideo(null); setShowVideoModal(true) }}>
                <Plus size={14} /> Добавить вебинар
              </button>
            )}
          </div>
        )}

        <LiveStreams isAdmin={isAdmin} />

        {loading ? (
          <div className="tr-loading"><RefreshCw size={16} className="spin" /> Загрузка...</div>
        ) : videos.length === 0 ? (
          <div className="tr-empty">
            <Video size={32} className="tr-empty-icon" />
            <p>Вебинаров пока нет</p>
            {isAdmin && <button className="tr-btn-create" onClick={() => setShowVideoModal(true)}><Plus size={14} /> Добавить первый</button>}
          </div>
        ) : isCleaner ? (
          /* ── Cleaner mobile card view ── */
          (() => {
            const withQuiz = videos.filter(v => quizByVideo[v.id])
            const done = withQuiz.filter(v => (quizByVideo[v.id]?.my_attempts || 0) > 0).length
            const total = withQuiz.length
            const pct = total > 0 ? Math.round(done / total * 100) : 0
            return (
              <div className="cl-training-wrap">
                {total > 0 && (
                  <div className="cl-progress-card">
                    <div className="cl-progress-top">
                      <span className="cl-progress-label">Тесты пройдены</span>
                      <span className="cl-progress-count">{done} / {total}</span>
                    </div>
                    <div className="cl-progress-bar">
                      <div className="cl-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                    {done === total
                      ? <div className="cl-progress-done">Все тесты пройдены!</div>
                      : <div className="cl-progress-hint">Осталось: {total - done} {(total - done) === 1 ? 'тест' : 'теста'}</div>}
                  </div>
                )}
                <div className="cl-cards">
                  {videos.map((v, i) => {
                    const quiz = quizByVideo[v.id]
                    const passed = quiz && (quiz.my_attempts || 0) > 0
                    const scorePct = quiz?.my_last_total > 0
                      ? Math.round(quiz.my_last_score / quiz.my_last_total * 100) : null
                    const lastAt = quiz?.my_last_at
                      ? new Date(quiz.my_last_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                      : null
                    return (
                      <div key={v.id} className={`cl-card ${passed ? 'cl-card-done' : ''}`} onClick={() => setSelected(v)}>
                        <div className="cl-card-num">{i + 1}</div>
                        {v.video_url && (
                          <div className="cl-card-thumb">
                            {getYoutubeThumbnail(v.video_url)
                              ? <img src={getYoutubeThumbnail(v.video_url)} alt="" className="cl-card-thumb-img" />
                              : <Play size={18} fill="white" color="white" />}
                            <div className="cl-card-thumb-play"><Play size={14} fill="white" color="white" /></div>
                          </div>
                        )}
                        <div className="cl-card-body">
                          <div className="cl-card-title">{v.title}</div>
                          {v.description && <div className="cl-card-desc">{v.description.slice(0, 70)}{v.description.length > 70 ? '…' : ''}</div>}
                          <div className="cl-card-footer">
                            {quiz
                              ? passed
                                ? <>
                                    <span className="cl-badge cl-badge-done"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5"/></svg> {quiz.my_last_score}/{quiz.my_last_total} — {scorePct}%</span>
                                    {lastAt && <span className="cl-card-date">{lastAt}</span>}
                                  </>
                                : <span className="cl-badge cl-badge-todo">Пройти тест</span>
                              : <span className="cl-badge cl-badge-watch">Смотреть</span>}
                            {v.duration_sec > 0 && <span className="cl-card-dur">{fmtSec(v.duration_sec)}</span>}
                          </div>
                        </div>
                        <div className="cl-card-arrow">›</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()
        ) : (
          /* ── Admin table view ── */
          <div className="tl-table-wrap">
            <table className="tl-table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Дата</th>
                  <th>Тест</th>
                  {isAdmin && <><th>Прошли</th><th>Ср. балл</th></>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {videos.map(v => {
                  const quiz = quizByVideo[v.id]
                  const qStat = quiz ? (analytics?.quizzes || []).find(q => q.id === quiz.id) : null
                  return (
                    <tr key={v.id} className="tl-row" onClick={() => setSelected(v)}>
                      <td className="tl-name">
                        <div className="tl-thumb-mini"><Play size={10} fill="white" /></div>
                        <div>
                          <div className="tl-title">{v.title}</div>
                          {v.description && <div className="tl-desc">{v.description.slice(0, 60)}{v.description.length > 60 ? '…' : ''}</div>}
                        </div>
                      </td>
                      <td className="tl-date">
                        {v.scheduled_at
                          ? <span className="tl-scheduled"><Calendar size={10} /> {new Date(v.scheduled_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                          : fmtDate(v.created_at)}
                      </td>
                      <td>
                        {quiz
                          ? <span className="tl-quiz-badge"><HelpCircle size={10} /> {quiz.title}</span>
                          : <span className="tl-no-quiz">—</span>}
                      </td>
                      {isAdmin && (
                        <>
                          <td className="tl-num">{qStat ? `${qStat.attempts_count || 0}` : '—'}</td>
                          <td>
                            {qStat
                              ? <span className={`an-score-badge ${(qStat.avg_score || 0) >= 70 ? 'good' : 'bad'}`}>{Math.round(qStat.avg_score || 0)}%</span>
                              : <span className="tl-no-quiz">—</span>}
                          </td>
                        </>
                      )}
                      <td onClick={e => e.stopPropagation()}>
                        <button className="tr-act-btn danger" onClick={() => deleteVideo(v)} title="Удалить">
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {showVideoModal && (
          <VideoModal
            video={editVideo}
            onClose={() => { setShowVideoModal(false); setEditVideo(null) }}
            onSaved={() => { setShowVideoModal(false); setEditVideo(null); loadAll() }}
          />
        )}
      </div>
    </>
  )
}
