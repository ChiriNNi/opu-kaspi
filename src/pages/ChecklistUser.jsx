import { useState, useEffect, useCallback } from 'react'
import { useStore } from '../store'
import PstNav from '../components/PstNav'
import { CheckCircle2, Circle, Plus, Trash2, ChevronDown, ChevronUp, Clock, MapPin } from 'lucide-react'
import './ChecklistUser.css'

const API = import.meta.env.VITE_API_URL || 'https://opu.ic-group.kz'

export default function ChecklistUser() {
  const { token } = useStore()
  const [checklists, setChecklists] = useState([])
  const [personal, setPersonal] = useState([])
  const [newItem, setNewItem] = useState('')
  const [loading, setLoading] = useState(true)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const loadAll = useCallback(async () => {
    const [clRes, pRes] = await Promise.all([
      fetch(`${API}/api/checklists/active`, { headers }).then(r => r.json()),
      fetch(`${API}/api/checklists/personal`, { headers }).then(r => r.json()),
    ])
    setChecklists(clRes.checklists || [])
    setPersonal(pRes.items || [])
    setLoading(false)
  }, [token])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Personal ────────────────────────────────────────────────

  const addPersonal = async (e) => {
    e.preventDefault()
    if (!newItem.trim()) return
    const res = await fetch(`${API}/api/checklists/personal`, { method: 'POST', headers, body: JSON.stringify({ title: newItem.trim() }) })
    const data = await res.json()
    setPersonal(prev => [...prev, data.item])
    setNewItem('')
  }

  const togglePersonal = async (id, completed) => {
    setPersonal(prev => prev.map(it => it.id === id ? { ...it, completed } : it))
    await fetch(`${API}/api/checklists/personal/${id}`, { method: 'PUT', headers, body: JSON.stringify({ completed }) })
  }

  const deletePersonal = async (id) => {
    setPersonal(prev => prev.filter(it => it.id !== id))
    await fetch(`${API}/api/checklists/personal/${id}`, { method: 'DELETE', headers })
  }

  const clearCompleted = async () => {
    const done = personal.filter(it => it.completed)
    setPersonal(prev => prev.filter(it => !it.completed))
    await Promise.all(done.map(it => fetch(`${API}/api/checklists/personal/${it.id}`, { method: 'DELETE', headers })))
  }

  if (loading) {
    return (
      <>
        <PstNav />
        <div className="clu-loading">Загрузка...</div>
      </>
    )
  }

  return (
    <>
      <PstNav />
      <div className="clu-page">

        {/* ── Assigned checklists ─────────────────────────── */}
        <section className="clu-section">
          <h2 className="clu-section-title">Мои задания</h2>
          {checklists.length === 0
            ? <div className="clu-empty-box">Нет активных заданий</div>
            : checklists.map(cl => (
              <AssignedChecklist key={cl.id} cl={cl} token={token} onRefresh={loadAll} />
            ))
          }
        </section>

        {/* ── Personal checklist ──────────────────────────── */}
        <section className="clu-section">
          <h2 className="clu-section-title">
            Личный список
            <span className="clu-badge">{personal.filter(i => !i.completed).length} осталось</span>
          </h2>

          <div className="clu-personal-card">
            {personal.map(item => (
              <div key={item.id} className={`clu-personal-item ${item.completed ? 'done' : ''}`}>
                <button className="clu-check" onClick={() => togglePersonal(item.id, !item.completed)}>
                  {item.completed
                    ? <CheckCircle2 size={20} color="#22c55e" />
                    : <Circle size={20} color="rgba(26,29,30,0.25)" />
                  }
                </button>
                <span className="clu-personal-title">{item.title}</span>
                <button className="clu-del" onClick={() => deletePersonal(item.id)}><Trash2 size={13} /></button>
              </div>
            ))}

            <form className="clu-add-form" onSubmit={addPersonal}>
              <input
                value={newItem}
                onChange={e => setNewItem(e.target.value)}
                placeholder="Добавить задачу..."
              />
              <button type="submit" disabled={!newItem.trim()}>
                <Plus size={16} />
              </button>
            </form>

            {personal.some(i => i.completed) && (
              <button className="clu-clear-btn" onClick={clearCompleted}>
                Очистить выполненные
              </button>
            )}
          </div>
        </section>

      </div>
    </>
  )
}

