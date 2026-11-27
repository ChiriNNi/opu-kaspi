// Состояние загрузки модели, общее для всех экранов: idle → loading → ready | failed. Из failed можно повторить,
// loading можно отменить (клинер выключил помощника).

export function createModelStore(load) {
  let state = { status: 'idle', loadedBytes: 0, model: null, url: null }
  const listeners = new Set()
  let current = null
  const update = (patch) => {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  const start = async (url) => {
    if (state.status === 'loading' || state.status === 'ready') return
    const run = new AbortController()
    current = run
    update({ status: 'loading', loadedBytes: 0, url })
    // всё, что прилетает от отменённой загрузки, пропускаем
    const onBytes = (bytes) => { if (!run.signal.aborted) update({ loadedBytes: state.loadedBytes + bytes }) }
    try {
      const model = await load(url, onBytes, run.signal)
      if (!run.signal.aborted) update({ status: 'ready', model })
    } catch (error) {
      if (run.signal.aborted) return
      console.warn('[camera guide] model was not loaded:', error)
      update({ status: 'failed' })
    }
  }

  const cancel = () => {
    if (state.status !== 'loading') return
    current.abort()
    update({ status: 'idle', loadedBytes: 0 })
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start,
    cancel,
    retry: () => (state.url ? start(state.url) : undefined),
  }
}
