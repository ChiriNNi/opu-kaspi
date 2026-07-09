import { useEffect, useState, useCallback, useRef } from 'react'
import api from '../api'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import {
  Search, X, RefreshCw, Building2, ChevronUp, ChevronDown,
  ChevronsUpDown, ArrowLeft, ArrowRight, Pencil, CheckCircle2,
  Circle, Filter, Plus, Trash2, MapPin, History, Download
} from 'lucide-react'
import DatePicker from '../components/DatePicker'
import './Locations.css'

async function downloadReportZip(report, label = '') {
  const detail = await api.get(`/pst/${report.id}`)
  const d = detail.data.report || detail.data
  const dt = new Date(d.submitted_at)
  const dateStr = `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`
  const timeStr = `${String(dt.getHours()).padStart(2,'0')}-${String(dt.getMinutes()).padStart(2,'0')}`
  const safe = s => String(s || '').replace(/[\/\\:*?"<>|]/g, '').trim()
  const folder = label || `${dateStr}_${timeStr}_ID${safe(d.location_id)}`
  const zip = new JSZip()
  const addPhoto = async (p, name) => {
    try {
      const url = p?.dataUrl || p
      if (!url) return
      if (url.startsWith('data:')) { const [,b64] = url.split(','); zip.file(`${folder}/${name}`, b64, { base64: true }) }
      else { const fullUrl = url.startsWith('http') ? url : `https://opu.ic-group.kz${url}`; zip.file(`${folder}/${name}`, await (await fetch(fullUrl)).blob()) }
    } catch {}
  }
  await Promise.all([
    ...(d.before_photos || []).map((p, i) => addPhoto(p, `до_${i+1}.jpg`)),
    ...(d.after_photos  || []).map((p, i) => addPhoto(p, `после_${i+1}.jpg`)),
  ])
  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${folder}.zip`; a.click(); URL.revokeObjectURL(a.href)
}

const fmtDate = (v) => v
  ? new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(v))
  : null

function SortBtn({ col, sortBy, sortDir, onSort }) {
  const active = sortBy === col
  return (
    <span className="sort-btn" onClick={() => onSort(col)}>
      {!active && <ChevronsUpDown size={12} className="si muted" />}
      {active && sortDir === 'desc' && <ChevronDown size={12} className="si active" />}
      {active && sortDir === 'asc' && <ChevronUp size={12} className="si active" />}
    </span>
  )
}

const ALMATY = [43.238949, 76.889709]

let rowCounter = 1
const newRow = () => ({ _key: rowCounter++, id: '', city: '', branch: '', address: '', install_place: '', cells_count: '', lat: null, lng: null })

// ── Map picker popup ─────────────────────────────────────────────────────────
function MapPickerPopup({ initial, onConfirm, onClose }) {
  const [lat, setLat] = useState(initial?.lat != null ? String(initial.lat) : '')
  const [lng, setLng] = useState(initial?.lng != null ? String(initial.lng) : '')
  const [mode, setMode] = useState('map') // 'map' | 'manual'
  const mapRef = useRef(null)
  const leafletRef = useRef(null)
  const markerRef = useRef(null)
  const latRef = useRef(lat)
  const lngRef = useRef(lng)
  latRef.current = lat; lngRef.current = lng

  useEffect(() => {
    if (mode !== 'map') return
    const L = window.L
    if (!L) return
    if (leafletRef.current) { leafletRef.current.invalidateSize(); return }
    const initLat = parseFloat(lat) || ALMATY[0]
    const initLng = parseFloat(lng) || ALMATY[1]
    const zoom = lat ? 15 : 11
    const map = L.map(mapRef.current, { center: [initLat, initLng], zoom })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map)

    const pinIcon = L.divIcon({
      className: '',
      html: `<div style="width:26px;height:26px;border-radius:50%;background:#16a34a;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4)"></div>`,
      iconSize: [26, 26], iconAnchor: [13, 13]
    })

    if (lat && lng) {
      markerRef.current = L.marker([initLat, initLng], { icon: pinIcon }).addTo(map)
    }

    map.on('click', (e) => {
      const { lat: la, lng: lo } = e.latlng
      const la6 = +la.toFixed(6), lo6 = +lo.toFixed(6)
      setLat(String(la6)); setLng(String(lo6))
      if (markerRef.current) markerRef.current.setLatLng([la6, lo6])
      else markerRef.current = L.marker([la6, lo6], { icon: pinIcon }).addTo(map)
    })
    leafletRef.current = map
    return () => { map.remove(); leafletRef.current = null; markerRef.current = null }
  }, [mode])

  const confirm = () => {
    const la = parseFloat(lat), lo = parseFloat(lng)
    onConfirm(isNaN(la) || isNaN(lo) ? { lat: null, lng: null } : { lat: la, lng: lo })
  }

  return (
    <div className="loc-backdrop lp-top" onClick={onClose}>
      <div className="lp-popup" onClick={e => e.stopPropagation()}>
        <div className="lp-head">
          <div className="lp-title">Указать координаты</div>
          <button className="loc-close" onClick={onClose}><X size={15} /></button>
        </div>

        <div className="lp-tabs">
          <button className={`lp-tab ${mode === 'map' ? 'active' : ''}`} onClick={() => setMode('map')}>
            <MapPin size={13} /> Карта
          </button>
          <button className={`lp-tab ${mode === 'manual' ? 'active' : ''}`} onClick={() => setMode('manual')}>
            Ввести вручную
          </button>
        </div>

        {mode === 'map' && (
          <div className="lp-map-wrap">
            <div className="lp-map-hint">Кликните на карте чтобы поставить метку</div>
            <div ref={mapRef} className="lp-map" />
            {lat && lng && (
              <div className="lp-coords-preview">{lat}, {lng}</div>
            )}
          </div>
        )}

        {mode === 'manual' && (
          <div className="lp-manual">
            <label className="lp-label">
              Широта (lat)
              <input className="lp-inp" type="number" step="any" value={lat} onChange={e => setLat(e.target.value)} placeholder="43.238949" />
            </label>
            <label className="lp-label">
              Долгота (lng)
              <input className="lp-inp" type="number" step="any" value={lng} onChange={e => setLng(e.target.value)} placeholder="76.889709" />
            </label>
          </div>
        )}

        <div className="lp-footer">
          {(lat || lng) && (
            <button className="lp-clear" onClick={() => { setLat(''); setLng('') }}>Очистить</button>
          )}
          <button className="loc-btn-cancel" onClick={onClose}>Отмена</button>
          <button className="loc-btn-save" onClick={confirm}>Подтвердить</button>
        </div>
      </div>
    </div>
  )
}

// ── Add modal ────────────────────────────────────────────────────────────────
function AddModal({ onClose, onSaved }) {
  const [rows, setRows] = useState([newRow()])
  const [pickerIdx, setPickerIdx] = useState(null) // which row is open in map picker
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setRow = (idx, patch) => setRows(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r))
  const addRow = () => setRows(rs => [...rs, newRow()])
  const delRow = (idx) => setRows(rs => rs.filter((_, i) => i !== idx))

  const submit = async () => {
    const valid = rows.filter(r => r.id.trim())
    if (!valid.length) { setError('Укажите ID хотя бы одного постомата'); return }
    setSaving(true); setError('')
    try {
      await api.post('/locations/bulk', { items: valid })
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сохранения')
    } finally { setSaving(false) }
  }

  const validCount = rows.filter(r => r.id.trim()).length

  return (
    <div className="loc-backdrop" onClick={onClose}>
      <div className="loc-add-modal" onClick={e => e.stopPropagation()}>
        <div className="loc-modal-head">
          <div className="loc-modal-title">Добавить постоматы</div>
          <button className="loc-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="loc-add-scroll">
          {error && <div className="loc-err" style={{ margin: '0 0 12px' }}>{error}</div>}
          <table className="loc-add-table">
            <thead>
              <tr>
                <th>#</th>
                <th>ID *</th>
                <th>Город</th>
                <th>Магазин</th>
                <th>Адрес</th>
                <th>Тип</th>
                <th>Ячеек</th>
                <th>Координаты</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={r._key} className="loc-add-row">
                  <td className="loc-add-num">{idx + 1}</td>
                  <td><input className="la-inp id" value={r.id} onChange={e => setRow(idx, { id: e.target.value })} placeholder="13725" /></td>
                  <td><input className="la-inp" value={r.city} onChange={e => setRow(idx, { city: e.target.value })} placeholder="Алматы" /></td>
                  <td><input className="la-inp" value={r.branch} onChange={e => setRow(idx, { branch: e.target.value })} placeholder="Магазин" /></td>
                  <td><input className="la-inp addr" value={r.address} onChange={e => setRow(idx, { address: e.target.value })} placeholder="ул. Абая 1" /></td>
                  <td>
                    <select className="la-sel" value={r.install_place} onChange={e => setRow(idx, { install_place: e.target.value })}>
                      <option value="">—</option>
                      <option value="Комнатный">Комнатный</option>
                      <option value="Уличный">Уличный</option>
                    </select>
                  </td>
                  <td><input className="la-inp num" value={r.cells_count} onChange={e => setRow(idx, { cells_count: e.target.value })} placeholder="40" /></td>
                  <td>
                    <button
                      className={`la-coord-btn ${r.lat ? 'has' : ''}`}
                      onClick={() => setPickerIdx(idx)}
                    >
                      <MapPin size={12} />
                      {r.lat ? `${r.lat}, ${r.lng}` : 'Указать'}
                    </button>
                  </td>
                  <td>
                    {rows.length > 1 && (
                      <button className="la-del" onClick={() => delRow(idx)}><Trash2 size={12} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="loc-add-row-btn" onClick={addRow}><Plus size={13} /> Добавить строку</button>
        </div>

        <div className="loc-form-footer">
          <button type="button" className="loc-btn-cancel" onClick={onClose}>Отмена</button>
          <button className="loc-btn-save" onClick={submit} disabled={saving || !validCount}>
            {saving ? 'Сохранение...' : `Добавить${validCount ? ` ${validCount}` : ''} постомат${validCount === 1 ? '' : 'ов'}`}
          </button>
        </div>
      </div>

      {pickerIdx !== null && (
        <MapPickerPopup
          initial={{ lat: rows[pickerIdx]?.lat, lng: rows[pickerIdx]?.lng }}
          onConfirm={({ lat, lng }) => { setRow(pickerIdx, { lat, lng }); setPickerIdx(null) }}
          onClose={() => setPickerIdx(null)}
        />
      )}
    </div>
  )
}

function EditModal({ loc, onClose, onSaved }) {
  const [form, setForm] = useState({
    city: loc.city || '',
    branch: loc.branch || '',
    address: loc.address || '',
    install_place: loc.install_place || '',
    cells_count: loc.cells_count || '',
    category: loc.category || '',
    route_text: loc.route_text || '',
    comment: loc.comment || '',
    hint: loc.hint || '',
    lat: loc.lat ?? null,
    lng: loc.lng ?? null,
    location_type: loc.location_type || '',
    is_spec_route: loc.is_spec_route || false,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await api.put(`/locations/${loc.id}`, form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'Ошибка сохранения')
    } finally { setLoading(false) }
  }

  return (
    <div className="loc-backdrop" onClick={onClose}>
      <div className="loc-modal" onClick={e => e.stopPropagation()}>
        <div className="loc-modal-head">
          <div>
            <div className="loc-modal-title">Редактировать постомат</div>
            <div className="loc-modal-id">ID: {loc.id}</div>
          </div>
          <button className="loc-close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="loc-form">
          {error && <div className="loc-err">{error}</div>}
          <div className="loc-form-row">
            <label>Город<input value={form.city} onChange={e => set('city', e.target.value)} /></label>
            <label>Ветка / Магазин<input value={form.branch} onChange={e => set('branch', e.target.value)} /></label>
          </div>
          <label>Адрес<input value={form.address} onChange={e => set('address', e.target.value)} /></label>
          <div className="loc-form-row">
            <label>Тип установки
              <select value={form.install_place} onChange={e => set('install_place', e.target.value)}>
                <option value="">—</option>
                <option value="Комнатный">Комнатный</option>
                <option value="Уличный">Уличный</option>
              </select>
            </label>
            <label>Ячеек<input value={form.cells_count} onChange={e => set('cells_count', e.target.value)} /></label>
          </div>
          <div className="loc-form-row">
            <label>Город / Пригород
              <select value={form.location_type} onChange={e => set('location_type', e.target.value)}>
                <option value="">—</option>
                <option value="город">Город</option>
                <option value="пригород">Пригород</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              Спец. маршрут
              <button
                type="button"
                className={`loc-toggle ${form.is_spec_route ? 'on' : 'off'}`}
                onClick={() => set('is_spec_route', !form.is_spec_route)}
                style={{ alignSelf: 'flex-start', marginTop: 4 }}
              >
                <span className="loc-toggle-thumb" />
              </button>
            </label>
          </div>
          <div className="loc-form-row">
            <label>Категория<input value={form.category} onChange={e => set('category', e.target.value)} /></label>
            <label>Маршрут<input value={form.route_text} onChange={e => set('route_text', e.target.value)} /></label>
          </div>
          <label>Комментарий<textarea rows={2} value={form.comment} onChange={e => set('comment', e.target.value)} /></label>
          <label>Подсказка<textarea rows={2} value={form.hint} onChange={e => set('hint', e.target.value)} /></label>
          <label>Координаты
            <button
              type="button"
              className={`la-coord-btn ${form.lat ? 'has' : ''}`}
              onClick={() => setPickerOpen(true)}
              style={{ width: '100%', justifyContent: 'flex-start' }}
            >
              <MapPin size={12} />
              {form.lat ? `${form.lat}, ${form.lng}` : 'Указать координаты'}
            </button>
          </label>
          <div className="loc-form-footer">
            <button type="button" className="loc-btn-cancel" onClick={onClose}>Отмена</button>
            <button type="submit" className="loc-btn-save" disabled={loading}>
              {loading ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>

      {pickerOpen && (
        <MapPickerPopup
          initial={{ lat: form.lat, lng: form.lng }}
          onConfirm={({ lat, lng }) => { set('lat', lat); set('lng', lng); setPickerOpen(false) }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}

// ── History Modal ─────────────────────────────────────────────────────────────
function HistoryModal({ loc, onClose }) {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [zipLoadingId, setZipLoadingId] = useState(null)
  const [zipAllLoading, setZipAllLoading] = useState(false)
  const [zipAllProgress, setZipAllProgress] = useState('')

  useEffect(() => {
    api.get(`/pst?location_id=${loc.id}&limit=200&sortBy=submitted_at&sortDir=desc`)
      .then(r => setReports(r.data.reports || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [loc.id])

  const byMonth = reports.reduce((acc, r) => {
    const d = new Date(r.submitted_at)
    const key = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  const handleRowZip = async (r) => {
    setZipLoadingId(r.id)
    try { await downloadReportZip(r) } catch { alert('Ошибка ZIP') }
    finally { setZipLoadingId(null) }
  }

  const handleAllZip = async () => {
    if (!reports.length) return
    setZipAllLoading(true)
    try {
      const zip = new JSZip()
      const addPhotoToZip = async (p, name) => {
        try {
          const url = p?.dataUrl || p
          if (!url) return
          if (url.startsWith('data:')) { const [,b64] = url.split(','); zip.file(name, b64, { base64: true }) }
          else { const fu = url.startsWith('http') ? url : `https://opu.ic-group.kz${url}`; zip.file(name, await (await fetch(fu)).blob()) }
        } catch {}
      }
      for (let i = 0; i < reports.length; i++) {
        const r = reports[i]
        setZipAllProgress(`${i + 1} / ${reports.length}`)
        const detail = await api.get(`/pst/${r.id}`)
        const d = detail.data.report || detail.data
        const dt = new Date(d.submitted_at)
        const folder = `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')} ${String(dt.getHours()).padStart(2,'0')}-${String(dt.getMinutes()).padStart(2,'0')}`
        await Promise.all([
          ...(d.before_photos || []).map((p, j) => addPhotoToZip(p, `${folder}/до_${j+1}.jpg`)),
          ...(d.after_photos  || []).map((p, j) => addPhotoToZip(p, `${folder}/после_${j+1}.jpg`)),
        ])
      }
      setZipAllProgress('Упаковка...')
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `ID${loc.id}_все_уборки.zip`
      a.click(); URL.revokeObjectURL(a.href)
    } catch { alert('Ошибка ZIP') }
    finally { setZipAllLoading(false); setZipAllProgress('') }
  }

  return (
    <div className="loc-backdrop" onClick={onClose}>
      <div className="loc-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="loc-modal-head">
          <div>
            <div className="loc-modal-title">История уборок</div>
            <div className="loc-modal-id">{loc.branch || loc.address} · ID {loc.id}</div>
          </div>
          <button className="loc-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ padding: '16px 20px', maxHeight: 520, overflowY: 'auto' }}>
          {loading ? (
            <div className="loc-empty" style={{ padding: 32 }}><RefreshCw size={16} className="spin" /> Загрузка...</div>
          ) : reports.length === 0 ? (
            <div className="loc-empty" style={{ padding: 32 }}>Уборок не было</div>
          ) : (
            Object.entries(byMonth).map(([month, reps]) => (
              <div key={month} className="hist-month-block">
                <div className="hist-month-label">{month} <span className="hist-month-cnt">{reps.length}</span></div>
                {reps.map(r => {
                  const d = new Date(r.submitted_at)
                  const hasPhotos = (r.before_count > 0 || r.after_count > 0)
                  return (
                    <div key={r.id} className="hist-row">
                      <div className="hist-date">
                        <span className="hist-day">{d.getDate()}</span>
                        <span className="hist-weekday">{d.toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
                      </div>
                      <div className="hist-time">{d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</div>
                      <div className="hist-who">{r.cleaner_name || r.user_phone || '—'}</div>
                      {hasPhotos && (
                        <button
                          className="hist-zip-btn"
                          disabled={zipLoadingId === r.id}
                          onClick={() => handleRowZip(r)}
                          title="Скачать ZIP"
                        >
                          {zipLoadingId === r.id
                            ? <RefreshCw size={11} className="spin" />
                            : <><Download size={11} /> ZIP</>}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div className="loc-form-footer" style={{ borderTop: '1px solid #f1f5f9', padding: '12px 20px' }}>
          <span style={{ fontSize: 13, color: '#94a3b8' }}>Всего: {reports.length} уборок</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {reports.length > 0 && (
              <button className="loc-excel-btn" onClick={handleAllZip} disabled={zipAllLoading}>
                <Download size={13} />
                {zipAllLoading ? (zipAllProgress || 'Скачивание...') : 'Все ZIP'}
              </button>
            )}
            <button className="loc-btn-cancel" onClick={onClose}>Закрыть</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Locations() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 100 })
  const [cities, setCities] = useState([])
  const [partners, setPartners] = useState([])

  const [search, setSearch] = useState('')
  const [city, setCity] = useState('')
  const [installPlace, setInstallPlace] = useState('')
  const [cleaned, setCleaned] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [partnerFilter, setPartnerFilter] = useState('')
  const [sortBy, setSortBy] = useState('last_cleaned_at')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)

  const [editLoc, setEditLoc] = useState(null)
  const [historyLoc, setHistoryLoc] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [editingPlan, setEditingPlan] = useState(null) // { id, value }
  const [bulkPlanModal, setBulkPlanModal] = useState(false)
  const [bulkPlanValue, setBulkPlanValue] = useState('')
  const [bulkPlanSaving, setBulkPlanSaving] = useState(false)
  const [viewMode, setViewMode] = useState('table') // 'table' | 'planning'
  const [cityPlans, setCityPlans] = useState([])
  const [cityPlansLoading, setCityPlansLoading] = useState(false)
  const [planSearch, setPlanSearch] = useState('')
  const [routeModal, setRouteModal] = useState(null) // { city, brigades }
  const [routeStartDate, setRouteStartDate] = useState('')
  const [routeItems, setRouteItems] = useState([])
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeSelected, setRouteSelected] = useState(new Set())
  const [routeFilter, setRouteFilter] = useState('uncleaned') // 'all' | 'uncleaned' | 'cleaned'
  const [routeSearch, setRouteSearch] = useState('')
  const searchTimer = useRef(null)

  const fetch = useCallback(async (overrides = {}) => {
    setLoading(true)
    try {
      const p = {
        page: overrides.page ?? page,
        limit: 100,
        sortBy: overrides.sortBy ?? sortBy,
        sortDir: overrides.sortDir ?? sortDir,
        search: overrides.search ?? search,
        city: overrides.city ?? city,
        install_place: overrides.installPlace ?? installPlace,
        cleaned: overrides.cleaned ?? cleaned,
        date_from: overrides.dateFrom ?? dateFrom,
        date_to: overrides.dateTo ?? dateTo,
        partner_id: overrides.partnerFilter ?? partnerFilter,
        active_filter: overrides.activeFilter ?? activeFilter,
      }
      const q = new URLSearchParams(Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '')))
      const res = await api.get(`/locations?${q}`)
      setRows(res.data.locations)
      setPagination(res.data.pagination)
    } catch { } finally { setLoading(false) }
  }, [page, sortBy, sortDir, search, city, installPlace, cleaned, dateFrom, dateTo, partnerFilter, activeFilter])

  useEffect(() => { fetch() }, [page, sortBy, sortDir, city, installPlace, cleaned, dateFrom, dateTo, partnerFilter, activeFilter])

  useEffect(() => {
    api.get('/locations/cities').then(r => setCities(r.data.cities)).catch(() => {})
    api.get('/users').then(r => setPartners((r.data.users || []).filter(u => u.role === 'partner'))).catch(() => {})
  }, [])

  const handleSearch = (val) => {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setPage(1); fetch({ search: val, page: 1 }) }, 400)
  }

  const handleSort = (col) => {
    if (sortBy === col) {
      const next = sortDir === 'desc' ? 'asc' : 'desc'
      setSortDir(next); fetch({ sortDir: next })
    } else {
      setSortBy(col); setSortDir('desc'); fetch({ sortBy: col, sortDir: 'desc' })
    }
  }

  const savePlan = async (id, value) => {
    const val = value === '' ? null : parseInt(value)
    if (val !== null && (isNaN(val) || val < 0)) { setEditingPlan(null); return }
    setRows(prev => prev.map(r => r.id === id ? { ...r, plan_per_month: val } : r))
    setEditingPlan(null)
    try { await api.patch(`/locations/${id}/plan`, { plan_per_month: val }) } catch {}
  }

  const openRouteModal = async (cityPlan) => {
    setRouteModal(cityPlan)
    setRouteFilter('uncleaned')
    setRouteSearch('')
    setRouteLoading(true)
    try {
      const q = new URLSearchParams({ city: cityPlan.city, limit: 100000, page: 1 })
      const res = await api.get(`/locations?${q}`)
      const items = res.data.locations || []
      setRouteItems(items)
      // Auto-select never-cleaned
      setRouteSelected(new Set(items.filter(r => r.cleanings_count === 0).map(r => r.id)))
    } catch {} finally { setRouteLoading(false) }
  }

  const toggleRouteItem = (id) => {
    setRouteSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const loadCityPlans = async () => {
    setCityPlansLoading(true)
    try {
      const res = await api.get('/locations/city-plans')
      setCityPlans(res.data.cities || [])
    } catch {} finally { setCityPlansLoading(false) }
  }

  const setBrigades = async (city, val) => {
    const n = Math.max(1, val)
    setCityPlans(prev => prev.map(c => c.city === city ? { ...c, brigades: n } : c))
    try { await api.put(`/locations/city-plans/${encodeURIComponent(city)}`, { brigades: n }) } catch {}
  }

  const saveBulkPlan = async () => {
    setBulkPlanSaving(true)
    try {
      const ids = rows.map(r => r.id)
      const val = bulkPlanValue === '' ? null : parseInt(bulkPlanValue)
      await api.patch('/locations/bulk-plan', { ids, plan_per_month: val })
      setRows(prev => prev.map(r => ids.includes(r.id) ? { ...r, plan_per_month: val } : r))
      setBulkPlanModal(false)
      setBulkPlanValue('')
    } catch {} finally { setBulkPlanSaving(false) }
  }

  const toggleActive = async (loc) => {
    const next = loc.is_active === false ? true : false
    setRows(prev => prev.map(r => r.id === loc.id ? { ...r, is_active: next } : r))
    try {
      await api.patch(`/locations/${loc.id}/active`, { is_active: next })
    } catch {
      setRows(prev => prev.map(r => r.id === loc.id ? { ...r, is_active: loc.is_active } : r))
    }
  }

  const exportExcel = async () => {
    setExporting(true)
    try {
      const q = new URLSearchParams({ page: 1, limit: 100000, sortBy, sortDir, search, city, install_place: installPlace, cleaned })
      const res = await api.get(`/locations?${q}`)
      const data = (res.data.locations || []).map(r => ({
        'ID': r.id,
        'Город': r.city || '',
        'Магазин': r.branch || '',
        'Адрес': r.address || '',
        'Тип': r.install_place || '',
        'Ячеек': r.cells_count || '',
        'Всего уборок': r.cleanings_count || 0,
        'Последняя уборка': r.last_cleaned_at ? new Date(r.last_cleaned_at).toLocaleString('ru-RU') : '',
        'Партнёр': r.last_cleaned_by || '',
        'Подсказка': r.hint || '',
      }))
      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Постоматы')
      const colWidths = [10, 18, 20, 32, 12, 8, 14, 22, 18, 30]
      ws['!cols'] = colWidths.map(w => ({ wch: w }))
      XLSX.writeFile(wb, `postomaty_${new Date().toISOString().slice(0, 10)}.xlsx`)
    } catch (e) {
      alert('Ошибка экспорта')
    } finally { setExporting(false) }
  }

  const reset = () => {
    setSearch(''); setCity(''); setInstallPlace(''); setCleaned(''); setDateFrom(''); setDateTo(''); setPartnerFilter(''); setActiveFilter(''); setPage(1)
    fetch({ search: '', city: '', installPlace: '', cleaned: '', dateFrom: '', dateTo: '', partnerFilter: '', activeFilter: '', page: 1 })
  }

  const hasFilters = search || city || installPlace || cleaned || dateFrom || dateTo || partnerFilter || activeFilter

  const th = (label, col) => (
    <th className={col ? 'sortable' : ''} onClick={col ? () => handleSort(col) : undefined}>
      {label}{col && <SortBtn col={col} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />}
    </th>
  )

  return (
    <div className="loc-page">
      {/* Header */}
      <div className="loc-header">
        <div>
          <h1>Постоматы</h1>
          <p>{pagination.total.toLocaleString('ru-RU')} локаций</p>
        </div>
        <div className="loc-header-right">
          <div className="loc-view-switch">
            <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>Список</button>
            <button className={viewMode === 'planning' ? 'active' : ''} onClick={() => { setViewMode('planning'); loadCityPlans() }}>Планирование</button>
          </div>
          {viewMode === 'table' && <>
            <button className="loc-excel-btn" onClick={exportExcel} disabled={exporting}>
              <Download size={14} /> {exporting ? 'Выгрузка...' : 'Excel'}
            </button>
            <button className="loc-plan-btn" onClick={() => { setBulkPlanValue(''); setBulkPlanModal(true) }}>
              Установить план
            </button>
            <button className="loc-add-btn" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Добавить
            </button>
          </>}
          <button className="loc-refresh" onClick={() => viewMode === 'table' ? fetch() : loadCityPlans()} title="Обновить">
            <RefreshCw size={14} className={(loading || cityPlansLoading) ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      {viewMode === 'table' && <div className="loc-toolbar">
        <div className="loc-search">
          <Search size={14} className="loc-search-ico" />
          <input
            placeholder="Поиск по адресу, ID, магазину..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
          {search && <button className="loc-search-clr" onClick={() => handleSearch('')}><X size={13} /></button>}
        </div>

        <div className="loc-filters">
          <div className="lf-group">
            <Building2 size={13} />
            <select value={city} onChange={e => { setCity(e.target.value); setPage(1) }}>
              <option value="">Все города</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="lf-group">
            <Filter size={13} />
            <select value={activeFilter} onChange={e => { setActiveFilter(e.target.value); setPage(1) }}>
              <option value="">Все</option>
              <option value="active">Активные</option>
              <option value="inactive">Неактивные</option>
            </select>
          </div>

          <div className="lf-group">
            <CheckCircle2 size={13} />
            <select value={cleaned} onChange={e => { setCleaned(e.target.value); setPage(1) }}>
              <option value="">Все</option>
              <option value="yes">Есть уборки</option>
              <option value="no">Не убирали</option>
            </select>
          </div>

          <DatePicker value={dateFrom} onChange={v => { setDateFrom(v); setPage(1) }} placeholder="Мойка с" />
          <span style={{ opacity: 0.4, fontSize: 12 }}>—</span>
          <DatePicker value={dateTo} onChange={v => { setDateTo(v); setPage(1) }} placeholder="Мойка по" />

          {partners.length > 0 && (
            <div className="lf-group">
              <select value={partnerFilter} onChange={e => { setPartnerFilter(e.target.value); setPage(1) }}>
                <option value="">Все партнёры</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          )}

          {hasFilters && (
            <button className="loc-reset" onClick={reset}>
              <X size={12} /> Сброс
            </button>
          )}
        </div>
      </div>}

      {/* Planning view */}
      {viewMode === 'planning' && (
        <div className="loc-planning">
          {cityPlansLoading && <div className="loc-empty" style={{ padding: 40 }}>Загрузка...</div>}
          {!cityPlansLoading && (() => {
            const filteredPlans = planSearch
              ? cityPlans.filter(c => c.city?.toLowerCase().includes(planSearch.toLowerCase()))
              : cityPlans
            const shortageCount = filteredPlans.filter(c => c.brigades < c.brigades_auto).length
            return (
              <>
                <div className="lp-summary">
                  <div className="lp-sum-card">
                    <span>{cityPlans.length}</span>
                    <label>Городов</label>
                  </div>
                  <div className="lp-sum-card">
                    <span>{cityPlans.reduce((s, c) => s + c.total, 0).toLocaleString('ru-RU')}</span>
                    <label>Постоматов</label>
                  </div>
                  <div className="lp-sum-card">
                    <span>{cityPlans.reduce((s, c) => s + c.brigades, 0)}</span>
                    <label>Бригад всего</label>
                  </div>
                  {shortageCount > 0 && (
                    <div className="lp-sum-card shortage-card">
                      <span>{shortageCount}</span>
                      <label>Нехватка бригад</label>
                    </div>
                  )}
                </div>

                <div className="lp-table-wrap">
                  <div className="lp-table-toolbar">
                    <input
                      className="lp-city-search"
                      placeholder="Поиск города..."
                      value={planSearch}
                      onChange={e => setPlanSearch(e.target.value)}
                    />
                    <span className="lp-table-count">{filteredPlans.length} городов</span>
                  </div>
                  <table className="lp-table">
                    <thead>
                      <tr>
                        <th>Город</th>
                        <th>Объектов</th>
                        <th>Бригад</th>
                        <th>Авто</th>
                        <th>Объектов / бригаду</th>
                        <th>В день</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPlans.map(c => {
                        const perBrigade = Math.round(c.total / c.brigades)
                        const shortage = c.brigades < c.brigades_auto
                        return (
                          <tr key={c.city} className={shortage ? 'lp-row-shortage' : ''}>
                            <td className="lp-td-city">
                              {c.city}
                              {shortage && <span className="lp-shortage-badge">↑ +{c.brigades_auto - c.brigades}</span>}
                            </td>
                            <td className="lp-td-num">{c.total.toLocaleString('ru-RU')}</td>
                            <td className="lp-td-ctrl">
                              <div className="lp-brigade-ctrl">
                                <button onClick={() => setBrigades(c.city, c.brigades - 1)} disabled={c.brigades <= 1}>−</button>
                                <span className="lp-brigade-val">{c.brigades}</span>
                                <button onClick={() => setBrigades(c.city, c.brigades + 1)}>+</button>
                              </div>
                            </td>
                            <td className="lp-td-auto">{c.brigades_auto}</td>
                            <td className="lp-td-num">{perBrigade}</td>
                            <td className="lp-td-num">{Math.round(perBrigade / 26)}</td>
                            <td>
                              <button className="lp-route-link" onClick={() => openRouteModal(c)}>
                                Адреса →
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )
          })()}
        </div>
      )}

      {/* Table */}
      {viewMode === 'table' && <div className="loc-table-wrap">
        <table className="loc-table">
          <thead>
            <tr>
              {th('ID', 'id')}
              {th('Город', 'city')}
              {th('Г/П', null)}
              {th('Адрес / Магазин', 'address')}
              {th('Тип', 'install_place')}
              {th('Ячеек', 'cells_count')}
              {th('Уборок', 'cleanings_count')}
              {th('Последняя уборка', 'last_cleaned_at')}
              <th>Партнёр</th>
              <th>Подсказка</th>
              <th>План/мес</th>
              <th>Активен</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && rows.length === 0 ? (
              <tr><td colSpan={13} className="loc-empty"><RefreshCw size={16} className="spin" /> Загрузка...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={13} className="loc-empty">Ничего не найдено</td></tr>
            ) : rows.map(r => {
              const lastDate = fmtDate(r.last_cleaned_at)
              const hasCleaned = r.cleanings_count > 0
              return (
                <tr key={r.id}>
                  <td><span className="loc-chip-id">{r.id}</span></td>
                  <td className="loc-city">{r.city || '—'}</td>
                  <td>
                    {r.location_type && (
                      <span className={`loc-zone-badge ${r.location_type === 'пригород' ? 'suburb' : 'city'}`}>
                        {r.location_type === 'пригород' ? 'приг' : 'гор'}
                      </span>
                    )}
                  </td>
                  <td className="loc-addr">
                    <div className="loc-branch">{r.branch || ''}</div>
                    <div className="loc-address">{r.address || '—'}</div>
                  </td>
                  <td>
                    {r.install_place && (
                      <span className={`loc-type ${r.install_place === 'Уличный' ? 'outdoor' : 'indoor'}`}>
                        {r.install_place}
                      </span>
                    )}
                  </td>
                  <td className="loc-num">{r.cells_count || '—'}</td>
                  <td className="loc-num">
                    <span className={`loc-cnt ${hasCleaned ? 'has' : ''}`}>{r.cleanings_count}</span>
                  </td>
                  <td className="loc-date">
                    {lastDate
                      ? <span className="loc-last-date">{lastDate}</span>
                      : <span className="loc-never">—</span>}
                  </td>
                  <td className="loc-who">{r.last_cleaned_by || (hasCleaned ? '—' : '')}</td>
                  <td className="loc-hint-cell">{r.hint || '—'}</td>
                  <td className="loc-plan-cell" onClick={() => setEditingPlan({ id: r.id, value: r.plan_per_month ?? '' })}>
                    {editingPlan?.id === r.id ? (
                      <input
                        className="loc-plan-input"
                        autoFocus
                        type="number"
                        min="0"
                        value={editingPlan.value}
                        onChange={e => setEditingPlan(p => ({ ...p, value: e.target.value }))}
                        onBlur={e => savePlan(r.id, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') savePlan(r.id, editingPlan.value)
                          if (e.key === 'Escape') setEditingPlan(null)
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span className={`loc-plan-val ${r.plan_per_month ? 'set' : 'empty'}`}>
                        {r.plan_per_month ?? '—'}
                      </span>
                    )}
                  </td>
                  <td>
                    <button
                      className={`loc-toggle ${r.is_active !== false ? 'on' : 'off'}`}
                      onClick={() => toggleActive(r)}
                      title={r.is_active !== false ? 'Деактивировать' : 'Активировать'}
                    >
                      <span className="loc-toggle-thumb" />
                    </button>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {r.cleanings_count > 0 && (
                        <button className="loc-edit-btn hist" onClick={() => setHistoryLoc(r)} title="История уборок">
                          <History size={13} />
                        </button>
                      )}
                      <button className="loc-edit-btn" onClick={() => setEditLoc(r)} title="Редактировать">
                        <Pencil size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>}

      {/* Pagination */}
      {viewMode === 'table' && pagination.pages > 1 && (
        <div className="loc-pagination">
          <span className="loc-pg-info">
            {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} из {pagination.total.toLocaleString('ru-RU')}
          </span>
          <div className="loc-pg-btns">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ArrowLeft size={14} /></button>
            {Array.from({ length: Math.min(7, pagination.pages) }, (_, i) => {
              const p = pagination.pages <= 7 ? i + 1
                : page <= 4 ? i + 1
                : page >= pagination.pages - 3 ? pagination.pages - 6 + i
                : page - 3 + i
              return (
                <button key={p} className={p === page ? 'active' : ''} onClick={() => setPage(p)}>{p}</button>
              )
            })}
            <button disabled={page >= pagination.pages} onClick={() => setPage(p => p + 1)}><ArrowRight size={14} /></button>
          </div>
        </div>
      )}

      {showAdd && (
        <AddModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); fetch() }}
        />
      )}
      {editLoc && (
        <EditModal
          loc={editLoc}
          onClose={() => setEditLoc(null)}
          onSaved={() => { setEditLoc(null); fetch() }}
        />
      )}
      {historyLoc && (
        <HistoryModal loc={historyLoc} onClose={() => setHistoryLoc(null)} />
      )}

      {routeModal && (() => {
        const brigades = routeModal.brigades
        const filtered = routeItems.filter(r => {
          if (routeFilter === 'uncleaned' && r.cleanings_count > 0) return false
          if (routeFilter === 'cleaned'   && r.cleanings_count === 0) return false
          if (routeSearch) {
            const q = routeSearch.toLowerCase()
            if (!`${r.id} ${r.branch || ''} ${r.address || ''}`.toLowerCase().includes(q)) return false
          }
          return true
        })
        const selCount = routeSelected.size
        const perBrigade = brigades > 0 ? Math.ceil(selCount / brigades) : selCount
        // Distribute selected into brigade groups
        const selectedArr = routeItems.filter(r => routeSelected.has(r.id))
        const brigadeGroups = Array.from({ length: brigades }, (_, i) =>
          selectedArr.slice(i * perBrigade, (i + 1) * perBrigade)
        )
        return (
          <div className="modal-overlay" onClick={() => setRouteModal(null)}>
            <div className="route-modal" onClick={e => e.stopPropagation()}>
              <div className="route-modal-header">
                <div>
                  <div className="route-modal-city">{routeModal.city}</div>
                  <div className="route-modal-sub">
                    Выбрано: <strong>{selCount}</strong> из {routeItems.length} · {brigades} бр. · ~{perBrigade}/бригаду
                  </div>
                </div>
                <div className="route-date-wrap">
                  <label className="route-date-label">Начало маршрута</label>
                  <DatePicker value={routeStartDate} onChange={setRouteStartDate} placeholder="Выберите дату" />
                </div>
                <button className="modal-close" onClick={() => setRouteModal(null)}>✕</button>
              </div>

              <div className="route-modal-toolbar">
                <div className="route-filter-tabs">
                  {[['uncleaned','Не мыли'], ['cleaned','Помыли'], ['all','Все']].map(([k,l]) => (
                    <button key={k} className={routeFilter === k ? 'active' : ''} onClick={() => setRouteFilter(k)}>{l}</button>
                  ))}
                </div>
                <input
                  className="route-search"
                  placeholder="Поиск по адресу, ID..."
                  value={routeSearch}
                  onChange={e => setRouteSearch(e.target.value)}
                />
                <div style={{ display:'flex', gap:6, marginLeft:'auto' }}>
                  <button className="route-sel-btn" onClick={() => setRouteSelected(new Set(filtered.map(r => r.id)))}>
                    Выбрать все
                  </button>
                  <button className="route-sel-btn" onClick={() => {
                    setRouteSelected(prev => {
                      const s = new Set(prev)
                      filtered.forEach(r => s.delete(r.id))
                      return s
                    })
                  }}>
                    Снять
                  </button>
                </div>
              </div>

              <div className="route-modal-body">
                {routeLoading ? (
                  <div className="loc-empty" style={{ padding: 40 }}>Загрузка...</div>
                ) : (
                  <div className="route-modal-cols">
                    {/* Left: list */}
                    <div className="route-list">
                      {filtered.length === 0 && <div className="loc-empty">Ничего не найдено</div>}
                      {filtered.map(r => (
                        <label key={r.id} className={`route-item ${routeSelected.has(r.id) ? 'sel' : ''}`}>
                          <input type="checkbox" checked={routeSelected.has(r.id)} onChange={() => toggleRouteItem(r.id)} />
                          <div className="route-item-info">
                            <span className="route-item-id">ID {r.id}</span>
                            <span className="route-item-addr">{r.branch ? `${r.branch} — ` : ''}{r.address}</span>
                            {r.cleanings_count > 0
                              ? <span className="route-item-stat cleaned">помыли {r.cleanings_count}×</span>
                              : <span className="route-item-stat new">не мыли</span>}
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* Right: pivot table — rows=days, cols=brigades */}
                    {selCount > 0 && (() => {
                      // brigadeGroups[b] = array of items for brigade b
                      // split each brigade into days of 15
                      const brigadeDays = brigadeGroups.map(grp => {
                        const days = []
                        for (let i = 0; i < grp.length; i += 15) days.push(grp.slice(i, i + 15))
                        return days
                      })
                      const maxDays = Math.max(...brigadeDays.map(d => d.length), 0)
                      const fmtDay = (dIdx) => {
                        if (!routeStartDate) return `День ${dIdx + 1}`
                        const d = new Date(routeStartDate)
                        d.setDate(d.getDate() + dIdx)
                        return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
                      }
                      return (
                        <div className="route-tbl-wrap">
                          <table className="route-tbl">
                            <thead>
                              <tr>
                                <th className="rt-th-date">Дата</th>
                                {brigadeGroups.map((_, bIdx) => (
                                  <th key={bIdx} className="rt-th-brig">Бригада {bIdx + 1}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {Array.from({ length: maxDays }, (_, dIdx) => (
                                <tr key={dIdx} className={dIdx % 2 === 1 ? 'rt-even' : ''}>
                                  <td className="rt-date-cell">{fmtDay(dIdx)}</td>
                                  {brigadeDays.map((days, bIdx) => {
                                    const dayItems = days[dIdx] || []
                                    return (
                                      <td key={bIdx} className="rt-cell">
                                        {dayItems.map(r => (
                                          <div key={r.id} className="rt-obj">
                                            <span className="rt-obj-id">{r.id}</span>
                                            <span className="rt-obj-name">{r.branch || r.address || ''}</span>
                                          </div>
                                        ))}
                                        {dayItems.length === 0 && <span className="rt-empty">—</span>}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {bulkPlanModal && (
        <div className="modal-overlay" onClick={() => setBulkPlanModal(false)}>
          <div className="modal-box" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Установить план</span>
              <button className="modal-close" onClick={() => setBulkPlanModal(false)}>✕</button>
            </div>
            <div style={{ padding: '16px 20px 20px' }}>
              <p style={{ margin: '0 0 6px', fontSize: 13, color: 'rgba(26,29,30,0.55)', lineHeight: 1.5 }}>
                Установит план для <strong>{rows.length.toLocaleString('ru-RU')}</strong> постоматов
                {partnerFilter ? <span style={{ color: '#8fc640', fontWeight: 700 }}> партнёра «{partners.find(p=>String(p.id)===String(partnerFilter))?.full_name}»</span>
                  : city ? <span style={{ color: '#8fc640', fontWeight: 700 }}> города «{city}»</span>
                  : ' в текущем фильтре'}.
              </p>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: 'rgba(26,29,30,0.4)' }}>
                Оставьте пустым чтобы сбросить план.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="number"
                  min="0"
                  placeholder="Кол-во уборок в месяц"
                  value={bulkPlanValue}
                  onChange={e => setBulkPlanValue(e.target.value)}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && saveBulkPlan()}
                  style={{
                    flex: 1, padding: '10px 12px', border: '1.5px solid rgba(26,29,30,0.12)',
                    borderRadius: 10, fontSize: 14, fontFamily: 'inherit', outline: 'none',
                    background: '#f8f9f5'
                  }}
                />
                <button
                  onClick={saveBulkPlan}
                  disabled={bulkPlanSaving}
                  style={{
                    padding: '10px 18px', background: '#1A1D1E', color: '#fff',
                    border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13,
                    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap'
                  }}
                >
                  {bulkPlanSaving ? '...' : 'Сохранить'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {[1,2,4,8,12].map(n => (
                  <button key={n} onClick={() => setBulkPlanValue(String(n))} style={{
                    padding: '4px 12px', background: bulkPlanValue === String(n) ? '#1A1D1E' : 'rgba(26,29,30,0.06)',
                    color: bulkPlanValue === String(n) ? '#fff' : '#1A1D1E',
                    border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit'
                  }}>{n}×/мес</button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
