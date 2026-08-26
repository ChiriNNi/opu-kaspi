import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as XLSX from 'xlsx'
import { Check, Download, ExternalLink, Filter, RefreshCw, Search, Settings2, X } from 'lucide-react'
import api from '../api'
import './PstList.css'

const STORAGE_KEY = 'pst_list_visible_columns_v1'
const CACHE_KEY = 'pst_list_rows_cache_v1'
const CACHE_TTL_MS = 5 * 60 * 1000
const PAGE_LIMIT = 1000
const ROW_HEIGHT = 34 // держим в синхроне с .pst-list-sheet th/td { height } в PstList.css

const readRowsCache = () => {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    if (!cached?.rows || !Array.isArray(cached.rows)) return []
    if (Date.now() - Number(cached.savedAt || 0) > CACHE_TTL_MS) return []
    return cached.rows
  } catch {
    return []
  }
}

const writeRowsCache = (rows) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), rows }))
  } catch {}
}

const fetchPagedLocations = async () => {
  const paramsFor = (page) => new URLSearchParams({
    page: String(page),
    limit: String(PAGE_LIMIT),
    sortBy: 'id',
    sortDir: 'asc',
    active_filter: 'active',
  })

  const first = await api.get(`/locations?${paramsFor(1)}`)
  const firstRows = (first.data.locations || []).filter(row => row.is_active !== false)
  const pages = Number(first.data.pagination?.pages || 1)

  if (pages <= 1) return firstRows

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) => {
      const page = index + 2
      return api.get(`/locations?${paramsFor(page)}`)
    })
  )

  return [
    ...firstRows,
    ...rest.flatMap(res => res.data.locations || []),
  ].filter(row => row.is_active !== false)
}

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

