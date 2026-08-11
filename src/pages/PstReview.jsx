import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, Building2, CalendarClock, Eye, Image,
  MapPin, RefreshCw, Search, X
} from 'lucide-react'
import api from '../api'
import DatePicker from '../components/DatePicker'
import { useStore } from '../store'
import './PstReports.css'
import './PstReview.css'

const isoDateAlmaty = (value) => {
  if (!value) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const get = type => parts.find(p => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const formatDate = (value) => {
  if (!value) return '—'
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-')
    return `${day}.${month}.${year}`
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const photoUrl = (photo, mode = 'thumb') => {
  if (photo?.driveId) {
    const size = mode === 'thumb' ? 'w600' : 'w2400'
    return `https://drive.google.com/thumbnail?id=${photo.driveId}&sz=${size}`
  }
  if (photo?.path) {
    const rel = photo.path.replace('/home/icgroup/uploads/', '')
    return `/api/pst/img?p=${encodeURIComponent(rel)}`
  }
  return typeof photo === 'string' ? photo : photo?.dataUrl || null
}

function PhotoLightbox({ photos, index, label, onClose }) {
  const [current, setCurrent] = useState(index || 0)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') setCurrent(v => (v - 1 + photos.length) % photos.length)
      if (e.key === 'ArrowRight') setCurrent(v => (v + 1) % photos.length)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, photos.length])

  if (!photos.length) return null

  return (
    <div className="pr-lightbox" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <button type="button" className="pr-lightbox-close" onClick={(e) => { e.stopPropagation(); onClose() }}><X size={20} /></button>
      {photos.length > 1 && (
        <>
          <button type="button" className="pr-lightbox-nav prev" onClick={e => { e.stopPropagation(); setCurrent(v => (v - 1 + photos.length) % photos.length) }}>‹</button>
          <button type="button" className="pr-lightbox-nav next" onClick={e => { e.stopPropagation(); setCurrent(v => (v + 1) % photos.length) }}>›</button>
        </>
      )}
      <img className="pr-lightbox-img" src={photos[current].src} alt="" onClick={e => e.stopPropagation()} />
      <div className="pr-lightbox-count" onClick={e => e.stopPropagation()}>
        {current + 1} / {photos.length}{label ? ` · ${label}` : ''}
      </div>
    </div>
  )
}

function PhotoModal({ report, sourceRow, isAdmin, onReportUpdate, onClose }) {
  const [tab, setTab] = useState('before')
  const [lightbox, setLightbox] = useState(null)
  const [savingPhoto, setSavingPhoto] = useState('')
  const before = report.before_photos || []
  const after = report.after_photos || []
  const driveAll = report.drive_photos || []
  const reportPostomatId = String(sourceRow.postomat_id || report.location_id || report.location_data?.id || '')
  const isReportDrivePhoto = (photo) => !photo?.postomatId || String(photo.postomatId) === reportPostomatId
  const drive = (isAdmin ? driveAll : driveAll.filter(p => !p?.hidden)).filter(isReportDrivePhoto)
  const driveBefore = drive.filter(p => p.section === 'before')
  const driveAfter = drive.filter(p => p.section === 'after')
  const hiddenDriveCount = driveAll.filter(p => p?.hidden).length
  const photos = tab === 'before'
    ? [...before, ...driveBefore]
    : tab === 'after'
      ? [...after, ...driveAfter]
      : drive
  const loc = report.location_data || {}

  const toggleDrivePhoto = async (photo, e) => {
    e.stopPropagation()
    if (!photo?.driveId || savingPhoto) return
    const hidden = !photo.hidden
    setSavingPhoto(photo.driveId)
    try {
      const res = await api.patch(`/pst/${report.id}/drive-photo-visibility`, { driveId: photo.driveId, hidden })
      const updated = { ...report, drive_photos: res.data.drive_photos || [] }
      onReportUpdate?.(updated)
    } finally {
      setSavingPhoto('')
    }
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const lightboxPhotos = photos.map(p => ({ src: photoUrl(p, 'full') })).filter(p => p.src)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card pr-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="modal-title">{sourceRow.address || loc.address || `POSTOMAT ${sourceRow.postomat_id}`}</div>
            <div className="modal-meta">
              <MapPin size={13} /> {sourceRow.city || loc.city || '—'} · дата из Excel: {formatDate(sourceRow.last_cleaned_date)}
            </div>
          </div>
          <button type="button" className="modal-close" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="modal-info-row">
          {[
            ['POSTOMAT_ID', sourceRow.postomat_id],
            ['Тип мойки', report.work_type],
            ['Дата отчета', formatDate(report.submitted_at)],
            ['Отчет ID', report.id],
            ['Филиал', sourceRow.branch || loc.branch],
          ].filter(([, value]) => value).map(([label, value]) => (
            <div key={label} className="modal-info-chip">
              <span className="chip-label">{label}</span>
              <span className="chip-val">{value}</span>
            </div>
          ))}
        </div>

        <div className="modal-tabs">
          <button type="button" className={`modal-tab ${tab === 'before' ? 'active' : ''}`} onClick={() => setTab('before')}>
            До уборки ({before.length + driveBefore.length})
          </button>
          <button type="button" className={`modal-tab ${tab === 'after' ? 'active' : ''}`} onClick={() => setTab('after')}>
            После уборки ({after.length + driveAfter.length})
          </button>
          {drive.length > 0 && (
            <button type="button" className={`modal-tab ${tab === 'drive' ? 'active' : ''}`} onClick={() => setTab('drive')}>
              Архив Drive ({drive.length})
              {isAdmin && hiddenDriveCount > 0 ? ` · скрыто ${hiddenDriveCount}` : ''}
            </button>
          )}
        </div>

        <div className="modal-photos">
          {photos.length === 0 ? (
            <div className="modal-empty">Нет фотографий для этой части отчета</div>
          ) : photos.map((photo, index) => (
            <button key={index} type="button" className="photo-thumb" onClick={() => setLightbox(index)}>
              <img src={photoUrl(photo, 'thumb')} alt={`фото ${index + 1}`} />
              <div className="photo-size">{photo?.driveId ? 'Drive' : photo?.sizeBytes ? `${Math.round(photo.sizeBytes / 1024)} КБ` : ''}</div>
              {isAdmin && photo?.driveId && (
                <span
                  className={`photo-hide-toggle ${photo.hidden ? 'hidden' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => toggleDrivePhoto(photo, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') toggleDrivePhoto(photo, e)
                  }}
                >
                  {savingPhoto === photo.driveId ? '...' : photo.hidden ? 'Показать' : 'Скрыть'}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
      {lightbox !== null && (
        <PhotoLightbox
          photos={lightboxPhotos}
          index={lightbox}
          label={tab === 'before' ? 'До уборки' : tab === 'after' ? 'После уборки' : 'Drive'}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

export default function PstReview() {
  const { user } = useStore()
  const isAdmin = user?.role === 'admin'
  const [book, setBook] = useState(null)
  const [activeTab, setActiveTab] = useState('full')
  const [reports, setReports] = useState([])
  const [loadingBook, setLoadingBook] = useState(true)
  const [loadingReports, setLoadingReports] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activePhoto, setActivePhoto] = useState(null)
  const [detailLoadingKey, setDetailLoadingKey] = useState('')

  const sheet = useMemo(() => book?.sheets?.find(s => s.key === activeTab) || book?.sheets?.[0], [book, activeTab])
  const sourceRows = sheet?.rows || []

  const visibleSourceRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sourceRows.filter(row => {
      if (city && row.city !== city) return false
      if (dateFrom && row.last_cleaned_date < dateFrom) return false
      if (dateTo && row.last_cleaned_date > dateTo) return false
      if (!q) return true
      return [
        row.postomat_id, row.city, row.branch, row.address,
        row.install_place, row.curator, row.location_type,
      ].some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [sourceRows, search, city, dateFrom, dateTo])

  const cities = useMemo(() => (
    Array.from(new Set(sourceRows.map(r => r.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'))
  ), [sourceRows])

  const fetchBook = useCallback(async () => {
    setLoadingBook(true)
    try {
      const res = await fetch('/pst-review-list.json', { cache: 'no-store' })
      if (!res.ok) throw new Error('review list not found')
      const data = await res.json()
      setBook(data)
      setActiveTab(data.sheets?.[0]?.key || 'full')
    } catch {
      setError('Не удалось загрузить Excel-реестр PST на проверку')
    } finally {
      setLoadingBook(false)
    }
  }, [])

  useEffect(() => { fetchBook() }, [fetchBook])

  const fetchReports = useCallback(async () => {
    if (!sheet) return
    setLoadingReports(true)
    setError('')
    try {
      const loaded = []
      const workTypes = sheet.key === 'exterior'
        ? [sheet.workType, 'НАРУЖНЯЯ УБОРКА']
        : [sheet.workType]

      for (const workType of workTypes) {
        let page = 1
        let pages = 1
        do {
          const q = new URLSearchParams({
            page,
            limit: 200,
            sortBy: 'submitted_at',
            sortDir: 'desc',
            work_type: workType,
          })
          const res = await api.get(`/pst?${q}`)
          loaded.push(...(res.data.reports || []))
          pages = res.data.pagination?.pages || 1
          page += 1
        } while (page <= pages)
      }

      setReports(Array.from(new Map(loaded.map(report => [report.id, report])).values()))
    } catch {
      setError('Не удалось загрузить отчеты для сопоставления фото')
      setReports([])
    } finally {
      setLoadingReports(false)
    }
  }, [sheet])

  useEffect(() => { fetchReports() }, [fetchReports])

  const reportIndexes = useMemo(() => {
    const byExact = new Map()
    const latestById = new Map()
    reports.forEach(report => {
      const date = isoDateAlmaty(report.submitted_at)
      const exactKey = `${String(report.location_id)}|${date}`
      if (!byExact.has(exactKey)) byExact.set(exactKey, report)
      const idKey = String(report.location_id)
      if (!latestById.has(idKey)) latestById.set(idKey, report)
    })
    return { byExact, latestById }
  }, [reports])

  const reviewRows = useMemo(() => visibleSourceRows.map(row => {
    const exact = reportIndexes.byExact.get(`${String(row.postomat_id)}|${row.last_cleaned_date}`)
    const latest = reportIndexes.latestById.get(String(row.postomat_id))
    return {
      source: row,
      report: exact || latest || null,
      matchMode: exact ? 'exact' : latest ? 'latest' : 'missing',
    }
  }), [visibleSourceRows, reportIndexes])

  const stats = useMemo(() => {
    const matched = reviewRows.filter(r => r.report).length
    const withPhotos = reviewRows.filter(r => r.report && ((r.report.before_count || 0) + (r.report.after_count || 0) + (r.report.drive_count || 0)) > 0).length
    return {
      total: reviewRows.length,
      matched,
      withPhotos,
      missing: reviewRows.length - matched,
    }
  }, [reviewRows])

  const openPhotos = async (entry) => {
    if (!entry.report) return
    const key = `${entry.source.postomat_id}-${entry.report.id}`
    setDetailLoadingKey(key)
    try {
      const res = await api.get(`/pst/${entry.report.id}`)
      setActivePhoto({ report: res.data.report || res.data, sourceRow: entry.source })
    } catch {
      setActivePhoto({ report: { ...entry.report, before_photos: [], after_photos: [], drive_photos: [] }, sourceRow: entry.source })
    } finally {
      setDetailLoadingKey('')
    }
  }

  const resetFilters = () => {
    setSearch('')
    setCity('')
    setDateFrom('')
    setDateTo('')
  }

  const hasFilters = search || city || dateFrom || dateTo
  const loading = loadingBook || loadingReports

  return (
    <div className="pst-page pr-page">
      <div className="pr-tabs" role="tablist" aria-label="Листы PST на проверку">
        {(book?.sheets || []).map(tab => (
          <button
            key={tab.key}
            type="button"
            className={`pr-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => { setActiveTab(tab.key); resetFilters() }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="pst-stats">
        <div className="pst-stat-card"><div className="pst-stat-val">{stats.total}</div><div className="pst-stat-label">ID из Excel</div></div>
        <div className="pst-stat-card"><div className="pst-stat-val">{stats.matched}</div><div className="pst-stat-label">Сопоставлено</div></div>
        <div className="pst-stat-card"><div className="pst-stat-val">{stats.withPhotos}</div><div className="pst-stat-label">Есть фото</div></div>
        <div className="pst-stat-card"><div className="pst-stat-val">{stats.missing}</div><div className="pst-stat-label">Нет отчета</div></div>
      </div>

      <div className="pst-toolbar">
        <div className="toolbar-search">
          <Search size={15} className="toolbar-search-icon" />
          <input
            type="text"
            placeholder="Поиск по POSTOMAT_ID, адресу, филиалу"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button type="button" className="toolbar-clear" onClick={() => setSearch('')}><X size={14} /></button>}
        </div>
        <div className="toolbar-filters">
          <div className="filter-group">
            <Building2 size={14} />
            <select value={city} onChange={e => setCity(e.target.value)}>
              <option value="">Все города</option>
              {cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="Дата от" />
          <DatePicker value={dateTo} onChange={setDateTo} placeholder="Дата до" />
          {hasFilters && <button type="button" className="btn-reset" onClick={resetFilters}><X size={13} /> Сброс</button>}
          <button type="button" className="btn-refresh" onClick={fetchReports} title="Обновить">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      <div className="pr-note">
        <CalendarClock size={15} />
        <span>Строки берутся строго из Excel. Сначала ищем точную дату из Excel, если ее нет — берем последнюю уборку по POSTOMAT_ID и типу мойки.</span>
      </div>

      <div className="pst-table-wrap">
        {error && <div className="pst-error"><AlertCircle size={16} /> {error}</div>}
        <table className="pst-table pr-table">
          <thead>
            <tr>
              <th style={{ minWidth: 94 }}>POSTOMAT_ID</th>
              <th style={{ minWidth: 118 }}>Город</th>
              <th style={{ minWidth: 132 }}>Филиал</th>
              <th style={{ minWidth: 260 }}>Адрес</th>
              <th style={{ minWidth: 112 }}>Установка</th>
              <th style={{ minWidth: 108 }}>Г/П</th>
              <th style={{ minWidth: 124 }}>Дата из Excel</th>
              <th style={{ minWidth: 118 }}>Отчет</th>
              <th style={{ minWidth: 64 }}>До</th>
              <th style={{ minWidth: 64 }}>После</th>
              <th style={{ minWidth: 72 }}>Фото</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="table-loading"><RefreshCw size={18} className="spin" /> Загрузка...</td></tr>
            ) : reviewRows.length === 0 ? (
              <tr><td colSpan={11} className="table-empty">{hasFilters ? 'Ничего не найдено в Excel-реестре' : 'Нет ID в этом листе'}</td></tr>
            ) : reviewRows.map((entry, index) => {
              const row = entry.source
              const report = entry.report
              const before = report?.before_count || 0
              const after = report?.after_count || 0
              const drive = report?.drive_count || 0
              const hasPhotos = before + after + drive > 0
              const loadingKey = `${row.postomat_id}-${report?.id}`
              const statusText = report
                ? entry.matchMode === 'latest'
                  ? `Последний: ${formatDate(report.submitted_at)}`
                  : `ID ${report.id}`
                : 'Не найден'
              const statusClass = entry.matchMode === 'exact' ? 'ok' : entry.matchMode === 'latest' ? 'fallback' : 'miss'
              return (
                <tr key={`${activeTab}-${row.postomat_id}-${index}`} className={index % 2 === 0 ? 'even' : 'odd'}>
                  <td className="cell-id"><span className="chip-id">{row.postomat_id}</span></td>
                  <td>{row.city || '—'}</td>
                  <td className="cell-branch" title={row.branch}>{row.branch || '—'}</td>
                  <td className="cell-address" title={row.address}>{row.address || '—'}</td>
                  <td>{row.install_place ? <span className={`chip-type ${row.install_place === 'Уличный' ? 'outdoor' : 'indoor'}`}>{row.install_place}</span> : '—'}</td>
                  <td className="pr-muted">{row.location_type || '—'}</td>
                  <td className="cell-date">{formatDate(row.last_cleaned_date)}</td>
                  <td><span className={`pr-status ${statusClass}`}>{statusText}</span></td>
                  <td className="cell-photo"><span className={`photo-badge ${before > 0 ? 'has-photos' : ''}`}>{before}</span></td>
                  <td className="cell-photo"><span className={`photo-badge ${after > 0 ? 'has-photos' : ''}`}>{after}</span></td>
                  <td>
                    <button
                      type="button"
                      className={`btn-view pr-eye ${hasPhotos ? 'complete' : ''}`}
                      onClick={() => openPhotos(entry)}
                      disabled={!report || !hasPhotos || detailLoadingKey === loadingKey}
                      title={report ? (hasPhotos ? 'Посмотреть фото' : 'В отчете нет фото') : 'Нет отчета по POSTOMAT_ID и типу мойки'}
                    >
                      {detailLoadingKey === loadingKey ? <RefreshCw size={14} className="spin" /> : hasPhotos ? <Eye size={14} /> : <Image size={14} />}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {activePhoto && (
        <PhotoModal
          report={activePhoto.report}
          sourceRow={activePhoto.sourceRow}
          isAdmin={isAdmin}
          onReportUpdate={(report) => setActivePhoto(prev => prev ? { ...prev, report } : prev)}
          onClose={() => setActivePhoto(null)}
        />
      )}
    </div>
  )
}
