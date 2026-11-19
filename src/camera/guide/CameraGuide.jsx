import { VIEW_RU } from './config'
import './CameraGuide.css'

// Анимированная рамка поверх превью камеры (как проверка авто в Яндекс Go или лица в банке):
//   scanning — белые уголки и бегущая линия, ok — зелёная рамка пульсирует, warn — янтарная рамка и подсказка.
// Только отрисовка: pointerEvents none, ничего не перекрывает и не сдвигает кнопку спуска.
export default function CameraGuide({ guide, expected, step }) {
  if (!guide?.active) return null
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
      </div>
      {hint && <div className="cg-hint">{status === 'ok' ? '✓ ' : ''}{hint}</div>}
    </div>
  )
}