// ── Assigned checklist card ───────────────────────────────────────────────────

function AssignedChecklist({ cl, token, onRefresh }) {
  const [expanded, setExpanded] = useState(false)
  const [items, setItems] = useState(null)
  const [loading, setLoading] = useState(false)
  const [completing, setCompleting] = useState(false)

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }

  const loadItems = async () => {
    if (items) return
    setLoading(true)
    const res = await fetch(`${API}/api/checklists/active/${cl.id}`, { headers })
    const data = await res.json()
    setItems(data.checklist?.items || [])
    setLoading(false)
  }

  const toggle = async () => {
    if (!expanded) loadItems()
    setExpanded(v => !v)
  }

  const toggleItem = async (item) => {
    const nextCompleted = !item.completed
    setItems(prev => prev.map(it => it.id === item.id ? { ...it, completed: nextCompleted } : it))
    await fetch(`${API}/api/checklists/active/${cl.id}/items/${item.id}`, {
      method: 'POST', headers, body: JSON.stringify({ completed: nextCompleted })
    })
  }

  const handleComplete = async () => {
    setCompleting(true)
    await fetch(`${API}/api/checklists/active/${cl.id}/complete`, { method: 'POST', headers, body: JSON.stringify({}) })
    onRefresh()
  }

  const doneCount = items ? items.filter(i => i.completed).length : cl.completed_items
  const total     = items ? items.length : cl.total_items
  const pct       = total > 0 ? Math.round((doneCount / total) * 100) : 0
  const allDone   = total > 0 && doneCount === total

  return (
    <div className={`clu-cl-card ${expanded ? 'open' : ''}`}>
      <div className="clu-cl-header" onClick={toggle}>
        <div className="clu-cl-info">
          <div className="clu-cl-name">{cl.template_name}</div>
          <div className="clu-cl-meta">
            {cl.location_name && <><MapPin size={11} /> {cl.location_name}</>}
            {cl.shift_date && <><Clock size={11} /> {new Date(cl.shift_date).toLocaleDateString('ru', { day: 'numeric', month: 'long' })}</>}
          </div>
        </div>
        <div className="clu-cl-right">
          <div className="clu-cl-prog-wrap">
            <div className="clu-cl-prog-bar" style={{ width: `${pct}%` }} />
          </div>
          <span className="clu-cl-pct">{doneCount}/{total}</span>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {expanded && (
        <div className="clu-cl-body">
          {loading
            ? <div className="clu-loading-sm">Загрузка пунктов...</div>
            : (
              <>
                <div className="clu-cl-items">
                  {(items || []).map(item => (
                    <button
                      key={item.id}
                      className={`clu-cl-item ${item.completed ? 'done' : ''}`}
                      onClick={() => toggleItem(item)}
                    >
                      <div className="clu-item-icon">
                        {item.completed
                          ? <CheckCircle2 size={18} color="#22c55e" />
                          : <Circle size={18} color="rgba(26,29,30,0.2)" />
                        }
                      </div>
                      <div className="clu-item-body">
                        <span className="clu-item-title">{item.title}</span>
                        {item.zone && <span className="clu-item-zone">{item.zone}</span>}
                      </div>
                      {item.duration_minutes && (
                        <span className="clu-item-dur"><Clock size={10} /> {item.duration_minutes}м</span>
                      )}
                    </button>
                  ))}
                </div>

                {allDone && cl.status !== 'completed' && (
                  <button className="clu-complete-btn" onClick={handleComplete} disabled={completing}>
                    <CheckCircle2 size={16} />
                    {completing ? 'Завершение...' : 'Завершить уборку'}
                  </button>
                )}
              </>
            )
          }
        </div>
      )}
    </div>
  )
}
