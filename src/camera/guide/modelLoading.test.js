import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isGuideAvailable, isGuideEnabled, withoutGuideParam } from './config.js'
import { createHealthWatch, withTimeout } from './health.js'
import { downloadBytes } from './modelDownload.js'
import { createModelStore } from './modelStore.js'
import { statusMessage } from './statusMessage.js'

const bodyOf = (chunks, { hang = false, signal } = {}) => new ReadableStream({
  start(controller) {
    chunks.forEach((chunk) => controller.enqueue(new Uint8Array(chunk)))
    if (!hang) controller.close()
    else signal.addEventListener('abort', () => controller.error(signal.reason))
  },
})
const answer = (chunks, { type = 'application/octet-stream', status = 200, hang = false } = {}) =>
  async (url, { signal }) => new Response(bodyOf(chunks, { hang, signal }), { status, headers: { 'content-type': type } })

test('download joins the chunks and reports progress', async () => {
  const progress = []
  const bytes = await downloadBytes('/model', { fetchImpl: answer([[1, 2], [3]]), onBytes: (n) => progress.push(n) })
  assert.deepEqual([...bytes], [1, 2, 3])
  assert.deepEqual(progress, [2, 1])
})

test('the site page returned instead of a missing model is an error', async () => {
  await assert.rejects(downloadBytes('/model', { fetchImpl: answer([[60]], { type: 'text/html' }) }), /not a model file/)
  await assert.rejects(downloadBytes('/model', { fetchImpl: answer([], { status: 404 }) }), /HTTP 404/)
})

test('a download that stops sending data fails instead of hanging forever', async () => {
  const fetchImpl = answer([[1]], { hang: true })
  await assert.rejects(downloadBytes('/model', { fetchImpl, stallMs: 30 }), /stalled/)
})

test('the loader goes loading → failed, and a retry can succeed', async (context) => {
  context.mock.method(console, 'warn', () => {})
  let attempt = 0
  const store = createModelStore(async (url, onBytes) => {
    attempt += 1
    onBytes(5)
    if (attempt === 1) throw new Error('network')
    return 'model'
  })
  const seen = []
  store.subscribe(() => seen.push(store.getState().status))

  await store.start('/model')
  assert.equal(store.getState().status, 'failed')
  assert.equal(store.getState().model, null)

  await store.retry()
  assert.equal(store.getState().status, 'ready')
  assert.equal(store.getState().model, 'model')
  assert.equal(store.getState().loadedBytes, 5, 'progress restarts on retry')
  assert.deepEqual([...new Set(seen)], ['loading', 'failed', 'ready'])
})

test('opening another screen does not start a second download', async () => {
  let calls = 0
  const store = createModelStore(async () => { calls += 1; return 'model' })
  await Promise.all([store.start('/model'), store.start('/model')])
  await store.start('/model')
  assert.equal(calls, 1)
})

test('messages: loading shows progress, failure offers a retry, a working guide says nothing', () => {
  const loading = statusMessage({ modelStatus: 'loading', loadedBytes: 12_400_000, downloadSizeMb: 28 })
  assert.match(loading.text, /12 из ≈28 МБ/)
  assert.match(loading.text, /Снимайте как обычно/)
  assert.equal(statusMessage({ modelStatus: 'failed' }).canRetry, true)
  assert.match(statusMessage({ modelStatus: 'ready', stopped: 'slow' }).text, /не справляется/)
  assert.equal(statusMessage({ modelStatus: 'ready' }), null)
})

test('one slow or failed check keeps the guide; three in a row switch it off', () => {
  const watch = createHealthWatch()
  watch.fail()
  watch.tick(100, 800)
  watch.tick(2000, 800)
  watch.tick(100, 800)
  assert.equal(watch.reason(), null)
  for (let i = 0; i < 3; i += 1) watch.tick(2000, 800)
  assert.equal(watch.reason(), 'slow')

  const failing = createHealthWatch()
  for (let i = 0; i < 3; i += 1) failing.fail()
  assert.equal(failing.reason(), 'error')
})

test('a frame check that never answers is cut off', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 20), /timeout/)
  assert.equal(await withTimeout(Promise.resolve(1), 20), 1)
})

test('the shared switch turns the guide on for everyone, and a phone can opt out', () => {
  assert.equal(isGuideEnabled(null, { enabled: true }), true)
  assert.equal(isGuideEnabled('off', { enabled: true }), false)
  assert.equal(isGuideAvailable('off', { enabled: true }), true, 'the button to turn it back on stays')
  assert.equal(isGuideEnabled(null, null), false, 'config not received: the form works as before')
  assert.equal(isGuideEnabled('on', null), true)
})

test('the shared «off» wins over a phone that had the guide turned on', () => {
  for (const local of ['on', 'off', null]) {
    assert.equal(isGuideEnabled(local, { enabled: false }), false)
    assert.equal(isGuideAvailable(local, { enabled: false }), false, 'no button either')
  }
})

test('the button removes the link choice from the address and keeps the rest', () => {
  assert.equal(withoutGuideParam('https://example.com/pst?camera_guide=on'), 'https://example.com/pst')
  assert.equal(withoutGuideParam('https://example.com/pst?a=1&camera_guide=off#top'), 'https://example.com/pst?a=1#top')
})

test('cancelling stops the download, ignores what arrives late, and it can be started again', async () => {
  const runs = []
  const store = createModelStore((url, onBytes, signal) => new Promise((resolve, reject) => {
    runs.push({ onBytes, resolve })
    signal.addEventListener('abort', () => reject(signal.reason))
  }))
  const first = store.start('/model')
  runs[0].onBytes(7)
  store.cancel()
  runs[0].onBytes(100)
  await first
  assert.deepEqual([store.getState().status, store.getState().loadedBytes], ['idle', 0])

  const second = store.start('/model')
  runs[1].resolve('model')
  await second
  assert.equal(store.getState().status, 'ready')
  store.cancel()
  assert.equal(store.getState().status, 'ready', 'a loaded model is kept')
})

test('an outside signal aborts a running download', async () => {
  const controller = new AbortController()
  const download = downloadBytes('/model', { fetchImpl: answer([[1]], { hang: true }), signal: controller.signal })
  setTimeout(() => controller.abort(new Error('switched off')), 20)
  await assert.rejects(download, /switched off/)
})
