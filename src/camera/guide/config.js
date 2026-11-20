// Настройки «помощника съёмки» (CV-модель 1 на телефоне).
//
// Включение в три уровня, любой может выключить:
//   1) сборка: VITE_CAMERA_GUIDE=on (по умолчанию выключено — прод ведёт себя как раньше);
//   2) удалённый выключатель: /config/camera-guide.json { "enabled": false } — выкладывается вместе с фронтом,
//      правится без изменения кода;
//   3) на конкретном телефоне для теста: localStorage 'camera_guide' = 'on' | 'off' (страница /camera-check).
// Правила набора фото — /config/photo-rules.json (тоже без изменения кода).

const BUILD_FLAG = String(import.meta.env?.VITE_CAMERA_GUIDE || 'off').toLowerCase() === 'on'

export const DEFAULT_GUIDE = {
  enabled: false,
  block: true,            // кнопка спуска неактивна, пока рамка не зелёная (с аварийной кнопкой «Не получается»)
  overrideAfterSec: 20,   // через сколько секунд показывать «Не получается»
  okFrames: 3,            // столько проверок подряд без замечаний → рамка зелёная
  tickMs: 250,            // частота проверок
  maxTickMs: 800,         // если одна проверка дольше — телефон не тянет, помощник отключается
  quick: { darkMean: 40, blurVar: 12 },   // пороги быстрых проверок (будут уточнены на реальных кадрах)
  modelUrl: '/models/photo_guide.onnx',   // файл модели не в репозитории (см. guideModel.js)
}

export const DEFAULT_RULES = {
  requireQrFirst: true,           // первое фото «до» — QR этого постомата
  minBefore: 2,                   // минимум фото «до» без учёта QR
  minAfter: 2,
  requiredViews: ['front', 'roof'],  // фасад и крыша есть всегда; бок/зад часто у стены
  afterMatchesBefore: true,       // «после» повторяет ракурсы «до» в том же порядке
  incident: { enforce: false },   // для инцидентов правила набора не применяются
}

const readLocal = () => {
  try { return localStorage.getItem('camera_guide') } catch { return null }
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

let cached = null

// Возвращает { guide, rules }. Любая ошибка → помощник выключен (как сегодня).
export async function loadGuideConfig() {
  if (cached) return cached
  const local = readLocal()
  const [remote, rules] = await Promise.all([fetchJson('/config/camera-guide.json'), fetchJson('/config/photo-rules.json')])
  const guide = { ...DEFAULT_GUIDE, ...(remote || {}) }
  guide.enabled = local === 'on' ? true : local === 'off' ? false : (BUILD_FLAG && remote?.enabled !== false)
  cached = { guide, rules: { ...DEFAULT_RULES, ...(rules || {}) } }
  return cached
}

export const VIEW_RU = {
  qr: 'QR-код', front: 'фасад', side: 'бок / зад', roof: 'крыша', cells: 'ячейки открыты',
  cell_interior: 'внутри ячейки', other: 'другое', defect: 'дефект',
}
