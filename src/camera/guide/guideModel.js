// Модель ракурса и качества кадра (CV-модель 1) в браузере: onnxruntime-web (WASM), грузится только когда помощник
// включён. Вход — кадр видео, сжатый до 224×224 (как при обучении: без штампа, RGB 0..1), выход — ракурс, проблемы
// кадра и дефекты. Пороги и подписи классов — в <model>.json рядом с моделью.
// Файл модели не хранится в репозитории (репозиторий публичный, модель обучена на фото компании) — его кладут в
// public/models/ при сборке/выкладке. Нет файла или не загрузилась → null, помощник работает без модели.

let pending = null

export function loadGuideModel(url) {
  if (!pending) pending = load(url).catch(() => null)
  return pending
}

async function load(url) {
  const [ort, wasmUrl, meta] = await Promise.all([
    import('onnxruntime-web'),
    import('../../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm?url').then(m => m.default),
    fetch(url.replace(/\.onnx$/, '.json'), { cache: 'no-cache' }).then(r => (r.ok ? r.json() : Promise.reject(new Error('no meta')))),
  ])
  ort.env.wasm.wasmPaths = { wasm: wasmUrl }
  ort.env.wasm.numThreads = 1          // без SharedArrayBuffer/COOP-заголовков; одной нити хватает на 224×224
  const session = await ort.InferenceSession.create(url, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 224
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const input = new Float32Array(3 * 224 * 224)
  const nv = meta.views.length, nf = meta.flags.length
  const sig = (x) => 1 / (1 + Math.exp(-x))
  const flagThr = meta.flag_thresholds || {}
  const viewMin = meta.view_min_prob ?? 0.5

  async function classify(video) {
    ctx.drawImage(video, 0, 0, 224, 224)
    const px = ctx.getImageData(0, 0, 224, 224).data
    for (let i = 0, j = 0; j < 224 * 224; i += 4, j++) {
      input[j] = px[i] / 255; input[j + 50176] = px[i + 1] / 255; input[j + 100352] = px[i + 2] / 255
    }
    const out = await session.run({ image: new ort.Tensor('float32', input, [1, 3, 224, 224]) })
    const z = out.logits.data
    let best = 0
    for (let k = 1; k < nv; k++) if (z[k] > z[best]) best = k
    let den = 0
    for (let k = 0; k < nv; k++) den += Math.exp(z[k] - z[best])
    const prob = 1 / den
    const flags = meta.flags.filter((f, k) => sig(z[nv + k]) >= (flagThr[f] ?? 0.7))
    const defects = meta.defects.filter((d, k) => sig(z[nv + nf + k]) >= 0.7)
    return { view: prob >= viewMin ? meta.views[best] : null, viewProb: prob, flags, defects }
  }
  return { classify, meta }
}