// Плоское текстовое значение колонки для экспорта — большинство col.render()
// и так возвращают строку, но у части колонок это JSX (значок/ссылка), для них
// значение достаём отдельно.
const exportCellValue = (col, row) => {
  if (col.key === 'id') return row.id
  if (col.key === 'install_place') return row.install_place || '—'
  if (col.key === 'washed') return row.cleanings_count > 0 ? 'Да' : 'Нет'
  if (col.key === 'two_gis_url') return get2GisUrl(row) || '—'
  const value = col.render(row)
  return typeof value === 'string' || typeof value === 'number' ? value : ''
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

// Фильтр по значениям колонки (как в Google Таблицах): воронка на заголовке →
// список уникальных значений с чекбоксами. selected === undefined значит "все";
// selected — массив (может быть пустым — тогда строк не показываем).
function ColumnFilterMenu({ col, rows, selected, onApply }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)

  const options = useMemo(() => {
    const counts = new Map()
    rows.forEach(row => {
      const raw = exportCellValue(col, row)
      const v = raw === '' || raw == null ? '—' : String(raw)
      counts.set(v, (counts.get(v) || 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ru'))
  }, [rows, col])

  const filteredOptions = options.filter(([v]) => normalize(v).includes(normalize(query)))
  const isChecked = (v) => selected === undefined || selected.includes(v)
  const active = selected !== undefined

  const toggleValue = (v) => {
    const base = selected === undefined ? options.map(([val]) => val) : selected
    const next = base.includes(v) ? base.filter(val => val !== v) : [...base, v]
    onApply(next.length === options.length ? undefined : next)
  }

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 260) })
    setQuery('')
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    return () => window.removeEventListener('scroll', close, true)
  }, [open])

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`pst-list-filter-btn ${active ? 'active' : ''}`}
        onClick={e => { e.stopPropagation(); open ? setOpen(false) : openMenu() }}
        title="Фильтр"
      >
        <Filter size={11} />
      </button>
      {open && pos && (
        <div className="pst-list-filter-backdrop" onClick={() => setOpen(false)}>
          <div className="pst-list-filter-menu" style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
            <label className="pst-list-filter-search">
              <Search size={13} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Поиск значений..." autoFocus />
            </label>
            <div className="pst-list-filter-actions">
              <button type="button" onClick={() => onApply(undefined)}>Выбрать все</button>
              <button type="button" onClick={() => onApply([])}>Снять все</button>
            </div>
            <div className="pst-list-filter-list">
              {filteredOptions.length === 0 ? (
                <div className="pst-list-filter-empty">Ничего не найдено</div>
              ) : filteredOptions.map(([v, count]) => (
                <label key={v} className="pst-list-filter-item">
                  <input type="checkbox" checked={isChecked(v)} onChange={() => toggleValue(v)} />
                  <span>{v}</span>
                  <span className="pst-list-filter-count">{count}</span>
                </label>
              ))}
            </div>
            <div className="pst-list-filter-footer">
              <button type="button" className="primary" onClick={() => setOpen(false)}>Готово</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

export default function PstList() {
  const cachedRowsRef = useRef(readRowsCache())
  const [rows, setRows] = useState(() => cachedRowsRef.current)
  const rowsRef = useRef(cachedRowsRef.current)
  const [loading, setLoading] = useState(() => cachedRowsRef.current.length === 0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState({}) // { [colKey]: string[] | undefined }
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [visibleIds, setVisibleIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      return Array.isArray(saved) && saved.length ? saved : DEFAULT_COLUMNS
    } catch {
      return DEFAULT_COLUMNS
    }
  })

  useEffect(() => { rowsRef.current = rows }, [rows])

  const fetchRows = useCallback(async () => {
    const hadRows = rowsRef.current.length > 0
    if (hadRows) setLoadingMore(true)
    else setLoading(true)
    setError('')
    try {
      let nextRows = []
      try {
        const res = await api.get('/locations/pst-list')
        nextRows = (res.data.locations || []).filter(row => row.is_active !== false)
      } catch (fastErr) {
        nextRows = await fetchPagedLocations()
      }
      setRows(nextRows)
      writeRowsCache(nextRows)
    } catch (e) {
      setError(e.response?.data?.error || 'Не удалось загрузить список постоматов')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])

  const saveVisibleIds = (ids) => {
    setVisibleIds(ids)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  }

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

  const activeColumnFilters = useMemo(
    () => Object.entries(columnFilters).filter(([, values]) => values !== undefined),
    [columnFilters]
  )

  const filteredRows = useMemo(() => {
    const q = normalize(search)
    return rows.filter(row => {
      for (const [key, values] of activeColumnFilters) {
        const col = columns.find(c => c.key === key)
        if (!col) continue
        const raw = exportCellValue(col, row)
        const v = raw === '' || raw == null ? '—' : String(raw)
        if (!values.includes(v)) return false
      }
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
  }, [rows, activeColumnFilters, columns, search])

  const stats = useMemo(() => ({
    total: rows.length,
    filtered: filteredRows.length,
    washed: rows.filter(row => row.cleanings_count > 0).length,
    incidents: rows.filter(rowHasIncident).length,
  }), [rows, filteredRows])

  const handleExportExcel = () => {
    setExporting(true)
    try {
      const data = filteredRows.map(row => {
        const line = {}
        visibleColumns.forEach(col => { line[col.label] = exportCellValue(col, row) })
        return line
      })
      const ws = XLSX.utils.json_to_sheet(data)
      // Без явной ширины Excel сжимает все столбцы до дефолтной узкой —
      // подбираем ширину по самому длинному значению (заголовок или ячейка) в колонке.
      ws['!cols'] = visibleColumns.map(col => {
        const longest = data.reduce((max, line) => {
          const len = String(line[col.label] ?? '').length
          return len > max ? len : max
        }, col.label.length)
        return { wch: Math.min(60, Math.max(10, longest + 2)) }
      })
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Список')
      XLSX.writeFile(wb, `pst-list_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  const resetFilters = () => {
    setSearch('')
    setColumnFilters({})
  }
  const hasActiveFilters = search || activeColumnFilters.length > 0

  // Виртуализация строк: в DOM держим только видимые (+overscan), а не все 10к+ разом —
  // иначе рендер и любой ре-рендер (поиск/фильтр) ощутимо подтормаживал.
  const scrollRef = useRef(null)
  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 15,
  })
  const virtualRows = rowVirtualizer.getVirtualItems()
  const topPad = virtualRows.length ? virtualRows[0].start : 0
  const bottomPad = virtualRows.length ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0

  return (
    <div className="pst-list-page">
      <div className="pst-list-header">
        <div>
          <h1>Список</h1>
          <p>Активные Kaspi Postomat из базы в табличном виде</p>
        </div>
        <div className="pst-list-actions">
          <button type="button" className="pst-list-btn" onClick={handleExportExcel} disabled={exporting || filteredRows.length === 0}>
            <Download size={16} /> {exporting ? 'Выгрузка...' : 'Excel'}
          </button>
          <button type="button" className="pst-list-btn" onClick={() => setColumnsOpen(true)}>
            <Settings2 size={16} /> Колонки
          </button>
          <button type="button" className="pst-list-icon-btn" onClick={fetchRows} disabled={loading} title="Обновить">
            <RefreshCw size={16} className={loading || loadingMore ? 'spin' : ''} />
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
        {hasActiveFilters && (
          <button type="button" className="pst-list-reset" onClick={resetFilters}><X size={14} /> Сброс</button>
        )}
      </div>

      {error && <div className="pst-list-error">{error}</div>}
      {loadingMore && rows.length > 0 && (
        <div className="pst-list-sync">
          <RefreshCw size={14} className="spin" /> Обновляю свежие данные, таблицей уже можно пользоваться
        </div>
      )}

      <div className="pst-list-sheet-wrap" ref={scrollRef}>
        <table className="pst-list-sheet">
          <thead>
            <tr>
              <th className="row-num">#</th>
              {visibleColumns.map(col => (
                <th key={col.key} className={`${col.className || ''} ${col.align ? `align-${col.align}` : ''}`}>
                  <div className="pst-list-th-row">
                    <span className="pst-list-th-label">{col.label}</span>
                    <ColumnFilterMenu
                      col={col}
                      rows={rows}
                      selected={columnFilters[col.key]}
                      onApply={(values) => setColumnFilters(prev => ({ ...prev, [col.key]: values }))}
                    />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={visibleColumns.length + 1} className="pst-list-state">Загружаю активные постоматы...</td></tr>
            ) : filteredRows.length === 0 ? (
              <tr><td colSpan={visibleColumns.length + 1} className="pst-list-state">Ничего не найдено</td></tr>
            ) : (
              <>
                {topPad > 0 && (
                  <tr className="pst-list-spacer" style={{ height: topPad }}>
                    <td colSpan={visibleColumns.length + 1} />
                  </tr>
                )}
                {virtualRows.map(virtualRow => {
                  const row = filteredRows[virtualRow.index]
                  return (
                    <tr key={row.id} className={`${rowHasIncident(row) ? 'is-incident' : ''} ${rowUnavailable(row) ? 'is-unavailable' : ''}`}>
                      <td className="row-num">{virtualRow.index + 1}</td>
                      {visibleColumns.map(col => (
                        <td key={col.key} className={`${col.className || ''} ${col.align ? `align-${col.align}` : ''}`}>
                          {col.render(row)}
                        </td>
                      ))}
                    </tr>
                  )
                })}
                {bottomPad > 0 && (
                  <tr className="pst-list-spacer" style={{ height: bottomPad }}>
                    <td colSpan={visibleColumns.length + 1} />
                  </tr>
                )}
              </>
            )}
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
