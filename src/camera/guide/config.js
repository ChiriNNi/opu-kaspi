// Настройки «помощника съёмки» (CV-модель 1 на телефоне).
//
// Включение:
//   1) для всех: /config/camera-guide.json { "enabled": true | false } — выкладывается вместе с фронтом, правится без
//      изменения кода. false выключает помощника у всех, даже если на телефоне его включали. Если файл не получен,
//      помощник выключен;
//   2) на конкретном телефоне: кнопка в форме отчёта или ссылка ?camera_guide=on|off.
// Правила набора фото — /config/photo-rules.json (тоже без изменения кода).

export const DEFAULT_GUIDE = {
  enabled: false,
  okFrames: 3,            // столько проверок подряд без замечаний → рамка зелёная
  tickMs: 250,            // частота проверок
  maxTickMs: 800,         // если одна проверка дольше — телефон не тянет, помощник отключается
  quick: { darkMean: 40, blurVar: 12 },   // пороги быстрых проверок (будут уточнены на реальных кадрах)
  defects: false,         // шаг «Дефекты»: включить, когда сервер начнёт принимать эти фото (сейчас они не отправляются)
  modelUrl: '/models/photo_guide.onnx',   // файл модели не в репозитории (см. guideModel.js)
  downloadSizeMb: 28,     // сколько скачивает телефон (модель + onnxruntime), для сообщения о загрузке
}

export const DEFAULT_RULES = {
  requireQrFirst: true,           // первое фото «до» — QR этого постомата
  minBefore: 2,                   // минимум фото «до» без учёта QR
  minAfter: 2,
  requiredViews: ['front', 'roof'],  // фасад и крыша есть всегда; бок/зад часто у стены
  afterMatchesBefore: true,       // «после» повторяет ракурсы «до» в том же порядке
  incident: { enforce: false },   // для инцидентов правила набора не применяются
}

// Выбор на этом телефоне: ссылка ?camera_guide=on|off или кнопка в форме запоминают его в localStorage.
const readLocal = () => {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('camera_guide')
    if (fromUrl === 'on' || fromUrl === 'off') localStorage.setItem('camera_guide', fromUrl)
    return localStorage.getItem('camera_guide')
  } catch { return null }
}

// Тестовый сервер (vite dev) шлёт отчёты на боевой API — при тесте помощника отправку блокируем.
export const isDevTest = () => Boolean(import.meta.env?.DEV)

async function fetchJson(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' })
    return r.ok ? await r.json() : null
  } catch { return null }
}

// Показывать ли помощника и его кнопку. Общее false важнее всего: это аварийное выключение для всех.
export const isGuideAvailable = (local, remote) => remote?.enabled !== false && (remote?.enabled === true || local === 'on')
export const isGuideEnabled = (local, remote) => isGuideAvailable(local, remote) && local !== 'off'

export const withoutGuideParam = (href) => {
  const url = new URL(href)
  url.searchParams.delete('camera_guide')
  return url.toString()
}

let cached = null

// Возвращает { guide, rules, available }. Любая ошибка → помощник выключен (как сегодня).
export async function loadGuideConfig() {
  if (cached) return cached
  const local = readLocal()
  const [remote, rules] = await Promise.all([fetchJson('/config/camera-guide.json'), fetchJson('/config/photo-rules.json')])
  const guide = { ...DEFAULT_GUIDE, ...(remote || {}) }
  guide.enabled = isGuideEnabled(local, remote)
  cached = { guide, rules: { ...DEFAULT_RULES, ...(rules || {}) }, available: isGuideAvailable(local, remote) }
  return cached
}

// Клинер выключил или включил помощника кнопкой. Вызывать после loadGuideConfig, только когда available.
export function saveGuideChoice(isOn) {
  try {
    localStorage.setItem('camera_guide', isOn ? 'on' : 'off')
  } catch (error) {
    console.warn('[camera guide] the choice was not saved, it lasts until the page is reloaded:', error)
  }
  // иначе ссылка с ?camera_guide=… после обновления страницы вернула бы прежний выбор
  window.history.replaceState(window.history.state, '', withoutGuideParam(window.location.href))
  cached = { ...cached, guide: { ...cached.guide, enabled: isOn } }
  return cached
}

export const VIEW_RU = {
  qr: 'QR-код', front: 'фасад', side: 'бок / зад', roof: 'крыша', cells: 'ячейки открыты',
  cell_interior: 'внутри ячейки', other: 'другое', camera: 'камера', defect: 'дефект',
}
