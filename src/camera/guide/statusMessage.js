// Что сказать клинеру, когда помощник не проверяет кадры. null — говорить нечего.
const SHOOT_AS_USUAL = 'Снимайте как обычно.'

export function statusMessage({ modelStatus, loadedBytes = 0, downloadSizeMb, stopped }) {
  if (stopped === 'slow') return { text: `Помощник выключен: телефон не справляется. ${SHOOT_AS_USUAL}`, canRetry: false }
  if (stopped) return { text: `Помощник выключен из-за ошибки. ${SHOOT_AS_USUAL}`, canRetry: false }
  if (modelStatus === 'failed') {
    return { text: `Помощник не загрузился, ракурс не проверяется. ${SHOOT_AS_USUAL}`, canRetry: true }
  }
  if (modelStatus === 'loading') {
    const loaded = Math.floor(loadedBytes / 1e6)
    const progress = loaded < downloadSizeMb ? `${loaded} из ≈${downloadSizeMb} МБ` : 'запускается'
    return { text: `Помощник загружается: ${progress}. Пока ракурс не проверяется. ${SHOOT_AS_USUAL}`, canRetry: false }
  }
  return null
}
