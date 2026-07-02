import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import './Dashboard.css'

const API = import.meta.env.VITE_API_URL || 'https://opu.ic-group.kz'

const STATUS_CFG = {
  done:   { dot: 'dash-dot green',  badge: 'dash-badge green',  label: 'Завершено' },
  ok:     { dot: 'dash-dot amber',  badge: 'dash-badge amber',  label: 'В процессе' },
  behind: { dot: 'dash-dot red',    badge: 'dash-badge red',    label: 'Отстаёт'   },
}
const WORKER_CFG = {
  done:   { bar: 'bar-green', text: 'clr-green'  },
  ok:     { bar: 'bar-amber', text: 'clr-amber'  },
  behind: { bar: 'bar-red',   text: 'clr-red'    },
}

function fmtDT(v) {
  if (!v) return '—'
  return new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function fmtNum(n) { return n == null ? '—' : String(n) }

// ── Objects table ─────────────────────────────────────────────────────────────

function ObjectsTable({ objects }) {
  const [openId, setOpenId] = useState(null)
  const [openWid, setOpenWid] = useState(null)

  return (
    <div className="dash-table">
      <div className="dash-table-head">
        <span>Объект</span>
        <span className="tc">План</span>
        <span className="tc">Факт</span>
        <span className="tc">Статус</span>
        <span />
      </div>

      {objects.length === 0 && (
        <div className="dash-empty">Нет активных смен на сегодня</div>
      )}

      {objects.map((obj, idx) => {
        const cfg = STATUS_CFG[obj.status] || STATUS_CFG.ok
        const pct = obj.plan ? Math.round((obj.fact / obj.plan) * 100) : 0
        const behind = obj.workers.filter(w => w.status === 'behind').length
        const isOpen = openId === obj.id

        return (
          <div key={obj.id} className={idx < objects.length - 1 || isOpen ? 'dash-row-wrap bordered' : 'dash-row-wrap'}>
            <button className={`dash-row ${isOpen ? 'active' : ''} ${obj.status === 'behind' ? 'hover-red' : ''}`}
              onClick={() => setOpenId(isOpen ? null : obj.id)}>
              <div className="obj-name-col">
                <div className="obj-name-row">
                  <span className={cfg.dot} />
                  <span className="obj-name">{obj.name}</span>
                </div>
                <span className="obj-sub">{obj.workers.length} чел.{behind > 0 ? ` · ${behind} отстаёт` : ''}</span>
              </div>
              <div className="tc">
                <span className="num-muted">{obj.plan}</span>
                <span className="sub-label">задач</span>
              </div>
              <div className="tc">
                <span className={`num-colored ${obj.status}`}>{obj.fact}</span>
                <div className="mini-bar"><div className={`mini-fill ${obj.status}`} style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="tc"><span className={cfg.badge}>{cfg.label}</span></div>
              <svg className={`chevron ${isOpen ? 'up' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isOpen && (
              <div className="dash-workers">
                <div className="workers-head">
                  <span>Сотрудник</span>
                  <span className="tc">План</span>
                  <span className="tc">Факт</span>
                  <span className="tc">Активность</span>
                </div>
                {obj.workers.map(w => {
                  const wc = WORKER_CFG[w.status] || WORKER_CFG.ok
                  const wpct = w.plan ? Math.round((w.fact / w.plan) * 100) : 0
                  const isWOpen = openWid === w.id
                  const pending = w.plan - w.fact

                  return (
                    <div key={w.id} className="worker-card">
                      <button className={`worker-row ${isWOpen ? 'active' : ''}`}
                        onClick={() => setOpenWid(isWOpen ? null : w.id)}>
                        <div className="worker-name-col">
                          <div className={`worker-avatar ${w.status}`}>{(w.name || 'К')[0]}</div>
                          <span className="worker-name">{w.name}</span>
                          {pending > 0 && <span className="worker-pending">−{pending}</span>}
                        </div>
                        <span className="tc num-xs-muted">{w.plan}</span>
                        <div className="tc">
                          <span className={`num-xs ${wc.text}`}>{w.fact}</span>
                          <div className="micro-bar"><div className={`micro-fill ${wc.bar}`} style={{ width: `${wpct}%` }} /></div>
                        </div>
                        <span className="tc activity-text">{w.lastSeen}</span>
                        <svg className={`chevron sm ${isWOpen ? 'up' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isWOpen && (
                        <div className="worker-detail">
                          <div className="worker-report-card">
                            <div className="report-head">
                              <div>
                                <div className="report-label">Отчёт смены</div>
                                <div className="report-sub">чек-лист #{w.checklistId || w.id}</div>
                              </div>
                              <span className={`worker-status-badge ${w.status}`}>{w.fact}/{w.plan}</span>
                            </div>
                            <div className="report-times">
                              <div className="report-time-cell">
                                <div className="time-label">Старт</div>
                                <div className="time-val">{fmtDT(w.startedAt)}</div>
                              </div>
                              <div className="report-time-cell">
                                <div className="time-label">Финиш</div>
                                <div className="time-val">{fmtDT(w.completedAt)}</div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, token } = useStore()
  const [objects, setObjects] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    fetch(`${API}/api/dashboard/overview`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        setObjects(data.objects || [])
        setStats(data.stats || null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [token])

  const totalPlan     = objects.reduce((s, o) => s + o.plan, 0)
  const totalFact     = objects.reduce((s, o) => s + o.fact, 0)
  const behindObjs    = objects.filter(o => o.status === 'behind').length
  const doneObjs      = objects.filter(o => o.status === 'done').length
  const totalWorkers  = objects.reduce((s, o) => s + o.workers.length, 0)
  const behindWorkers = objects.flatMap(o => o.workers).filter(w => w.status === 'behind').length
  const overallPct    = totalPlan > 0 ? Math.round((totalFact / totalPlan) * 100) : 0
  const firstName     = user?.full_name?.split(' ')[0] || user?.phone || 'Куратор'

  return (
    <div className="dash-page">

      {/* ── Hero card ───────────────────────────────────────── */}
      <div className="dash-hero">
        <div className="dash-hero-deco" />
        <p className="dash-hero-label">Сегодня</p>
        <h1 className="dash-hero-name">Привет, {firstName}</h1>

        <div className="dash-overall">
          <div className="dash-overall-row">
            <span className="dash-overall-label">Общий прогресс</span>
            <span className="dash-overall-nums">{totalFact} / {totalPlan} задач</span>
          </div>
          <div className="dash-overall-bar">
            <div className="dash-overall-fill" style={{ width: `${overallPct}%` }} />
          </div>
          <p className="dash-overall-pct">{overallPct}%</p>
        </div>

        <div className="dash-chips">
          <span className="dash-chip"><span className="chip-dot" />{objects.length} объектов</span>
          <span className="dash-chip green"><span className="chip-dot green" />{doneObjs} завершено</span>
          {behindObjs > 0 && <span className="dash-chip red"><span className="chip-dot red" />{behindObjs} отстаёт</span>}
          <span className="dash-chip amber"><span className="chip-dot amber" />{totalWorkers} сотрудников</span>
        </div>
      </div>

      {/* ── Behind alert ────────────────────────────────────── */}
      {behindWorkers > 0 && (
        <div className="dash-alert">
          <div className="dash-alert-icon">
            <svg fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" width={16} height={16}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <p className="dash-alert-title">{behindWorkers} сотрудников отстают от плана</p>
            <p className="dash-alert-sub">Раскройте объект чтобы увидеть кто именно</p>
          </div>
        </div>
      )}

      {/* ── Quick links ──────────────────────────────────────── */}
      <div className="dash-links">
        <Link to="/checklists" className="dash-link-card">
          <div className="dash-link-icon dark">
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={16} height={16}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <div><p className="dash-link-title">Чек-листы</p><p className="dash-link-sub">Шаблоны и задания</p></div>
        </Link>
        <Link to="/pst-reports" className="dash-link-card">
          <div className="dash-link-icon green">
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={16} height={16}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
            </svg>
          </div>
          <div><p className="dash-link-title">PST отчёты</p><p className="dash-link-sub">{fmtNum(stats?.total)} уборок</p></div>
        </Link>
        <Link to="/locations" className="dash-link-card">
          <div className="dash-link-icon amber">
            <svg fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" width={16} height={16}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
            </svg>
          </div>
          <div><p className="dash-link-title">Постоматы</p><p className="dash-link-sub">База адресов</p></div>
        </Link>
      </div>

    </div>
  )
}
