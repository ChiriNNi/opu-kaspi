import { VIEW_RU } from './config'
import { statusMessage } from './statusMessage'
import './CameraGuide.css'

// Анимированная рамка поверх превью камеры (как проверка авто в Яндекс Go или лица в банке):
//   scanning — белые уголки и бегущая линия, ok — зелёная рамка пульсирует, warn — янтарная рамка и подсказка.
// Пока помощник не проверяет кадры, рамки нет — только сообщение почему. Не перекрывает кнопку спуска:
// pointerEvents none, кроме кнопки «Повторить загрузку».
export default function CameraGuide({ guide, expected, step, model, downloadSizeMb }) {
  if (!guide?.active) {
    const message = statusMessage({
      modelStatus: model?.status, loadedBytes: model?.loadedBytes, downloadSizeMb, stopped: guide?.stopped,
    })
    if (!message) return null
    return (
      <div className="cg-root" role="status">
        <div className="cg-notice">
          <span>{message.text}</span>
          {message.canRetry && <button type="button" onClick={model.retry}>Повторить загрузку</button>}
        </div>
      </div>
    )
  }
  const { status, hint } = guide
  return (
    <div className={`cg-root cg-${status}`} aria-live="polite">
      <div className="cg-top">
        {step && <span className="cg-step">{step}</span>}
        {expected && <span className="cg-expected">{VIEW_RU[expected] || expected}</span>}
      </div>
      <div className="cg-frame">
        <i className="cg-corner cg-tl" /><i className="cg-corner cg-tr" /><i className="cg-corner cg-bl" /><i className="cg-corner cg-br" />
        {status === 'scanning' && <i className="cg-sweep" />}
        {guide.box && (expected === 'front' || expected === 'side' || guide.view === 'front' || guide.view === 'side') && (
          <i className="cg-box" style={{ left: `${guide.box[0] * 100}%`, top: `${guide.box[1] * 100}%`,
            width: `${(guide.box[2] - guide.box[0]) * 100}%`, height: `${(guide.box[3] - guide.box[1]) * 100}%` }} />
        )}
      </div>
      {hint && <div className="cg-hint">{status === 'ok' ? '✓ ' : ''}{hint}</div>}
    </div>
  )
}
