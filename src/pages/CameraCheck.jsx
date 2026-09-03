import { useCallback, useEffect, useRef, useState } from 'react'

// Диагностика камер телефона. Отвечает на один вопрос: можно ли вшить 0.5x в нашу
// съёмку отчётов, не выходя в родную камеру телефона.
//
// Два возможных пути, и страница проверяет оба:
//   1) взять заднюю камеру, которая заявляет zoom.min < 1, и применить zoom: 0.5
//      (так работает iPhone: «Задняя двойная широкоугольная» отдаёт 0.5–10 и iOS сама
//      переключает объектив внутри одного потока — как в родной камере);
//   2) взять сверхширокоугольную отдельным устройством по deviceId.
//
// Кандидатов ищем по возможностям (zoom.min < 1 + facingMode: environment), а НЕ по
// названию камеры: на iOS название локализовано, на Android это вообще «camera2 0,
// facing back». Заявленный диапазон зума ещё не значит, что он применится, поэтому
// после applyConstraints() перечитываем getSettings() и показываем, что реально встало.
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
const btnAccent = { ...btn, background: '#8fc640', color: '#1A1D1E' }
const mono = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11,
  whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
}

const shortId = (id) => (id ? `${String(id).slice(0, 10)}…` : '—')

const zoomCaps = (cap) => (cap && cap.zoom && typeof cap.zoom.min === 'number' ? cap.zoom : null)
const isBack = (settings, cap) => settings?.facingMode === 'environment'
  || (Array.isArray(cap?.facingMode) && cap.facingMode.includes('environment'))

