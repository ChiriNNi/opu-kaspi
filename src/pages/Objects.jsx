import { useEffect, useState, useCallback, useRef } from 'react'
import api from '../api'
import { Search, X, RefreshCw, Building2, Users, ChevronDown, UserCheck } from 'lucide-react'
import './Objects.css'

export default function Objects() {
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 100 })
  const [cities, setCities]       = useState([])
  const [partners, setPartners]   = useState([])
  const [search, setSearch]       = useState('')
  const [city, setCity]           = useState('')
  const [partnerId, setPartnerId] = useState('')
  const [page, setPage]           = useState(1)
  const [editingPartner, setEditingPartner] = useState(null)
  const [savingId, setSavingId]   = useState(null)
  const searchTimer = useRef(null)

  const load = useCallback(async (overrides = {}) => {
    setLoading(true)
    try {
      const p = {
        page: overrides.page ?? page,
        limit: 100,
        search: overrides.search ?? search,
        city: overrides.city ?? city,
        partner_id: overrides.partner_id !== undefined ? overrides.partner_id : partnerId,
      }
      const q = new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '')))
      const res = await api.get(`/locations/cleaning?${q}`)
      setRows(res.data.locations)
      setPagination(res.data.pagination)
    } catch { } finally { setLoading(false) }
  }, [page, search, city, partnerId])

  useEffect(() => { load() }, [page, city, partnerId])

  useEffect(() => {
    api.get('/locations/cleaning/cities').then(r => setCities(r.data.cities)).catch(() => {})
    api.get('/users').then(r => {
      setPartners(r.data.users.filter(u => u.role === 'partner' && u.is_active))
    }).catch(() => {})
  }, [])

  const handleSearch = (val) => {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(1); load({ search: val, page: 1 }) }, 400)
  }

  const reset = () => { setSearch(''); setCity(''); setPartnerId(''); setPage(1); load({ search: '', city: '', partner_id: '', page: 1 }) }

  const savePartner = async (locationId, partnerId) => {
    setSavingId(locationId)
    try {
      await api.put(`/locations/cleaning/${locationId}`, { partner_id: partnerId || null })
      setRows(prev => prev.map(r => {
        if (r.id !== locationId) return r
        const p = partners.find(p => p.id === Number(partnerId))
        return { ...r, partner_id: partnerId ? Number(partnerId) : null, partner_name: p?.full_name || null }
      }))
      setEditingPartner(null)
    } catch (e) {
      alert('Ошибка: ' + (e.response?.data?.error || e.message))
    } finally { setSavingId(null) }
  }

  const hasFilters = search || city || partnerId

  return (
    <div className="obj-page">
      <div className="obj-header">
        <div>
          <h1>Объекты</h1>
          <p>{pagination.total} объектов Kaspi Bank</p>
        </div>
        <button className="obj-refresh" onClick={() => load()} title="Обновить">
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div className="obj-toolbar">
        <div className="obj-search">
          <Search size={14} className="obj-search-ico" />
          <input
            placeholder="Поиск по названию, городу, ответственному..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
          {search && <button className="obj-search-clr" onClick={() => handleSearch('')}><X size={13} /></button>}
        </div>
        <div className="obj-filters">
          <div className="of-group">
            <Building2 size={13} />
            <select value={city} onChange={e => { setCity(e.target.value); setPage(1) }}>
              <option value="">Все города</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="of-group">
            <UserCheck size={13} />
            <select value={partnerId} onChange={e => { setPartnerId(e.target.value); setPage(1) }}>
              <option value="">Все партнёры</option>
              {partners.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>
          </div>
          {hasFilters && (
            <button className="obj-reset" onClick={reset}><X size={12} /> Сброс</button>
          )}
        </div>
      </div>

      <div className="obj-table-wrap">
        <table className="obj-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Город</th>
              <th>Объект</th>
              <th>Партнёр</th>
              <th>Площадь, м²</th>
              <th>Люди</th>
              <th>Координаты</th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={7} className="obj-empty"><RefreshCw size={16} className="spin" /> Загрузка...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="obj-empty">Ничего не найдено</td></tr>
            ) : rows.map(r => {
              const count = r.cleaner_count || 0
              const names = r.cleaners || []
              const isEditing = editingPartner === r.id
              const isSaving  = savingId === r.id
              return (
                <tr key={r.id}>
                  <td><span className="obj-chip-id">{r.kaspi_id}</span></td>
                  <td className="obj-city">{r.city || '—'}</td>
                  <td className="obj-name">{r.name || '—'}</td>
                  <td className="obj-partner-cell">
                    {isEditing ? (
                      <div className="obj-partner-edit">
                        <select
                          defaultValue={r.partner_id || ''}
                          autoFocus
                          onChange={e => savePartner(r.id, e.target.value)}
                          onBlur={() => setEditingPartner(null)}
                          disabled={isSaving}
                        >
                          <option value="">— Не назначен —</option>
                          {partners.map(p => (
                            <option key={p.id} value={p.id}>{p.full_name}</option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <button
                        className={`obj-partner-btn ${r.partner_name ? 'assigned' : 'empty'}`}
                        onClick={() => setEditingPartner(r.id)}
                        title="Нажмите чтобы изменить"
                      >
                        {isSaving
                          ? <RefreshCw size={10} className="spin" />
                          : r.partner_name || '—'
                        }
                        <ChevronDown size={10} className="obj-partner-chevron" />
                      </button>
                    )}
                  </td>
                  <td className="obj-num">{r.area ? `${parseFloat(r.area).toLocaleString('ru-RU')}` : '—'}</td>
                  <td className="obj-people">
                    {count > 0 ? (
                      <span className="obj-people-badge" title={names.join('\n')}>
                        <Users size={11} /> {count}
                      </span>
                    ) : (
                      <span className="obj-people-empty">—</span>
                    )}
                  </td>
                  <td className="obj-coords">
                    {r.lat && r.lng ? `${parseFloat(r.lat).toFixed(4)}, ${parseFloat(r.lng).toFixed(4)}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pagination.pages > 1 && (
        <div className="obj-pagination">
          <span className="obj-pg-info">
            {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} из {pagination.total}
          </span>
          <div className="obj-pg-btns">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
            {Array.from({ length: Math.min(7, pagination.pages) }, (_, i) => {
              const p = pagination.pages <= 7 ? i + 1
                : page <= 4 ? i + 1
                : page >= pagination.pages - 3 ? pagination.pages - 6 + i
                : page - 3 + i
              return <button key={p} className={p === page ? 'active' : ''} onClick={() => setPage(p)}>{p}</button>
            })}
            <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        </div>
      )}
    </div>
  )
}
