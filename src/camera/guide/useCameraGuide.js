import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'
import { quickChecks } from './quickChecks'
import { VIEW_RU } from './config'
import { createHealthWatch, withTimeout } from './health'
import { viewIssue } from './photoSet'

// Проверка кадра в реальном времени, пока клинер наводит камеру.
// Каждые tickMs: маленькая копия кадра → быстрые проверки (темно/смазано) → QR (на шаге QR) →
// модель ракурса и качества. Рамка зелёная после okFrames проверок подряд без замечаний.
// Помощник только подсказывает и снимать не запрещает. Пока модели нет, нет ни рамки, ни подсказок. Несколько ошибок или
// медленных проверок подряд → помощник выключается (stopped), съёмка работает как раньше, экран говорит об этом.

const HINTS = {
  dark: 'Слишком темно',
  blurry: 'Держите телефон ровно',
  qr_none: 'Наведите камеру на QR-код постомата',
  qr_foreign: 'Это QR другого постомата',
  cut_off: 'Отойдите — постомат не помещается в кадр',
  too_far: 'Подойдите ближе',
  glancing_or_glare: 'Снимите сверху, без бликов',
  not_postomat: 'Постомата не видно',
}

const QR_RE = /^PST(\d+)/i
const CLASSIFY_TIMEOUT_MS = 4000

const touchesEdges = (b, m = 0.01) => (b[0] <= m) + (b[1] <= m) + (b[2] >= 1 - m) + (b[3] >= 1 - m)

const IDLE = { status: 'scanning', hint: '', ok: false, view: null, isQr: false, active: false, stopped: null }

export function useCameraGuide(videoRef, ready, { enabled, expected, postomatId, cfg, model, stepKey }) {
  const [state, setState] = useState(IDLE)
  const okRun = useRef(0)
  const health = useRef(createHealthWatch())

  useEffect(() => {
    okRun.current = 0
    // результат прошлого шага не должен помечать следующий кадр
    setState(s => ({ ...IDLE, active: s.active, stopped: s.stopped }))
  }, [stepKey, expected])

  useEffect(() => {
    if (!enabled || !ready || !model || health.current.reason()) {
      setState(s => ({ ...s, active: false }))
      return undefined
    }
    const small = document.createElement('canvas')
    const qrCanvas = document.createElement('canvas')
    let stopped = false, timer = null

    const tick = async () => {
      if (stopped) return
      const video = videoRef.current
      const t0 = performance.now()
      try {
        if (!video || !video.videoWidth) throw new Error('no frame')
        const w = 160, h = Math.round(160 * video.videoHeight / video.videoWidth)
        small.width = w; small.height = h
        const ctx = small.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(video, 0, 0, w, h)
        const quick = quickChecks(ctx.getImageData(0, 0, w, h), cfg.quick)
        const issues = [...quick.issues]
        let view = null, isQr = false, qrId = null, defects = [], box = null
        const softHints = []

        if (expected === 'qr') {
          const qw = 480, qh = Math.round(480 * video.videoHeight / video.videoWidth)
          qrCanvas.width = qw; qrCanvas.height = qh
          const qctx = qrCanvas.getContext('2d', { willReadFrequently: true })
          qctx.drawImage(video, 0, 0, qw, qh)
          const code = jsQR(qctx.getImageData(0, 0, qw, qh).data, qw, qh, { inversionAttempts: 'dontInvert' })
          const m = code?.data?.match(QR_RE)
          qrId = m ? m[1] : null
          if (!m) issues.push('qr_none')
          else if (postomatId && String(m[1]) !== String(postomatId)) issues.push('qr_foreign')
          else {
            isQr = true; view = 'qr'
            const bi = issues.indexOf('blurry')
            if (bi >= 0) issues.splice(bi, 1)   // QR прочитан — значит кадр достаточно резкий
          }
        } else {
          const r = await withTimeout(model.classify(video), CLASSIFY_TIMEOUT_MS)
          defects = r.defects
          box = r.box
          view = r.view
          // «обрезан»: для фасада и бока — по контуру постомата (касается ≥2 краёв кадра), это точнее модели;
          // для крыши и ячеек контур всегда во весь кадр, там остаётся оценка модели
          const cutByBox = box && (view === 'front' || view === 'side') && touchesEdges(box) >= 2
          const modelFlags = r.flags.filter((f) => !(box && f === 'cut_off' && (view === 'front' || view === 'side')))
          if (cutByBox) modelFlags.unshift('cut_off')
          // с обрезанным фасадом или боком рамка не зеленеет; остальные замечания модели (точность ~50–60%) на цвет не влияют
          const frontSide = view === 'front' || view === 'side'
          for (const f of modelFlags) {
            ;(f === 'cut_off' && frontSide ? issues : softHints).push(f)
          }
          if (viewIssue(expected, view)) issues.push(viewIssue(expected, view))
        }

        okRun.current = issues.length ? 0 : okRun.current + 1
        const ok = okRun.current >= cfg.okFrames
        const first = issues[0] || softHints[0]
        const hint = !first ? (expected ? `Ракурс: ${VIEW_RU[expected]}` : '')
          : first.startsWith('view:') ? `Нужен ракурс: ${VIEW_RU[first.slice(5)]}` : HINTS[first] || ''
        if (stopped) return
        setState({
          stopped: null,
          status: ok ? 'ok' : issues.length ? 'warn' : 'scanning', hint, ok, view, isQr, qrId, defects, box, active: true, issues,
        })
        health.current.tick(performance.now() - t0, cfg.maxTickMs)
      } catch (e) {
        // пока камера не отдала первый кадр, это не сбой помощника
        if (e.message !== 'no frame') {
          console.warn('[camera guide] frame check failed:', e)
          health.current.fail()
        }
      }
      if (health.current.reason() && !stopped) {
        stopped = true
        setState({ ...IDLE, stopped: health.current.reason() })
        return
      }
      timer = setTimeout(tick, cfg.tickMs)
    }
    tick()
    return () => { stopped = true; clearTimeout(timer) }
  }, [enabled, ready, expected, postomatId, cfg, model, videoRef])

  return state
}
