import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Bot, Building2, CalendarClock, Eye, RefreshCw, Search, X } from 'lucide-react'
import './PstReports.css'
import './AiReview.css'

// AI-проверка отчётов (v1, локально). Работает параллельно с ручной проверкой «PST на проверку» и ничего в ней не меняет.
// Данные берутся ТОЛЬКО из локального AI-сервиса (auto-cleaner: scripts/ai_service.py на 127.0.0.1), а не с сервера
// opu.ic-group.kz: здесь намеренно используется fetch, а не общий api-клиент, чтобы не отправлять туда запросы и токен.
const AI_URL = (import.meta.env.VITE_AI_URL || 'http://127.0.0.1:8765').replace(/\/$/, '')

const DECISIONS = {
  APPROVED:      { label: 'Одобрено AI',    tone: 'ok' },
  NOT_CLEAN:     { label: 'Не чисто',       tone: 'bad' },
  CANNOT_ASSESS: { label: 'Нельзя оценить', tone: 'warn' },
  REVIEW:        { label: 'Проверить',      tone: 'info' },
}
const FILTERS = [
  { key: 'admin', label: 'На проверку админу' },
  { key: 'all', label: 'Все' },
  { key: 'NOT_CLEAN', label: 'Не чисто' },
  { key: 'CANNOT_ASSESS', label: 'Нельзя оценить' },
  { key: 'REVIEW', label: 'Проверить' },
  { key: 'APPROVED', label: 'Одобрено AI' },
]
const REASONS = {
  dust: 'пыль', streaks: 'разводы', stains: 'грязь/пятна', litter: 'мусор', parcels: 'посылки в кадре',
  bad_angle: 'плохой ракурс/блик', blur_dark: 'размыто/темно', no_matching_before: 'нет подходящего «до»',
  same_as_before: '«после» = «до»',
}
const VIEWS = {
  front: 'фасад', side: 'бок', roof: 'крыша', cells: 'ячейки открыты', cell_interior: 'внутри ячейки', other: 'другое',
}
const STATUS_RU = { clean: 'чисто', partial: 'частично', not_clean: 'не чисто', cannot_assess: 'нельзя оценить' }

const photoUrl = (rel) => `${AI_URL}/api/ai/photo?f=${encodeURIComponent(rel)}`
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)
const timeAlmaty = (s) => (s ? s.slice(11, 16) : '—')
const fmtDate = (d) => (d ? d.split('-').reverse().join('.') : '—')

