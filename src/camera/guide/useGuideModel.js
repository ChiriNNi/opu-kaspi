import { useEffect, useSyncExternalStore } from 'react'
import { loadModel } from './guideModel'
import { createModelStore } from './modelStore'

const store = createModelStore(loadModel)

// Начинает загрузку модели, когда помощник включён, и отдаёт её состояние { status, loadedBytes, model, retry }.
export function useGuideModel(enabled, url) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  useEffect(() => { if (enabled && url) store.start(url) }, [enabled, url])
  return { ...state, retry: store.retry, cancel: store.cancel }
}
