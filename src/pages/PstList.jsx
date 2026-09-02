import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import * as XLSX from 'xlsx'
import { Calendar, Check, ChevronDown, ClipboardList, Download, ExternalLink, Filter, RefreshCw, Search, Settings2, Table2, X } from 'lucide-react'
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
// Значение, по которому строится фильтр колонки. Обычно совпадает с тем, что в ячейке,
// но для "Последней уборки" ячейка показывает дату со временем — по такому значению
// фильтровать бессмысленно (каждая уборка уникальна, в списке тысячи пунктов по одному).
// Поэтому колонка может задать filterValue и группировать, например, только по дате.
const filterCellValue = (col, row) => {
  const raw = col.filterValue ? col.filterValue(row) : exportCellValue(col, row)
  return raw === '' || raw == null ? '—' : String(raw)
}

// Даты в формате ДД.ММ.ГГГГ нельзя сортировать как строки — сравниваем хронологически.
const DMY_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/
const compareFilterOptions = (a, b) => {
  const ma = DMY_RE.exec(a)
  const mb = DMY_RE.exec(b)
  if (ma && mb) return `${ma[3]}${ma[2]}${ma[1]}`.localeCompare(`${mb[3]}${mb[2]}${mb[1]}`)
  return a.localeCompare(b, 'ru')
}

const exportCellValue = (col, row) => {
  if (col.key === 'id') return row.id
  if (col.key === 'install_place') return row.install_place || '—'
  if (col.key === 'washed') return row.cleanings_count > 0 ? 'Да' : 'Нет'
  if (col.key === 'two_gis_url') return get2GisUrl(row) || '—'
  if (col.key === 'absence_reason') return row.absence_reason || '—'
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

// На телефоне таблица остаётся таблицей (не превращается в карточки), но с 13
// колонками по умолчанию горизонтальный скролл был бы бесконечным — сужаем
// стартовый набор до самого нужного, остальное доступно через "Колонки".
const MOBILE_DEFAULT_COLUMNS = ['id', 'address', 'install_place', 'washed', 'partner', 'planned_wash_date']

const ABSENCE_REASONS = [
  'Выезд специалиста',
  'Нет с подтверждением каспи',
  'Перемещение с точки',
  'Снят с витрины',
  'Отказ точки',
  'Адрес изменен',
  'Увезли постомат',
  'Нет электричества',
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

// Меню (воронка фильтра, квартал, Excel) рендерятся с position: fixed по координатам
// кнопки, поэтому при скролле их нужно двигать вместе с кнопкой. Раньше вместо этого висел
// window.addEventListener('scroll', close, true): capture:true ловит скролл ЛЮБОГО элемента,
// включая список значений внутри самого меню (.pst-list-filter-list прокручивается) и
// прокрутку страницы под полноэкранным backdrop. Из-за этого меню закрывалось, не дав
// по нему кликнуть. Теперь: скролл внутри меню игнорируем, снаружи — пересчитываем позицию,
// и закрываем только когда кнопка-якорь ушла за пределы окна.
function useAnchoredMenu(computePos) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)
  const menuRef = useRef(null)

  const openMenu = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos(computePos(r))
    setOpen(true)
  }, [computePos])

  useEffect(() => {
    if (!open) return
    const onMove = (e) => {
      if (e?.target instanceof Node && menuRef.current?.contains(e.target)) return
      const r = btnRef.current?.getBoundingClientRect()
      if (!r || r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return }
      setPos(computePos(r))
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, computePos])

  return { open, setOpen, pos, btnRef, menuRef, openMenu }
}

const anchorBelowLeft = (r) => ({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 260) })

