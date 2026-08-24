import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, Building2, CalendarClock, Download, Eye, Image,
  MapPin, RefreshCw, Search, X
} from 'lucide-react'
import * as XLSX from 'xlsx'
import api from '../api'
import DatePicker from '../components/DatePicker'
import { useStore } from '../store'
import './PstReports.css'
import './PstReview.css'

const REVIEW_PERIODS = [
  { key: 'august-2026', label: 'Август 2026', file: '/pst-review-list.json', dateFrom: '2026-08-01', dateTo: '2026-08-31' },
  { key: 'july-2026', label: 'Июль 2026', file: '/pst-review-list-july.json', dateFrom: '2026-07-01', dateTo: '2026-07-31' },
]

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

const reportToSourceRow = (report) => {
  const loc = report.location_data || {}
  return {
    report_id: report.id,
    postomat_id: String(report.location_id || loc.id || ''),
    city: loc.city || report.city || '',
    branch: loc.branch || report.branch || '',
    address: loc.address || report.address || '',
    install_place: loc.installPlace || report.install_place || '',
    point_type: loc.category || report.category || '',
    lat: loc.lat ?? null,
    lng: loc.lng ?? null,
    last_cleaned_date: isoDateAlmaty(report.submitted_at),
    submitted_at: report.submitted_at,
    curator: report.cleaner_name || '',
    location_type: '',
    excel_washed: true,
    show_static: true,
  }
}

const reportTimestamp = (report) => new Date(report?.submitted_at || 0).getTime()

