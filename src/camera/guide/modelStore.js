// Состояние загрузки модели, общее для всех экранов: idle → loading → ready | failed. Из failed можно повторить.

export function createModelStore(load) {
  let state = { status: 'idle', loadedBytes: 0, model: null, url: null }
  const listeners = new Set()
  const update = (patch) => {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  const start = async (url) => {
    if (state.status === 'loading' || state.status === 'ready') return
    update({ status: 'loading', loadedBytes: 0, url })
    try {
      const model = await load(url, (bytes) => update({ loadedBytes: state.loadedBytes + bytes }))
      update({ status: 'ready', model })
    } catch (error) {
      console.warn('[camera guide] model was not loaded:', error)
      update({ status: 'failed' })
    }
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start,
    retry: () => (state.url ? start(state.url) : undefined),
  }
}
