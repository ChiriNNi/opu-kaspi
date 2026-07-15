import { useEffect, useState, useCallback, useRef } from 'react'
import api from '../api'
import * as XLSX from 'xlsx'
import JSZip from 'jszip'
import {
  Search, ChevronUp, ChevronDown, ChevronsUpDown,
  X, ArrowLeft, ArrowRight, MapPin, RefreshCw,
  Eye, Building2, Download, ImageDown
} from 'lucide-react'
import DatePicker from '../components/DatePicker'
import { useStore } from '../store'
import './PstReports.css'

const formatDate = (val) => {
  if (!val) return '—'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }).format(new Date(val))
}

const COLUMNS = [
  { key: 'id',              label: 'ID',          width: 55,  sortable: true },
  { key: 'location_id',    label: 'ID поста',    width: 90,  sortable: true },
  { key: 'submitted_at',   label: 'Дата/Время',  width: 140, sortable: true },
  { key: 'city',           label: 'Город',       width: 110, sortable: true },
  { key: 'branch',         label: 'Филиал',      width: 130, sortable: false },
  { key: 'address',        label: 'Адрес',       width: 230, sortable: false },
  { key: 'install_place',  label: 'Тип',         width: 90,  sortable: false },
  { key: 'distance_meters',label: 'Дист.',       width: 65,  sortable: false },
  { key: 'before_count',   label: 'До',          width: 50,  sortable: false },
  { key: 'after_count',    label: 'После',       width: 55,  sortable: false },
  { key: 'work_type',      label: 'Тип работы',  width: 130, sortable: false },
]

