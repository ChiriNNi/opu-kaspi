import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera } from 'lucide-react'

// Диагностика камер телефона + прототип съёмки с переключателем 0.5x.
//
// Два возможных пути получить широкий угол, страница проверяет оба:
//   1) задняя камера, которая заявляет zoom.min < 1, и применённый zoom: 0.5
//      (так работает iPhone: «Задняя двойная широкоугольная» отдаёт 0.5–10 и iOS сама
//      переключает объектив внутри одного потока — как в родной камере);
//   2) сверхширокоугольная отдельным устройством по deviceId (ожидаемый путь Android).
//
// Кандидатов ищем по возможностям (zoom.min < 1 + facingMode: environment), а НЕ по
// названию камеры: на iOS название локализовано, на Android это «camera2 0, facing back».
// Заявленный диапазон зума ещё не значит, что он применится, поэтому после
// applyConstraints() перечитываем getSettings() и смотрим, что реально встало.
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

const stopTracks = (stream) => stream?.getTracks?.().forEach(t => t.stop())

// ── Прототип съёмки отчёта ────────────────────────────────────────────────────
// Разметка повторяет InlineCamera из PstPage.jsx один в один (те же размеры кнопок,
// отступы, вспышка), чтобы можно было честно оценить ощущение. Отличие одно:
// добавлена пилюля 0.5x / 1x над панелью управления — так, чтобы НЕ сдвигать кнопку
// спуска: клинеры снимают по 16 кадров не глядя, у них моторная память.
//
// Ничего не отправляется на сервер: фото остаются в памяти вкладки как превью.
function MockCapture({ wideSource, onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [flash, setFlash] = useState(false)
  const [lens, setLens] = useState('1x')
  const [switching, setSwitching] = useState(false)
  const [shots, setShots] = useState([])
  const [camError, setCamError] = useState('')
  const [switchMs, setSwitchMs] = useState(null)

  const attach = useCallback(async (stream) => {
    streamRef.current = stream
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      await videoRef.current.play().catch(() => {})
    }
    setReady(true)
  }, [])

  // Открываем ровно как настоящая съёмка отчётов — facingMode: 'environment'.
  // Основной путь остаётся нетронутым, широкий угол включается только по кнопке.
  const openNormal = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
    await attach(stream)
  }, [attach])

  const openWide = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: wideSource.deviceId } },
      audio: false,
    })
    await attach(stream)
    if (wideSource.mode === 'zoom') {
      const track = stream.getVideoTracks()[0]
      try { await track.applyConstraints({ zoom: wideSource.zoom }) } catch { /* останемся на 1x */ }
    }
  }, [attach, wideSource])

  useEffect(() => {
    openNormal().catch(err => {
      setCamError(err.name === 'NotAllowedError'
        ? 'Доступ к камере запрещён. Разрешите доступ в настройках браузера.'
        : 'Камера недоступна на этом устройстве.')
    })
    return () => stopTracks(streamRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Замеряем реальную задержку переключения — её и надо оценивать, а не воображать.
  const switchLens = useCallback(async (next) => {
    if (switching || next === lens) return
    setSwitching(true)
    const t0 = performance.now()
    try {
      stopTracks(streamRef.current)
      if (next === '0.5x') await openWide()
      else await openNormal()
      setLens(next)
      setSwitchMs(Math.round(performance.now() - t0))
    } catch {
      setCamError('Не удалось переключить объектив')
    } finally {
      setSwitching(false)
    }
  }, [switching, lens, openWide, openNormal])

  const snap = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    // Размеры берём из текущего трека, а не запомненные — иначе после переключения
    // объектива кадр уехал бы. Это же надо будет проверить в реальной съёмке.
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    setFlash(true)
    setTimeout(() => setFlash(false), 120)
    const shotLens = lens
    canvas.toBlob(blob => {
      if (!blob) return
      setShots(prev => [...prev, {
        url: URL.createObjectURL(blob),
        kb: Math.round(blob.size / 1024),
        w: canvas.width, h: canvas.height,
        lens: shotLens,
      }])
    }, 'image/jpeg', 0.88)

    // 0.5x не «залипает»: после кадра возвращаемся на 1x. Иначе один раз включат —
    // и весь месяц отчёты будут отсняты широкоугольником, который мылит по краям
    // и хуже в темноте, а по этим фото принимают работу.
    if (lens === '0.5x') switchLens('1x')
  }, [lens, switchLens])

  const done = () => {
    stopTracks(streamRef.current)
    shots.forEach(s => URL.revokeObjectURL(s.url))
    onClose(shots.length)
  }

  const pill = (value) => ({
    padding: '7px 14px', borderRadius: 100, border: 'none', fontFamily: 'inherit',
    fontSize: 13, fontWeight: 800, cursor: 'pointer',
    background: lens === value ? '#8fc640' : 'rgba(255,255,255,0.18)',
    color: lens === value ? '#1A1D1E' : '#fff',
    opacity: switching ? 0.5 : 1,
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {flash && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0.6, zIndex: 2, pointerEvents: 'none' }} />}

      {camError ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, gap: 20 }}>
          <div style={{ color: '#ff6b6b', fontSize: 15, fontWeight: 700, textAlign: 'center', lineHeight: 1.5 }}>{camError}</div>
          <button onClick={done} style={{ color: '#fff', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 16, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Закрыть</button>
        </div>
      ) : (
        <video ref={videoRef} playsInline muted style={{ flex: 1, width: '100%', objectFit: 'cover' }} />
      )}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {!camError && (
        <>
          {/* Пилюля объектива — над панелью, кнопку спуска не двигаем */}
          {wideSource && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '0 24px 10px', background: '#000' }}>
              <button type="button" style={pill('0.5x')} onClick={() => switchLens('0.5x')} disabled={switching}>0.5x</button>
              <button type="button" style={pill('1x')} onClick={() => switchLens('1x')} disabled={switching}>1x</button>
            </div>
          )}

          {/* Плашка-подсказка прототипа: в реальной съёмке её не будет */}
          <div style={{ padding: '0 24px 8px', background: '#000', color: 'rgba(255,255,255,0.45)', fontSize: 11, textAlign: 'center', lineHeight: 1.4 }}>
            {switching ? 'переключаю объектив...' : (
              <>
                прототип — ничего не отправляется
                {switchMs != null && ` · переключение заняло ${switchMs} мс`}
                {!wideSource && ' · широкий угол на этом телефоне недоступен'}
              </>
            )}
          </div>

          <div style={{ padding: '10px 24px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#000' }}>
            <button onClick={done} style={{ color: '#fff', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 16, padding: '10px 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Готово {shots.length > 0 && `(${shots.length} фото)`}
            </button>
            <button onClick={snap} disabled={!ready || switching} style={{ width: 72, height: 72, borderRadius: '50%', background: '#8fc640', border: '4px solid #fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px rgba(143,198,64,0.4)', opacity: (ready && !switching) ? 1 : 0.5 }}>
              <Camera size={28} color="#1A1D1E" />
            </button>
            <div style={{ width: 80 }} />
          </div>

          {shots.length > 0 && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 24px 28px', background: '#000' }}>
              {shots.map((s, i) => (
                <div key={i} style={{ flexShrink: 0, textAlign: 'center' }}>
                  <img src={s.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 10, display: 'block' }} />
                  <div style={{ color: s.lens === '0.5x' ? '#8fc640' : 'rgba(255,255,255,0.5)', fontSize: 10, fontWeight: 800, marginTop: 4 }}>
                    {s.lens}
                  </div>
                  <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>{s.kb} КБ</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function CameraCheck() {
  const [devices, setDevices] = useState([])
  const [probed, setProbed] = useState({})   // deviceId -> { settings, capabilities, error }
  const [activeId, setActiveId] = useState('')
  const [zoomState, setZoomState] = useState(null) // { min, max, requested, applied, error }
  const [verdict, setVerdict] = useState(null)     // { ok, text }
  const [wideSource, setWideSource] = useState(null) // { mode, deviceId, zoom, label }
  const [mockOpen, setMockOpen] = useState(false)
  const [mockResult, setMockResult] = useState(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const stopStream = useCallback(() => {
    stopTracks(streamRef.current)
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
      stopTracks(probe)

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
  // реально выставить её минимум. Найденный источник запоминаем — он же пойдёт
  // в прототип съёмки.
  const testWide = useCallback(async () => {
    setBusy(true); setVerdict(null); setError(''); setWideSource(null)
    try {
      let candidate = null
      let backCams = []

      for (const d of devices) {
        setStatus(`Проверяю: ${d.label || shortId(d.deviceId)}`)
        const res = await openDevice(d.deviceId)
        if (res.error) continue
        const back = isBack(res.settings, res.capabilities)
        if (back) backCams.push(d)
        const z = zoomCaps(res.capabilities)
        if (back && z && z.min < 1) { candidate = { d, z }; break }
      }

      // Путь 1: зум меньше 1 на задней камере (iPhone).
      if (candidate) {
        const { d, z } = candidate
        setStatus(`Применяю zoom ${z.min} на «${d.label || shortId(d.deviceId)}»...`)
        const applied = await applyZoom(z.min)
        setStatus('')
        if (applied != null && Math.abs(applied - z.min) < 0.01) {
          setWideSource({ mode: 'zoom', deviceId: d.deviceId, zoom: z.min, label: d.label })
          setVerdict({
            ok: true,
            text: `Работает через зум. Камера «${d.label || shortId(d.deviceId)}»: запрошен zoom ${z.min}, применился ${applied}. Ниже появилась кнопка прототипа — посмотри, как это будет в съёмке отчёта.`,
          })
          return
        }
        setVerdict({
          ok: false,
          text: `Камера «${d.label || shortId(d.deviceId)}» заявляет зум от ${z.min}, но применить не удалось (сейчас ${applied ?? 'не сообщается'}). Пробую второй путь — отдельным устройством.`,
        })
      }

      // Путь 2: сверхширокоугольная отдельным устройством. Какая из задних камер
      // широкая — API числом не говорит, поэтому берём вторую заднюю и решаем глазами.
      if (backCams.length > 1) {
        const alt = backCams[1]
        setWideSource({ mode: 'device', deviceId: alt.deviceId, label: alt.label })
        setStatus('')
        setVerdict({
          ok: true,
          text: `Через зум не вышло, но задних камер несколько (${backCams.length}). Взял вторую: «${alt.label || shortId(alt.deviceId)}». Открой прототип и сравни кадр глазами — если он шире, путь рабочий.`,
        })
        return
      }

      setStatus('')
      setVerdict({
        ok: false,
        text: backCams.length
          ? 'Задняя камера одна и зум меньше 1 не поддерживается — 0.5x на этом телефоне недоступен.'
          : 'Задних камер не найдено вообще — проверь, что разрешение на камеру выдано.',
      })
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
    wideSource,
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

  const zoomSteps = zoomState
    ? [zoomState.min, 1, 2].filter((v, i, arr) => arr.indexOf(v) === i && v >= zoomState.min && v <= zoomState.max)
    : []

  const openMock = () => {
    stopStream()          // отпускаем камеру диагностики, иначе прототип её не получит
    setActiveId('')
    setMockResult(null)
    setMockOpen(true)
  }

  return (
    <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
      {mockOpen && (
        <MockCapture
          wideSource={wideSource}
          onClose={(n) => { setMockOpen(false); setMockResult(n) }}
        />
      )}

      <h1 style={{ fontSize: 20, fontWeight: 900, margin: '0 0 4px' }}>Диагностика камер</h1>
      <div style={{ fontSize: 13, color: 'rgba(26,29,30,0.55)', lineHeight: 1.5, marginBottom: 14 }}>
        Открой на телефоне. «Начать проверку» → разреши доступ → «Проверить 0.5x».
        Если 0.5x доступен, появится кнопка прототипа — там видно, как это будет
        выглядеть в реальной съёмке отчёта.
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

      {/* Прототип реальной съёмки */}
      <div style={{ ...box, borderColor: wideSource ? '#8fc640' : 'rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 6 }}>Как это будет в съёмке отчёта</div>
        <div style={{ fontSize: 12, color: 'rgba(26,29,30,0.55)', lineHeight: 1.5, marginBottom: 10 }}>
          Экран собран один в один с настоящей съёмкой постоматов, добавлен только
          переключатель 0.5x / 1x над кнопкой спуска. Снимай сколько хочешь — фото
          остаются в телефоне и никуда не отправляются.
          {!wideSource && ' Сначала нажми «Проверить 0.5x», иначе переключателя не будет.'}
        </div>
        <button type="button" style={wideSource ? btnAccent : btnLight} onClick={openMock} disabled={busy}>
          Открыть прототип съёмки
        </button>
        {mockResult != null && (
          <div style={{ fontSize: 12, color: 'rgba(26,29,30,0.55)', marginTop: 10 }}>
            Снято кадров: {mockResult}. В реальной съёмке они бы ушли в отчёт.
          </div>
        )}
      </div>

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
