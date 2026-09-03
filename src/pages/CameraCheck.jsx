import { useCallback, useEffect, useRef, useState } from 'react'

// Диагностика камер телефона. Отвечает на один вопрос: отдаёт ли браузер этого
// телефона сверхширокоугольный объектив (0.5x) отдельным устройством — то есть
// можно ли вшить переключатель 0.5x в нашу съёмку отчётов, не выходя в родную камеру.
//
// Маршрут /camera-check зарегистрирован только в админском блоке App.jsx и нигде не
// показан в меню: у остальных ролей его перехватывает Route path="*". Страница
// одноразовая, поэтому стили инлайновые — отдельный CSS не заводим.

const box = {
  background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 14,
  padding: 14, marginBottom: 12,
}
const btn = {
  padding: '11px 16px', borderRadius: 12, border: 'none', background: '#1A1D1E',
  color: '#fff', fontSize: 14, fontWeight: 800, fontFamily: 'inherit', cursor: 'pointer',
}
const btnLight = { ...btn, background: '#f1f3ec', color: '#1A1D1E' }
const mono = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11,
  whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
}

const shortId = (id) => (id ? `${String(id).slice(0, 10)}…` : '—');

export default function CameraCheck() {
  const [devices, setDevices] = useState([])
  const [probed, setProbed] = useState({})   // deviceId -> { settings, capabilities, error }
  const [activeId, setActiveId] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [])

  // Камеру обязательно гасим при уходе со страницы — иначе на телефоне
  // останется горящий индикатор и занятый объектив.
  useEffect(() => stopStream, [stopStream])

  // enumerateDevices() возвращает пустые label, пока не выдано разрешение на камеру,
  // поэтому сначала один раз открываем поток, потом перечисляем и поток закрываем.
  const enumerate = useCallback(async () => {
    setError(''); setBusy(true); setStatus('Запрашиваю доступ к камере...')
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Браузер не поддерживает mediaDevices — камера недоступна')
      }
      const probe = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      probe.getTracks().forEach(t => t.stop())

      setStatus('Читаю список камер...')
      const all = await navigator.mediaDevices.enumerateDevices()
      const cams = all.filter(d => d.kind === 'videoinput')
      setDevices(cams.map(d => ({ deviceId: d.deviceId, label: d.label, groupId: d.groupId })))
      setStatus(`Найдено камер: ${cams.length}`)
    } catch (e) {
      setError(`${e.name || 'Ошибка'}: ${e.message || String(e)}`)
      setStatus('')
    } finally {
      setBusy(false)
    }
  }, [])

  const openDevice = useCallback(async (deviceId) => {
    setError(''); setBusy(true)
    stopStream()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }
      const track = stream.getVideoTracks()[0]
      const settings = track?.getSettings ? track.getSettings() : null
      const capabilities = track?.getCapabilities ? track.getCapabilities() : null
      setProbed(prev => ({ ...prev, [deviceId]: { settings, capabilities } }))
      setActiveId(deviceId)
      return { settings, capabilities }
    } catch (e) {
      const msg = `${e.name || 'Ошибка'}: ${e.message || String(e)}`
      setProbed(prev => ({ ...prev, [deviceId]: { error: msg } }))
      setError(msg)
      return { error: msg }
    } finally {
      setBusy(false)
    }
  }, [stopStream])

  // Прогон по всем камерам подряд — чтобы одним нажатием собрать полный отчёт.
  const scanAll = useCallback(async () => {
    for (const d of devices) {
      setStatus(`Проверяю: ${d.label || shortId(d.deviceId)}`)
      await openDevice(d.deviceId)
    }
    stopStream()
    setActiveId('')
    setStatus('Проверены все камеры — можно копировать отчёт')
  }, [devices, openDevice, stopStream])

  const report = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}`,
    camerasFound: devices.length,
    cameras: devices.map(d => ({ ...d, ...(probed[d.deviceId] || {}) })),
  }

  const copyReport = async () => {
    const text = JSON.stringify(report, null, 2)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Не удалось скопировать — выделите текст отчёта ниже вручную')
    }
  }

  const zoomOf = (cap) => {
    if (!cap || !('zoom' in cap)) return 'зум не поддерживается'
    const z = cap.zoom || {}
    return `зум ${z.min ?? '?'}–${z.max ?? '?'} (шаг ${z.step ?? '?'})`
  }

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 4px' }}>Диагностика камер</h1>
      <div style={{ fontSize: 13, color: 'rgba(26,29,30,0.55)', lineHeight: 1.5, marginBottom: 14 }}>
        Открой эту страницу на телефоне. Она показывает, какие объективы браузер отдаёт
        веб-странице. Если задних камер несколько — переключатель 0.5x в нашу съёмку
        вшить можно; если браузер отдаёт одну «заднюю камеру» — нельзя.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" style={btn} onClick={enumerate} disabled={busy}>
          {devices.length ? 'Обновить список' : 'Начать проверку'}
        </button>
        {devices.length > 1 && (
          <button type="button" style={btnLight} onClick={scanAll} disabled={busy}>
            Проверить все подряд
          </button>
        )}
        {devices.length > 0 && (
          <button type="button" style={btnLight} onClick={copyReport} disabled={busy}>
            {copied ? 'Скопировано' : 'Скопировать отчёт'}
          </button>
        )}
      </div>

      {status && <div style={{ ...box, background: '#f5fbe9', fontSize: 13, fontWeight: 600 }}>{status}</div>}
      {error && <div style={{ ...box, background: '#fee2e2', color: '#dc2626', fontSize: 13, fontWeight: 600 }}>{error}</div>}

      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          width: '100%', borderRadius: 14, background: '#000',
          display: activeId ? 'block' : 'none', marginBottom: 12,
        }}
      />
      {activeId && (
        <div style={{ fontSize: 12, color: 'rgba(26,29,30,0.55)', marginBottom: 12, lineHeight: 1.5 }}>
          Сравни картинку у разных камер: у сверхширокоугольной (0.5x) в кадр влезает
          заметно больше. Ширину угла браузер числом не сообщает — только так, глазами.
        </div>
      )}

      {devices.map((d, i) => {
        const p = probed[d.deviceId] || {}
        const s = p.settings
        return (
          <div key={d.deviceId || i} style={{ ...box, ...(activeId === d.deviceId ? { borderColor: '#8fc640', borderWidth: 2 } : null) }}>
            <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>
              {i + 1}. {d.label || <span style={{ color: 'rgba(26,29,30,0.4)' }}>без названия</span>}
            </div>
            <p style={{ ...mono, color: 'rgba(26,29,30,0.5)', marginBottom: 8 }}>
              deviceId: {shortId(d.deviceId)}{'\n'}
              groupId: {shortId(d.groupId)}
            </p>
            {s && (
              <p style={{ ...mono, marginBottom: 8 }}>
                разрешение: {s.width}×{s.height}{'\n'}
                facingMode: {s.facingMode || '—'}{'\n'}
                {zoomOf(p.capabilities)}
              </p>
            )}
            {p.error && <p style={{ ...mono, color: '#dc2626', marginBottom: 8 }}>{p.error}</p>}
            <button type="button" style={btnLight} onClick={() => openDevice(d.deviceId)} disabled={busy}>
              Показать эту камеру
            </button>
          </div>
        )
      })}

      {devices.length > 0 && (
        <details style={box}>
          <summary style={{ fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Полный отчёт (JSON)</summary>
          <p style={{ ...mono, marginTop: 10 }}>{JSON.stringify(report, null, 2)}</p>
        </details>
      )}
    </div>
  )
}
