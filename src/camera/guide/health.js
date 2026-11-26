// Когда помощник пора выключить: проверки кадра подряд падают или телефон с ними не справляется.
// Один случайный сбой или одна медленная проверка помощника не выключают.

export const MAX_FAILURES_IN_ROW = 3
export const MAX_SLOW_IN_ROW = 3

export function createHealthWatch() {
  let failures = 0
  let slow = 0
  return {
    tick(durationMs, maxMs) {
      failures = 0
      slow = durationMs > maxMs ? slow + 1 : 0
    },
    fail() { failures += 1 },
    reason: () => (failures >= MAX_FAILURES_IN_ROW ? 'error' : slow >= MAX_SLOW_IN_ROW ? 'slow' : null),
  }
}

// Зависшая проверка иначе оставила бы на экране старую рамку и заблокированный спуск.
export function withTimeout(promise, ms) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
