import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, BarChart3, CalendarDays, CheckCircle2, Clock3,
  RefreshCw, Search, TrendingUp, X
} from 'lucide-react'
import api from '../api'
import './PstDashboard.css'

const WORK_TYPE = 'ПОЛНАЯ МОЙКА'
const PAGE_LIMIT = 200

const monthNames = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
]

const toIsoMonth = (date) => {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const currentMonth = () => toIsoMonth(new Date())

const monthLabel = (month) => {
  const [year, mm] = month.split('-').map(Number)
  return `${monthNames[(mm || 1) - 1]} ${year}`
}

const monthBounds = (month) => {
  const [year, mm] = month.split('-').map(Number)
  const start = new Date(year, mm - 1, 1)
  const end = new Date(year, mm, 0)
  return {
    start,
    end,
    dateFrom: `${year}-${String(mm).padStart(2, '0')}-01`,
    dateTo: `${year}-${String(mm).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`,
    days: end.getDate(),
  }
}

const monthOptions = () => {
  const base = new Date()
  return Array.from({ length: 8 }, (_, index) => {
    const d = new Date(base.getFullYear(), base.getMonth() - 5 + index, 1)
    const value = toIsoMonth(d)
    return { value, label: monthLabel(value) }
  }).reverse()
}

const isoDateAlmaty = (value) => {
  if (!value) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const get = type => parts.find(p => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const dateOnly = (value) => {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10)
  return isoDateAlmaty(value)
}

const normalize = (value) => String(value || '').trim().toLowerCase()

const formatNum = (value) => Number(value || 0).toLocaleString('ru-RU')

const pct = (fact, plan) => {
  if (!plan) return 0
  return Math.round((fact / plan) * 1000) / 10
}

const partnerNameOf = (row) => (
  row.partner_name ||
  row.partner ||
  row.curator_name ||
  row.last_cleaned_by ||
  row.responsible ||
  ''
)

const groupNameOf = (row) => (
  row.branch ||
  row.city ||
  row.location_type ||
  'Без филиала'
)

const emptyDayMap = (days) => Object.fromEntries(
  Array.from({ length: days }, (_, i) => [i + 1, { plan: 0, fact: 0 }])
)

const getReportPostomatId = (report) => String(
  report.location_id ||
  report.postomat_id ||
  report.location_data?.id ||
  ''
).trim()

const fetchAllReports = async ({ dateFrom, dateTo }) => {
  const loaded = []
  let page = 1
  let pages = 1
  do {
    const q = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_LIMIT),
      sortBy: 'submitted_at',
      sortDir: 'desc',
      work_type: WORK_TYPE,
      dateFrom,
      dateTo,
    })
    const res = await api.get(`/pst?${q}`)
    loaded.push(...(res.data.reports || []))
    pages = Number(res.data.pagination?.pages || 1)
    page += 1
  } while (page <= pages)
  return loaded
}

