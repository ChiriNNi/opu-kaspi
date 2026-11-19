// Быстрые проверки кадра без нейросети: яркость и резкость (дисперсия лапласиана) на маленькой серой копии.
// Работают на любом телефоне за единицы миллисекунд.

export function toGray(imageData) {
  const { data, width, height } = imageData
  const g = new Float32Array(width * height)
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
  return { g, width, height }
}

export function quickChecks(imageData, thresholds) {
  const { g, width: w, height: h } = toGray(imageData)
  let sum = 0
  for (let i = 0; i < g.length; i++) sum += g[i]
  const mean = sum / g.length
  // дисперсия 4-соседнего лапласиана: мало перепадов → кадр смазан или не в фокусе
  let n = 0, s = 0, s2 = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i]
      s += l; s2 += l * l; n++
    }
  }
  const blurVar = n ? s2 / n - (s / n) ** 2 : 0
  const issues = []
  if (mean < thresholds.darkMean) issues.push('dark')
  else if (blurVar < thresholds.blurVar) issues.push('blurry')
  return { mean, blurVar, issues }
}
