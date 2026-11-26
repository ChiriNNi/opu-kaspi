import assert from 'node:assert/strict'
import { test } from 'node:test'
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