// Фильтр по значениям колонки (как в Google Таблицах): воронка на заголовке →
// список уникальных значений с чекбоксами. selected === undefined значит "все";
// selected — массив (может быть пустым — тогда строк не показываем).
function ColumnFilterMenu({ col, rows, selected, onApply }) {
  const [query, setQuery] = useState('')
  const { open, setOpen, pos, btnRef, menuRef, openMenu } = useAnchoredMenu(anchorBelowLeft)

  const options = useMemo(() => {
    const counts = new Map()
    rows.forEach(row => {
      const v = filterCellValue(col, row)
      counts.set(v, (counts.get(v) || 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => compareFilterOptions(a[0], b[0]))
  }, [rows, col])

  const filteredOptions = options.filter(([v]) => normalize(v).includes(normalize(query)))
  const isChecked = (v) => selected === undefined || selected.includes(v)
  const active = selected !== undefined

  const toggleValue = (v) => {
    const base = selected === undefined ? options.map(([val]) => val) : selected
    const next = base.includes(v) ? base.filter(val => val !== v) : [...base, v]
    onApply(next.length === options.length ? undefined : next)
  }

  const handleOpen = () => { setQuery(''); openMenu() }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`pst-list-filter-btn ${active ? 'active' : ''}`}
        onClick={e => { e.stopPropagation(); open ? setOpen(false) : handleOpen() }}
        title="Фильтр"
      >
        <Filter size={11} />
      </button>
      {open && pos && (
        <div className="pst-list-filter-backdrop" onClick={() => setOpen(false)}>
          <div ref={menuRef} className="pst-list-filter-menu" style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
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

const MONTHS_SHORT_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
function formatPeriodRange(p) {
  if (!p) return ''
  const from = new Date(p.period_start)
  const to = new Date(p.period_end)
  const fromStr = `${from.getDate()} ${MONTHS_SHORT_RU[from.getMonth()]}`
  const toStr = `${to.getDate()} ${MONTHS_SHORT_RU[to.getMonth()]} ${to.getFullYear()}`
  return from.getFullYear() === to.getFullYear() ? `${fromStr} – ${toStr}` : `${fromStr} ${from.getFullYear()} – ${toStr}`
}

// Выбор квартального плана (postomat_plans.period): по умолчанию показываем
// последний загруженный квартал, но можно посмотреть и данные прошлых кварталов —
// раньше под каждый квартал была своя отдельная таблица в Google Таблицах.
function PeriodMenu({ periods, selectedPeriod, onSelect, compact }) {
  const { open, setOpen, pos, btnRef, menuRef, openMenu } = useAnchoredMenu(anchorBelowLeft)

  const currentPeriod = periods[0]?.period
  const active = periods.find(p => p.period === (selectedPeriod || currentPeriod))

  if (periods.length === 0) return null

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className={`pst-list-btn pst-list-period-btn ${selectedPeriod ? 'active' : ''}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        title="Выбрать квартальный план"
      >
        <Calendar size={16} /> {active ? (compact ? active.period : formatPeriodRange(active)) : 'Квартал'} <ChevronDown size={13} />
      </button>
      {open && pos && (
        <div className="pst-list-filter-backdrop" onClick={() => setOpen(false)}>
          <div ref={menuRef} className="pst-list-filter-menu pst-list-period-menu" style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
            <div className="pst-list-filter-list">
              {periods.map(p => (
                <label key={p.period} className="pst-list-filter-item">
                  <input
                    type="radio"
                    name="pst-list-period"
                    checked={(selectedPeriod || currentPeriod) === p.period}
                    onChange={() => { onSelect(p.period === currentPeriod ? '' : p.period); setOpen(false) }}
                  />
                  <span>
                    {formatPeriodRange(p)}
                    {p.period === currentPeriod && <em className="pst-list-period-current"> · текущий</em>}
                  </span>
                  <span className="pst-list-filter-count">{p.locations_count}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

const EXCEL_MENU_WIDTH = 300

// Excel-меню прижимаем правым краем к кнопке — она обычно у правого края шапки.
const anchorExcelMenu = (r) => ({
  top: r.bottom + 6,
  left: Math.max(12, Math.min(r.right - EXCEL_MENU_WIDTH, window.innerWidth - EXCEL_MENU_WIDTH - 12)),
})
const isAvailable = (row) => normalize(row.availability_status || row.on_point_status) === 'да'
const isNotWashed = (row) => !(row.cleanings_count > 0)
const partnerNameOf = (row) => row.curator_name || row.partner_name || row.last_cleaned_by || ''

// Excel не даёт называть лист длиннее 31 символа и с символами : \ / ? * [ ]
const sanitizeSheetName = (name) => {
  const cleaned = String(name || '').replace(/[:\\/?*[\]]/g, ' ').trim()
  return (cleaned || 'Без партнёра').slice(0, 31)
}

// Кнопка "Excel" со своим выбором: выгрузить текущую выборку как есть, или
// "снять остатки" — отдельный операционный отчёт (Помыли? = Нет, Доступен? = Да),
// не зависящий от того, что сейчас включено в поиске/фильтрах на экране.
function ExcelMenu({ rows, filteredCount, exporting, disabled, refreshing, degraded, onExport }) {
  const { open, setOpen, pos, btnRef, menuRef, openMenu } = useAnchoredMenu(anchorExcelMenu)

  const remainingCount = useMemo(
    () => rows.filter(row => isNotWashed(row) && isAvailable(row)).length,
    [rows]
  )

  const choose = (mode) => { setOpen(false); onExport(mode) }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        className="pst-list-btn"
        onClick={() => (open ? setOpen(false) : openMenu())}
        disabled={disabled || exporting || refreshing || degraded}
        title={
          degraded ? 'Данные загружены в упрощённом режиме — количество уборок посчитано за всю историю, а не за квартал. Обновите страницу.'
            : refreshing ? 'Дожидаюсь свежих данных — иначе в файл попадут устаревшие цифры'
              : undefined
        }
      >
        <Download size={16} /> {exporting ? 'Выгрузка...' : refreshing ? 'Обновляю...' : 'Excel'} <ChevronDown size={13} />
      </button>
      {open && pos && (
        <div className="pst-list-filter-backdrop" onClick={() => setOpen(false)}>
          <div ref={menuRef} className="pst-list-excel-menu" style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
            <button type="button" className="pst-list-excel-option" onClick={() => choose('all')} disabled={filteredCount === 0}>
              <span className="pst-list-excel-icon"><Table2 size={15} /></span>
              <span className="pst-list-excel-text">
                <strong>Текущий вид таблицы</strong>
                <span>Что сейчас на экране: с поиском и фильтрами</span>
              </span>
            </button>
            <button type="button" className="pst-list-excel-option pst-list-excel-option--accent" onClick={() => choose('remaining')} disabled={remainingCount === 0}>
              <span className="pst-list-excel-icon pst-list-excel-icon--accent"><ClipboardList size={15} /></span>
              <span className="pst-list-excel-text">
                <strong>Остатки по мойке <em className="pst-list-excel-count">{remainingCount}</em></strong>
                <span>Ещё не помыли, но точка доступна — отдельный лист на каждого партнёра</span>
              </span>
            </button>
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
  // Резервный путь загрузки (/locations вместо /locations/pst-list) считает cleanings_count
  // за ВСЮ историю, а не за выбранный квартал — на таких данных "остатки" считать нельзя,
  // поэтому выгрузку в этом режиме блокируем.
  const [degraded, setDegraded] = useState(false)
  const [search, setSearch] = useState('')
  const [columnFilters, setColumnFilters] = useState({}) // { [colKey]: string[] | undefined }
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [periods, setPeriods] = useState([]) // квартальные планы (postomat_plans.period), новые сверху
  const [selectedPeriod, setSelectedPeriod] = useState('') // '' = последний загруженный квартал
  const [visibleIds, setVisibleIds] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
      if (Array.isArray(saved) && saved.length) return saved
    } catch {}
    const isMobileNow = typeof window !== 'undefined' && window.innerWidth <= 768
    return isMobileNow ? MOBILE_DEFAULT_COLUMNS : DEFAULT_COLUMNS
  })

  // Только для подсказки в поиске (короче на узком экране) — вёрстка таблицы
  // сама по себе не зависит от JS, реагирует через CSS media query.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const onChange = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => { rowsRef.current = rows }, [rows])

  // Квартал, по которому реально показаны данные: выбранный, либо (по умолчанию)
  // самый свежий загруженный — используется при сохранении "Причины отсутствия".
  const effectivePeriod = selectedPeriod || periods[0]?.period || ''

  const updateAbsenceReason = useCallback(async (row, value) => {
    if (!effectivePeriod) return
    const prev = row.absence_reason
    setRows(list => list.map(r => (r.id === row.id ? { ...r, absence_reason: value || null } : r)))
    try {
      await api.patch(`/locations/${encodeURIComponent(row.id)}/absence-reason`, {
        period: effectivePeriod,
        absence_reason: value || null,
      })
    } catch (e) {
      setRows(list => list.map(r => (r.id === row.id ? { ...r, absence_reason: prev } : r)))
      alert(e.response?.data?.error || 'Не удалось сохранить причину отсутствия')
    }
  }, [effectivePeriod])

  const fetchRows = useCallback(async () => {
    const hadRows = rowsRef.current.length > 0
    if (hadRows) setLoadingMore(true)
    else setLoading(true)
    setError('')
    try {
      let nextRows = []
      let usedFallback = false
      try {
        const qs = selectedPeriod ? `?period=${encodeURIComponent(selectedPeriod)}` : ''
        const res = await api.get(`/locations/pst-list${qs}`)
        nextRows = (res.data.locations || []).filter(row => row.is_active !== false)
      } catch (fastErr) {
        usedFallback = true
        nextRows = selectedPeriod ? [] : await fetchPagedLocations()
      }
      setDegraded(usedFallback)
      setRows(nextRows)
      // Кэшируем только полноценные данные — иначе упрощённый снимок с "историческими"
      // счётчиками уборок осел бы в localStorage и врал бы при следующем открытии.
      if (!selectedPeriod && !usedFallback) writeRowsCache(nextRows)
    } catch (e) {
      setError(e.response?.data?.error || 'Не удалось загрузить список постоматов')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [selectedPeriod])

  useEffect(() => { fetchRows() }, [fetchRows])

  // Список загруженных кварталов для переключателя — грузится один раз, не зависит от выбора.
  useEffect(() => {
    api.get('/locations/plan-periods')
      .then(res => setPeriods(res.data.periods || []))
      .catch(() => {})
  }, [])

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
    { key: 'last_cleaned_at', label: 'Последняя уборка', group: 'Уборки', render: row => row.last_cleaned_at ? formatDate(row.last_cleaned_at) : '—', filterValue: row => row.last_cleaned_at ? formatDateOnly(row.last_cleaned_at) : '—' },
    { key: 'partner', label: 'Партнер', group: 'Уборки', render: row => partnerNameOf(row) || '—' },
    { key: 'planned_wash_date', label: 'Плановая дата', group: 'План', render: row => row.planned_wash_date ? formatDateOnly(row.planned_wash_date) : '—' },
    { key: 'plan_per_month', label: 'План/мес', group: 'План', align: 'right', render: row => row.plan_per_month ?? '—' },
    { key: 'location_type', label: 'Г/П', group: 'Excel', render: row => row.location_type || '—' },
    { key: 'category', label: 'Категория', group: 'Excel', render: row => row.category || '—' },
    { key: 'activity_status', label: 'Активность', group: 'Excel', render: row => row.activity_status || '—' },
    { key: 'availability_status', label: 'Доступен?', group: 'Excel', render: row => row.availability_status || row.on_point_status || '—' },
    { key: 'absence_reason', label: 'Причина отсутствия', group: 'Excel', className: 'wide', render: row => (
      <select
        className={`pst-list-reason-select ${row.absence_reason ? 'pst-list-reason-select--set' : ''}`}
        value={row.absence_reason || ''}
        onClick={e => e.stopPropagation()}
        onChange={e => updateAbsenceReason(row, e.target.value)}
      >
        <option value="">—</option>
        {ABSENCE_REASONS.map(reason => <option key={reason} value={reason}>{reason}</option>)}
      </select>
    ) },
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
  ], [updateAbsenceReason])

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
        if (!values.includes(filterCellValue(col, row))) return false
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

  const addExcelSheet = (wb, sheetRows, sheetName) => {
    const data = sheetRows.map(row => {
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
    XLSX.utils.book_append_sheet(wb, ws, sheetName)
  }

  const handleExportExcel = (mode = 'all') => {
    setExporting(true)
    try {
      // 'remaining' ("снять остатки") — отдельный операционный отчёт по ВСЕМ
      // загруженным постоматам (не только по текущей выборке на экране):
      // ещё не помыли, но точка доступна для мойки.
      const sourceRows = mode === 'remaining'
        ? rows.filter(row => isNotWashed(row) && isAvailable(row))
        : filteredRows

      const wb = XLSX.utils.book_new()

      if (mode === 'remaining') {
        // Один лист на партнёра — удобно раздавать каждой бригаде только её часть остатков.
        const byPartner = new Map()
        sourceRows.forEach(row => {
          const name = partnerNameOf(row) || 'Без партнёра'
          if (!byPartner.has(name)) byPartner.set(name, [])
          byPartner.get(name).push(row)
        })

        const usedSheetNames = new Set()
        ;[...byPartner.entries()]
          .sort(([a], [b]) => a.localeCompare(b, 'ru'))
          .forEach(([name, partnerRows]) => {
            let sheetName = sanitizeSheetName(name)
            let suffix = 2
            while (usedSheetNames.has(sheetName)) sheetName = `${sanitizeSheetName(name).slice(0, 28)} ${suffix++}`
            usedSheetNames.add(sheetName)
            addExcelSheet(wb, partnerRows, sheetName)
          })
      } else {
        addExcelSheet(wb, sourceRows, 'Список')
      }

      const suffix = mode === 'remaining' ? 'ostatki' : 'list'
      XLSX.writeFile(wb, `pst-${suffix}_${new Date().toISOString().slice(0, 10)}.xlsx`)
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
          <PeriodMenu periods={periods} selectedPeriod={selectedPeriod} onSelect={setSelectedPeriod} compact={isMobile} />
          <ExcelMenu
            rows={rows}
            filteredCount={filteredRows.length}
            exporting={exporting}
            disabled={rows.length === 0}
            refreshing={loading || loadingMore}
            degraded={degraded}
            onExport={handleExportExcel}
          />
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
            placeholder={isMobile ? 'Поиск...' : 'Поиск по ID, городу, филиалу, адресу, партнеру'}
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