async function getJson(path) {
  const res = await fetch(`${AI_URL}${path}`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

function DecisionBadge({ decision }) {
  const d = DECISIONS[decision] || { label: decision, tone: 'info' }
  return <span className={`ai-badge ai-${d.tone}`}>{d.label}</span>
}

function RiskBar({ risk }) {
  const v = Math.max(0, Math.min(1, risk ?? 0))
  return (
    <div className="ai-risk" title={`Риск AI: ${pct(v)} (50% = порог решения)`}>
      <div className="ai-risk-track"><div className={`ai-risk-fill ${v >= 0.5 ? 'hi' : 'lo'}`} style={{ width: `${v * 100}%` }} /></div>
      <span>{pct(v)}</span>
    </div>
  )
}

function PairCard({ pair, onZoom }) {
  const probs = pair.vlm_probs || {}
  const vlmStatus = pair.vlm_pred?.status
  return (
    <div className={`ai-pair ai-pair-${(DECISIONS[pair.decision] || {}).tone || 'info'}`}>
      <div className="ai-pair-head">
        <DecisionBadge decision={pair.decision} />
        <span className="ai-chip">{VIEWS[pair.view] || pair.view}</span>
        <RiskBar risk={pair.risk} />
      </div>
      <div className="ai-pair-photos">
        {[['До', pair.before_file], ['После', pair.after_file]].map(([label, f]) => (
          <figure key={label} onClick={() => onZoom(f)}>
            <img src={photoUrl(f)} alt={label} loading="lazy" />
            <figcaption>{label}</figcaption>
          </figure>
        ))}
      </div>
      {pair.reasons?.length > 0 && (
        <div className="ai-reasons">{pair.reasons.map(r => <span key={r} className="ai-chip ai-chip-reason">{REASONS[r] || r}</span>)}</div>
      )}
      <div className="ai-scores">
        <div><b>VLM:</b> {vlmStatus ? STATUS_RU[vlmStatus] || vlmStatus : 'нет ответа'}
          {' · '}чисто {pct(probs.clean)}, частично {pct(probs.partial)}, не чисто {pct(probs.not_clean)}, нельзя {pct(probs.cannot_assess)}</div>
        <div><b>CV:</b> грязь {pct(pair.p_dirty)}, нельзя оценить {pct(pair.p_cannot_assess)}
          {pair.roof_mil != null && <> · детали крыши {pair.roof_mil >= 0 ? 'есть подозрение' : 'норма'} ({pair.roof_mil.toFixed(2)})</>}</div>
        {pair.view !== pair.before_view && <div className="ai-warn-line">«До» другого вида ({VIEWS[pair.before_view] || pair.before_view})</div>}
      </div>
    </div>
  )
}

function ReportModal({ report, onClose }) {
  const [zoom, setZoom] = useState(null)
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') (zoom ? setZoom(null) : onClose()) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoom, onClose])
  const loc = report.location || {}
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card ai-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">Отчёт #{report.report_id} · постомат {report.postomat_id}</div>
            <div className="ai-modal-sub">
              {loc.city} · {loc.address} · {report.work_type} · {timeAlmaty(report.submitted_at_almaty)}
            </div>
          </div>
          <div className="ai-modal-right">
            <DecisionBadge decision={report.decision} />
            <button type="button" className="modal-close" onClick={onClose}><X size={18} /></button>
          </div>
        </div>
        <div className="ai-note">
          Решение AI — подсказка. Окончательное решение принимает администратор в «PST на проверку».
        </div>
        <div className="ai-pairs">
          {report.pairs.map(p => <PairCard key={`${p.after_file}|${p.before_file}`} pair={p} onZoom={setZoom} />)}
        </div>
      </div>
      {zoom && (
        <div className="pr-lightbox" onClick={(e) => { e.stopPropagation(); setZoom(null) }}>
          <button type="button" className="pr-lightbox-close" onClick={(e) => { e.stopPropagation(); setZoom(null) }}><X size={20} /></button>
          <img className="pr-lightbox-img" src={photoUrl(zoom)} alt="" onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}

export default function AiReview() {
  const [days, setDays] = useState([])
  const [date, setDate] = useState('')
  const [day, setDay] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState('admin')
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('')
  const [active, setActive] = useState(null)

  const loadDays = useCallback(async () => {
    setError(''); setLoading(true)
    try {
      const list = await getJson('/api/ai/days')
      setDays(list)
      setDate(d => (d && list.some(x => x.date === d) ? d : list[0]?.date || ''))
      if (!list.length) setDay(null)
    } catch {
      setError('offline')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadDays() }, [loadDays])

  useEffect(() => {
    if (!date) return
    let cancelled = false
    setLoading(true)
    getJson(`/api/ai/day?date=${date}`)
      .then(d => { if (!cancelled) { setDay(d); setError('') } })
      .catch(() => { if (!cancelled) setError('offline') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [date])

  const reports = day?.reports || []
  const cities = useMemo(() => [...new Set(reports.map(r => r.location?.city).filter(Boolean))].sort(), [reports])
  const stats = useMemo(() => {
    const c = { total: reports.length, APPROVED: 0, NOT_CLEAN: 0, CANNOT_ASSESS: 0, REVIEW: 0 }
    reports.forEach(r => { c[r.decision] = (c[r.decision] || 0) + 1 })
    return c
  }, [reports])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports.filter(r => {
      if (filter === 'admin' && r.decision === 'APPROVED') return false
      if (!['admin', 'all'].includes(filter) && r.decision !== filter) return false
      if (city && r.location?.city !== city) return false
      if (!q) return true
      const loc = r.location || {}
      return [r.report_id, r.postomat_id, loc.address, loc.title, loc.branch].some(v => String(v || '').toLowerCase().includes(q))
    }).sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0))
  }, [reports, filter, search, city])

  if (error === 'offline') {
    return (
      <div className="pst-page ai-page">
        <div className="ai-offline">
          <AlertCircle size={22} />
          <div>
            <div className="ai-offline-title">Локальный AI-сервис не запущен</div>
            <div>AI-проверка работает только на компьютере с моделью. Запустите в папке auto-cleaner:</div>
            <code>python -X utf8 scripts/ai_service.py</code>
            <div className="pr-muted">Адрес сервиса: {AI_URL}</div>
          </div>
          <button type="button" className="btn-reset" onClick={loadDays}><RefreshCw size={13} /> Повторить</button>
        </div>
      </div>
    )
  }

  return (
    <div className="pst-page ai-page">
      <div className="ai-header">
        <div className="ai-title"><Bot size={20} /> AI проверка отчётов</div>
        <div className="ai-sub">
          Модели: VLM + CV + агент · правило {day?.versions?.rule_name || '—'} · расчёт {day?.generated_at?.replace('T', ' ') || '—'}
          {day?.versions?.note && <span className="ai-chip ai-chip-reason">{day.versions.note}</span>}
        </div>
      </div>

      <div className="pst-stats">
        <div className="pst-stat-card"><div className="pst-stat-val">{stats.total}</div><div className="pst-stat-label">Отчётов проверено</div></div>
        <div className="pst-stat-card"><div className="pst-stat-val ai-ok-text">{stats.APPROVED}</div><div className="pst-stat-label">Одобрено AI</div></div>
        <div className="pst-stat-card"><div className="pst-stat-val ai-bad-text">{stats.NOT_CLEAN}</div><div className="pst-stat-label">Не чисто</div></div>
        <div className="pst-stat-card"><div className="pst-stat-val ai-warn-text">{stats.CANNOT_ASSESS + stats.REVIEW}</div><div className="pst-stat-label">Нельзя оценить / проверить</div></div>
      </div>

      <div className="pst-toolbar">
        <div className="toolbar-search">
          <Search size={15} className="toolbar-search-icon" />
          <input type="text" placeholder="Поиск по отчёту, POSTOMAT_ID, адресу" value={search} onChange={e => setSearch(e.target.value)} />
          {search && <button type="button" className="toolbar-clear" onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <div className="toolbar-filters">
          <div className="filter-group">
            <CalendarClock size={14} />
            <select value={date} onChange={e => setDate(e.target.value)}>
              {days.map(d => <option key={d.date} value={d.date}>{fmtDate(d.date)} · {d.n_reports} отч.</option>)}
            </select>
          </div>
          <div className="filter-group">
            <Building2 size={14} />
            <select value={city} onChange={e => setCity(e.target.value)}>
              <option value="">Все города</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <button type="button" className="btn-reset" onClick={loadDays} title="Обновить"><RefreshCw size={13} className={loading ? 'spin' : ''} /></button>
        </div>
      </div>

      <div className="ai-filters" role="tablist">
        {FILTERS.map(f => (
          <button key={f.key} type="button" className={`pr-tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      <div className="pst-table-wrap">
        <table className="pst-table">
          <thead>
            <tr>
              <th>Время</th><th>Отчёт</th><th>POSTOMAT_ID</th><th>Город</th><th>Адрес</th><th>Тип</th>
              <th>Пары фото</th><th>Решение AI</th><th>Риск</th><th></th>
            </tr>
          </thead>
          <tbody>
            {!loading && !rows.length && (
              <tr><td colSpan={10} className="table-empty">{days.length ? 'Нет отчётов по фильтру' : 'Нет результатов AI — запустите scripts/ai_check_day.py'}</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.report_id} className={i % 2 ? 'odd' : 'even'}>
                <td>{timeAlmaty(r.submitted_at_almaty)}</td>
                <td>#{r.report_id}</td>
                <td>{r.postomat_id}</td>
                <td>{r.location?.city || '—'}</td>
                <td className="ai-addr">{r.location?.address || '—'}</td>
                <td>{r.kind === 'full' ? 'Полная' : 'Наружная'}</td>
                <td>
                  {r.pairs.length}
                  {r.counts?.NOT_CLEAN > 0 && <span className="ai-mini ai-bad-text"> · {r.counts.NOT_CLEAN} не чисто</span>}
                </td>
                <td><DecisionBadge decision={r.decision} /></td>
                <td><RiskBar risk={r.risk} /></td>
                <td><button type="button" className="ai-open" onClick={() => setActive(r)}><Eye size={14} /> Фото</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {active && <ReportModal report={active} onClose={() => setActive(null)} />}
    </div>
  )
}