async function downloadReportZip(reportId, label = '') {
  const detail = await api.get(`/pst/${reportId}`)
  const d = detail.data.report || detail.data
  const dt = new Date(d.submitted_at)
  const dateStr = `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`
  const timeStr = `${String(dt.getHours()).padStart(2,'0')}-${String(dt.getMinutes()).padStart(2,'0')}`
  const safe = s => String(s || '').replace(/[\/\\:*?"<>|]/g, '').trim()
  const folder = label || `${dateStr}_${timeStr}_ID${safe(d.location_id)}`

  const zip = new JSZip()

  const photoToUrl = (p) => {
    if (p?.driveId) return `https://drive.google.com/uc?export=download&id=${p.driveId}`
    if (p?.path) {
      const rel = p.path.replace('/home/icgroup/uploads/', '')
      return `https://opu.ic-group.kz/api/pst/img?p=${encodeURIComponent(rel)}`
    }
    return p?.dataUrl || null
  }

  const addPhoto = async (p, name) => {
    try {
      const url = photoToUrl(p)
      if (!url) return
      if (url.startsWith('data:')) {
        const [, b64] = url.split(',')
        zip.file(`${folder}/${name}`, b64, { base64: true })
      } else {
        const r = await fetch(url)
        if (r.ok) zip.file(`${folder}/${name}`, await r.blob())
      }
    } catch {}
  }

  await Promise.all([
    ...(d.before_photos || []).map((p, i) => addPhoto(p, `до_${i+1}.jpg`)),
    ...(d.after_photos  || []).map((p, i) => addPhoto(p, `после_${i+1}.jpg`)),
  ])

  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${folder}.zip`
  a.click()
  URL.revokeObjectURL(a.href)
}

function SortIcon({ col, sortBy, sortDir }) {
  if (!col.sortable) return null
  if (sortBy !== col.key) return <ChevronsUpDown size={13} className="sort-icon muted" />
  return sortDir === 'asc'
    ? <ChevronUp size={13} className="sort-icon active" />
    : <ChevronDown size={13} className="sort-icon active" />
}

// Полноэкранный просмотрщик с пинч-зумом (touch), зумом колесом мыши и двойным тапом/кликом.
// Слушатели wheel/touchmove навешаны вручную через addEventListener(passive:false) —
// синтетические onWheel/onTouchMove в React пассивны, и preventDefault() в них не срабатывает,
// из-за чего страница скроллится вместо зума фото.
function ZoomableLightbox({ photos, index, label, onClose }) {
  const [i, setI] = useState(index || 0)
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const pinchRef = useRef(null)
  const stageRef = useRef(null)
  const scaleRef = useRef(1)
  const posRef = useRef({ x: 0, y: 0 })

  useEffect(() => { scaleRef.current = scale }, [scale])
  useEffect(() => { posRef.current = pos }, [pos])

  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }) }
  const prev = (e) => { e?.stopPropagation(); reset(); setI(v => (v - 1 + photos.length) % photos.length) }
  const next = (e) => { e?.stopPropagation(); reset(); setI(v => (v + 1) % photos.length) }

  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, photos.length])

  const clampScale = (s) => Math.min(5, Math.max(1, s))
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  useEffect(() => {
    const el = stageRef.current
    if (!el) return

    const onWheel = (e) => {
      e.preventDefault()
      const next = clampScale(scaleRef.current - e.deltaY * 0.0015)
      setScale(next)
      if (next === 1) setPos({ x: 0, y: 0 })
    }

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        pinchRef.current = { startDist: dist(e.touches), startScale: scaleRef.current }
      } else if (e.touches.length === 1 && scaleRef.current > 1) {
        dragRef.current = { x: e.touches[0].clientX - posRef.current.x, y: e.touches[0].clientY - posRef.current.y }
      }
    }
    const onTouchMove = (e) => {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault()
        const factor = dist(e.touches) / pinchRef.current.startDist
        setScale(clampScale(pinchRef.current.startScale * factor))
      } else if (e.touches.length === 1 && dragRef.current) {
        e.preventDefault()
        setPos({ x: e.touches[0].clientX - dragRef.current.x, y: e.touches[0].clientY - dragRef.current.y })
      }
    }
    const onTouchEnd = (e) => {
      if (e.touches.length < 2) pinchRef.current = null
      if (e.touches.length < 1) dragRef.current = null
      if (scaleRef.current <= 1) setPos({ x: 0, y: 0 })
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  const onDoubleClick = (e) => {
    e.stopPropagation()
    if (scale > 1) reset()
    else setScale(2.5)
  }

  const onMouseDown = (e) => {
    if (scale <= 1) return
    dragRef.current = { x: e.clientX - pos.x, y: e.clientY - pos.y }
  }
  const onMouseMove = (e) => {
    if (!dragRef.current) return
    setPos({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y })
  }
  const onMouseUp = () => { dragRef.current = null }

  return (
    <div className="pg-lightbox" onClick={e => { e.stopPropagation(); onClose() }}>
      <button className="pg-lightbox-close" onClick={e => { e.stopPropagation(); onClose() }}><X size={20} /></button>
      <div
        ref={stageRef}
        className="pg-lightbox-stage"
        onClick={e => e.stopPropagation()}
        onDoubleClick={onDoubleClick}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <img
          src={photos[i].src}
          alt=""
          className="pg-lightbox-img"
          draggable={false}
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
            cursor: scale > 1 ? 'grab' : 'zoom-in',
          }}
        />
      </div>
      {photos.length > 1 && (
        <>
          <button className="pg-lightbox-nav prev" onClick={prev}>‹</button>
          <button className="pg-lightbox-nav next" onClick={next}>›</button>
        </>
      )}
      <div className="pg-lightbox-caption" onClick={e => e.stopPropagation()}>
        {photos[i].caption && <div className="pg-lightbox-caption-text">{photos[i].caption}</div>}
        <div className="pg-lightbox-count">{i + 1} / {photos.length}{label ? ` · ${label}` : ''}</div>
      </div>
    </div>
  )
}

function PhotoModal({ report, onClose }) {
  const [tab, setTab] = useState('before')
  const photos = tab === 'before' ? (report.before_photos ?? []) : (report.after_photos ?? [])
  const [lightbox, setLightbox] = useState(null) // { i }

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">
              {report.location_data?.title || report.location_data?.address || '—'}
            </div>
            <div className="modal-meta">
              <MapPin size={13} /> {report.location_data?.city} · {formatDate(report.submitted_at)}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-info-row">
          {[
            ['ID точки', report.location_id],
            ['Тип', report.location_data?.installPlace],
            ['Категория', report.location_data?.category],
            ['Ячеек', report.location_data?.cellsCount],
            ['Дист.', report.location_data?.distanceMeters ? `${report.location_data.distanceMeters} м` : null],
          ].filter(([, v]) => v).map(([label, val]) => (
            <div key={label} className="modal-info-chip">
              <span className="chip-label">{label}</span>
              <span className="chip-val">{val}</span>
            </div>
          ))}
        </div>

        <div className="modal-tabs">
          <button
            className={`modal-tab ${tab === 'before' ? 'active' : ''}`}
            onClick={() => setTab('before')}
          >
            До уборки ({report.before_photos?.length ?? 0})
          </button>
          <button
            className={`modal-tab ${tab === 'after' ? 'active' : ''}`}
            onClick={() => setTab('after')}
          >
            После уборки ({report.after_photos?.length ?? 0})
          </button>
        </div>

        <div className="modal-photos">
          {photos.length === 0 ? (
            <div className="modal-empty">Нет фотографий</div>
          ) : (
            photos.map((p, i) => {
              const toUrl = (photo) => {
                if (photo?.driveId) return `https://drive.google.com/uc?export=download&id=${photo.driveId}`
                if (photo?.path) {
                  const rel = photo.path.replace('/home/icgroup/uploads/', '')
                  return `/api/pst/img?p=${encodeURIComponent(rel)}`
                }
                return photo?.dataUrl || null
              }
              const src = p?.driveId
                ? `https://drive.google.com/thumbnail?id=${p.driveId}&sz=w400`
                : toUrl(p)
              const full = p?.driveId
                ? `https://drive.google.com/uc?export=view&id=${p.driveId}`
                : toUrl(p)
              return (
                <button key={i} type="button" className="photo-thumb" onClick={() => setLightbox({ i })}>
                  <img src={src} alt={`фото ${i + 1}`} />
                  <div className="photo-size">{p.sizeBytes ? `${Math.round(p.sizeBytes / 1024)} КБ` : p.driveId ? 'Drive' : ''}</div>
                </button>
              )
            })
          )}
        </div>
      </div>
      {lightbox && (
        <ZoomableLightbox
          photos={photos.map(p => {
            const toUrl = (photo) => {
              if (photo?.driveId) return `https://drive.google.com/uc?export=view&id=${photo.driveId}`
              if (photo?.path) {
                const rel = photo.path.replace('/home/icgroup/uploads/', '')
                return `/api/pst/img?p=${encodeURIComponent(rel)}`
              }
              return photo?.dataUrl || null
            }
            return {
              src: toUrl(p),
              caption: `${formatDate(report.submitted_at)} · ${report.location_data?.address || report.location_data?.title || ''}`,
            }
          })}
          index={lightbox.i}
          label={tab === 'before' ? 'До уборки' : 'После уборки'}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

const WORK_TYPES = ['ПОЛНАЯ МОЙКА', 'НАРУЖНЯЯ МОЙКА']

const WT_COLOR = {
  'ИНЦИДЕНТ': '#dc2626',
  'НАРУЖНЯЯ МОЙКА': '#d97706',
  'ПОЛНАЯ МОЙКА': '#5a8a1f',
}

function WorkTypeCell({ row, onUpdate }) {
  const [saving, setSaving] = useState(false)

  const handleChange = async (e) => {
    const wt = e.target.value
    setSaving(true)
    try {
      await api.patch(`/pst/${row.id}/work-type`, { work_type: wt })
      onUpdate(row.id, wt)
    } catch {
      alert('Ошибка при обновлении типа работы')
    } finally {
      setSaving(false)
    }
  }

  const current = row.work_type || 'ПОЛНАЯ МОЙКА'
  return (
    <select
      value={current}
      onChange={handleChange}
      disabled={saving}
      style={{
        fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
        color: WT_COLOR[current] || '#5a8a1f',
        border: 'none', background: 'transparent', cursor: 'pointer',
        padding: '2px 0', outline: 'none', appearance: 'auto',
        opacity: saving ? 0.5 : 1,
      }}
    >
      {WORK_TYPES.map(wt => (
        <option key={wt} value={wt}>{wt}</option>
      ))}
    </select>
  )
}

export default function PstReports() {
  const { user } = useStore()
  const isAdmin = user?.role === 'admin'
  const isAuditor = ['auditor', 'kaspi'].includes(user?.role)
  const [rows, setRows]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [stats, setStats]         = useState(null)
  const [cities, setCities]       = useState([])
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0, limit: 50 })

  const [partners, setPartners]   = useState([])
  const [search, setSearch]       = useState('')
  const [city, setCity]           = useState('')
  const [installPlace, setInstallPlace] = useState('')
  const [locationZone, setLocationZone] = useState('')
  const [partnerFilter, setPartnerFilter] = useState('')
  const [workTypeFilter, setWorkTypeFilter] = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [sortBy, setSortBy]       = useState('submitted_at')
  const [sortDir, setSortDir]     = useState('desc')
  const [page, setPage]           = useState(1)

  const [activeReport, setActiveReport] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [downloadingPhotos, setDownloadingPhotos] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState('')
  const [zipLoadingId, setZipLoadingId] = useState(null)
  const [syncingId, setSyncingId] = useState(null)
  const searchTimer = useRef(null)

  const fetchReports = useCallback(async (params = {}) => {
    setLoading(true)
    setError('')
    try {
      const q = new URLSearchParams({
        page: params.page ?? page,
        limit: 50,
        sortBy: params.sortBy ?? sortBy,
        sortDir: params.sortDir ?? sortDir,
        ...(params.search ?? search ? { search: params.search ?? search } : {}),
        ...(params.city ?? city ? { city: params.city ?? city } : {}),
        ...((params.installPlace ?? installPlace) ? { install_place: params.installPlace ?? installPlace } : {}),
        ...((params.locationZone ?? locationZone) ? { location_zone: params.locationZone ?? locationZone } : {}),
        ...((params.partnerFilter ?? partnerFilter) ? { partner_id: params.partnerFilter ?? partnerFilter } : {}),
        ...((params.workTypeFilter ?? workTypeFilter) ? { work_type: params.workTypeFilter ?? workTypeFilter } : {}),
        ...(params.dateFrom ?? dateFrom ? { dateFrom: params.dateFrom ?? dateFrom } : {}),
        ...(params.dateTo ?? dateTo ? { dateTo: params.dateTo ?? dateTo } : {}),
      })
      const res = await api.get(`/pst?${q}`)
      setRows(res.data.reports)
      setPagination(res.data.pagination)
    } catch (e) {
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [page, sortBy, sortDir, search, city, installPlace, locationZone, partnerFilter, workTypeFilter, dateFrom, dateTo])

  const fetchStats = async () => {
    try {
      const res = await api.get('/pst/stats')
      setStats(res.data)
    } catch {}
  }

  const fetchCities = async () => {
    try {
      const res = await api.get('/pst/cities')
      setCities(res.data.cities)
    } catch {}
  }

  useEffect(() => {
    fetchStats()
    fetchCities()
    api.get('/users').then(r => setPartners((r.data.users || []).filter(u => u.role === 'partner'))).catch(() => {})
  }, [])

  useEffect(() => {
    fetchReports()
  }, [page, sortBy, sortDir, city, installPlace, locationZone, partnerFilter, workTypeFilter, dateFrom, dateTo])

  const handleSearch = (val) => {
    setSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setPage(1)
      fetchReports({ search: val, page: 1 })
    }, 400)
  }

  const handleSort = (col) => {
    if (!col.sortable) return
    if (sortBy === col.key) {
      const next = sortDir === 'desc' ? 'asc' : 'desc'
      setSortDir(next)
      fetchReports({ sortDir: next })
    } else {
      setSortBy(col.key)
      setSortDir('desc')
      fetchReports({ sortBy: col.key, sortDir: 'desc' })
    }
  }

  const openDetail = async (row) => {
    setLoadingDetail(true)
    try {
      const res = await api.get(`/pst/${row.id}`)
      setActiveReport(res.data)
    } catch {
      setActiveReport({ ...row, before_photos: [], after_photos: [] })
    } finally {
      setLoadingDetail(false)
    }
  }

  const handlePageChange = (p) => {
    setPage(p)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const exportToExcel = async () => {
    setExporting(true)
    try {
      const q = new URLSearchParams({
        page: 1, limit: 10000,
        sortBy, sortDir,
        ...(search ? { search } : {}),
        ...(city ? { city } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
      })
      const res = await api.get(`/pst?${q}`)
      const data = res.data.reports.map(r => ({
        '#': r.id,
        'Дата/Время': formatDate(r.submitted_at),
        'ID точки': r.location_id,
        'Город': r.city || '',
        'Тип': r.install_place || '',
        'Тип работы': r.work_type || 'ПОЛНАЯ МОЙКА',
        'Название': r.title || '',
        'Адрес': r.address || '',
        'Ячеек': r.cells_count || '',
        'Дистанция (м)': r.distance_meters ?? '',
        'Фото До': r.before_count,
        'Фото После': r.after_count,
      }))
      const ws = XLSX.utils.json_to_sheet(data)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Отчёты PST')
      const date = new Date().toISOString().slice(0, 10)
      XLSX.writeFile(wb, `pst-reports-${date}.xlsx`)
    } catch { } finally {
      setExporting(false)
    }
  }

  const downloadPhotos = async () => {
    setDownloadingPhotos(true)
    setDownloadProgress('Загрузка списка...')
    try {
      const q = new URLSearchParams({
        page: 1, limit: 10000, sortBy, sortDir,
        ...(search ? { search } : {}),
        ...(city ? { city } : {}),
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
      })
      const res = await api.get(`/pst?${q}`)
      const reports = res.data.reports
      const zip = new JSZip()
      let total = 0
      let done = 0
      reports.forEach(r => {
        total += (r.before_count || 0) + (r.after_count || 0)
      })
      if (total === 0) { alert('Нет фото в выбранных отчётах'); return }

      for (const report of reports) {
        const detail = await api.get(`/pst/${report.id}`)
        const d = detail.data.report
        const dt = new Date(d.submitted_at)
        const dateStr = `${String(dt.getDate()).padStart(2,'0')}.${String(dt.getMonth()+1).padStart(2,'0')}.${dt.getFullYear()}`
        const timeStr = `${String(dt.getHours()).padStart(2,'0')}-${String(dt.getMinutes()).padStart(2,'0')}`
        const city = d.location_data?.city || d.city || ''
        const locName = (d.location_data?.title || d.location_data?.address || d.address || 'unknown').slice(0, 30)
        const locId = `ID${d.location_id || ''}`
        const safe = s => String(s).replace(/[\/\\:*?"<>|]/g, '').trim()
        const folder = `${dateStr} ${timeStr} ${safe(city)} ${safe(locId)} ${safe(locName)}`

        const fetchPhoto = async (url, name) => {
          try {
            const r = await fetch(url)
            const blob = await r.blob()
            zip.file(`${folder}/${name}`, blob)
          } catch {}
          done++
          setDownloadProgress(`${done} / ${total} фото`)
        }

        const beforePhotos = d.before_photos || []
        const afterPhotos = d.after_photos || []
        await Promise.all([
          ...beforePhotos.map((url, i) => fetchPhoto(url.startsWith('http') ? url : `https://opu.ic-group.kz${url}`, `до_${i+1}.jpg`)),
          ...afterPhotos.map((url, i) => fetchPhoto(url.startsWith('http') ? url : `https://opu.ic-group.kz${url}`, `после_${i+1}.jpg`)),
        ])
      }
      setDownloadProgress('Упаковка архива...')
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `pst-photos-${new Date().toISOString().slice(0,10)}.zip`
      a.click()
      URL.revokeObjectURL(a.href)
    } catch (e) {
      alert('Ошибка при скачивании: ' + e.message)
    } finally {
      setDownloadingPhotos(false)
      setDownloadProgress('')
    }
  }

  const resyncReport = async (id) => {
    setSyncingId(id)
    try {
      await api.post(`/pst/${id}/resync`)
      await fetchReports({ search, city, dateFrom, dateTo, page, sortBy, sortDir })
    } catch { alert('Ошибка синхронизации') }
    finally { setSyncingId(null) }
  }

  const resetFilters = () => {
    setSearch(''); setCity(''); setInstallPlace(''); setLocationZone(''); setPartnerFilter(''); setWorkTypeFilter(''); setDateFrom(''); setDateTo('')
    setPage(1)
    fetchReports({ search: '', city: '', installPlace: '', locationZone: '', partnerFilter: '', workTypeFilter: '', dateFrom: '', dateTo: '', page: 1 })
  }

  const hasFilters = search || city || installPlace || locationZone || partnerFilter || workTypeFilter || dateFrom || dateTo

  return (
    <div className="pst-page">
      {/* Stats */}
      {stats && (
        <div className="pst-stats">
          {[
            { label: 'Всего уборок', val: stats.total },
            { label: 'За сегодня',   val: stats.today },
            { label: 'За 7 дней',    val: stats.week },
            { label: 'Локаций',      val: stats.unique_locations },
            { label: 'Городов',      val: stats.unique_cities },
          ].map(({ label, val }) => (
            <div key={label} className="pst-stat-card">
              <div className="pst-stat-val">{val}</div>
              <div className="pst-stat-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="pst-toolbar">
        <div className="toolbar-search">
          <Search size={15} className="toolbar-search-icon" />
          <input
            type="text"
            placeholder="Поиск по адресу, названию, ID..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
          />
          {search && <button className="toolbar-clear" onClick={() => handleSearch('')}><X size={14} /></button>}
        </div>

        <div className="toolbar-filters">
          <div className="filter-group">
            <Building2 size={14} />
            <select value={city} onChange={e => { setCity(e.target.value); setPage(1) }}>
              <option value="">Все города</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="filter-group">
            <select value={locationZone} onChange={e => { setLocationZone(e.target.value); setPage(1) }}>
              <option value="">Г/П</option>
              <option value="город">Город</option>
              <option value="пригород">Пригород</option>
            </select>
          </div>

          <div className="filter-group">
            <select value={installPlace} onChange={e => { setInstallPlace(e.target.value); setPage(1) }}>
              <option value="">Все типы</option>
              <option value="Комнатный">Комнатный</option>
              <option value="Уличный">Уличный</option>
            </select>
          </div>

          {partners.length > 0 && (
            <div className="filter-group">
              <select value={partnerFilter} onChange={e => { setPartnerFilter(e.target.value); setPage(1) }}>
                <option value="">Все партнёры</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </div>
          )}

          <DatePicker value={dateFrom} onChange={v => { setDateFrom(v); setPage(1) }} placeholder="Дата от" />

          <span style={{ fontSize: 12, opacity: 0.5 }}>—</span>

          <DatePicker value={dateTo} onChange={v => { setDateTo(v); setPage(1) }} placeholder="Дата до" />

          {hasFilters && (
            <button className="btn-reset" onClick={resetFilters}>
              <X size={13} /> Сброс
            </button>
          )}

          <button className="btn-refresh" onClick={() => fetchReports()} title="Обновить">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>

          <button className="btn-excel" onClick={exportToExcel} disabled={exporting} title="Выгрузить в Excel">
            <Download size={14} />
            {exporting ? 'Выгрузка...' : 'Excel'}
          </button>

          <div className="filter-group">
            <select value={workTypeFilter} onChange={e => { setWorkTypeFilter(e.target.value); setPage(1) }}>
              <option value="">Все типы мойки</option>
              <option value="ПОЛНАЯ МОЙКА">Полная мойка</option>
              <option value="НАРУЖНЯЯ МОЙКА">Наружняя мойка</option>
              <option value="ИНЦИДЕНТ">Инцидент</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="pst-table-wrap">
        {error && <div className="pst-error">{error}</div>}

        <table className="pst-table">
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  style={{ minWidth: col.width }}
                  className={col.sortable ? 'sortable' : ''}
                  onClick={() => handleSort(col)}
                >
                  <span>{col.label}</span>
                  <SortIcon col={col} sortBy={sortBy} sortDir={sortDir} />
                </th>
              ))}
              <th style={{ minWidth: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={COLUMNS.length + 1} className="table-loading">
                <RefreshCw size={18} className="spin" /> Загрузка...
              </td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={COLUMNS.length + 1} className="table-empty">
                {hasFilters ? 'Ничего не найдено' : 'Нет данных'}
              </td></tr>
            ) : rows.map((row, i) => (
              <tr key={row.id} className={i % 2 === 0 ? 'even' : 'odd'}>
                <td className="cell-num">{row.id}</td>
                <td className="cell-id">
                  <span className="chip-id">{row.location_id}</span>
                </td>
                <td className="cell-date">{formatDate(row.submitted_at)}</td>
                <td>{row.city || '—'}</td>
                <td className="cell-branch" title={row.branch}>{row.branch || '—'}</td>
                <td className="cell-address" title={row.address}>{row.address || '—'}</td>
                <td>
                  {row.install_place
                    ? <span className={`chip-type ${row.install_place === 'Уличный' ? 'outdoor' : 'indoor'}`}>{row.install_place}</span>
                    : '—'}
                </td>
                <td className="cell-num">{row.distance_meters != null ? `${row.distance_meters}` : '—'}</td>
                <td className="cell-photo">
                  <span className={`photo-badge ${row.before_count > 0 ? 'has-photos' : ''}`}>{row.before_count}</span>
                </td>
                <td className="cell-photo">
                  <span className={`photo-badge ${row.after_count > 0 ? 'has-photos' : ''}`}>{row.after_count}</span>
                </td>
                <td>
                  {isAdmin ? (
                    <WorkTypeCell
                      row={row}
                      onUpdate={(id, wt) => setRows(prev => prev.map(r => r.id === id ? { ...r, work_type: wt } : r))}
                    />
                  ) : (
                    <span style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: WT_COLOR[row.work_type] || '#5a8a1f' }}>
                      {row.work_type || 'ПОЛНАЯ МОЙКА'}
                    </span>
                  )}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <button className="btn-view" onClick={() => openDetail(row)} disabled={loadingDetail} title="Просмотр фото">
                      <Eye size={14} />
                    </button>
                    {(row.before_count > 0 || row.after_count > 0) && (
                      <button
                        className="btn-zip-row"
                        disabled={zipLoadingId === row.id}
                        title="Скачать ZIP"
                        onClick={async () => {
                          setZipLoadingId(row.id)
                          try { await downloadReportZip(row.id) } catch { alert('Ошибка ZIP') }
                          finally { setZipLoadingId(null) }
                        }}
                      >
                        {zipLoadingId === row.id ? <RefreshCw size={12} className="spin" /> : <Download size={12} />}
                      </button>
                    )}
                    {!isAuditor && (
                      <button
                        className="btn-sync-row"
                        disabled={syncingId === row.id}
                        title="Синхронизировать с Google Sheets"
                        onClick={() => resyncReport(row.id)}
                      >
                        <RefreshCw size={12} className={syncingId === row.id ? 'spin' : ''} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="pst-pagination">
          <span className="pg-info">
            {((pagination.page - 1) * pagination.limit) + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} из {pagination.total}
          </span>
          <div className="pg-controls">
            <button disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
              <ArrowLeft size={15} />
            </button>
            {Array.from({ length: Math.min(7, pagination.pages) }, (_, i) => {
              const p = pagination.pages <= 7 ? i + 1
                : page <= 4 ? i + 1
                : page >= pagination.pages - 3 ? pagination.pages - 6 + i
                : page - 3 + i
              return (
                <button
                  key={p}
                  className={p === page ? 'active' : ''}
                  onClick={() => handlePageChange(p)}
                >
                  {p}
                </button>
              )
            })}
            <button disabled={page >= pagination.pages} onClick={() => handlePageChange(page + 1)}>
              <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {activeReport && (
        <PhotoModal report={activeReport} onClose={() => setActiveReport(null)} />
      )}
    </div>
  )
}
