import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Calendar as CalIcon, ChevronDown } from 'lucide-react'
import './DatePicker.css'

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const pad2 = (n) => String(n).padStart(2, '0')

// Кастомный выбор даты (только дата, формат значения "YYYY-MM-DD").
// Поповер рендерится через портал (fixed) — не раздувает родителя и не обрезается.
export default function DatePicker({ value, onChange, placeholder = 'Дата' }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState(null)
  const fieldRef = useRef(null)
  const popRef = useRef(null)

  const parsed = (() => {
    if (value && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      const [y, mo, da] = value.split('-').map(Number)
      return { y, mo: mo - 1, da }
    }
    return null
  })()

  const now = new Date()
  const [viewY, setViewY] = useState(parsed?.y ?? now.getFullYear())
  const [viewM, setViewM] = useState(parsed?.mo ?? now.getMonth())
  useEffect(() => { if (parsed) { setViewY(parsed.y); setViewM(parsed.mo) } }, [parsed?.y, parsed?.mo])

  const computePos = () => {
    const r = fieldRef.current?.getBoundingClientRect()
    if (!r) return
    const W = Math.min(300, Math.max(r.width, 260))
    const H = 320
    const top = (window.innerHeight - r.bottom > H + 12) ? r.bottom + 6 : Math.max(8, r.top - H - 6)
    let left = r.left
    if (left + W > window.innerWidth - 8) left = window.innerWidth - W - 8
    if (left < 8) left = 8
    setPos({ top, left, width: W })
  }
  const toggleOpen = () => { if (!open) computePos(); setOpen(o => !o) }

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (fieldRef.current?.contains(e.target)) return
      if (popRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', onDoc)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', onDoc); window.removeEventListener('scroll', onScroll, true) }
  }, [open])

  const fmt = (y, mo, da) => `${y}-${pad2(mo + 1)}-${pad2(da)}`
  const selectDay = (da) => { onChange(fmt(viewY, viewM, da)); setOpen(false) }

  const prevMonth = () => { if (viewM === 0) { setViewM(11); setViewY(y => y - 1) } else setViewM(m => m - 1) }
  const nextMonth = () => { if (viewM === 11) { setViewM(0); setViewY(y => y + 1) } else setViewM(m => m + 1) }

  const daysInMonth = new Date(viewY, viewM + 1, 0).getDate()
  const firstWeekday = (new Date(viewY, viewM, 1).getDay() + 6) % 7
  const isToday = (da) => da === now.getDate() && viewM === now.getMonth() && viewY === now.getFullYear()
  const isSelected = (da) => parsed && parsed.da === da && parsed.mo === viewM && parsed.y === viewY

  const monthLabel = new Date(viewY, viewM).toLocaleString('ru-RU', { month: 'long', year: 'numeric' })
  const display = parsed
    ? new Date(parsed.y, parsed.mo, parsed.da).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    : placeholder

  return (
    <div className={`dp ${open ? 'open' : ''}`}>
      <button type="button" ref={fieldRef} className={`dp-field ${parsed ? 'filled' : ''}`} onClick={toggleOpen}>
        <CalIcon size={15} className="dp-field-icon" />
        <span className="dp-field-text">{display}</span>
        <ChevronDown size={15} className="dp-field-chev" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && pos && createPortal(
        <div className="dp-pop" ref={popRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 1100 }}>
          <div className="dp-head">
            <button type="button" className="dp-nav" onClick={prevMonth}>‹</button>
            <span className="dp-month">{monthLabel}</span>
            <button type="button" className="dp-nav" onClick={nextMonth}>›</button>
          </div>
          <div className="dp-wd">{WD.map(d => <span key={d} className="dp-wd-cell">{d}</span>)}</div>
          <div className="dp-days">
            {Array.from({ length: firstWeekday }).map((_, i) => <span key={'b' + i} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const da = i + 1
              return (
                <button
                  key={da}
                  type="button"
                  className={`dp-day ${isSelected(da) ? 'selected' : ''} ${isToday(da) ? 'today' : ''}`}
                  onClick={() => selectDay(da)}
                >
                  {da}
                </button>
              )
            })}
          </div>
          <div className="dp-foot">
            <button type="button" className="dp-foot-btn" onClick={() => { onChange(''); setOpen(false) }}>Очистить</button>
            <button
              type="button"
              className="dp-foot-btn accent"
              onClick={() => { const t = new Date(); onChange(fmt(t.getFullYear(), t.getMonth(), t.getDate())); setOpen(false) }}
            >
              Сегодня
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
