import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_RULES } from './config.js'
import { evaluateSet, expectedNext, photoMeta, viewIssue } from './photoSet.js'

const shot = (view) => ({ view, isQr: view === 'qr', guided: true, confirmed: true })
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
  for (const unguided of [photoMeta({ active: false, view: null }, null), {}]) {
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

test('any shot closes the requested step, so an unrecognised view is not asked for again', () => {
  // например, крыша под снегом: модель не уверена или видит другой ракурс
  for (const seen of [null, 'side']) {
    const roof = photoMeta(working(seen), 'roof')
    assert.equal(roof.view, 'roof')
    assert.equal(roof.confirmed, false)
    const before = [shot('qr'), shot('front'), roof]
    assert.equal(expectedNext('before', before, [], DEFAULT_RULES), null)
    assert.equal(expectedNext('after', before, [shot('front')], DEFAULT_RULES), 'roof')
    assert.equal(evaluateSet(before, [shot('front'), shot('roof')], WASH, DEFAULT_RULES).ok, true)
  }
})

test('a shot on the QR step moves on even when the code was not read', () => {
  const qr = photoMeta(working(null), 'qr')
  assert.equal(qr.isQr, true)
  assert.equal(qr.confirmed, false)
  assert.equal(expectedNext('before', [qr], [], DEFAULT_RULES), 'front')
})

test('a recognised view is confirmed; a free shot keeps what the model saw', () => {
  assert.equal(photoMeta(working('front'), 'front').confirmed, true)
  assert.equal(photoMeta(working('side'), null).view, 'side')
})

test('an unsure model does not confirm a requested view', () => {
  assert.equal(viewIssue('front', null), 'view:front')
  assert.equal(viewIssue('front', 'side'), 'view:front')
  assert.equal(viewIssue('front', 'front'), null)
  assert.equal(viewIssue(null, null), null)
  assert.equal(viewIssue('qr', null), null)
})

test('a set that misses the roof still gets a hint about it', () => {
  const before = [shot('qr'), shot('front'), shot('side')]
  const result = evaluateSet(before, [shot('front'), shot('side')], WASH, DEFAULT_RULES)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((problem) => problem.code === 'need_roof'))
})
