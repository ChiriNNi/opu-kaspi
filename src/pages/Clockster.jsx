import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Crosshair, LocateFixed, MapPin, RefreshCw, Search, ShieldAlert, Timer, UserRound } from 'lucide-react'
import api from '../api'
import { useStore } from '../store'
import './Clockster.css'

const MANAGER_ROLES = ['admin', 'partner', 'auditor', 'curator']

function formatDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function distanceMeters(a, b) {
  if (!a || !b?.lat || !b?.lng) return null
  const r = 6371000
  const toRad = v => (Number(v) * Math.PI) / 180
  const dLat = toRad(Number(b.lat) - Number(a.lat))
  const dLng = toRad(Number(b.lng) - Number(a.lng))
  const lat1 = toRad(Number(a.lat))
  const lat2 = toRad(Number(b.lat))
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return Math.round(r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)))
}

function statusText(distance, radius) {
  if (distance === null) return 'GPS не определен'
  return distance <= radius ? `В радиусе: ${distance} м` : `Далеко: ${distance} м`
}

export default function Clockster() {
  const { user } = useStore()
  const canManage = MANAGER_ROLES.includes(user?.role)
  const [locations, setLocations] = useState([])
  const [records, setRecords] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [coords, setCoords] = useState(null)
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [locating, setLocating] = useState(false)
  const [checking, setChecking] = useState(false)
  const [savingRadiusId, setSavingRadiusId] = useState(null)

  const selected = useMemo(
    () => locations.find(l => String(l.id) === String(selectedId)) || null,
    [locations, selectedId],
  )

  const nearest = useMemo(() => {
    if (!coords || locations.length === 0) return null
    return locations
      .map(location => ({
        location,
        distance: distanceMeters(coords, location),
        radius: Number(location.clockster_radius_meters || 50),
      }))
      .filter(item => item.distance !== null)
      .sort((a, b) => a.distance - b.distance)[0] || null
  }, [coords, locations])

  const loadLocations = useCallback(async () => {
    const q = search ? `?search=${encodeURIComponent(search)}` : ''
    const res = await api.get(`/clockster/locations${q}`)
    const next = res.data.locations || []
    setLocations(next)
    if (!selectedId && next.length > 0) setSelectedId(String(next[0].id))
  }, [search, selectedId])

  const loadRecords = useCallback(async () => {
    const q = new URLSearchParams()
    if (date) q.set('date', date)
    const res = await api.get(`/clockster/records?${q}`)
    setRecords(res.data.records || [])
  }, [date])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([loadLocations(), loadRecords()])
    } catch (e) {
      setMessage({ type: 'error', text: e.response?.data?.error || 'Не удалось загрузить Clockster' })
    } finally {
      setLoading(false)
    }
  }, [loadLocations, loadRecords])

  useEffect(() => { load() }, [date])

  const locate = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Геолокация не поддерживается этим устройством'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      position => {
        const next = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }
        setCoords(next)
        resolve(next)
      },
      err => reject(new Error(err.message || 'Не удалось получить геолокацию')),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
    )
  })

  const handleLocate = async () => {
    setLocating(true)
    setMessage(null)
    try {
      await locate()
    } catch (e) {
      setMessage({ type: 'error', text: e.message })
    } finally {
      setLocating(false)
    }
  }

  const handleCheckIn = async () => {
    setChecking(true)
    setMessage(null)
    try {
      const current = coords || await locate()
      const target = selected || nearest?.location
      if (!target) throw new Error('Выберите объект для отметки')
      const res = await api.post('/clockster/check-in', {
        location_id: target.id,
        lat: current.lat,
        lng: current.lng,
        accuracy_meters: current.accuracy,
      })
      setMessage({
        type: 'success',
        text: `Отметка сохранена: ${res.data.location?.name || target.name}, расстояние ${Math.round(res.data.attendance.distance_meters)} м`,
      })
      await Promise.all([loadLocations(), loadRecords()])
    } catch (e) {
      const data = e.response?.data
      const detail = data?.distance_meters
        ? `Вы в ${Math.round(data.distance_meters)} м, допустимо ${data.allowed_radius_meters} м`
        : e.message
      setMessage({ type: 'error', text: data?.error === 'Outside allowed radius' ? detail : (data?.error || detail) })
    } finally {
      setChecking(false)
    }
  }

  const saveRadius = async (locationId, value) => {
    const radius = Number(value)
    if (!Number.isFinite(radius)) return
    setSavingRadiusId(locationId)
    try {
      const res = await api.patch(`/clockster/locations/${locationId}/radius`, { radius_meters: radius })
      setLocations(prev => prev.map(l => (
        l.id === locationId ? { ...l, clockster_radius_meters: res.data.location.clockster_radius_meters } : l
      )))
    } catch (e) {
      setMessage({ type: 'error', text: e.response?.data?.error || 'Не удалось сохранить радиус' })
    } finally {
      setSavingRadiusId(null)
    }
  }

  const selectedDistance = distanceMeters(coords, selected)
  const selectedRadius = Number(selected?.clockster_radius_meters || 50)

  return (
    <div className="clk-page">
      <div className="clk-header">
        <div>
          <h1>Clockster</h1>
          <p>{canManage ? 'Контроль отметок сотрудников на объектах' : 'Отметка присутствия на назначенном объекте'}</p>
        </div>
        <button className="clk-icon-btn" onClick={load} title="Обновить">
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
        </button>
      </div>

      <div className="clk-grid">
        <section className="clk-panel clk-check-panel">
          <div className="clk-panel-title">
            <LocateFixed size={17} />
            <span>Отметка на объекте</span>
          </div>

          <div className="clk-field">
            <label>Объект</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}>
              {locations.length === 0 ? (
                <option value="">Нет объектов с координатами</option>
              ) : locations.map(l => (
                <option key={l.id} value={l.id}>{l.city || '—'} · {l.name}</option>
              ))}
            </select>
          </div>

          <div className="clk-location-box">
            <div>
              <span className="clk-muted">Текущая позиция</span>
              <strong>{coords ? `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` : 'Не определена'}</strong>
              {coords?.accuracy && <small>Точность: ±{Math.round(coords.accuracy)} м</small>}
            </div>
            <button className="clk-secondary" onClick={handleLocate} disabled={locating}>
              <Crosshair size={15} />
              {locating ? 'Ищем...' : 'Определить'}
            </button>
          </div>

          {selected && (
            <div className={`clk-distance ${selectedDistance !== null && selectedDistance <= selectedRadius ? 'ok' : ''}`}>
              <MapPin size={16} />
              <div>
                <strong>{statusText(selectedDistance, selectedRadius)}</strong>
                <span>Радиус объекта: {selectedRadius} м</span>
              </div>
            </div>
          )}

          {nearest && (
            <button className="clk-nearest" onClick={() => setSelectedId(String(nearest.location.id))}>
              Ближайший: {nearest.location.name} · {nearest.distance} м
            </button>
          )}

          {message && (
            <div className={`clk-message ${message.type}`}>
              {message.type === 'success' ? <CheckCircle2 size={16} /> : <ShieldAlert size={16} />}
              <span>{message.text}</span>
            </div>
          )}

          <button className="clk-primary" onClick={handleCheckIn} disabled={checking || locations.length === 0}>
            <CheckCircle2 size={18} />
            {checking ? 'Сохраняем...' : 'Отметиться'}
          </button>
        </section>

        <section className="clk-panel">
          <div className="clk-panel-title">
            <Timer size={17} />
            <span>История</span>
          </div>
          <div className="clk-record-tools">
            <input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div className="clk-records">
            {records.length === 0 ? (
              <div className="clk-empty">Отметок за выбранный день нет</div>
            ) : records.map(r => (
              <div key={r.id} className="clk-record">
                <div className="clk-record-main">
                  <strong>{canManage ? (r.user_name || r.user_phone) : r.location_name}</strong>
                  <span>{canManage ? `${r.city || '—'} · ${r.location_name}` : formatDateTime(r.checked_at)}</span>
                </div>
                <div className="clk-record-meta">
                  <span>{formatDateTime(r.checked_at)}</span>
                  <b>{Math.round(r.distance_meters)} м</b>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="clk-panel clk-wide">
        <div className="clk-list-head">
          <div className="clk-panel-title">
            <MapPin size={17} />
            <span>Объекты</span>
          </div>
          <div className="clk-search">
            <Search size={14} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') loadLocations() }}
              placeholder="Поиск по объектам"
            />
          </div>
        </div>

        <div className="clk-table-wrap">
          <table className="clk-table">
            <thead>
              <tr>
                <th>Город</th>
                <th>Объект</th>
                <th>Ответственный</th>
                <th>Радиус</th>
                <th>Последняя отметка</th>
              </tr>
            </thead>
            <tbody>
              {locations.map(l => (
                <tr key={l.id}>
                  <td>{l.city || '—'}</td>
                  <td>
                    <div className="clk-object-name">
                      <strong>{l.name}</strong>
                      <span>ID {l.kaspi_id || l.id}</span>
                    </div>
                  </td>
                  <td>{l.responsible || l.partner_name || '—'}</td>
                  <td>
                    {canManage ? (
                      <div className="clk-radius-edit">
                        <input
                          type="number"
                          min="10"
                          max="1000"
                          defaultValue={l.clockster_radius_meters || 50}
                          onBlur={e => saveRadius(l.id, e.target.value)}
                        />
                        <span>м</span>
                        {savingRadiusId === l.id && <RefreshCw size={12} className="spin" />}
                      </div>
                    ) : `${l.clockster_radius_meters || 50} м`}
                  </td>
                  <td>
                    {l.last_checked_at ? (
                      <div className="clk-last">
                        <span>{formatDateTime(l.last_checked_at)}</span>
                        {l.last_user_name && <small>{l.last_user_name}</small>}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {!loading && locations.length === 0 && (
                <tr><td colSpan={5} className="clk-empty">Нет доступных объектов с координатами</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
