import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useStore } from '../store'
import api from '../api'
import {
  Plus, Trash2, Edit2, ChevronDown, ChevronUp, X,
  Clock, GripVertical, RefreshCw, Search, Camera,
  ClipboardList, PlayCircle, AlertCircle, CheckCircle2, MapPin, Globe
} from 'lucide-react'
import './Checklists.css'

const ZONE_COLORS = [
  { bg: '#EEF2FF', border: '#818CF8', dot: '#6366F1', label: 'Фиолетовый' },
  { bg: '#F0FDF4', border: '#4ADE80', dot: '#16A34A', label: 'Зелёный'   },
  { bg: '#FFF7ED', border: '#FB923C', dot: '#EA580C', label: 'Оранжевый' },
  { bg: '#F0FDFA', border: '#2DD4BF', dot: '#0D9488', label: 'Бирюзовый' },
  { bg: '#FDF2F8', border: '#E879F9', dot: '#A21CAF', label: 'Розовый'   },
  { bg: '#FFFBEB', border: '#FBBF24', dot: '#D97706', label: 'Жёлтый'   },
]

const ZONE_NAMES = [
  'Санузлы', 'Кассовые зоны', 'Операционный зал', 'Социальная зона',
  'Зона 24/7', 'Open Space', 'Конференц-зал', 'Кухня', 'Лестницы',
  'Кабинет директора', 'VIP-отдел', 'Инкассация', 'Касса пересчета',
  'Служебные помещения', 'Поддерживающая уборка',
]

