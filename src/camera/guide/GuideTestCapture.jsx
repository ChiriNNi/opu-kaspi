import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import CameraGuide from './CameraGuide'
import { useCameraGuide } from './useCameraGuide'
import { DEFAULT_GUIDE, DEFAULT_RULES, VIEW_RU, loadGuideConfig } from './config'
import { evaluateSet, expectedNext, photoMeta } from './photoSet'
import { useGuideModel } from './useGuideModel'

// Тестовый стенд «помощника съёмки» для страницы /camera-check (только админ).
// Повторяет раскладку InlineCamera (кнопка спуска на том же месте) и проходит весь сценарий отчёта:
// QR → фото «до» → фото «после» (те же ракурсы) → дефекты. Ничего не отправляет на сервер.

const SECTIONS = [['before', 'До'], ['after', 'После'], ['defect', 'Дефекты']]

export default function GuideTestCapture({ onClose }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [camError, setCamError] = useState('')
  const [flash, setFlash] = useState(false)
  const [cfg, setCfg] = useState({ guide: DEFAULT_GUIDE, rules: DEFAULT_RULES })
  const [section, setSection] = useState('before')
  const [shots, setShots] = useState({ before: [], after: [], defect: [] })
  const [postomatId, setPostomatId] = useState(null)
  const [configLoaded, setConfigLoaded] = useState(false)
  const loader = useGuideModel(configLoaded, cfg.guide.modelUrl)
  const modelState = { idle: 'ожидание', loading: 'загрузка…', ready: 'есть', failed: 'не загрузилась' }[loader.status]

  useEffect(() => {
    loadGuideConfig().then(c => { setCfg(c); setConfigLoaded(true) })
  }, [])
  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => {
        streamRef.current = stream
        videoRef.current.srcObject = stream
        videoRef.current.play().catch(() => {})
        setReady(true)
      })
      .catch(() => setCamError('Камера недоступна'))
    return () => streamRef.current?.getTracks().forEach(t => t.stop())
  }, [])

  const metas = useMemo(() => ({ before: shots.before.map(s => s.meta), after: shots.after.map(s => s.meta) }), [shots])
  const expected = section === 'defect' ? null : expectedNext(section, metas.before, metas.after, cfg.rules)
  const guide = useCameraGuide(videoRef, ready, {
    enabled: true, expected, postomatId, cfg: cfg.guide, model: loader.model, stepKey: `${section}:${shots[section].length}`,
  })
  const evaluation = evaluateSet(metas.before, metas.after, 'ПОЛНАЯ МОЙКА', cfg.rules)

  const snap = useCallback(() => {
    const video = videoRef.current, canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    setFlash(true); setTimeout(() => setFlash(false), 120)
    const meta = { ...photoMeta(guide, expected), issues: guide.issues || [] }
    // на стенде постомат не выбран заранее: фиксируем тот, чей QR сняли первым
    if (guide.isQr && !postomatId) setPostomatId(guide.qrId)
    canvas.toBlob(blob => {
      if (!blob) return
      setShots(prev => ({ ...prev, [section]: [...prev[section], { url: URL.createObjectURL(blob), meta }] }))
    }, 'image/jpeg', 0.88)
  }, [guide, expected, postomatId, section])

  const done = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    Object.values(shots).flat().forEach(s => URL.revokeObjectURL(s.url))
    onClose()
  }

  const stepText = section === 'defect' ? 'Дефекты (необязательно)'
    : `${section === 'before' ? 'До' : 'После'} · фото ${shots[section].length + 1}`

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {flash && <div style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0.6, zIndex: 4, pointerEvents: 'none' }} />}
      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', background: '#000' }}>
        {SECTIONS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setSection(k)} style={{
            flex: 1, padding: '8px 0', borderRadius: 12, border: 'none', fontWeight: 800, fontFamily: 'inherit',
            background: section === k ? '#8fc640' : 'rgba(255,255,255,0.15)', color: section === k ? '#1A1D1E' : '#fff',
          }}>{label} ({shots[k].length})</button>
        ))}
      </div>
      <div style={{ position: 'relative', flex: 1, display: 'flex' }}>
        {camError
          ? <div style={{ color: '#ff6b6b', margin: 'auto', fontWeight: 700 }}>{camError}</div>
          : <video ref={videoRef} playsInline muted style={{ flex: 1, width: '100%', objectFit: 'cover' }} />}
        <CameraGuide guide={guide} expected={expected} step={stepText} model={loader} downloadSizeMb={cfg.guide.downloadSizeMb} />
      </div>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      <div style={{ padding: '8px 16px 0', background: '#000', color: 'rgba(255,255,255,0.75)', fontSize: 12, lineHeight: 1.45 }}>
        {evaluation.ok ? '✓ Набор фото полный'
          : evaluation.problems.slice(0, 2).map(p => <div key={p.code}>• {p.text}</div>)}
        {evaluation.checklist.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {evaluation.checklist.map(c => (
              <span key={c.index} style={{ padding: '3px 8px', borderRadius: 100, fontWeight: 800,
                background: c.done ? '#8fc640' : 'rgba(255,255,255,0.15)', color: c.done ? '#1A1D1E' : '#fff' }}>
                {c.index + 1}. {c.view ? VIEW_RU[c.view] : 'фото'}
              </span>
            ))}
          </div>
        )}
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 4 }}>
          стенд · модель: {modelState}{guide.view ? ` · видит: ${VIEW_RU[guide.view]}` : ''} · постомат: {postomatId || 'любой'}
        </div>
      </div>

      <div style={{ padding: '10px 24px 40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#000' }}>
        <button onClick={done} style={{ color: '#fff', background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 16, padding: '10px 18px', fontSize: 14, fontWeight: 700, fontFamily: 'inherit' }}>
          Готово
        </button>
        <button onClick={snap} disabled={!ready} style={{ width: 72, height: 72, borderRadius: '50%', background: '#8fc640', border: '4px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px rgba(143,198,64,0.4)', opacity: ready ? 1 : 0.5 }}>
          <Camera size={28} color="#1A1D1E" />
        </button>
        <div style={{ width: 80 }} />
      </div>
    </div>
  )
}
