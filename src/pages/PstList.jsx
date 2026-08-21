import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, RefreshCw, Search, Settings2, X } from 'lucide-react'
import api from '../api'
import './PstList.css'

const STORAGE_KEY = 'pst_list_visible_columns_v1'

const formatDate = (value) => {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const formatDateOnly = (value) => {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(value))
}

const normalize = (value) => String(value || '').trim().toLowerCase()

const yesNo = (value) => {
  if (value === true) return 'Да'
  if (value === false) return 'Нет'
  return '—'
}

const get2GisUrl = (row) => {
  if (row.two_gis_url && /^https?:\/\//i.test(row.two_gis_url)) return row.two_gis_url
  if (row.lat != null && row.lng != null) {
    return `https://2gis.kz/search/${encodeURIComponent(`${row.lat},${row.lng}`)}?m=${row.lng},${row.lat}/17`
  }
  return ''
}

const rowHasIncident = (row) => {
  const hay = [
    row.activity_status,
    row.availability_status,
    row.on_point_status,
    row.comment,
    row.hint,
  ].map(normalize).join(' ')
  return hay.includes('инцидент')
}

const rowUnavailable = (row) => {
  const hay = [
    row.availability_status,
    row.on_point_status,
    row.activity_status,
  ].map(normalize).join(' ')
  return hay.includes('нет') || hay.includes('недоступ')
}

const DEFAULT_COLUMNS = [
  'id',
  'city',
  'branch',
  'address',
  'install_place',
  'hint',
  'washed',
  'last_cleaned_at',
  'availability_status',
  'partner',
  'planned_wash_date',
  'location_type',
  'two_gis_url',
]

function ColumnPicker({ columns, visibleIds, onChange, onClose }) {
  const [query, setQuery] = useState('')
  const visible = new Set(visibleIds)
  const filtered = columns.filter(col => normalize(`${col.label} ${col.group}`).includes(normalize(query)))
  const grouped = filtered.reduce((acc, col) => {
    const group = col.group || 'Основное'
    if (!acc[group]) acc[group] = []
    acc[group].push(col)
    return acc
  }, {})

  const apply = (ids) => {
    const next = ids.includes('id') ? ids : ['id', ...ids]
    onChange(next)
  }

  const toggle = (key) => {
    if (key === 'id') return
    apply(visible.has(key) ? visibleIds.filter(id => id !== key) : [...visibleIds, key])
  }

  return (
    <div className="pst-list-backdrop" onClick={onClose}>
      <div className="pst-list-cols" onClick={e => e.stopPropagation()}>
        <div className="pst-list-cols-head">
          <div>
            <h2>Настройка списка</h2>
            <p>{visibleIds.length} из {columns.length} столбцов выбрано</p>
          </div>
          <button type="button" onClick={onClose} className="pst-list-icon-btn"><X size={17} /></button>
        </div>

        <label className="pst-list-cols-search">
          <Search size={17} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск по полям" autoFocus />
        </label>

        <div className="pst-list-cols-body">
          {Object.entries(grouped).map(([group, items]) => (
            <section key={group}>
              <h3>{group}</h3>
              <div className="pst-list-cols-grid">
                {items.map(col => (
                  <label key={col.key} className={`pst-list-col-check ${visible.has(col.key) ? 'active' : ''}`}>
                    <input
                      type="checkbox"
                      checked={visible.has(col.key)}
                      disabled={col.key === 'id'}
                      onChange={() => toggle(col.key)}
                    />
                    <span>{col.label}</span>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="pst-list-cols-footer">
          <button type="button" onClick={() => apply(columns.map(col => col.key))}>Выбрать все</button>
          <button type="button" onClick={() => apply(DEFAULT_COLUMNS)}>По умолчанию</button>
          <button type="button" className="primary" onClick={onClose}>Применить</button>
        </div>
      </div>
    </div>
  )
}

export default function PstList() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('')
  const [installPlace, setInstallPlace] = useState('')
  const [status, setStatus] = useState('all')
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [visibleIds, setVisibleIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      return Array.isArray(saved) && saved.length ? saved : DEFAULT_COLUMNS
    } catch {
      return DEFAULT_COLUMNS
    }
  })

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const all = []
      let page = 1
      let pages = 1
      do {
        const params = new URLSearchParams({
          page: String(page),
          limit: '1000',
          sortBy: 'id',
          sortDir: 'asc',
          active_filter: 'active',
        })
        const res = await api.get(`/locations?${params}`)
        all.push(...(res.data.locations || []))
        pages = Number(res.data.pagination?.pages || 1)
        page += 1
      } while (page <= pages)
      setRows(all.filter(row => row.is_active !== false))
    } catch (e) {
      setError(e.response?.data?.error || 'Не удалось загрузить список постоматов')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])

  const saveVisibleIds = (ids) => {
    setVisibleIds(ids)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  }

  const cities = useMemo(() => (
    Array.from(new Set(rows.map(row => row.city).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'ru'))
  ), [rows])

  const installPlaces = useMemo(() => (
    Array.from(new Set(rows.map(row => row.install_place).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'ru'))
  ), [rows])

  const columns = useMemo(() => [
    { key: 'id', label: 'POSTOMAT_ID', group: 'Основное', className: 'id-col', render: row => <span className="pst-list-id">{row.id}</span> },
    { key: 'city', label: 'Город', group: 'Основное', render: row => row.city || '—' },
    { key: 'branch', label: 'Филиал', group: 'Основное', render: row => row.branch || '—' },
    { key: 'address', label: 'Адрес', group: 'Основное', className: 'wide', render: row => row.address || '—' },
    { key: 'install_place', label: 'Место установки', group: 'Основное', render: row => <span className={`pst-list-type ${normalize(row.install_place).includes('улич') ? 'outdoor' : 'indoor'}`}>{row.install_place || '—'}</span> },
    { key: 'hint', label: 'Комментарий', group: 'Основное', className: 'wide-xl', render: row => row.hint || row.comment || row.routeText || '—' },
    { key: 'washed', label: 'Помыли?', group: 'Уборки', align: 'center', render: row => row.cleanings_count > 0 ? <span className="pst-list-check"><Check size={14} /></span> : <span className="pst-list-empty-mark">—</span> },
    { key: 'cleanings_count', label: 'Кол-во уборок', group: 'Уборки', align: 'right', render: row => row.cleanings_count || 0 },
    { key: 'last_cleaned_at', label: 'Последняя уборка', group: 'Уборки', render: row => row.last_cleaned_at ? formatDate(row.last_cleaned_at) : '—' },
    { key: 'partner', label: 'Партнер', group: 'Уборки', render: row => row.curator_name || row.partner_name || row.last_cleaned_by || '—' },
    { key: 'planned_wash_date', label: 'Плановая дата', group: 'План', render: row => row.planned_wash_date ? formatDateOnly(row.planned_wash_date) : '—' },
    { key: 'plan_per_month', label: 'План/мес', group: 'План', align: 'right', render: row => row.plan_per_month ?? '—' },
    { key: 'location_type', label: 'Г/П', group: 'Excel', render: row => row.location_type || '—' },
    { key: 'category', label: 'Категория', group: 'Excel', render: row => row.category || '—' },
    { key: 'activity_status', label: 'Активность', group: 'Excel', render: row => row.activity_status || '—' },
    { key: 'availability_status', label: 'Доступен?', group: 'Excel', render: row => row.availability_status || row.on_point_status || '—' },
    { key: 'on_point_status', label: 'На точке', group: 'Excel', render: row => row.on_point_status || '—' },
    { key: 'postomat_removed', label: 'Постомат удален', group: 'Excel', render: row => yesNo(row.postomat_removed) },
    { key: 'access_card_required', label: 'Нужен доступ', group: 'Excel', render: row => yesNo(row.access_card_required) },
    { key: 'cells_count', label: 'Ячеек', group: 'Система', align: 'right', render: row => row.cells_count || '—' },
    { key: 'coordinates', label: 'Координаты', group: 'Система', render: row => row.lat != null && row.lng != null ? `${Number(row.lat).toFixed(5)}, ${Number(row.lng).toFixed(5)}` : '—' },
    { key: 'source_file', label: 'Источник', group: 'Система', render: row => row.source_file || '—' },
    { key: 'source_updated_at', label: 'Обновлено', group: 'Система', render: row => row.source_updated_at ? formatDate(row.source_updated_at) : '—' },
    { key: 'two_gis_url', label: '2GIS', group: 'Ссылки', align: 'center', render: row => {
      const url = get2GisUrl(row)
      return url ? <a className="pst-list-2gis" href={url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> 2GIS</a> : '—'
    } },
  ], [])

  const visibleColumns = columns.filter(col => visibleIds.includes(col.key))

  const filteredRows = useMemo(() => {
    const q = normalize(search)
    return rows.filter(row => {
      if (city && row.city !== city) return false
      if (installPlace && row.install_place !== installPlace) return false
      if (status === 'incident' && !rowHasIncident(row)) return false
      if (status === 'washed' && !(row.cleanings_count > 0)) return false
      if (status === 'not_washed' && row.cleanings_count > 0) return false
      if (status === 'unavailable' && !rowUnavailable(row)) return false
      if (!q) return true
      return normalize([
        row.id,
        row.city,
        row.branch,
        row.address,
        row.install_place,
        row.category,
        row.hint,
        row.comment,
        row.curator_name,
        row.partner_name,
        row.last_cleaned_by,
      ].join(' ')).includes(q)
    })
  }, [rows, city, installPlace, status, search])

  const stats = useMemo(() => ({
    total: rows.length,
    filtered: filteredRows.length,
    washed: rows.filter(row => row.cleanings_count > 0).length,
    incidents: rows.filter(rowHasIncident).length,
  }), [rows, filteredRows])

  const resetFilters = () => {
    setSearch('')
    setCity('')
    setInstallPlace('')
    setStatus('all')
  }

  return (
    <div className="pst-list-page">
      <div className="pst-list-header">
        <div>
          <h1>Список</h1>
          <p>Активные Kaspi Postomat из базы в табличном виде</p>
        </div>
        <div className="pst-list-actions">
          <button type="button" className="pst-list-btn" onClick={() => setColumnsOpen(true)}>
            <Settings2 size={16} /> Колонки
          </button>
          <button type="button" className="pst-list-icon-btn" onClick={fetchRows} disabled={loading} title="Обновить">
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="pst-list-stats">
        <div><strong>{stats.total.toLocaleString('ru-RU')}</strong><span>активных PST</span></div>
        <div><strong>{stats.filtered.toLocaleString('ru-RU')}</strong><span>в выборке</span></div>
        <div><strong>{stats.washed.toLocaleString('ru-RU')}</strong><span>с уборкой</span></div>
        <div><strong>{stats.incidents.toLocaleString('ru-RU')}</strong><span>инцидентов</span></div>
      </div>

      <div className="pst-list-toolbar">
        <label className="pst-list-search">
          <Search size={17} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск по ID, городу, филиалу, адресу, партнеру"
          />
          {search && <button type="button" onClick={() => setSearch('')}><X size={15} /></button>}
        </label>
        <select value={city} onChange={e => setCity(e.target.value)}>
          <option value="">Все города</option>
          {cities.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={installPlace} onChange={e => setInstallPlace(e.target.value)}>
          <option value="">Все установки</option>
          {installPlaces.map(item => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">Все статусы</option>
          <option value="washed">Помытые</option>
          <option value="not_washed">Без уборки</option>
          <option value="incident">Инцидент</option>
          <option value="unavailable">Недоступные</option>
        </select>
        <button type="button" className="pst-list-reset" onClick={resetFilters}><X size={14} /> Сброс</button>
      </div>

      {error && <div className="pst-list-error">{error}</div>}

      <div className="pst-list-sheet-wrap">
        <table className="pst-list-sheet">
          <thead>
            <tr className="pst-list-letters">
              <th className="row-num corner"></th>
              {visibleColumns.map((col, index) => (
                <th key={col.key} className={col.className || ''}>{String.fromCharCode(65 + (index % 26))}</th>
              ))}
            </tr>
            <tr>
              <th className="row-num">#</th>
              {visibleColumns.map(col => (
                <th key={col.key} className={`${col.className || ''} ${col.align ? `align-${col.align}` : ''}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={visibleColumns.length + 1} className="pst-list-state">Загружаю активные постоматы...</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={visibleColumns.length + 1} className="pst-list-state">Ничего не найдено</td></tr>
            ) : filteredRows.map((row, index) => (
              <tr key={row.id} className={`${rowHasIncident(row) ? 'is-incident' : ''} ${rowUnavailable(row) ? 'is-unavailable' : ''}`}>
                <td className="row-num">{index + 1}</td>
                {visibleColumns.map(col => (
                  <td key={col.key} className={`${col.className || ''} ${col.align ? `align-${col.align}` : ''}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {columnsOpen && (
        <ColumnPicker
          columns={columns}
          visibleIds={visibleIds}
          onChange={saveVisibleIds}
          onClose={() => setColumnsOpen(false)}
        />
      )}
    </div>
  )
}