// ── Zone editor ────────────────────────────────────────────────────────────────
function ZoneBlock({ zone, idx, total, color, onChange, onDelete, onMoveUp, onMoveDown }) {
  const [open, setOpen] = useState(true)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const tasks = zone.tasks || []
  const filtered = ZONE_NAMES.filter(n => n.toLowerCase().includes((zone.name || '').toLowerCase()) && n !== zone.name)

  const addTask = () => onChange({ ...zone, tasks: [...tasks, { title: '', requires_photo: false, time_start: '', time_end: '' }] })
  const removeTask = (i) => onChange({ ...zone, tasks: tasks.filter((_, ti) => ti !== i) })
  const updateTask = (i, field, val) => onChange({
    ...zone,
    tasks: tasks.map((t, ti) => ti === i ? { ...t, [field]: val } : t)
  })

  return (
    <div className="zone-block" style={{ borderColor: color.border, background: open ? color.bg : '#fff' }}>
      <div className="zone-header">
        <div className="zone-drag"><GripVertical size={14} /></div>
        <div className="zone-name-wrap">
          <span className="zone-dot" style={{ background: color.dot }} />
          <div className="zone-name-input-wrap">
            <input
              className="zone-name-input"
              placeholder="Название зоны..."
              value={zone.name}
              onChange={e => { onChange({ ...zone, name: e.target.value }); setShowSuggestions(true) }}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onFocus={() => setShowSuggestions(true)}
            />
            {showSuggestions && filtered.length > 0 && (
              <div className="zone-suggestions">
                {filtered.slice(0, 5).map(s => (
                  <button key={s} className="zone-suggestion-item" onMouseDown={() => { onChange({ ...zone, name: s }); setShowSuggestions(false) }}>{s}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="zone-time-wrap">
          <Clock size={12} style={{ color: color.dot }} />
          <input className="zone-time" type="time" value={zone.time_start || ''} onChange={e => onChange({ ...zone, time_start: e.target.value })} />
          <span className="zone-time-sep">—</span>
          <input className="zone-time" type="time" value={zone.time_end || ''} onChange={e => onChange({ ...zone, time_end: e.target.value })} />
        </div>
        <div className="zone-actions">
          <button className="zone-move-btn" onClick={onMoveUp}   disabled={idx === 0}><ChevronUp size={13} /></button>
          <button className="zone-move-btn" onClick={onMoveDown} disabled={idx === total - 1}><ChevronDown size={13} /></button>
          <button className="zone-collapse-btn" onClick={() => setOpen(o => !o)}>{open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</button>
          <button className="zone-delete-btn" onClick={onDelete}><X size={13} /></button>
        </div>
      </div>

      {open && (
        <div className="zone-tasks">
          {tasks.map((task, i) => (
            <div key={i} className="zone-task-row">
              <GripVertical size={13} className="task-grip" />
              <input
                className="zone-task-input"
                placeholder="Описание задачи..."
                value={task.title}
                onChange={e => updateTask(i, 'title', e.target.value)}
              />
              <div className="task-time-wrap">
                <input className="task-time" type="time" value={task.time_start || ''} onChange={e => updateTask(i, 'time_start', e.target.value)} />
                <span className="task-time-sep">—</span>
                <input className="task-time" type="time" value={task.time_end || ''} onChange={e => updateTask(i, 'time_end', e.target.value)} />
              </div>
              <label className={`task-photo-label ${task.requires_photo ? 'active' : ''}`} title="Требуется фото">
                <input type="checkbox" checked={task.requires_photo} onChange={e => updateTask(i, 'requires_photo', e.target.checked)} />
                <Camera size={13} />
              </label>
              <button className="task-del-btn" onClick={() => removeTask(i)}><X size={12} /></button>
            </div>
          ))}
          <button className="zone-add-task" onClick={addTask}><Plus size={13} /> Добавить задачу</button>
        </div>
      )}
    </div>
  )
}

// ── Template modal ─────────────────────────────────────────────────────────────
// ── Location combobox ──────────────────────────────────────────────────────────
function LocationCombobox({ value, onChange }) {
  const [allLocs, setAllLocs] = useState([])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [selectedLoc, setSelectedLoc] = useState(null)
  const inputRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => {
    api.get('/locations/cleaning?limit=300').then(r => {
      const locs = r.data.locations || []
      setAllLocs(locs)
      // Try to match existing value to a location
      if (value) {
        const match = locs.find(l => `${l.city} · ${l.name}` === value || l.name === value)
        if (match) setSelectedLoc(match)
      }
    }).catch(() => {})
  }, [])

  useEffect(() => {
    const handler = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return allLocs.slice(0, 50)
    const q = query.toLowerCase()
    return allLocs.filter(l => l.name.toLowerCase().includes(q) || l.city.toLowerCase().includes(q)).slice(0, 50)
  }, [allLocs, query])

  const select = (loc) => {
    setSelectedLoc(loc); setQuery(''); onChange(`${loc.city} · ${loc.name}`); setOpen(false)
  }

  const clear = () => {
    setSelectedLoc(null); setQuery(''); onChange('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  if (selectedLoc) {
    return (
      <div className="loc-selected">
        <div className="loc-selected-inner">
          <MapPin size={13} className="loc-selected-icon" />
          <div className="loc-selected-info">
            <span className="loc-selected-city">{selectedLoc.city}</span>
            <span className="loc-selected-name">{selectedLoc.name}</span>
          </div>
        </div>
        <button className="loc-selected-clear" onClick={clear} title="Изменить"><X size={13} /></button>
      </div>
    )
  }

  return (
    <div className="loc-combo" ref={boxRef}>
      <div className={`loc-combo-input-wrap ${open ? 'focused' : ''}`}>
        <Search size={13} className="loc-combo-icon" />
        <input
          ref={inputRef}
          className="loc-combo-input"
          placeholder="Введите город или адрес..."
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
        {query && <button className="loc-combo-clear" onMouseDown={e => { e.preventDefault(); setQuery('') }}><X size={11} /></button>}
      </div>
      {open && (
        <div className="loc-combo-dropdown">
          {filtered.length === 0
            ? <div className="loc-combo-empty">Ничего не найдено</div>
            : filtered.map(l => (
              <button
                key={l.id}
                className="loc-combo-item"
                onMouseDown={e => { e.preventDefault(); select(l) }}
              >
                <span className="loc-combo-city">{l.city}</span>
                <span className="loc-combo-name">{l.name}</span>
              </button>
            ))
          }
        </div>
      )}
    </div>
  )
}

function TemplateModal({ template, onClose, onSave }) {
  const [name, setName] = useState(template?.name || '')
  const [desc, setDesc] = useState(template?.description || '')
  const [isDefault, setIsDefault] = useState(template?.is_default || false)
  const [zones, setZones] = useState(() => {
    const rawZones = template?.zones || []
    const items = template?.items || []

    if (rawZones.length) {
      return rawZones.map(z => ({
        name: z.name || '',
        time_start: z.time_start || '',
        time_end: z.time_end || '',
        tasks: z.tasks?.length
          ? z.tasks
          : items
              .filter(it => it.zone === z.name)
              .map(it => ({ title: it.title, requires_photo: !!it.requires_photo, time_start: it.time_start || '', time_end: it.time_end || '' }))
      }))
    }
    if (items.length) {
      const zoneMap = {}
      items.forEach(it => {
        const zn = it.zone || 'Общие задачи'
        if (!zoneMap[zn]) zoneMap[zn] = { name: zn, time_start: it.time_start || '', time_end: it.time_end || '', tasks: [] }
        zoneMap[zn].tasks.push({ title: it.title, requires_photo: !!it.requires_photo, time_start: it.time_start || '', time_end: it.time_end || '' })
      })
      return Object.values(zoneMap)
    }
    return [{ name: '', time_start: '', time_end: '', tasks: [{ title: '', requires_photo: false, time_start: '', time_end: '' }] }]
  })
  const [saving, setSaving] = useState(false)

  const addZone = () => setZones(z => [...z, { name: '', time_start: '', time_end: '', tasks: [{ title: '', requires_photo: false, time_start: '', time_end: '' }] }])
  const deleteZone = (i) => setZones(z => z.filter((_, zi) => zi !== i))
  const updateZone = (i, zone) => setZones(z => z.map((oz, zi) => zi === i ? zone : oz))
  const moveZone = (i, dir) => setZones(z => {
    const n = [...z]; [n[i], n[i + dir]] = [n[i + dir], n[i]]; return n
  })

  const totalTasks = zones.reduce((s, z) => s + z.tasks.filter(t => t.title.trim()).length, 0)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    const items = []
    zones.forEach(z => {
      z.tasks.filter(t => t.title.trim()).forEach(t => {
        items.push({ title: t.title.trim(), zone: z.name, time_start: t.time_start || z.time_start || null, time_end: t.time_end || z.time_end || null, requires_photo: t.requires_photo || false })
      })
    })
    await onSave({ name: name.trim(), description: isDefault ? null : (desc.trim() || null), zones, items, is_default: isDefault })
    setSaving(false)
  }

  return (
    <div className="cl-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="cl-modal cl-modal-zones">
        <div className="cl-modal-header">
          <div>
            <h2>{template ? 'Редактировать шаблон' : 'Новый шаблон'}</h2>
            <span className="cl-modal-meta">{zones.length} зон · {totalTasks} задач</span>
          </div>
          <button className="cl-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="cl-modal-body">
          <div className="tmpl-meta-stack">
            <div className="cl-field">
              <label>Название шаблона *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Ежедневная уборка отделения банка" />
            </div>
            <div className="cl-field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={isDefault} onChange={e => { setIsDefault(e.target.checked); if (e.target.checked) setDesc('') }} style={{ width: 15, height: 15, cursor: 'pointer' }} />
                Для всех остальных адресов
              </label>
            </div>
            {!isDefault && (
              <div className="cl-field">
                <label>Адрес объекта</label>
                <LocationCombobox value={desc} onChange={setDesc} />
              </div>
            )}
          </div>

          <div className="zones-section">
            <div className="zones-section-head">
              <span className="zones-label">ЗОНЫ И ЗАДАЧИ</span>
              <button className="zones-add-btn" onClick={addZone}><Plus size={13} /> Добавить зону</button>
            </div>
            <div className="zones-list">
              {zones.map((zone, i) => (
                <ZoneBlock
                  key={i}
                  zone={zone}
                  idx={i}
                  total={zones.length}
                  color={ZONE_COLORS[i % ZONE_COLORS.length]}
                  onChange={z => updateZone(i, z)}
                  onDelete={() => deleteZone(i)}
                  onMoveUp={() => moveZone(i, -1)}
                  onMoveDown={() => moveZone(i, 1)}
                />
              ))}
              {zones.length === 0 && (
                <button className="zones-empty-add" onClick={addZone}>
                  <Plus size={16} /> Добавить первую зону
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="cl-modal-footer">
          <button className="cl-btn-cancel" onClick={onClose}>Отмена</button>
          <button className="cl-btn-save" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Сохранение...' : template ? 'Сохранить' : 'Создать шаблон'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Worker select ──────────────────────────────────────────────────────────────
const ROLE_LABELS = { cleaner: 'Клинер', user: 'PST', curator: 'Куратор', partner: 'Партнёр', admin: 'Админ' }
const ROLE_COLORS = { cleaner: '#16a34a', user: '#2563eb', curator: '#7c3aed', partner: '#0891b2', admin: '#1A1D1E' }

function initials(name) {
  if (!name) return '?'
  return name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function MultiWorkerSelect({ workers, value, onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const selectedWorkers = workers.filter(w => value.includes(w.id))

  useEffect(() => {
    const handler = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = useMemo(() => {
    const available = workers.filter(w => !value.includes(w.id))
    if (!query.trim()) return available
    const q = query.toLowerCase()
    return available.filter(w => (w.full_name || '').toLowerCase().includes(q) || w.phone.includes(q))
  }, [workers, query, value])

  const add = (w) => { onChange([...value, w.id]); setQuery(''); setOpen(true); setTimeout(() => inputRef.current?.focus(), 0) }
  const remove = (id) => onChange(value.filter(v => v !== id))

  return (
    <div className="es-combo" ref={boxRef}>
      <div className={`es-multi-wrap ${open ? 'focused' : ''}`} onClick={() => { setOpen(true); inputRef.current?.focus() }}>
        {selectedWorkers.map(w => (
          <span key={w.id} className="es-chip">
            <span className="es-chip-dot" style={{ background: ROLE_COLORS[w.role] }} />
            {w.full_name || w.phone}
            <button className="es-chip-remove" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); remove(w.id) }}><X size={10} /></button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="es-multi-input"
          placeholder={value.length === 0 ? 'Имя или номер телефона...' : 'Добавить ещё...'}
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && (
        <div className="es-dropdown">
          {filtered.length === 0 ? (
            <div className="es-empty">{query ? 'Никого не найдено' : 'Все сотрудники выбраны'}</div>
          ) : filtered.map(w => {
            const lc = (w.cleaning_location_ids || []).length
            return (
              <button key={w.id} className="es-option" onMouseDown={e => { e.preventDefault(); add(w) }}>
                <span className="es-avatar sm" style={{ background: ROLE_COLORS[w.role] + '22', color: ROLE_COLORS[w.role] }}>
                  {initials(w.full_name)}
                </span>
                <div className="es-option-info">
                  <span className="es-option-name">{w.full_name || w.phone}</span>
                  <div className="es-option-meta">
                    <span className="es-role-chip" style={{ color: ROLE_COLORS[w.role], background: ROLE_COLORS[w.role] + '18' }}>
                      {ROLE_LABELS[w.role] || w.role}
                    </span>
                    <span className="es-phone-chip">{w.phone}</span>
                    {lc > 0 && <span className="es-loc-chip"><MapPin size={9} /> {lc} объект{lc === 1 ? '' : lc < 5 ? 'а' : 'ов'}</span>}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Assign location select ─────────────────────────────────────────────────────
function AssignLocSelect({ locations, priorityIds, value, onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const boxRef = useRef(null)
  const selected = locations.find(l => l.id === value)

  useEffect(() => {
    const handler = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const priorityLocs = useMemo(() => locations.filter(l => priorityIds.includes(l.id)), [locations, priorityIds])
  const otherLocs    = useMemo(() => locations.filter(l => !priorityIds.includes(l.id)), [locations, priorityIds])

  const filtered = useMemo(() => {
    if (!query.trim()) return null
    const q = query.toLowerCase()
    return locations.filter(l => l.name.toLowerCase().includes(q) || l.city.toLowerCase().includes(q))
  }, [locations, query])

  const select = (loc) => { onChange(loc.id); setOpen(false); setQuery('') }

  if (selected && !open) {
    return (
      <div className="loc-selected">
        <div className="loc-selected-inner">
          <MapPin size={13} className="loc-selected-icon" />
          <div className="loc-selected-info">
            <span className="loc-selected-city">{selected.city}</span>
            <span className="loc-selected-name">{selected.name}</span>
          </div>
        </div>
        <button className="loc-selected-clear" onClick={() => { onChange(null); setOpen(true) }} title="Изменить">
          <X size={13} />
        </button>
      </div>
    )
  }

  const renderList = (list) => list.map(l => (
    <button key={l.id} className="es-option loc-option" onMouseDown={e => { e.preventDefault(); select(l) }}>
      <span className="loc-combo-city">{l.city}</span>
      <span className="loc-combo-name">{l.name}</span>
    </button>
  ))

  return (
    <div className="es-combo" ref={boxRef}>
      <div className={`es-input-wrap ${open ? 'focused' : ''}`}>
        <Search size={13} className="es-input-icon" />
        <input
          ref={inputRef}
          className="es-input"
          placeholder="Поиск по городу или адресу..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
        />
        {query && <button className="es-clear" onMouseDown={e => { e.preventDefault(); setQuery('') }}><X size={11} /></button>}
      </div>
      {open && (
        <div className="es-dropdown">
          <button className="es-option es-option-none" onMouseDown={e => { e.preventDefault(); onChange(null); setOpen(false) }}>
            — Не указывать объект —
          </button>
          {filtered ? (
            filtered.length === 0
              ? <div className="es-empty">Ничего не найдено</div>
              : renderList(filtered)
          ) : (
            <>
              {priorityLocs.length > 0 && (
                <>
                  <div className="es-group-label">★ Объекты клинера</div>
                  {renderList(priorityLocs)}
                  {otherLocs.length > 0 && <div className="es-group-label">Все объекты</div>}
                </>
              )}
              {renderList(otherLocs)}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Assign modal ───────────────────────────────────────────────────────────────
// Генерирует даты в диапазоне [from, to]
function dateRange(from, to) {
  const dates = []; let d = new Date(from)
  const end = new Date(to)
  while (d <= end) { dates.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1) }
  return dates
}
const todayStr = () => new Date().toISOString().slice(0, 10)

function AssignModal({ template, users, locations, active, onClose, onSave }) {
  const isDefault = template.is_default
  const [assignedTo, setAssignedTo] = useState([])
  const [locationId, setLocationId] = useState(() => {
    if (!isDefault && template.description && locations.length > 0) {
      const match = locations.find(l => `${l.city} · ${l.name}` === template.description || l.name === template.description)
      return match?.id ?? null
    }
    return null
  })
  // For default templates: selected location IDs
  const [selectedLocIds, setSelectedLocIds] = useState(null) // null = not yet initialized
  const [locSearch, setLocSearch] = useState('')
  const [mode, setMode] = useState('single')
  const [dateFrom, setDateFrom] = useState(todayStr())
  const [dateTo, setDateTo] = useState(todayStr())
  const [dailyDays, setDailyDays] = useState(7)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const cleaners = users.filter(u => u.role === 'cleaner' || u.role === 'user')

  const allCleanerLocIds = useMemo(() => {
    const ids = new Set()
    assignedTo.forEach(id => {
      const w = users.find(u => u.id === id)
      ;(w?.cleaning_location_ids || []).forEach(lid => ids.add(lid))
    })
    return [...ids]
  }, [assignedTo, users])

  // For default mode: find locations that already have active checklists on selected dates
  const occupiedLocIds = useMemo(() => {
    if (!isDefault) return new Set()
    const dates = computedDates()
    const s = new Set()
    ;(active || []).forEach(ac => {
      const d = (ac.shift_date || '').slice(0, 10)
      if (dates.includes(d) && ac.location_id) s.add(ac.location_id)
    })
    return s
  }, [isDefault, active, dateFrom, dateTo, dailyDays, mode])

  // Initialize selectedLocIds when locations or occupiedLocIds changes (for default mode)
  useEffect(() => {
    if (!isDefault || locations.length === 0) return
    if (selectedLocIds !== null) return
    setSelectedLocIds(new Set(locations.filter(l => !occupiedLocIds.has(l.id)).map(l => l.id)))
  }, [isDefault, locations, occupiedLocIds])

  // Re-compute pre-selection when date changes
  useEffect(() => {
    if (!isDefault || locations.length === 0) return
    setSelectedLocIds(new Set(locations.filter(l => !occupiedLocIds.has(l.id)).map(l => l.id)))
  }, [occupiedLocIds])

  function computedDates() {
    if (mode === 'single') return [dateFrom]
    if (mode === 'range') return dateRange(dateFrom, dateTo)
    if (mode === 'daily') {
      const end = new Date(dateFrom); end.setDate(end.getDate() + Number(dailyDays) - 1)
      return dateRange(dateFrom, end.toISOString().slice(0, 10))
    }
    return [dateFrom]
  }

  const handleWorkerChange = (ids) => {
    setAssignedTo(ids)
    if (!isDefault && !locationId && ids.length === 1) {
      const workerLocIds = users.find(u => u.id === ids[0])?.cleaning_location_ids || []
      if (workerLocIds.length === 1) setLocationId(workerLocIds[0])
    }
  }

  const toggleLoc = (id) => setSelectedLocIds(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  const toggleAll = () => {
    const filtered = filteredLocs
    const allChecked = filtered.every(l => selectedLocIds?.has(l.id))
    setSelectedLocIds(prev => {
      const n = new Set(prev)
      if (allChecked) filtered.forEach(l => n.delete(l.id))
      else filtered.forEach(l => n.add(l.id))
      return n
    })
  }

  const filteredLocs = useMemo(() => {
    if (!locSearch.trim()) return locations
    const q = locSearch.toLowerCase()
    return locations.filter(l => l.name.toLowerCase().includes(q) || l.city.toLowerCase().includes(q))
  }, [locations, locSearch])

  const handle = async () => {
    if (assignedTo.length === 0) return
    setSaving(true)
    const dates = computedDates()
    if (isDefault) {
      const locIds = [...(selectedLocIds || [])].filter(id => locations.some(l => l.id === id))
      await onSave({ template_id: template.id, workers: assignedTo, location_ids: locIds, dates, notes: notes || null })
    } else {
      await onSave({ template_id: template.id, workers: assignedTo, location_id: locationId || null, dates, notes: notes || null })
    }
    setSaving(false)
  }

  const dates = computedDates()
  const tooMany = dates.length > 90
  const selCount = isDefault ? (selectedLocIds?.size || 0) : 1
  const totalShifts = dates.length * assignedTo.length * (isDefault ? selCount : 1)

  return (
    <div className="cl-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="cl-modal" style={{ maxWidth: isDefault ? 620 : 500 }}>
        <div className="cl-modal-header">
          <div>
            <h2>Назначить смену</h2>
            <span className="cl-modal-meta">{template.name}</span>
          </div>
          <button className="cl-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="cl-modal-body">
          <div className="cl-field">
            <label>Сотрудники *</label>
            <MultiWorkerSelect workers={cleaners} value={assignedTo} onChange={handleWorkerChange} />
          </div>

          {isDefault ? (
            <div className="cl-field">
              <label>
                Объекты <span style={{ fontWeight: 400, color: '#64748b' }}>({selCount} выбрано из {locations.length})</span>
              </label>
              <div className="def-loc-box">
                <div className="def-loc-toolbar">
                  <input className="def-loc-search" placeholder="Поиск объекта..." value={locSearch} onChange={e => setLocSearch(e.target.value)} />
                  <button className="def-loc-all-btn" onClick={toggleAll}>
                    {filteredLocs.every(l => selectedLocIds?.has(l.id)) ? 'Снять все' : 'Выбрать все'}
                  </button>
                </div>
                <div className="def-loc-legend">
                  <span className="def-loc-chip free">без шаблона</span>
                  <span className="def-loc-chip busy">уже есть</span>
                </div>
                <div className="def-loc-list">
                  {filteredLocs.map(l => {
                    const busy = occupiedLocIds.has(l.id)
                    const checked = selectedLocIds?.has(l.id) ?? false
                    return (
                      <label key={l.id} className={`def-loc-row ${busy ? 'busy' : ''} ${checked ? 'checked' : ''}`}>
                        <input type="checkbox" checked={checked} onChange={() => toggleLoc(l.id)} />
                        <span className="def-loc-city">{l.city}</span>
                        <span className="def-loc-name">{l.name}</span>
                        {busy && <span className="def-loc-busy-tag">есть</span>}
                      </label>
                    )
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="cl-field">
              <label>Объект</label>
              <AssignLocSelect locations={locations} priorityIds={allCleanerLocIds} value={locationId} onChange={setLocationId} />
            </div>
          )}

          <div className="cl-field">
            <label>Расписание</label>
            <div className="am-mode-tabs">
              <button className={`am-mode-tab ${mode==='single'?'active':''}`} onClick={() => setMode('single')}>Один день</button>
              <button className={`am-mode-tab ${mode==='range'?'active':''}`} onClick={() => setMode('range')}>Диапазон</button>
              <button className={`am-mode-tab ${mode==='daily'?'active':''}`} onClick={() => setMode('daily')}>Ежедневно</button>
            </div>
          </div>

          {mode === 'single' && (
            <div className="cl-field">
              <label>Дата</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
          )}
          {mode === 'range' && (
            <div className="cl-field">
              <label>Период</label>
              <div className="am-range-row">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                <span className="am-range-sep">—</span>
                <input type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} />
              </div>
            </div>
          )}
          {mode === 'daily' && (
            <div className="cl-field">
              <label>Начало и количество дней</label>
              <div className="am-range-row">
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                <input type="number" min={1} max={90} value={dailyDays} onChange={e => setDailyDays(Math.min(90, Math.max(1, +e.target.value)))} style={{ width: 80, textAlign: 'center' }} placeholder="дней" />
                <span style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap' }}>дн.</span>
              </div>
            </div>
          )}

          {totalShifts > 1 && !tooMany && (
            <div className="am-dates-preview">
              Будет создано <strong>{totalShifts}</strong> смен{isDefault ? ` (${selCount} объект. × ${assignedTo.length} сотр. × ${dates.length} дн.)` : assignedTo.length > 1 ? ` (${assignedTo.length} сотр. × ${dates.length} дн.)` : `: ${dates[0]}${dates.length > 1 ? ` — ${dates[dates.length-1]}` : ''}`}
            </div>
          )}
          {tooMany && <div className="am-dates-warn">Максимум 90 дней за раз</div>}

          <div className="cl-field">
            <label>Заметки</label>
            <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Дополнительные инструкции..." />
          </div>
        </div>
        <div className="cl-modal-footer">
          <button className="cl-btn-cancel" onClick={onClose}>Отмена</button>
          <button className="cl-btn-save" onClick={handle} disabled={saving || assignedTo.length === 0 || tooMany || (isDefault && selCount === 0)}>
            {saving ? 'Назначение...' : totalShifts > 1 ? `Назначить ${totalShifts} смен` : 'Назначить смену'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── Default template group (for "Остальные адреса") ──────────────────────────
function DefaultTemplateGroup({ templates, onEdit, onAssign, onDelete, open, onToggle }) {
  return (
    <div className="tmpl-group tmpl-group-default">
      <button className="tmpl-group-header" onClick={onToggle}>
        <Globe size={13} className="tmpl-group-pin" style={{ color: '#8fc640' }} />
        <div className="tmpl-group-loc">
          <span className="tmpl-group-addr" style={{ color: '#8fc640', fontWeight: 700 }}>Остальные адреса</span>
          <span style={{ fontSize: 11, color: 'rgba(26,29,30,0.45)', fontWeight: 400, marginLeft: 6 }}>применяется ко всем незакреплённым объектам</span>
        </div>
        <span className="tmpl-group-count">{templates.length} шаблон{templates.length === 1 ? '' : templates.length < 5 ? 'а' : 'ов'}</span>
        <ChevronDown size={14} className={`tmpl-group-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="tmpl-group-body">
          {templates.map(t => (
            <TemplateRow key={t.id} t={t} onEdit={onEdit} onAssign={onAssign} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Template card (grid) ───────────────────────────────────────────────────────
// Single template row inside a group
function TemplateRow({ t, onEdit, onAssign, onDelete }) {
  const zones = t.zones || []
  const totalTasks = (t.items || []).length
  return (
    <div className="tmpl-inner-row">
      <div className="tmpl-inner-name">
        <ClipboardList size={12} className="tmpl-inner-icon" />
        <span>{t.name}</span>
      </div>
      <div className="tmpl-inner-stat">
        {zones.length > 0 && <span className="tmpl-stat-chip zones">{zones.length} зон</span>}
        <span className="tmpl-stat-chip tasks">{totalTasks} задач</span>
      </div>
      <div className="tmpl-inner-btns">
        <button className="tc-btn del" onClick={() => onDelete(t.id)} title="Удалить"><Trash2 size={13} /></button>
        <button className="tc-btn edit" onClick={() => onEdit(t)} title="Редактировать"><Edit2 size={13} /></button>
        <button className="tc-btn assign" onClick={() => onAssign(t)}><Plus size={13} /> Назначить</button>
      </div>
    </div>
  )
}

// Group of templates by address (controlled)
function TemplateGroup({ city, address, templates, onEdit, onAssign, onDelete, open, onToggle }) {
  const label = address || 'Без объекта'
  return (
    <div className="tmpl-group">
      <button className="tmpl-group-header" onClick={onToggle}>
        <MapPin size={13} className="tmpl-group-pin" />
        <div className="tmpl-group-loc">
          {city && <span className="tmpl-group-city">{city}</span>}
          <span className="tmpl-group-addr">{label}</span>
        </div>
        <span className="tmpl-group-count">{templates.length} шаблон{templates.length === 1 ? '' : templates.length < 5 ? 'а' : 'ов'}</span>
        <ChevronDown size={14} className={`tmpl-group-chevron ${open ? 'open' : ''}`} />
      </button>
      {open && (
        <div className="tmpl-group-body">
          {templates.map(t => (
            <TemplateRow key={t.id} t={t} onEdit={onEdit} onAssign={onAssign} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Active card ────────────────────────────────────────────────────────────────
// ── 3-level monitor: Объект → Шаблон → Клинеры ───────────────────────────────
const AM_STATUS = {
  completed:  { dot: 'am-dot green',  badge: 'am-badge green',  label: 'Завершено'  },
  in_progress:{ dot: 'am-dot blue',   badge: 'am-badge blue',   label: 'В процессе' },
  pending:    { dot: 'am-dot amber',  badge: 'am-badge amber',  label: 'Ожидает'    },
  behind:     { dot: 'am-dot red',    badge: 'am-badge red',    label: 'Отстаёт'    },
}

function workerInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(' ')
  return parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0][0]
}

const fmtShiftDate = (v) => v
  ? new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
  : '—'

const fmtHHMM = (v) => v
  ? new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  : null

// ── Детали смены (раскрывается под строкой даты) ─────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL || 'https://opu.ic-group.kz'

function PhotoLightbox({ photos, index, onClose }) {
  const [i, setI] = useState(index || 0)
  const prev = (e) => { e?.stopPropagation(); setI(v => (v - 1 + photos.length) % photos.length) }
  const next = (e) => { e?.stopPropagation(); setI(v => (v + 1) % photos.length) }
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, photos.length])
  return (
    <div className="sd-lightbox" onClick={onClose}>
      <img src={photos[i]} className="sd-lightbox-img" onClick={e => e.stopPropagation()} alt="" />
      {photos.length > 1 && (
        <>
          <button className="sd-lightbox-nav prev" onClick={prev}>‹</button>
          <button className="sd-lightbox-nav next" onClick={next}>›</button>
          <div className="sd-lightbox-count" onClick={e => e.stopPropagation()}>{i + 1} / {photos.length}</div>
        </>
      )}
      <button className="sd-lightbox-close" onClick={onClose}>✕</button>
    </div>
  )
}

function ShiftDetail({ checklistId }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [openZones, setOpenZones] = useState({})
  const [lightbox, setLightbox] = useState(null)   // { list: [url...], i }

  useEffect(() => {
    api.get(`/checklists/active/${checklistId}`)
      .then(r => setData(r.data.checklist))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [checklistId])

  if (loading) return <div className="sd-loading"><RefreshCw size={12} className="spin" /> Загрузка...</div>
  if (!data) return null

  const items = data.items || []
  const zones = [...new Set(items.map(it => it.zone || 'Общие'))]
  const done  = items.filter(it => it.completed).length

  const toggleZone = (zone) =>
    setOpenZones(s => ({ ...s, [zone]: !s[zone] }))

  return (
    <div className="sd-wrap">
      {lightbox && <PhotoLightbox photos={lightbox.list} index={lightbox.i} onClose={() => setLightbox(null)} />}
      <div className="sd-summary">
        <span className="sd-done">{done} выполнено</span>
        <span className="sd-total">из {items.length}</span>
        {done < items.length && <span className="sd-remain">· {items.length - done} не выполнено</span>}
      </div>
      {zones.map(zone => {
        const zItems   = items.filter(it => (it.zone || 'Общие') === zone)
        const zDone    = zItems.filter(it => it.completed).length
        const isOpen   = !!openZones[zone]
        const allDone  = zDone === zItems.length
        return (
          <div key={zone} className="sd-zone">
            <div className="sd-zone-header clickable" onClick={() => toggleZone(zone)}>
              <div className={`sd-zone-dot ${allDone ? 'full' : zDone > 0 ? 'partial' : ''}`} />
              <span className="sd-zone-name">{zone}</span>
              <span className={`sd-zone-count ${allDone ? 'full' : ''}`}>{zDone}/{zItems.length}</span>
              <ChevronDown size={12} className={`sd-zone-chevron ${isOpen ? 'open' : ''}`} />
            </div>
            {isOpen && zItems.map(item => (
              <div key={item.id} className={`sd-item ${item.completed ? 'done' : 'miss'}`}>
                <div className={`sd-check ${item.completed ? 'done' : ''}`}>
                  {item.completed
                    ? <CheckCircle2 size={13} />
                    : <div className="sd-check-empty" />
                  }
                </div>
                <span className="sd-item-title">{item.title}</span>
                {item.completed && fmtHHMM(item.completed_at) && (
                  <span className="sd-item-time">{fmtHHMM(item.completed_at)}</span>
                )}
                {!item.completed && <span className="sd-miss-label">Не выполнено</span>}
                {(() => {
                  const raw = (item.photos && item.photos.length) ? item.photos : (item.photo_url ? [item.photo_url] : [])
                  if (!raw.length) return null
                  const urls = raw.map(p => API_BASE + p)
                  return (
                    <div className="sd-photos">
                      {urls.slice(0, 4).map((u, idx) => (
                        <button
                          key={idx}
                          className="sd-photo-btn"
                          onClick={() => setLightbox({ list: urls, i: idx })}
                          title="Посмотреть фото"
                        >
                          <img src={u} className="sd-photo-thumb" alt="" />
                          {idx === 0 && urls.length > 1 && <span className="sd-photo-badge">{urls.length}</span>}
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function deriveStatus(shifts) {
  if (shifts.every(s => s.status === 'completed')) return 'completed'
  if (shifts.some(s => s.status === 'in_progress')) return 'in_progress'
  return 'pending'
}

function ActiveMonitor({ active, onComplete, onDelete, onDeleteWorker }) {
  const [openLoc,  setOpenLoc]  = useState({})  // locationKey → bool
  const [openTmpl, setOpenTmpl] = useState({})  // templateKey → bool
  const [openWrkr, setOpenWrkr] = useState({})  // workerKey   → bool

  // Build 3-level tree: location → template → worker → shifts[]
  const tree = useMemo(() => {
    const locMap = {}
    active.forEach(ac => {
      const locKey  = String(ac.location_id  || '__none__')
      const tmplKey = String(ac.template_id  || '__none__')
      const wrkKey  = String(ac.assigned_to  || '__none__')

      if (!locMap[locKey]) locMap[locKey] = {
        key: locKey,
        city: ac.location_city || '',
        name: ac.location_name || '',
        templates: {}
      }
      const loc = locMap[locKey]

      if (!loc.templates[tmplKey]) loc.templates[tmplKey] = {
        key: `${locKey}__${tmplKey}`,
        name: ac.template_name || '—',
        workers: {}
      }
      const tmpl = loc.templates[tmplKey]

      if (!tmpl.workers[wrkKey]) tmpl.workers[wrkKey] = {
        key: `${locKey}__${tmplKey}__${wrkKey}`,
        name: ac.assigned_to_name || '—',
        shifts: []
      }
      tmpl.workers[wrkKey].shifts.push(ac)
    })

    return Object.values(locMap).sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'ru')
    )
  }, [active])

  const toggle = (setter, key) => setter(p => ({ ...p, [key]: !p[key] }))

  return (
    <div className="am3-wrap">
      {tree.map(loc => {
        const allShifts   = Object.values(loc.templates).flatMap(t => Object.values(t.workers).flatMap(w => w.shifts))
        const totalPlan   = allShifts.reduce((s, ac) => s + (ac.total_items || 0), 0)
        const totalDone   = allShifts.reduce((s, ac) => s + (ac.completed_items || ac.done_items || 0), 0)
        const locStatus   = deriveStatus(allShifts)
        const locCfg      = AM_STATUS[locStatus]
        const isLocOpen   = openLoc[loc.key] !== false
        const uniqueWorkers = new Set(allShifts.map(s => s.assigned_to)).size

        return (
          <div key={loc.key} className="am3-loc">
            {/* ── Уровень 1: Объект ── */}
            <button className={`am3-loc-row ${locStatus}`} onClick={() => toggle(setOpenLoc, loc.key)}>
              <div className="am3-loc-left">
                <span className={locCfg.dot} />
                <div className="am3-loc-info">
                  {loc.city && <span className="am3-city">{loc.city}</span>}
                  <span className="am3-locname">{loc.name || 'Без объекта'}</span>
                </div>
                <span className="am3-loc-meta">{uniqueWorkers} клин. · {totalPlan} задач</span>
              </div>
              <div className="am3-loc-right">
                <span className={locCfg.badge}>{locCfg.label}</span>
                {totalPlan > 0 && (
                  <div className="am3-mini-bar">
                    <div className={`am3-mini-fill ${locStatus}`} style={{ width: `${Math.round(totalDone/totalPlan*100)}%` }} />
                  </div>
                )}
                <ChevronDown size={14} className={`am-chevron ${isLocOpen ? 'open' : ''}`} />
              </div>
            </button>

            {isLocOpen && Object.values(loc.templates).map(tmpl => {
              const tmplShifts  = Object.values(tmpl.workers).flatMap(w => w.shifts)
              const tmplStatus  = deriveStatus(tmplShifts)
              const tmplCfg     = AM_STATUS[tmplStatus]
              const tmplDone    = tmplShifts.reduce((s, ac) => s + (ac.completed_items || ac.done_items || 0), 0)
              const tmplPlan    = tmplShifts.reduce((s, ac) => s + (ac.total_items || 0), 0)
              const isTmplOpen  = openTmpl[tmpl.key] !== false
              const workerCount = Object.keys(tmpl.workers).length

              return (
                <div key={tmpl.key} className="am3-tmpl">
                  {/* ── Уровень 2: Шаблон ── */}
                  <button className={`am3-tmpl-row ${tmplStatus}`} onClick={() => toggle(setOpenTmpl, tmpl.key)}>
                    <div className="am3-tmpl-left">
                      <span className={tmplCfg.dot} style={{ width: 7, height: 7 }} />
                      <span className="am3-tmpl-name">{tmpl.name}</span>
                      <span className="am3-tmpl-meta">{workerCount} чел. · {tmplPlan} задач</span>
                    </div>
                    <div className="am3-tmpl-right">
                      <span className={`am3-progress-txt ${tmplStatus}`}>{tmplDone}/{tmplPlan}</span>
                      <span className={tmplCfg.badge}>{tmplCfg.label}</span>
                      <ChevronDown size={12} className={`am-chevron ${isTmplOpen ? 'open' : ''}`} />
                    </div>
                  </button>

                  {isTmplOpen && (
                    <div className="am3-workers-wrap">
                      {Object.values(tmpl.workers).map(wrk => {
                        const wStatus = deriveStatus(wrk.shifts)
                        const wCfg    = AM_STATUS[wStatus]
                        const wDone   = wrk.shifts.reduce((s, ac) => s + (ac.completed_items || ac.done_items || 0), 0)
                        const wPlan   = wrk.shifts.reduce((s, ac) => s + (ac.total_items || 0), 0)
                        const wPct    = wPlan > 0 ? Math.round(wDone / wPlan * 100) : 0
                        const isWOpen = openWrkr[wrk.key]
                        const sorted  = [...wrk.shifts].sort((a, b) => (a.shift_date || '').localeCompare(b.shift_date || ''))

                        return (
                          <div key={wrk.key} className="am3-worker">
                            {/* ── Уровень 3: Клинер ── */}
                            <div className={`am3-worker-row ${wStatus}`} onClick={() => toggle(setOpenWrkr, wrk.key)}>
                              <div className="am3-worker-left">
                                <div className={`am-avatar ${wStatus}`}>{workerInitials(wrk.name)}</div>
                                <span className="am3-worker-name">{wrk.name}</span>
                                <span className="am3-worker-meta">{wrk.shifts.length} смен</span>
                              </div>
                              <div className="am3-worker-right">
                                <div className="am3-micro-bar">
                                  <div className={`am3-micro-fill ${wStatus}`} style={{ width: `${wPct}%` }} />
                                </div>
                                <span className={`am3-progress-txt ${wStatus}`}>{wDone}/{wPlan}</span>
                                <span className={wCfg.badge}>{wCfg.label}</span>
                                <ChevronDown size={11} className={`am-chevron ${isWOpen ? 'open' : ''}`} />
                                <button
                                  className="am3-del-worker-btn"
                                  title={`Удалить все смены (${wrk.shifts.length})`}
                                  onClick={e => {
                                    e.stopPropagation()
                                    if (window.confirm(`Удалить все ${wrk.shifts.length} смен у ${wrk.name}?`)) {
                                      onDeleteWorker(wrk.shifts.map(s => s.id))
                                    }
                                  }}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>

                            {/* Список смен по датам */}
                            {isWOpen && (
                              <div className="am3-shifts">
                                {sorted.map(ac => {
                                  const ss   = ac.status === 'completed' ? 'completed' : ac.status === 'in_progress' ? 'in_progress' : 'pending'
                                  const sCfg = AM_STATUS[ss]
                                  const done = ac.completed_items || ac.done_items || 0
                                  const plan = ac.total_items || 0
                                  const isShiftOpen = openWrkr[`shift_${ac.id}`]
                        return (
                                    <div key={ac.id} className="am3-shift-wrap">
                                      <div
                                        className={`am3-shift-row ${ss} ${isShiftOpen ? 'open' : ''}`}
                                        onClick={() => toggle(setOpenWrkr, `shift_${ac.id}`)}
                                      >
                                        <span className="am3-shift-date">{fmtShiftDate(ac.shift_date)}</span>
                                        <div className="am3-micro-bar sm">
                                          <div className={`am3-micro-fill ${ss}`} style={{ width: `${plan ? Math.round(done/plan*100) : 0}%` }} />
                                        </div>
                                        <span className={`am3-progress-txt ${ss}`}>{done}/{plan}</span>
                                        <span className={sCfg.badge}>{sCfg.label}</span>
                                        <ChevronDown size={11} className={`am-chevron ${isShiftOpen ? 'open' : ''}`} style={{ marginLeft: 'auto' }} />
                                        <div className="am-worker-actions" onClick={e => e.stopPropagation()}>
                                          {ac.status !== 'completed' && (
                                            <button className="am-complete-btn" onClick={() => onComplete(ac.id)} title="Завершить">
                                              <CheckCircle2 size={12} />
                                            </button>
                                          )}
                                          <button className="am-del-btn" onClick={() => onDelete(ac.id)} title="Удалить">
                                            <Trash2 size={11} />
                                          </button>
                                        </div>
                                      </div>
                                      {isShiftOpen && <ShiftDetail checklistId={ac.id} />}
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── History List ──────────────────────────────────────────────────────────────
const fmtDay = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Сегодня'
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
}
const fmtTime = (v) => v ? new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''

function HistoryList() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/checklists/history')
      .then(r => setItems(r.data.history || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const grouped = useMemo(() => {
    const map = {}
    items.forEach(h => {
      const day = fmtDay(h.completed_at || h.shift_date)
      if (!map[day]) map[day] = []
      map[day].push(h)
    })
    return Object.entries(map)
  }, [items])

  if (loading) return <div className="cl-loading"><RefreshCw size={18} className="spin" /> Загрузка...</div>
  if (!items.length) return <div className="cl-empty"><p>История пуста</p></div>

  return (
    <div className="hist-list">
      {grouped.map(([day, rows]) => (
        <div key={day} className="hist-day-group">
          <div className="hist-day-label">{day} <span className="hist-day-count">{rows.length}</span></div>
          <div className="hist-day-rows">
            {rows.map(h => {
              const loc = [h.location_city, h.location_name].filter(Boolean).join(' · ')
              return (
                <div key={h.id} className="hist-row">
                  <div className={`hist-avatar`}>{workerInitials(h.assigned_to_name)}</div>
                  <div className="hist-info">
                    <div className="hist-name">{h.assigned_to_name || '—'}</div>
                    <div className="hist-tmpl">{h.template_name}</div>
                    {loc && <div className="hist-loc">{loc}</div>}
                  </div>
                  <div className="hist-meta">
                    {h.total_items > 0 && (
                      <span className="hist-tasks-chip">{h.total_items} задач</span>
                    )}
                    <span className="hist-time">{fmtTime(h.completed_at)}</span>
                    <span className="hist-done-badge"><CheckCircle2 size={11} /> Завершено</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Checklists() {
  const { user } = useStore()
  const isAdmin = ['admin', 'partner'].includes(user?.role)

  const [templates, setTemplates] = useState([])
  const [active, setActive]       = useState([])
  const [users, setUsers]         = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState('templates')
  const [search, setSearch]       = useState('')
  const [openGroups, setOpenGroups] = useState({}) // key → bool; undefined = open (default)

  const [editTmpl, setEditTmpl]   = useState(null)
  const [showNew, setShowNew]     = useState(false)
  const [assignTmpl, setAssignTmpl] = useState(null)

  // Active filters
  const [fStatus, setFStatus]   = useState('')        // '' | 'pending' | 'in_progress' | 'completed'
  const [fDate,   setFDate]     = useState('today')   // '' | 'today' | 'week' | 'YYYY-MM-DD'
  const [fWorker, setFWorker]   = useState('')        // free text

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [tRes, aRes] = await Promise.all([
        api.get('/checklists/templates'),
        api.get('/checklists/active'),
      ])
      const tmplList = tRes.data.templates || []
      const detailed = await Promise.all(
        tmplList.map(t => api.get(`/checklists/templates/${t.id}`).then(r => r.data.template || t).catch(() => t))
      )
      setTemplates(detailed)
      setActive(aRes.data.checklists || [])
    } catch (e) { console.error('loadAll error:', e) }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [])

  useEffect(() => {
    if (!isAdmin) return
    api.get('/users').then(r => setUsers(r.data.users || [])).catch(() => {})
    api.get('/locations/cleaning?limit=200').then(r => setLocations(r.data.locations || [])).catch(() => {})
  }, [isAdmin])

  const filteredTemplates = useMemo(() => {
    if (!search.trim()) return templates
    const q = search.toLowerCase()
    return templates.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q)
    )
  }, [templates, search])

  const groupedTemplates = useMemo(() => {
    const map = {}
    const defaultTmpls = []
    filteredTemplates.forEach(t => {
      if (t.is_default) { defaultTmpls.push(t); return }
      const key = t.description || ''
      if (!map[key]) map[key] = []
      map[key].push(t)
    })
    const regular = Object.entries(map).sort(([a], [b]) => {
      if (!a && b) return 1
      if (a && !b) return -1
      return a.localeCompare(b, 'ru')
    })
    if (defaultTmpls.length > 0) regular.push(['__default__', defaultTmpls])
    return regular
  }, [filteredTemplates])

  const stats = useMemo(() => ({
    templates: templates.length,
    pending:    active.filter(a => a.status === 'pending').length,
    inProgress: active.filter(a => a.status === 'in_progress').length,
    completed:  active.filter(a => a.status === 'completed').length,
  }), [templates, active])

  const groupedActive = useMemo(() => ({
    in_progress: active.filter(a => a.status === 'in_progress'),
    pending:     active.filter(a => a.status === 'pending'),
    completed:   active.filter(a => a.status === 'completed'),
  }), [active])

  const saveTemplate = async (data) => {
    try {
      if (editTmpl?.id) {
        await api.put(`/checklists/templates/${editTmpl.id}`, data)
      } else {
        await api.post('/checklists/templates', data)
      }
      setEditTmpl(null); setShowNew(false); loadAll()
    } catch (e) { alert('Ошибка: ' + (e.response?.data?.error || e.message)) }
  }

  const deleteTemplate = async (id) => {
    if (!confirm('Удалить шаблон?')) return
    try {
      await api.delete(`/checklists/templates/${id}`)
      loadAll()
    } catch (e) { alert('Ошибка удаления: ' + (e.response?.data?.error || e.message)) }
  }

  const assignTemplate = async (data) => {
    try {
      const { dates, workers, location_ids, ...rest } = data
      const workerList = workers?.length ? workers : (rest.assigned_to ? [rest.assigned_to] : [])
      const locationList = location_ids?.length ? location_ids : [rest.location_id || null]
      const requests = []
      for (const workerId of workerList) {
        for (const locId of locationList) {
          const body = { ...rest, assigned_to: workerId, location_id: locId }
          delete body.location_id_unused
          if (dates && dates.length > 1) {
            dates.forEach(d => requests.push(api.post('/checklists/active', { ...body, shift_date: d })))
          } else {
            requests.push(api.post('/checklists/active', { ...body, shift_date: dates?.[0] || rest.shift_date }))
          }
        }
      }
      // Batch in chunks of 20 to avoid overwhelming server
      for (let i = 0; i < requests.length; i += 20) {
        await Promise.all(requests.slice(i, i + 20))
      }
      setAssignTmpl(null); setTab('active'); loadAll()
    } catch (e) { alert('Ошибка: ' + (e.response?.data?.error || e.message)) }
  }

  const completeActive = async (id) => {
    try {
      await api.post(`/checklists/active/${id}/complete`, {})
      loadAll()
    } catch (e) { alert('Ошибка: ' + (e.response?.data?.error || e.message)) }
  }

  const deleteActive = async (id) => {
    if (!confirm('Удалить смену?')) return
    try {
      await api.delete(`/checklists/active/${id}`)
      loadAll()
    } catch (e) { alert('Ошибка удаления: ' + (e.response?.data?.error || e.message)) }
  }

  const deleteWorkerShifts = async (ids) => {
    try {
      await Promise.all(ids.map(id => api.delete(`/checklists/active/${id}`)))
      loadAll()
    } catch (e) { alert('Ошибка удаления: ' + (e.response?.data?.error || e.message)) }
  }

  const filteredActive = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const weekAgo  = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
    return active.filter(ac => {
      const shiftDay = (ac.shift_date || '').slice(0, 10)
      if (fStatus && ac.status !== fStatus) return false
      if (fDate === 'today' && shiftDay !== todayStr) return false
      if (fDate === 'week'  && (shiftDay < weekAgo || shiftDay > todayStr)) return false
      if (fDate && fDate !== 'today' && fDate !== 'week' && shiftDay !== fDate) return false
      if (fWorker && !(ac.assigned_to_name || '').toLowerCase().includes(fWorker.toLowerCase())) return false
      return true
    })
  }, [active, fStatus, fDate, fWorker])

  const pendingCount = active.filter(a => a.status !== 'completed').length

  return (
    <div className="cl-page">
      {/* Header */}
      <div className="cl-page-header">
        <div>
          <h1>Чек-Листы</h1>
          <p>Шаблоны уборки и активные смены</p>
        </div>
        <div className="cl-page-actions">
          <button className="cl-refresh-btn" onClick={loadAll} title="Обновить">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
          {isAdmin && (
            <button className="cl-new-btn" onClick={() => { setEditTmpl(null); setShowNew(true) }}>
              <Plus size={15} /> Новый шаблон
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="cl-stats">
        <div className="cl-stat-card">
          <div className="cl-stat-icon neutral"><ClipboardList size={16} /></div>
          <div className="cl-stat-info">
            <span className="cl-stat-value">{stats.templates}</span>
            <span className="cl-stat-label">Шаблонов</span>
          </div>
        </div>
        <div className="cl-stat-card">
          <div className="cl-stat-icon orange"><AlertCircle size={16} /></div>
          <div className="cl-stat-info">
            <span className="cl-stat-value orange">{stats.pending}</span>
            <span className="cl-stat-label">Ожидают</span>
          </div>
        </div>
        <div className="cl-stat-card">
          <div className="cl-stat-icon blue"><PlayCircle size={16} /></div>
          <div className="cl-stat-info">
            <span className="cl-stat-value blue">{stats.inProgress}</span>
            <span className="cl-stat-label">В работе</span>
          </div>
        </div>
        <div className="cl-stat-card">
          <div className="cl-stat-icon green"><CheckCircle2 size={16} /></div>
          <div className="cl-stat-info">
            <span className="cl-stat-value green">{stats.completed}</span>
            <span className="cl-stat-label">Завершены</span>
          </div>
        </div>
      </div>

      {/* Tabs + search */}
      <div className="cl-tabs-bar">
        <div className="cl-tabs">
          <button className={`cl-tab ${tab === 'templates' ? 'active' : ''}`} onClick={() => setTab('templates')}>
            Шаблоны <span className="cl-tab-badge">{templates.length}</span>
          </button>
          <button className={`cl-tab ${tab === 'active' ? 'active' : ''}`} onClick={() => setTab('active')}>
            Активные смены
            {pendingCount > 0 && <span className="cl-tab-badge red">{pendingCount}</span>}
          </button>
          <button className={`cl-tab ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
            История
          </button>
        </div>
        {tab === 'templates' && (
          <div className="cl-search-wrap">
            <Search size={13} className="cl-search-icon" />
            <input
              className="cl-search-input"
              placeholder="Поиск по шаблонам..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="cl-search-clear" onClick={() => setSearch('')}><X size={12} /></button>
            )}
          </div>
        )}
      </div>

      {/* Templates grid */}
      {tab === 'templates' && (
        loading ? (
          <div className="cl-loading"><RefreshCw size={18} className="spin" /> Загрузка...</div>
        ) : filteredTemplates.length === 0 ? (
          <div className="cl-empty">
            {search
              ? <><p>Ничего не найдено по запросу «{search}»</p><button className="cl-btn-link" onClick={() => setSearch('')}>Сбросить поиск</button></>
              : <><p>Шаблонов пока нет</p>{isAdmin && <button className="cl-new-btn" onClick={() => setShowNew(true)}><Plus size={15} /> Создать первый</button>}</>
            }
          </div>
        ) : (
          <>
            <div className="tmpl-groups-toolbar">
              <button className="tmpl-collapse-btn" onClick={() => {
                const all = {}
                groupedTemplates.forEach(([desc]) => { all[desc || '__none__'] = false })
                setOpenGroups(all)
              }}>Свернуть все</button>
              <button className="tmpl-collapse-btn" onClick={() => setOpenGroups({})}>
                Развернуть все
              </button>
            </div>
            <div className="cl-templates-groups">
              {groupedTemplates.map(([desc, tmpls]) => {
                const key = desc || '__none__'
                const isOpen = openGroups[key] !== undefined ? openGroups[key] : true
                if (key === '__default__') {
                  return (
                    <DefaultTemplateGroup
                      key="__default__"
                      templates={tmpls}
                      open={isOpen}
                      onToggle={() => setOpenGroups(prev => ({ ...prev, '__default__': !isOpen }))}
                      onEdit={tmpl => { setEditTmpl(tmpl); setShowNew(true) }}
                      onAssign={tmpl => setAssignTmpl(tmpl)}
                      onDelete={deleteTemplate}
                    />
                  )
                }
                const dotIdx = desc.indexOf(' · ')
                const city    = dotIdx > -1 ? desc.slice(0, dotIdx) : ''
                const address = dotIdx > -1 ? desc.slice(dotIdx + 3) : desc
                return (
                  <TemplateGroup
                    key={key}
                    city={city}
                    address={address}
                    templates={tmpls}
                    open={isOpen}
                    onToggle={() => setOpenGroups(prev => ({ ...prev, [key]: !isOpen }))}
                    onEdit={tmpl => { setEditTmpl(tmpl); setShowNew(true) }}
                    onAssign={tmpl => setAssignTmpl(tmpl)}
                    onDelete={deleteTemplate}
                  />
                )
              })}
            </div>
          </>
        )
      )}

      {/* History */}
      {tab === 'history' && <HistoryList />}

      {/* Active checklists monitoring */}
      {tab === 'active' && (
        loading ? (
          <div className="cl-loading"><RefreshCw size={18} className="spin" /> Загрузка...</div>
        ) : (
          <>
            {/* Filters */}
            <div className="af-bar">
              {/* Статус */}
              <div className="af-group">
                {[
                  { v: '',            label: 'Все' },
                  { v: 'pending',     label: 'Ожидают' },
                  { v: 'in_progress', label: 'В процессе' },
                  { v: 'completed',   label: 'Завершены' },
                ].map(({ v, label }) => (
                  <button key={v} className={`af-pill ${fStatus === v ? 'active' : ''}`} onClick={() => setFStatus(v)}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="af-divider" />

              {/* Дата */}
              <div className="af-group">
                {[
                  { v: 'today', label: 'Сегодня' },
                  { v: 'week',  label: '7 дней'  },
                  { v: '',      label: 'Все даты' },
                ].map(({ v, label }) => (
                  <button key={v} className={`af-pill ${fDate === v ? 'active' : ''}`} onClick={() => setFDate(v)}>
                    {label}
                  </button>
                ))}
                <input
                  type="date"
                  className="af-date-input"
                  value={fDate !== 'today' && fDate !== 'week' && fDate !== '' ? fDate : ''}
                  onChange={e => setFDate(e.target.value || '')}
                  title="Конкретная дата"
                />
              </div>

              <div className="af-divider" />

              {/* Клинер */}
              <div className="af-search-wrap">
                <Search size={12} className="af-search-icon" />
                <input
                  className="af-search-input"
                  placeholder="Клинер..."
                  value={fWorker}
                  onChange={e => setFWorker(e.target.value)}
                />
                {fWorker && <button className="af-search-clear" onClick={() => setFWorker('')}><X size={11} /></button>}
              </div>

              {/* Сброс */}
              {(fStatus || fDate !== 'today' || fWorker) && (
                <button className="af-reset" onClick={() => { setFStatus(''); setFDate('today'); setFWorker('') }}>
                  <X size={12} /> Сбросить
                </button>
              )}

              <span className="af-count">{filteredActive.length} смен</span>
            </div>

            {filteredActive.length === 0 ? (
              <div className="cl-empty"><p>Нет смен по выбранным фильтрам</p></div>
            ) : (
              <ActiveMonitor active={filteredActive} onComplete={completeActive} onDelete={deleteActive} onDeleteWorker={deleteWorkerShifts} />
            )}
          </>
        )
      )}

      {/* Modals */}
      {showNew && (
        <TemplateModal
          template={editTmpl}
          onClose={() => { setShowNew(false); setEditTmpl(null) }}
          onSave={saveTemplate}
        />
      )}
      {assignTmpl && (
        <AssignModal
          template={assignTmpl}
          users={users}
          locations={locations}
          active={active}
          onClose={() => setAssignTmpl(null)}
          onSave={assignTemplate}
        />
      )}
    </div>
  )
}
