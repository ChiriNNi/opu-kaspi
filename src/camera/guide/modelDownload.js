// Скачивание файлов модели с прогрессом. Медленный интернет — это нормально, поэтому общего лимита времени нет:
// загрузка считается сорванной, только если данные не идут stallMs подряд.

export const STALL_MS = 45000

export async function downloadBytes(url, { onBytes = () => {}, stallMs = STALL_MS, fetchImpl = fetch, signal } = {}) {
  const controller = new AbortController()
  const cancel = () => controller.abort(signal.reason)
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  let timer
  const restartTimer = () => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(new Error(`download stalled: ${url}`)), stallMs)
  }
  try {
    restartTimer()
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`)
    // сервер на несуществующий файл отвечает 200 и страницей сайта
    if (/text\/html/i.test(response.headers.get('content-type') || '')) throw new Error(`not a model file: ${url}`)
    const reader = response.body.getReader()
    const chunks = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      restartTimer()
      chunks.push(value)
      size += value.byteLength
      onBytes(value.byteLength)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