export default function PstDashboard() {
  const [month, setMonth] = useState(currentMonth())
  const [locations, setLocations] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [responsible, setResponsible] = useState('')

  const bounds = useMemo(() => monthBounds(month), [month])

  const fetchData = useCallback(async ({ soft = false } = {}) => {
    if (soft) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const [locRes, reportRows] = await Promise.all([
        api.get('/locations/pst-list'),
        fetchAllReports(bounds),
      ])
      setLocations((locRes.data.locations || []).filter(row => row.is_active !== false))
      setReports(reportRows)
    } catch (e) {
      setError(e.response?.data?.error || 'Не удалось загрузить данные дашборда')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [bounds])

  useEffect(() => { fetchData() }, [fetchData])

  const dashboard = useMemo(() => {
    const days = bounds.days
    const locationById = new Map(locations.map(row => [String(row.id), row]))
    const plannedLocations = locations.filter(row => {
      const d = dateOnly(row.planned_wash_date)
      return d >= bounds.dateFrom && d <= bounds.dateTo
    })

    const groups = new Map()
    const ensureGroup = (name, sample = {}) => {
      const key = name || 'Без филиала'
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          name: key,
          city: sample.city || '',
          responsible: partnerNameOf(sample),
          fullVolume: 0,
          planTotal: 0,
          factTotal: 0,
          days: emptyDayMap(days),
          plannedIds: new Set(),
          washedIds: new Set(),
          overdue: 0,
          duplicates: 0,
        })
      }
      const group = groups.get(key)
      if (!group.responsible && partnerNameOf(sample)) group.responsible = partnerNameOf(sample)
      if (!group.city && sample.city) group.city = sample.city
      return group
    }

    plannedLocations.forEach(row => {
      const plannedDate = dateOnly(row.planned_wash_date)
      const day = Number(plannedDate.slice(-2))
      const group = ensureGroup(groupNameOf(row), row)
      group.fullVolume += 1
      group.planTotal += 1
      group.plannedIds.add(String(row.id))
      if (group.days[day]) group.days[day].plan += 1
    })

    const reportBuckets = new Map()
    reports.forEach(report => {
      const postomatId = getReportPostomatId(report)
      const submittedDate = isoDateAlmaty(report.submitted_at)
      if (!postomatId || submittedDate < bounds.dateFrom || submittedDate > bounds.dateTo) return
      const key = `${postomatId}|${submittedDate}|${WORK_TYPE}`
      const current = reportBuckets.get(key) || []
      current.push(report)
      reportBuckets.set(key, current)
    })

    reportBuckets.forEach((bucket, key) => {
      const [postomatId, submittedDate] = key.split('|')
      const day = Number(submittedDate.slice(-2))
      const location = locationById.get(postomatId) || bucket[0]?.location_data || {}
      const group = ensureGroup(groupNameOf(location), location)
      group.factTotal += 1
      group.washedIds.add(postomatId)
      group.duplicates += Math.max(0, bucket.length - 1)
      if (group.days[day]) group.days[day].fact += 1
    })

    const todayIso = isoDateAlmaty(new Date())
    plannedLocations.forEach(row => {
      const plannedDate = dateOnly(row.planned_wash_date)
      const group = ensureGroup(groupNameOf(row), row)
      const washed = Array.from(reportBuckets.keys()).some(key => {
        const [id, submittedDate] = key.split('|')
        return id === String(row.id) && submittedDate >= plannedDate
      })
      if (!washed && plannedDate < todayIso) group.overdue += 1
    })

    const list = Array.from(groups.values()).sort((a, b) => {
      const aProblem = b.overdue - a.overdue
      if (aProblem) return aProblem
      return a.name.localeCompare(b.name, 'ru')
    })

    const totalPlan = list.reduce((sum, row) => sum + row.planTotal, 0)
    const totalFact = list.reduce((sum, row) => sum + row.factTotal, 0)
    const totalOverdue = list.reduce((sum, row) => sum + row.overdue, 0)
    const duplicates = list.reduce((sum, row) => sum + row.duplicates, 0)
    const todayDay = todayIso.startsWith(month) ? Number(todayIso.slice(-2)) : null
    const todayPlan = todayDay ? list.reduce((sum, row) => sum + (row.days[todayDay]?.plan || 0), 0) : 0
    const todayFact = todayDay ? list.reduce((sum, row) => sum + (row.days[todayDay]?.fact || 0), 0) : 0

    return {
      rows: list,
      totalPlan,
      totalFact,
      remaining: Math.max(0, totalPlan - totalFact),
      totalOverdue,
      duplicates,
      todayDay,
      todayPlan,
      todayFact,
      days,
      plannedCount: plannedLocations.length,
      reportCount: reports.length,
      uniqueReportCount: reportBuckets.size,
    }
  }, [bounds, locations, month, reports])

  const responsibles = useMemo(() => (
    Array.from(new Set(dashboard.rows.map(row => row.responsible).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'ru'))
  ), [dashboard.rows])

  const visibleRows = useMemo(() => {
    const q = normalize(query)
    return dashboard.rows.filter(row => {
      if (responsible && row.responsible !== responsible) return false
      if (!q) return true
      return normalize(`${row.name} ${row.city} ${row.responsible}`).includes(q)
    })
  }, [dashboard.rows, query, responsible])

  const topProblemRows = useMemo(() => (
    [...dashboard.rows]
      .filter(row => row.overdue > 0 || row.planTotal > row.factTotal)
      .sort((a, b) => (b.overdue - a.overdue) || ((b.planTotal - b.factTotal) - (a.planTotal - a.factTotal)))
      .slice(0, 5)
  ), [dashboard.rows])

  const hasFilters = query || responsible
  const progress = Math.min(100, pct(dashboard.totalFact, dashboard.totalPlan))

  return (
    <div className="pst-dash-page">
      <div className="pst-dash-hero">
        <div>
          <div className="pst-dash-kicker"><BarChart3 size={16} /> Полная мойка</div>
          <h1>Kaspi PST Dashboard</h1>
        </div>
        <div className="pst-dash-actions">
          <label className="pst-dash-select">
            <CalendarDays size={16} />
            <select value={month} onChange={e => setMonth(e.target.value)}>
              {monthOptions().map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" className="pst-dash-refresh" onClick={() => fetchData({ soft: true })} disabled={loading || refreshing}>
            <RefreshCw size={16} className={loading || refreshing ? 'spin' : ''} />
            Обновить
          </button>
        </div>
      </div>

      {error && <div className="pst-dash-error"><AlertCircle size={16} /> {error}</div>}

      <div className="pst-dash-stats">
        <div className="pst-dash-stat primary">
          <span>План месяца</span>
          <strong>{formatNum(dashboard.totalPlan)}</strong>
          <small>{monthLabel(month)}</small>
        </div>
        <div className="pst-dash-stat">
          <span>Факт</span>
          <strong>{formatNum(dashboard.totalFact)}</strong>
          <small>{progress}% выполнения</small>
        </div>
        <div className="pst-dash-stat">
          <span>Остаток</span>
          <strong>{formatNum(dashboard.remaining)}</strong>
          <small>{formatNum(dashboard.totalOverdue)} просрочено</small>
        </div>
        <div className="pst-dash-stat">
          <span>Сегодня</span>
          <strong>{formatNum(dashboard.todayFact)} / {formatNum(dashboard.todayPlan)}</strong>
          <small>{dashboard.todayDay ? `${dashboard.todayDay} число` : 'не выбранный месяц'}</small>
        </div>
      </div>

      <div className="pst-dash-progress-panel">
        <div className="pst-dash-progress-head">
          <div>
            <strong>{progress}%</strong>
            <span>общее выполнение полной мойки</span>
          </div>
          <div className="pst-dash-meta">
            <span><CheckCircle2 size={14} /> {formatNum(dashboard.uniqueReportCount)} уникальных фактов</span>
            <span><Clock3 size={14} /> {formatNum(dashboard.duplicates)} повторных отчетов не задвоены</span>
          </div>
        </div>
        <div className="pst-dash-progress"><i style={{ width: `${progress}%` }} /></div>
      </div>

      <div className="pst-dash-grid">
        <section className="pst-dash-panel main">
          <div className="pst-dash-panel-head">
            <div>
              <h2>План-факт по филиалам</h2>
              <p>{formatNum(visibleRows.length)} строк в выборке</p>
            </div>
            <div className="pst-dash-filters">
              <label className="pst-dash-search">
                <Search size={16} />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по филиалу, городу, ответственному" />
                {query && <button type="button" onClick={() => setQuery('')}><X size={14} /></button>}
              </label>
              <select value={responsible} onChange={e => setResponsible(e.target.value)}>
                <option value="">Все ответственные</option>
                {responsibles.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
              {hasFilters && <button type="button" className="pst-dash-clear" onClick={() => { setQuery(''); setResponsible('') }}>Сброс</button>}
            </div>
          </div>

          <div className="pst-dash-table-wrap">
            <table className="pst-dash-table">
              <thead>
                <tr>
                  <th className="sticky-main">Филиал</th>
                  <th>Ответственный</th>
                  <th>Объем</th>
                  {Array.from({ length: dashboard.days }, (_, i) => (
                    <th key={i + 1} className={dashboard.todayDay === i + 1 ? 'is-today' : ''}>{i + 1}</th>
                  ))}
                  <th>План</th>
                  <th>Факт</th>
                  <th>Разница</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={dashboard.days + 6} className="pst-dash-state"><RefreshCw size={18} className="spin" /> Загружаю данные...</td></tr>
                ) : visibleRows.length === 0 ? (
                  <tr><td colSpan={dashboard.days + 6} className="pst-dash-state">Ничего не найдено</td></tr>
                ) : visibleRows.map(row => (
                  <tr key={row.key}>
                    <td className="sticky-main branch-cell">
                      <strong>{row.name}</strong>
                      <span>{row.city || '—'}</span>
                    </td>
                    <td className="responsible-cell">{row.responsible || '—'}</td>
                    <td className="num-cell">{formatNum(row.fullVolume)}</td>
                    {Array.from({ length: dashboard.days }, (_, i) => {
                      const day = i + 1
                      const cell = row.days[day] || { plan: 0, fact: 0 }
                      const done = cell.plan > 0 && cell.fact >= cell.plan
                      const partial = cell.fact > 0 && cell.fact < cell.plan
                      const missed = cell.plan > 0 && cell.fact === 0 && `${month}-${String(day).padStart(2, '0')}` < isoDateAlmaty(new Date())
                      return (
                        <td key={day} className={`day-cell ${done ? 'done' : partial ? 'partial' : missed ? 'missed' : ''} ${dashboard.todayDay === day ? 'is-today' : ''}`}>
                          {(cell.plan || cell.fact) ? <span>{cell.plan}<em>{cell.fact}</em></span> : '—'}
                        </td>
                      )
                    })}
                    <td className="num-cell total">{formatNum(row.planTotal)}</td>
                    <td className="num-cell total fact">{formatNum(row.factTotal)}</td>
                    <td className={`num-cell total ${row.planTotal - row.factTotal > 0 ? 'bad' : 'good'}`}>
                      {formatNum(row.planTotal - row.factTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="pst-dash-panel side">
          <div className="pst-dash-panel-head compact">
            <div>
              <h2>Где горит</h2>
              <p>филиалы с самым большим остатком</p>
            </div>
            <TrendingUp size={18} />
          </div>
          <div className="pst-dash-problems">
            {topProblemRows.length === 0 ? (
              <div className="pst-dash-empty">Просрочек и остатков нет</div>
            ) : topProblemRows.map(row => {
              const rowPct = pct(row.factTotal, row.planTotal)
              return (
                <div key={row.key} className="pst-dash-problem">
                  <div>
                    <strong>{row.name}</strong>
                    <span>{row.responsible || '—'}</span>
                  </div>
                  <b>{formatNum(Math.max(0, row.planTotal - row.factTotal))}</b>
                  <div className="pst-dash-mini-progress"><i style={{ width: `${Math.min(100, rowPct)}%` }} /></div>
                  <small>{rowPct}% · просрочка {formatNum(row.overdue)}</small>
                </div>
              )
            })}
          </div>
        </aside>
      </div>
    </div>
  )
}