const combineReports = (reports) => {
  const sorted = [...(reports || [])].filter(Boolean).sort((a, b) => reportTimestamp(b) - reportTimestamp(a))
  const main = sorted[0] || null
  if (!main) return null
  const attachReportId = (report, photos) => (photos || []).map(photo => ({ ...photo, _reportId: report.id }))
  return {
    ...main,
    report_ids: sorted.map(report => report.id),
    before_count: sorted.reduce((sum, report) => sum + (report.before_count || 0), 0),
    after_count: sorted.reduce((sum, report) => sum + (report.after_count || 0), 0),
    drive_count: sorted.reduce((sum, report) => sum + (report.drive_count || 0), 0),
    before_photos: sorted.flatMap(report => attachReportId(report, report.before_photos)),
    after_photos: sorted.flatMap(report => attachReportId(report, report.after_photos)),
    drive_photos: sorted.flatMap(report => attachReportId(report, report.drive_photos)),
  }
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

  const downloadCurrent = (e) => {
    e.stopPropagation()
    const photo = photos[current]
    if (!photo?.src) return
    const a = document.createElement('a')
    a.href = photo.src
    a.download = photo.name || `pst-photo-${current + 1}.jpg`
    a.target = '_blank'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <div className="pr-lightbox" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <button type="button" className="pr-lightbox-download" onClick={downloadCurrent} title="Скачать фото"><Download size={20} /></button>
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
    const targetReportId = photo._reportId || report.id
    setSavingPhoto(photo.driveId)
    try {
      await api.patch(`/pst/${targetReportId}/drive-photo-visibility`, { driveId: photo.driveId, hidden })
      const updated = {
        ...report,
        drive_photos: (report.drive_photos || []).map(item => (
          item.driveId === photo.driveId ? { ...item, hidden } : item
        )),
      }
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

  const lightboxPhotos = photos.map((p, index) => ({ src: photoUrl(p, 'full'), name: p?.name || p?.fileName || `pst-photo-${index + 1}.jpg` })).filter(p => p.src)

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
            ['Отчет ID', report.report_ids?.length > 1 ? `${report.id} +${report.report_ids.length - 1}` : report.id],
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
          {isAdmin && drive.length > 0 && (
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
                  className={`photo-hide-toggle ${photo.hidden ? 'is-hidden' : ''}`}
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
  const [period, setPeriod] = useState(REVIEW_PERIODS[0].key)
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

  const periodConfig = REVIEW_PERIODS.find(p => p.key === period) || REVIEW_PERIODS[0]
  const hideFullWash = book?.displayRules?.hideFullWash === true
  const visibleSheets = useMemo(() => (
    (book?.sheets || []).filter(s => !(hideFullWash && s.key === 'full'))
  ), [book, hideFullWash])
  const sheet = useMemo(() => visibleSheets.find(s => s.key === activeTab) || visibleSheets[0], [visibleSheets, activeTab])
  const isDynamicIncidentSheet = period === 'august-2026' && sheet?.key === 'incident'
  const sourceRows = useMemo(() => (
    isDynamicIncidentSheet
      ? reports.map(reportToSourceRow).sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at))
      : (sheet?.rows || [])
  ), [isDynamicIncidentSheet, reports, sheet])

  const visibleSourceRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sourceRows.filter(row => {
      if (city && row.city !== city) return false
      if (dateFrom && row.last_cleaned_date < dateFrom) return false
      if (dateTo && row.last_cleaned_date > dateTo) return false
      if (!q) return true
      return [
        row.report_id, row.postomat_id, row.city, row.branch, row.address,
        row.install_place, row.curator, row.location_type,
      ].some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [sourceRows, search, city, dateFrom, dateTo])

  const cities = useMemo(() => (
    Array.from(new Set(sourceRows.map(r => r.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ru'))
  ), [sourceRows])

  const fetchBook = useCallback(async () => {
    setLoadingBook(true)
    setError('')
    setBook(null)
    setReports([])
    try {
      const res = await fetch(periodConfig.file, { cache: 'no-store' })
      if (!res.ok) throw new Error('review list not found')
      const data = await res.json()
      setBook(data)
      const shouldHideFull = data?.displayRules?.hideFullWash === true
      const firstSheet = (data.sheets || []).find(s => !(shouldHideFull && s.key === 'full')) || data.sheets?.[0]
      setActiveTab(firstSheet?.key || 'exterior')
      resetFilters()
    } catch {
      setError('Не удалось загрузить Excel-реестр PST на проверку')
      setBook(null)
    } finally {
      setLoadingBook(false)
    }
  }, [periodConfig.file])

  useEffect(() => { fetchBook() }, [fetchBook])

  const fetchReports = useCallback(async () => {
    if (!sheet) return
    setLoadingReports(true)
    setError('')
    setReports([])
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
            dateFrom: periodConfig.dateFrom || sheet.reportDateFrom || '',
            dateTo: periodConfig.dateTo || sheet.reportDateTo || '',
          })
          if (!q.get('dateFrom')) q.delete('dateFrom')
          if (!q.get('dateTo')) q.delete('dateTo')
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
  }, [periodConfig.dateFrom, periodConfig.dateTo, sheet])

  useEffect(() => { fetchReports() }, [fetchReports])

  const reportIndexes = useMemo(() => {
    const byId = new Map()
    const byExact = new Map()
    const byExactAll = new Map()
    const latestById = new Map()
    reports.forEach(report => {
      byId.set(Number(report.id), report)
      const date = isoDateAlmaty(report.submitted_at)
      const exactKey = `${String(report.location_id)}|${date}`
      if (!byExact.has(exactKey)) byExact.set(exactKey, report)
      const exactReports = byExactAll.get(exactKey) || []
      exactReports.push(report)
      byExactAll.set(exactKey, exactReports)
      const idKey = String(report.location_id)
      if (!latestById.has(idKey)) latestById.set(idKey, report)
    })
    return { byId, byExact, byExactAll, latestById }
  }, [reports])

  const matchSourceRow = useCallback((row) => {
    const byReportId = row.report_id ? reportIndexes.byId.get(Number(row.report_id)) : null
    if (row.report_id) {
      return {
        source: row,
        report: byReportId || null,
        reports: byReportId ? [byReportId] : [],
        matchMode: byReportId ? 'exact' : 'missing',
      }
    }
    const exact = reportIndexes.byExact.get(`${String(row.postomat_id)}|${row.last_cleaned_date}`)
    const exactReports = reportIndexes.byExactAll.get(`${String(row.postomat_id)}|${row.last_cleaned_date}`) || []
    const latest = reportIndexes.latestById.get(String(row.postomat_id))
    return {
      source: row,
      report: byReportId || exact || latest || null,
      reports: exactReports.length ? exactReports : latest ? [latest] : [],
      matchMode: byReportId || exact ? 'exact' : latest ? 'latest' : 'missing',
    }
  }, [reportIndexes])

  const dedupeReviewEntries = useCallback((entries) => {
    const grouped = new Map()
    entries.forEach(entry => {
      const row = entry.source
      const key = [
        row.postomat_id || '',
        row.last_cleaned_date || '',
        row.install_place || '',
        row.location_type || '',
        sheet?.key || '',
      ].join('|')
      const current = grouped.get(key)
      if (!current) {
        grouped.set(key, {
          ...entry,
          reports: [...(entry.reports || [])],
        })
        return
      }
      const reports = new Map((current.reports || []).map(report => [report.id, report]))
      ;(entry.reports || []).forEach(report => reports.set(report.id, report))
      const mergedReports = Array.from(reports.values()).sort((a, b) => reportTimestamp(b) - reportTimestamp(a))
      grouped.set(key, {
        ...current,
        report: combineReports(mergedReports),
        reports: mergedReports,
        matchMode: current.matchMode === 'exact' || entry.matchMode === 'exact'
          ? 'exact'
          : current.matchMode === 'latest' || entry.matchMode === 'latest'
            ? 'latest'
            : 'missing',
      })
    })
    return Array.from(grouped.values()).map(entry => {
      if ((entry.reports || []).length <= 1) return entry
      return {
        ...entry,
        report: combineReports(entry.reports),
      }
    })
  }, [sheet?.key])

  const reviewRows = useMemo(() => (
    dedupeReviewEntries(
      visibleSourceRows
        .map(matchSourceRow)
        .filter(entry => entry.source.show_static !== false || Boolean(entry.report))
    )
  ), [visibleSourceRows, matchSourceRow, dedupeReviewEntries])

  const truthExportRows = useMemo(() => (
    dedupeReviewEntries(
      visibleSourceRows
        .map(matchSourceRow)
        .filter(entry => entry.source.show_static !== false || Boolean(entry.report))
    )
  ), [visibleSourceRows, matchSourceRow, dedupeReviewEntries])

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
    const reportList = entry.reports?.length ? entry.reports : [entry.report]
    const key = `${entry.source.postomat_id}-${reportList.map(report => report.id).join('-')}`
    setDetailLoadingKey(key)
    try {
      const details = await Promise.all(reportList.map(async (report) => {
        try {
          const res = await api.get(`/pst/${report.id}`)
          return res.data.report || res.data
        } catch {
          return { ...report, before_photos: [], after_photos: [], drive_photos: [] }
        }
      }))
      setActivePhoto({ report: combineReports(details), sourceRow: entry.source })
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

  const exportTruthRows = () => {
    const rows = truthExportRows.map((entry) => {
      const { source: row, report, matchMode } = entry
      const combinedReport = combineReports(entry.reports?.length ? entry.reports : [report]) || report
      const before = combinedReport?.before_count || 0
      const after = combinedReport?.after_count || 0
      const drive = combinedReport?.drive_count || 0
      return {
        'POSTOMAT_ID': row.postomat_id || '',
        'Город': row.city || '',
        'Филиал': row.branch || '',
        'Адрес': row.address || '',
        'Установка': row.install_place || '',
        'Г/П': row.location_type || '',
        'Помыли?': 'ИСТИНА',
        'Дата из Excel': row.last_cleaned_date ? formatDate(row.last_cleaned_date) : '',
        'Отчет ID': combinedReport?.report_ids?.join(', ') || combinedReport?.id || '',
        'Статус сопоставления': report ? (row.show_static === false ? 'Было ЛОЖЬ, есть отчет' : matchMode === 'latest' ? 'Последний отчет' : 'Точная дата') : 'Не найден',
        'Дата отчета': combinedReport?.submitted_at ? formatDate(combinedReport.submitted_at) : '',
        'До': before,
        'После': after,
        'Архив Drive': drive,
        'Есть фото': before + after + drive > 0 ? 'Да' : 'Нет',
        'Тип мойки': report?.work_type || sheet?.workType || '',
        'Куратор/клинер': row.curator || report?.cleaner_name || '',
      }
    })

    if (!rows.length) return

    const worksheet = XLSX.utils.json_to_sheet(rows)
    worksheet['!cols'] = [
      { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 34 },
      { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 14 },
      { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 8 },
      { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 20 },
      { wch: 22 },
    ]
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, 'ИСТИНА')
    const safeSheet = String(sheet?.label || activeTab || 'PST').replace(/[\\/:*?"<>|]/g, '')
    const safePeriod = String(periodConfig.label || period).replace(/[\\/:*?"<>|]/g, '')
    XLSX.writeFile(workbook, `PST_ИСТИНА_${safeSheet}_${safePeriod}.xlsx`)
  }

  const hasFilters = search || city || dateFrom || dateTo
  const loading = loadingBook || loadingReports
  return (
    <div className="pst-page pr-page">
      <div className="pr-tabs-row">
        <div className="filter-group pr-period-filter">
          <CalendarClock size={14} />
          <select value={period} onChange={e => setPeriod(e.target.value)}>
            {REVIEW_PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </div>

        <div className="pr-tabs" role="tablist" aria-label="Листы PST на проверку">
          {visibleSheets.map(tab => (
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
          <button
            type="button"
            className="btn-export-truth"
            onClick={exportTruthRows}
            disabled={loading || truthExportRows.length === 0}
            title="Выгрузить строки с ИСТИНА в Excel"
          >
            <Download size={14} />
            Выгрузить ИСТИНА
          </button>
          <button type="button" className="btn-refresh" onClick={fetchReports} title="Обновить">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
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
              const reportCount = report?.report_ids?.length || 1
              const loadingKey = `${row.postomat_id}-${report?.report_ids?.join('-') || report?.id}`
              const statusText = report
                ? reportCount > 1 ? `ID ${report.id} +${reportCount - 1}` : `ID ${report.id}`
                : 'Не найден'
              const statusClass = report && row.show_static === false
                ? 'ok'
                : entry.matchMode === 'exact' ? 'ok' : entry.matchMode === 'latest' ? 'fallback' : 'miss'
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