export default function CameraCheck() {
  const [devices, setDevices] = useState([])
  const [probed, setProbed] = useState({})   // deviceId -> { settings, capabilities, error }
  const [activeId, setActiveId] = useState('')
  const [zoomState, setZoomState] = useState(null) // { min, max, requested, applied, error }
  const [verdict, setVerdict] = useState(null)     // { ok, text }
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
    setError('')
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
      const z = zoomCaps(capabilities)
      setZoomState(z ? { min: z.min, max: z.max, applied: settings?.zoom ?? null } : null)
      return { settings, capabilities, track }
    } catch (e) {
      const msg = `${e.name || 'Ошибка'}: ${e.message || String(e)}`
      setProbed(prev => ({ ...prev, [deviceId]: { error: msg } }))
      setError(msg)
      setZoomState(null)
      return { error: msg }
    }
  }, [stopStream])

  const openDeviceUi = useCallback(async (deviceId) => {
    setBusy(true); setVerdict(null)
    try { await openDevice(deviceId) } finally { setBusy(false) }
  }, [openDevice])

  // Заявленный в getCapabilities() диапазон — это ещё не гарантия. Применяем и
  // перечитываем getSettings(): только это показывает, что реально встало.
  const applyZoom = useCallback(async (value) => {
    const track = streamRef.current?.getVideoTracks?.()[0]
    if (!track) return null
    setBusy(true)
    try {
      // Базовое (не advanced) ограничение: если зум не поддерживается, получим
      // ошибку вместо тихого игнорирования — для диагностики это и нужно.
      await track.applyConstraints({ zoom: value })
      const applied = track.getSettings?.().zoom ?? null
      setZoomState(prev => ({ ...(prev || {}), requested: value, applied, error: null }))
      return applied
    } catch (e) {
      const msg = `${e.name || 'Ошибка'}: ${e.message || String(e)}`
      setZoomState(prev => ({ ...(prev || {}), requested: value, applied: null, error: msg }))
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  // Главная проверка: ищем заднюю камеру, которая умеет зум меньше 1, и пробуем
  // реально выставить её минимум.
  const testWide = useCallback(async () => {
    setBusy(true); setVerdict(null); setError('')
    try {
      let candidate = null
      let anyBack = false

      for (const d of devices) {
        setStatus(`Проверяю: ${d.label || shortId(d.deviceId)}`)
        const res = await openDevice(d.deviceId)
        if (res.error) continue
        const back = isBack(res.settings, res.capabilities)
        if (back) anyBack = true
        const z = zoomCaps(res.capabilities)
        if (back && z && z.min < 1) { candidate = { d, z }; break }
      }

      if (!candidate) {
        setStatus('')
        setVerdict({
          ok: false,
          text: anyBack
            ? 'Ни одна задняя камера не заявляет зум меньше 1. Через zoom 0.5x не получить — остаётся только отдельная сверхширокоугольная камера, если она есть в списке выше: открой её кнопкой и сравни кадр глазами.'
            : 'Задних камер не найдено вообще — проверь, что разрешение на камеру выдано.',
        })
        return
      }

      const { d, z } = candidate
      setStatus(`Применяю zoom ${z.min} на «${d.label || shortId(d.deviceId)}»...`)
      const applied = await applyZoom(z.min)
      setStatus('')

      if (applied != null && Math.abs(applied - z.min) < 0.01) {
        setVerdict({
          ok: true,
          text: `Работает. Камера «${d.label || shortId(d.deviceId)}»: запрошен zoom ${z.min}, применился ${applied}. Значит 0.5x можно вшить в нашу съёмку — смотри предпросмотр, кадр должен стать заметно шире.`,
        })
      } else {
        setVerdict({
          ok: false,
          text: `Камера «${d.label || shortId(d.deviceId)}» заявляет зум от ${z.min}, но применить его не удалось (сейчас ${applied ?? 'не сообщается'}). Путь через zoom не работает — надо пробовать отдельную сверхширокоугольную камеру по deviceId.`,
        })
      }
    } finally {
      setBusy(false)
    }
  }, [devices, openDevice, applyZoom])

  const report = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    screen: `${window.screen.width}x${window.screen.height} @${window.devicePixelRatio}`,
    camerasFound: devices.length,
    cameras: devices.map(d => ({ ...d, ...(probed[d.deviceId] || {}) })),
    zoomTest: zoomState,
    verdict: verdict?.text || null,
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

  const zoomLabel = (cap) => {
    const z = zoomCaps(cap)
    if (!z) return 'зум не поддерживается'
    return `зум ${z.min}–${z.max}${z.min < 1 ? '  ← умеет 0.5x' : ''}`
  }

  // Кнопки быстрого зума для активной камеры: только значения внутри её диапазона.
  const zoomSteps = zoomState
    ? [zoomState.min, 1, 2].filter((v, i, arr) => arr.indexOf(v) === i && v >= zoomState.min && v <= zoomState.max)
    : []

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 4px' }}>Диагностика камер</h1>
      <div style={{ fontSize: 13, color: 'rgba(26,29,30,0.55)', lineHeight: 1.5, marginBottom: 14 }}>
        Открой на телефоне. «Начать проверку» → разреши доступ → «Проверить 0.5x».
        Страница сама найдёт подходящую заднюю камеру, попробует выставить 0.5x и скажет,
        получилось ли по-настоящему, а не только на бумаге.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button type="button" style={btn} onClick={enumerate} disabled={busy}>
          {devices.length ? 'Обновить список' : 'Начать проверку'}
        </button>
        {devices.length > 0 && (
          <button type="button" style={btnAccent} onClick={testWide} disabled={busy}>
            Проверить 0.5x
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

      {verdict && (
        <div style={{
          ...box,
          background: verdict.ok ? 'rgba(143,198,64,0.15)' : '#fef9c3',
          borderColor: verdict.ok ? '#8fc640' : '#eab308',
          fontSize: 14, fontWeight: 700, lineHeight: 1.5,
        }}>
          {verdict.ok ? '✅ ' : '⚠️ '}{verdict.text}
        </div>
      )}

      <video
        ref={videoRef}
        playsInline
        muted
        style={{
          width: '100%', borderRadius: 14, background: '#000',
          display: activeId ? 'block' : 'none', marginBottom: 10,
        }}
      />

      {activeId && zoomState && (
        <div style={{ ...box, marginBottom: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>
            Зум активной камеры ({zoomState.min}–{zoomState.max})
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {zoomSteps.map(v => (
              <button
                key={v}
                type="button"
                style={Math.abs((zoomState.applied ?? -1) - v) < 0.01 ? btnAccent : btnLight}
                onClick={() => applyZoom(v)}
                disabled={busy}
              >
                {v}x
              </button>
            ))}
          </div>
          <p style={{ ...mono }}>
            запрошено: {zoomState.requested ?? '—'}{'\n'}
            применилось: {zoomState.applied ?? '—'}
            {zoomState.error ? `\nошибка: ${zoomState.error}` : ''}
          </p>
        </div>
      )}

      {activeId && (
        <div style={{ fontSize: 12, color: 'rgba(26,29,30,0.55)', marginBottom: 12, lineHeight: 1.5 }}>
          Жми 0.5x и 1x по очереди и смотри на предпросмотр: если на 0.5x в кадр влезает
          заметно больше — объектив реально переключился. Угол обзора браузер числом не
          сообщает, поэтому окончательная проверка только глазами.
        </div>
      )}

      {devices.map((d, i) => {
        const p = probed[d.deviceId] || {}
        const s = p.settings
        const wide = zoomCaps(p.capabilities)?.min < 1
        return (
          <div key={d.deviceId || i} style={{
            ...box,
            ...(activeId === d.deviceId ? { borderColor: '#8fc640', borderWidth: 2 } : null),
            ...(wide ? { background: 'rgba(143,198,64,0.07)' } : null),
          }}>
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
                {zoomLabel(p.capabilities)}
              </p>
            )}
            {p.error && <p style={{ ...mono, color: '#dc2626', marginBottom: 8 }}>{p.error}</p>}
            <button type="button" style={btnLight} onClick={() => openDeviceUi(d.deviceId)} disabled={busy}>
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
