import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES } from './config.js'
import { evaluateSet, expectedNext, photoMeta, viewIssue } from './photoSet.js'

const shot = (view, extra = {}) => ({ view, isQr: view === 'qr', guided: true, override: false, ...extra })
const working = (view, isQr = false) => ({ view, isQr, defects: [], active: true })
const WASH = 'ПОЛНАЯ МОЙКА'

test('with the model the guide asks for QR, then front, then roof, then any shot', () => {
  const before = []
  for (const expected of ['qr', 'front', 'roof']) {
    assert.equal(expectedNext('before', before, [], DEFAULT_RULES), expected)
    before.push(shot(expected))
  }
  assert.equal(expectedNext('before', before, [], DEFAULT_RULES), null)
})

test('photos taken without a working guide: nothing is demanded and sending is not blocked', () => {
  // так выглядит кадр, снятый пока модель не загрузилась, и фото из старого черновика
  for (const unguided of [photoMeta({ active: false, view: null }, null, false), {}]) {
    assert.equal(expectedNext('before', [unguided, unguided], [], DEFAULT_RULES), null)
    assert.equal(expectedNext('after', [unguided], [], DEFAULT_RULES), null)
    assert.deepEqual(evaluateSet([unguided], [unguided], WASH, DEFAULT_RULES), { ok: true, problems: [], checklist: [] })
  }
})

test('one photo without the guide is enough to drop the demands, even if others were checked', () => {
  const before = [shot('qr'), { guided: false }]
  assert.equal(expectedNext('before', before, [], DEFAULT_RULES), null)
  assert.equal(evaluateSet(before, [shot('front')], WASH, DEFAULT_RULES).ok, true)
})

test('«Не получается» counts as the requested shot, so the guide moves on', () => {
  const unsure = photoMeta(working(null), 'front', true)
  assert.equal(unsure.view, 'front')
  assert.equal(expectedNext('before', [shot('qr'), unsure], [], DEFAULT_RULES), 'roof')

  const wrongView = photoMeta(working('side'), 'roof', true)
  const before = [shot('qr'), unsure, wrongView]
  assert.equal(evaluateSet(before, [shot('front'), shot('roof')], WASH, DEFAULT_RULES).ok, true)
})

test('«Не получается» on the QR step does not leave the report blocked', () => {
  const qr = photoMeta(working(null), 'qr', true)
  assert.equal(qr.isQr, true)
  const before = [qr, shot('front'), shot('roof')]
  assert.equal(evaluateSet(before, [shot('front'), shot('roof')], WASH, DEFAULT_RULES).ok, true)
})

test('without override the photo keeps what the model saw', () => {
  assert.equal(photoMeta(working('side'), 'front', false).view, 'side')
})

test('an unsure model does not confirm a requested view', () => {
  assert.equal(viewIssue('front', null), 'view:front')
  assert.equal(viewIssue('front', 'side'), 'view:front')
  assert.equal(viewIssue('front', 'front'), null)
  assert.equal(viewIssue(null, null), null)
  assert.equal(viewIssue('qr', null), null)
})

test('a checked report that misses the roof is still rejected', () => {
  const before = [shot('qr'), shot('front'), shot('side')]
  const result = evaluateSet(before, [shot('front'), shot('side')], WASH, DEFAULT_RULES)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((problem) => problem.code === 'need_roof'))
})
