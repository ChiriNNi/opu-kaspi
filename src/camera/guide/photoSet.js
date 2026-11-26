// Правила набора фото отчёта (чистые функции, без React).
//
// «До»:    первое фото — QR этого постомата, затем минимум minBefore фото без QR, обязательные ракурсы requiredViews.
// «После»: без QR, те же ракурсы, что «до», в том же порядке (до №1 фасад → после №1 фасад), минимум minAfter.
// «Дефекты»: необязательные фото физических дефектов, в правила не входят.
// Ракурс фото берётся из meta.view (модель на телефоне). Пока модели нет (view = null), ракурс не проверяется,
// считается только количество.

import { VIEW_RU } from './config.js'

const nonQr = (metas) => metas.filter(m => m?.view !== 'qr' && !m?.isQr)

// Фото снято без работающего помощника (модель не загрузилась, помощник выключился, старый черновик).
// Про такой набор помощник ничего достоверно не знает, поэтому ничего от него не требует.
const hasUnguided = (metas) => metas.some(m => !m?.guided)

// Замечание по ракурсу. Если модель не уверена (view = null), нужный ракурс не подтверждён: зелёной рамки нет,
// иначе кадр не засчитался бы и помощник просил бы его снова. Выход — «Не получается».
export const viewIssue = (expected, view) => (expected && expected !== 'qr' && view !== expected ? `view:${expected}` : null)

// Что запомнить о снятом кадре. «Не получается» — клинер подтверждает, что это тот кадр, который просили:
// без этого помощник снова просил бы то же самое и не давал отправить отчёт.
export function photoMeta(guide, expected, override) {
  const accepted = override && expected ? expected : null
  return {
    view: accepted || guide.view,
    isQr: accepted === 'qr' || Boolean(guide.isQr),
    defects: guide.defects || [],
    guided: guide.active,
    override,
  }
}

// Какой кадр ожидается следующим. null — любой.
export function expectedNext(section, before, after, rules) {
  if (hasUnguided([...before, ...after])) return null
  if (section === 'before') {
    if (rules.requireQrFirst && !before.some(m => m?.isQr)) return 'qr'
    const have = new Set(nonQr(before).map(m => m?.view).filter(Boolean))
    return rules.requiredViews.find(v => !have.has(v)) || null
  }
  if (section === 'after' && rules.afterMatchesBefore) {
    const b = nonQr(before), a = after
    return a.length < b.length ? (b[a.length]?.view || null) : null
  }
  return null
}

// Итог для экрана отчёта: можно ли отправлять, что не так, чек-лист.
export function evaluateSet(before, after, workType, rules) {
  const problems = []
  if (hasUnguided([...before, ...after])) return { ok: true, problems: [], checklist: [] }
  const incident = /ИНЦИДЕНТ/i.test(workType || '')
  if (incident && !rules.incident?.enforce) {
    if (!before.length) problems.push({ code: 'no_before', text: 'Добавьте хотя бы одно фото «до»' })
    if (!after.length) problems.push({ code: 'no_after', text: 'Добавьте хотя бы одно фото «после»' })
    return { ok: problems.length === 0, problems, checklist: [] }
  }
  const b = nonQr(before)
  if (rules.requireQrFirst && !before.some(m => m?.isQr)) problems.push({ code: 'qr', text: 'Первым снимите QR-код постомата' })
  if (b.length < rules.minBefore) problems.push({ code: 'min_before', text: `Нужно минимум ${rules.minBefore} фото «до» (без QR)` })
  const haveB = new Set(b.map(m => m?.view).filter(Boolean))
  const unknown = b.some(m => !m?.view)
  if (!unknown) {
    for (const v of rules.requiredViews) if (!haveB.has(v)) problems.push({ code: `need_${v}`, text: `Нет фото «до»: ${VIEW_RU[v]}` })
  }
  if (after.some(m => m?.isQr || m?.view === 'qr')) problems.push({ code: 'qr_after', text: 'QR после уборки не нужен — удалите его' })
  if (after.length < Math.max(rules.minAfter, rules.afterMatchesBefore ? b.length : 0)) {
    problems.push({ code: 'min_after', text: `Нужно ${Math.max(rules.minAfter, b.length)} фото «после» — столько же, сколько «до»` })
  }
  const checklist = b.map((m, i) => {
    const a = after[i]
    const match = a ? (!m?.view || !a?.view || a.view === m.view) : null
    if (a && match === false) problems.push({ code: `mismatch_${i}`, text: `Фото «после» №${i + 1}: нужен ракурс «${VIEW_RU[m.view]}»` })
    return { index: i, view: m?.view || null, done: Boolean(a) && match !== false }
  })
  return { ok: problems.length === 0, problems, checklist }
}
