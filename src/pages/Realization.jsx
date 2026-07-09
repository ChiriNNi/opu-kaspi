import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import { RefreshCw, AlertTriangle, CheckCircle2, Send } from 'lucide-react'
import './Realization.css'

const currentMonth = () => new Date().toISOString().slice(0, 7)

// ── Вкладка «Отчёт» ───────────────────────────────────────────────────────────
function ReportTab() {
  const [month, setMonth] = useState(currentMonth())
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [batch, setBatch] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [r, b] = await Promise.all([
        api.get(`/realization/report?month=${month}`),
        api.get(`/realization/batches?month=${month}`),
      ])
      setGroups(r.data.groups || [])
      setBatch(b.data.batch)
    } catch (e) {
      setError(e.response?.data?.error || 'Ошибка загрузки отчёта')
    } finally { setLoading(false) }
  }, [month])

  useEffect(() => { load() }, [load])

  // Поллинг прогресса, пока батч в процессе
  useEffect(() => {
    if (batch?.status !== 'in_progress') return
    const t = setInterval(async () => {
      try {
        const { data } = await api.get(`/realization/batches/${batch.id}`)
        setBatch(data.batch)
        if (data.batch.status !== 'in_progress') load()
      } catch {}
    }, 3000)
    return () => clearInterval(t)
  }, [batch, load])

  const readyGroups = groups.filter(g => g.ready)
  const notReadyGroups = groups.filter(g => !g.ready)
  const totalSum = readyGroups.reduce((s, g) => s + (Number(g.sum_contract) || 0), 0)

  const openConfirm = async () => {
    setError('')
    try {
      const { data } = await api.post('/realization/batches/preview', { month })
      setPreview(data)
      setConfirmOpen(true)
    } catch (e) {
      setError(e.response?.data?.error || 'Ошибка предпросмотра')
    }
  }

  const confirmCreate = async () => {
    if (!preview) return
    setCreating(true); setError('')
    try {
      const groupKeys = preview.groups.map(g => g.group_key)
      const { data } = await api.post('/realization/batches', { month, groupKeys })
      setBatch({ id: data.batch_id, status: data.status, groups_total: data.groups_total, groups_done: 0 })
      setConfirmOpen(false)
    } catch (e) {
      setError(e.response?.data?.error || 'Ошибка создания сделок')
    } finally { setCreating(false) }
  }

  const hasActiveBatch = batch && batch.status !== 'failed'

  return (
    <div className="rz-tab">
      <div className="rz-toolbar">
        <input type="month" className="rz-month-input" value={month} onChange={e => setMonth(e.target.value)} />
        <button className="rz-refresh" onClick={load} title="Обновить"><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>
      </div>

      {error && <div className="rz-error">{error}</div>}

      {hasActiveBatch && (
        <div className={`rz-batch-banner ${batch.status}`}>
          {batch.status === 'in_progress' && <>Создаём сделки в Bitrix: {batch.groups_done} / {batch.groups_total}...</>}
          {batch.status === 'completed' && <>✓ Сделки за этот месяц уже созданы: {batch.groups_total} шт. ({new Date(batch.completed_at).toLocaleDateString('ru-RU')})</>}
          {batch.status === 'partial' && <>⚠ Создано частично: {batch.groups_done} / {batch.groups_total}. {batch.error_message}</>}
        </div>
      )}

      {loading ? (
        <div className="rz-empty">Загрузка...</div>
      ) : groups.length === 0 ? (
        <div className="rz-empty">Нет помытых постоматов за этот месяц</div>
      ) : (
        <>
          <div className="rz-summary">
            <div className="rz-summary-item"><span>Готово к отправке</span><b>{readyGroups.length} групп</b></div>
            <div className="rz-summary-item"><span>Не готово</span><b className={notReadyGroups.length ? 'warn' : ''}>{notReadyGroups.length} групп</b></div>
            <div className="rz-summary-item"><span>Сумма (готовые)</span><b>{totalSum.toLocaleString('ru-RU')} ₸</b></div>
          </div>

          <div className="rz-table-wrap">
            <table className="rz-table">
              <thead>
                <tr>
                  <th></th><th>Тип</th><th>Город/пригород</th><th>Установка</th><th>Партнёр</th>
                  <th>Кол-во</th><th>Сумма</th><th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, i) => (
                  <tr key={i} className={g.ready ? '' : 'rz-row-warn'}>
                    <td>{g.ready ? <CheckCircle2 size={14} className="rz-ok-ico" /> : <AlertTriangle size={14} className="rz-warn-ico" />}</td>
                    <td>{g.is_spec_route ? 'Спец' : 'Осн'}</td>
                    <td>{g.location_type || <span className="rz-missing">не указано</span>}</td>
                    <td>{g.install_place}</td>
                    <td>{g.partner_name || <span className="rz-missing">не назначен</span>}</td>
                    <td>{g.postomat_count}</td>
                    <td>{g.sum_contract != null ? Number(g.sum_contract).toLocaleString('ru-RU') + ' ₸' : <span className="rz-missing">—</span>}</td>
                    <td className="rz-reasons">{g.reasons?.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            className="rz-btn-create"
            disabled={!readyGroups.length || hasActiveBatch}
            onClick={openConfirm}
          >
            <Send size={15} /> Создать сделки в Bitrix ({readyGroups.length})
          </button>
        </>
      )}

      {confirmOpen && preview && (
        <div className="rz-modal-backdrop" onClick={() => setConfirmOpen(false)}>
          <div className="rz-modal" onClick={e => e.stopPropagation()}>
            <div className="rz-modal-head">Подтвердите создание сделок</div>
            <div className="rz-modal-hint">
              Будет создано {preview.groups.length} сделок в Bitrix24 (воронка «Реализация клиента») за {month}.
              Действие необратимо — сделки создаются на живом портале.
            </div>
            <div className="rz-modal-list">
              {preview.groups.map((g, i) => (
                <div key={i} className="rz-modal-row">
                  {g.title} — {g.postomat_count} шт., {Number(g.sum_contract).toLocaleString('ru-RU')} ₸
                </div>
              ))}
            </div>
            <div className="rz-modal-footer">
              <button className="rz-btn-cancel" onClick={() => setConfirmOpen(false)}>Отмена</button>
              <button className="rz-btn-confirm" onClick={confirmCreate} disabled={creating}>
                {creating ? 'Создаём...' : 'Подтвердить и создать'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Вкладка «Стоимость постомата» ─────────────────────────────────────────────
function RatesTab() {
  const [rates, setRates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // { id, value }

  useEffect(() => {
    api.get('/realization/rates')
      .then(r => setRates(r.data.rates || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const saveRate = async (id, value) => {
    const num = parseFloat(value)
    if (isNaN(num)) { setEditing(null); return }
    setRates(prev => prev.map(r => r.id === id ? { ...r, rate: num } : r))
    setEditing(null)
    try { await api.put(`/realization/rates/${id}`, { rate: num }) } catch {
      // откат
      api.get('/realization/rates').then(r => setRates(r.data.rates || [])).catch(() => {})
    }
  }

  const label = r => {
    const route = r.is_spec_route ? 'Спец' : 'Основной'
    const zone = r.location_type === 'пригород' ? 'Пригород' : 'Город'
    return { route, zone, place: r.install_place }
  }

  const specRates = rates.filter(r => r.is_spec_route)
  const mainRates = rates.filter(r => !r.is_spec_route)

  const RateRow = ({ r }) => {
    const { route, zone, place } = label(r)
    const isEdit = editing?.id === r.id
    return (
      <tr key={r.id}>
        <td><span className={`rz-route-badge ${r.is_spec_route ? 'spec' : 'main'}`}>{route}</span></td>
        <td>{zone}</td>
        <td>{place}</td>
        <td className="rz-rate-cell" onClick={() => !isEdit && setEditing({ id: r.id, value: String(r.rate) })}>
          {isEdit ? (
            <input
              autoFocus type="number" className="rz-rate-input"
              value={editing.value}
              onChange={e => setEditing(p => ({ ...p, value: e.target.value }))}
              onBlur={e => saveRate(r.id, e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveRate(r.id, editing.value); if (e.key === 'Escape') setEditing(null) }}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="rz-rate-val">{Number(r.rate).toLocaleString('ru-RU')} ₸</span>
          )}
        </td>
      </tr>
    )
  }

  if (loading) return <div className="rz-empty">Загрузка...</div>

  return (
    <div className="rz-tab">
      <div className="rz-rates-hint">Нажмите на цену чтобы изменить. Изменения сразу применяются к расчёту отчёта.</div>
      <div className="rz-rates-grid">
        <div className="rz-rates-section">
          <div className="rz-rates-section-title">Основной маршрут</div>
          <div className="rz-table-wrap">
            <table className="rz-table">
              <thead><tr><th>Маршрут</th><th>Зона</th><th>Тип</th><th>Стоимость</th></tr></thead>
              <tbody>{mainRates.map(r => <RateRow key={r.id} r={r} />)}</tbody>
            </table>
          </div>
        </div>
        <div className="rz-rates-section">
          <div className="rz-rates-section-title">Спец маршрут</div>
          <div className="rz-table-wrap">
            <table className="rz-table">
              <thead><tr><th>Маршрут</th><th>Зона</th><th>Тип</th><th>Стоимость</th></tr></thead>
              <tbody>{specRates.map(r => <RateRow key={r.id} r={r} />)}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Главная страница ───────────────────────────────────────────────────────────
export default function Realization() {
  const [tab, setTab] = useState('report')

  return (
    <div className="rz-page">
      <div className="rz-header">
        <div>
          <h1>Реализация</h1>
        </div>
      </div>

      <div className="rz-tabs-wrap">
        <div className="rz-tabs">
          <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>Отчёт</button>
          <button className={tab === 'rates' ? 'active' : ''} onClick={() => setTab('rates')}>Стоимость постомата</button>
        </div>
      </div>

      {tab === 'report' && <ReportTab />}
      {tab === 'rates' && <RatesTab />}
    </div>
  )
}
