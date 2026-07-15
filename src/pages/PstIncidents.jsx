import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, Plus, RefreshCw, X } from 'lucide-react'
import api from '../api'
import { useStore } from '../store'
import './PstReports.css'
import './PstIncidents.css'

const formatDate = (val) => {
  if (!val) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(val))
}

const EMPTY_FORM = { postomat_id: '', city: '', branch: '', address: '' }

export default function PstIncidents() {
  const { user } = useStore()
  const [incidents, setIncidents] = useState([])
  const [loading, setLoading]     = useState(false)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState('')
  const [success, setSuccess]     = useState('')

  const fetchIncidents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/pst/incidents')
      setIncidents(res.data.incidents || [])
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchIncidents() }, [fetchIncidents])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    if (!form.postomat_id.trim()) { setError('Укажите POSTOMAT_ID'); return }
    setSubmitting(true)
    try {
      await api.post('/pst/incident', {
        postomat_id: form.postomat_id.trim(),
        city:    form.city.trim(),
        branch:  form.branch.trim(),
        address: form.address.trim(),
      })
      setSuccess('Инцидент добавлен')
      setForm(EMPTY_FORM)
      fetchIncidents()
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка при отправке')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="pst-page">
      {/* Form card */}
      <div className="inc-form-card">
        <div className="inc-form-title">
          <AlertTriangle size={16} />
          Добавить инцидент
        </div>

        <form onSubmit={handleSubmit} className="inc-form">
          <div className="inc-form-fields">
            <label className="inc-field">
              <span>POSTOMAT_ID <span className="inc-required">*</span></span>
              <input
                type="text"
                value={form.postomat_id}
                onChange={e => set('postomat_id', e.target.value)}
                placeholder="Например: 12345"
                autoComplete="off"
              />
            </label>
            <label className="inc-field">
              <span>Город</span>
              <input
                type="text"
                value={form.city}
                onChange={e => set('city', e.target.value)}
                placeholder="Алматы"
                autoComplete="off"
              />
            </label>
            <label className="inc-field">
              <span>Филиал</span>
              <input
                type="text"
                value={form.branch}
                onChange={e => set('branch', e.target.value)}
                placeholder="Медеу"
                autoComplete="off"
              />
            </label>
            <label className="inc-field inc-field--wide">
              <span>Адрес</span>
              <input
                type="text"
                value={form.address}
                onChange={e => set('address', e.target.value)}
                placeholder="ул. Абая, 12"
                autoComplete="off"
              />
            </label>
          </div>

          {error   && <div className="inc-msg inc-msg--err"><X size={13}/> {error}</div>}
          {success && <div className="inc-msg inc-msg--ok">{success}</div>}

          <div className="inc-form-actions">
            <button type="submit" disabled={submitting} className="inc-btn-submit">
              <Plus size={15} />
              {submitting ? 'Отправка...' : 'Добавить инцидент'}
            </button>
          </div>
        </form>
      </div>

      {/* List */}
      <div className="pst-table-wrap">
        <div className="inc-table-header">
          <span className="inc-table-title">История инцидентов</span>
          <button className="btn-refresh" onClick={fetchIncidents} disabled={loading} title="Обновить">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>

        {loading && incidents.length === 0 ? (
          <div className="inc-empty">Загрузка...</div>
        ) : incidents.length === 0 ? (
          <div className="inc-empty">Инциденты не найдены</div>
        ) : (
          <table className="pst-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th style={{ width: 100 }}>POSTOMAT_ID</th>
                <th style={{ width: 140 }}>Дата/Время</th>
                <th style={{ width: 110 }}>Город</th>
                <th style={{ width: 130 }}>Филиал</th>
                <th>Адрес</th>
                <th style={{ width: 80 }}>Синхр.</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((r, i) => (
                <tr key={r.id} className={i % 2 === 0 ? 'even' : 'odd'}>
                  <td className="cell-num">{r.id}</td>
                  <td>{r.postomat_id || '—'}</td>
                  <td className="cell-date">{formatDate(r.created_at)}</td>
                  <td>{r.city || '—'}</td>
                  <td className="cell-branch">{r.branch || '—'}</td>
                  <td className="cell-address">{r.address || '—'}</td>
                  <td>
                    <span className={`sync-badge sync-${r.sync_status}`}>
                      {r.sync_status === 'synced' ? 'OK' : r.sync_status === 'pending' ? '...' : 'Ошибка'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
