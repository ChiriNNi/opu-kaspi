import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import { RefreshCw, AlertTriangle, CheckCircle2, Search, Send } from 'lucide-react'
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

// ── Вкладка «Классификация» ───────────────────────────────────────────────────
function ClassificationTab() {
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [unclassifiedOnly, setUnclassifiedOnly] = useState(true)
  const [editingRate, setEditingRate] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/realization/classification', {
        params: { unclassified_only: unclassifiedOnly, search, limit: 200 }
      })
      setLocations(data.locations || [])
    } catch {} finally { setLoading(false) }
  }, [search, unclassifiedOnly])

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t) }, [load])

  const patch = async (id, body) => {
    setLocations(prev => prev.map(l => l.id === id ? { ...l, ...body } : l))
    try { await api.put(`/realization/locations/${id}`, body) } catch { load() }
  }

  const saveRate = (id, value) => {
    const num = value === '' ? null : Number(value)
    patch(id, { contract_rate: num })
    setEditingRate(null)
  }

  return (
    <div className="rz-tab">
      <div className="rz-toolbar">
        <div className="rz-search-wrap">
          <Search size={14} />
          <input placeholder="Поиск по адресу/городу/ID..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <label className="rz-checkbox-label">
          <input type="checkbox" checked={unclassifiedOnly} onChange={e => setUnclassifiedOnly(e.target.checked)} />
          Только незаполненные
        </label>
      </div>

      {loading ? <div className="rz-empty">Загрузка...</div> : locations.length === 0 ? (
        <div className="rz-empty">Ничего не найдено</div>
      ) : (
        <div className="rz-table-wrap">
          <table className="rz-table">
            <thead>
              <tr><th>ID</th><th>Город</th><th>Адрес</th><th>Партнёр</th><th>Установка</th><th>Город/пригород</th><th>Спец</th><th>Сумма договора</th></tr>
            </thead>
            <tbody>
              {locations.map(l => (
                <tr key={l.id}>
                  <td>{l.id}</td>
                  <td>{l.city}</td>
                  <td>{l.address}</td>
                  <td>{l.partner_name || <span className="rz-missing">—</span>}</td>
                  <td>{l.install_place || '—'}</td>
                  <td>
                    <select value={l.location_type || ''} onChange={e => patch(l.id, { location_type: e.target.value || null })}>
                      <option value="">—</option>
                      <option value="город">город</option>
                      <option value="пригород">пригород</option>
                    </select>
                  </td>
                  <td>
                    <button
                      className={`rz-toggle ${l.is_spec_route ? 'on' : 'off'}`}
                      onClick={() => patch(l.id, { is_spec_route: !l.is_spec_route })}
                    ><span className="rz-toggle-thumb" /></button>
                  </td>
                  <td onClick={() => setEditingRate({ id: l.id, value: l.contract_rate ?? '' })}>
                    {editingRate?.id === l.id ? (
                      <input
                        autoFocus type="number" className="rz-rate-input"
                        value={editingRate.value}
                        onChange={e => setEditingRate(p => ({ ...p, value: e.target.value }))}
                        onBlur={e => saveRate(l.id, e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveRate(l.id, editingRate.value); if (e.key === 'Escape') setEditingRate(null) }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className={l.contract_rate ? 'rz-rate-set' : 'rz-missing'}>{l.contract_rate ?? '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Вкладка «Партнёры → Bitrix ИП» ────────────────────────────────────────────
function PartnerMapTab() {
  const [partners, setPartners] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/realization/partner-map')
      setPartners(data.partners || [])
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const save = async (partnerId, ipId) => {
    setSaving(true); setError('')
    try {
      const { data } = await api.put(`/realization/partner-map/${partnerId}`, { bitrix_ip_element_id: ipId })
      setPartners(prev => prev.map(p => p.partner_id === partnerId ? { ...p, ...data.map, confirmed_by_admin: true } : p))
      setEditing(null)
    } catch (e) {
      setError(e.response?.data?.error || 'Не удалось сохранить/проверить ИП')
    } finally { setSaving(false) }
  }

  return (
    <div className="rz-tab">
      {error && <div className="rz-error">{error}</div>}
      {loading ? <div className="rz-empty">Загрузка...</div> : (
        <div className="rz-table-wrap">
          <table className="rz-table">
            <thead><tr><th>Партнёр</th><th>Наименование ИП в Bitrix</th><th>ID элемента</th><th>Статус</th><th></th></tr></thead>
            <tbody>
              {partners.map(p => (
                <tr key={p.partner_id}>
                  <td>{p.partner_name}</td>
                  <td>{p.bitrix_ip_name || <span className="rz-missing">не сопоставлено</span>}</td>
                  <td>
                    {editing === p.partner_id ? (
                      <input
                        autoFocus type="number" className="rz-rate-input" defaultValue={p.bitrix_ip_element_id || ''}
                        onKeyDown={e => { if (e.key === 'Enter') save(p.partner_id, Number(e.target.value)) }}
                        onBlur={e => e.target.value && save(p.partner_id, Number(e.target.value))}
                      />
                    ) : (p.bitrix_ip_element_id || '—')}
                  </td>
                  <td>
                    {p.confirmed_by_admin
                      ? <span className="rz-badge-ok">Подтверждено</span>
                      : p.bitrix_ip_element_id
                        ? <span className="rz-badge-warn">Проверьте (авто)</span>
                        : <span className="rz-badge-warn">Не задано</span>}
                  </td>
                  <td>
                    <button className="rz-edit-btn" onClick={() => setEditing(p.partner_id)} disabled={saving}>
                      {p.bitrix_ip_element_id ? 'Изменить' : 'Задать'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Главная страница ───────────────────────────────────────────────────────────
export default function Realization() {
  const [tab, setTab] = useState('report')

  return (
    <div className="rz-page">
      <div className="rz-header">
        <h1>Реализация</h1>
        <div className="rz-tabs">
          <button className={tab === 'report' ? 'active' : ''} onClick={() => setTab('report')}>Отчёт</button>
          <button className={tab === 'classification' ? 'active' : ''} onClick={() => setTab('classification')}>Классификация</button>
          <button className={tab === 'partners' ? 'active' : ''} onClick={() => setTab('partners')}>Партнёры → Bitrix ИП</button>
        </div>
      </div>

      {tab === 'report' && <ReportTab />}
      {tab === 'classification' && <ClassificationTab />}
      {tab === 'partners' && <PartnerMapTab />}
    </div>
  )
}
