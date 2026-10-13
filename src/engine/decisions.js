// Elle verilmiş çift kararlarını çözücüye bağlar.
//
// Öncelik, lab'de üzerinde anlaşılan sıra:
//
//   ★ prefer  -> bu çiftte her zaman bu yerleşim
//   ✓ ok      -> çiftte ok varsa YALNIZ onların arasından seçilir
//   işaretsiz -> karar verilmemiş; hiç ok yoksa motor kendi puanıyla seçer
//   ✗ no      -> asla
//
// Bu sıralamanın nedeni pratik: "olmaz"lar her çiftte çoğunluk, tek tek
// işaretlemek anlamsız. Birkaç iyiyi işaretlemek yetiyor, gerisi kendiliğinden
// eleniyor.

import decisions from '../data/pair-decisions.json' with { type: 'json' }

const BAND = decisions.bandHeight ?? 9

/** Yerleşimin kimliği: hangi varyantlar, hangi hizalama. */
const signature = (p) =>
  `${p.left.id}|${p.right.id}|${p.advance}|${p.left.top ?? 0}|${p.right.top ?? 0}`

const keyOf = (left, right, advance, leftTop, rightTop) =>
  `${left}|${right}|${advance}|${leftTop}|${rightTop}`

/** pair -> { ok:Set, prefer:Set } */
const index = new Map()
for (const [pair, rows] of Object.entries(decisions.ok ?? {})) {
  const ok = new Set(rows.map((r) => keyOf(...r)))
  index.set(pair, { ok, prefer: new Set() })
}
for (const [pair, rows] of Object.entries(decisions.prefer ?? {})) {
  const entry = index.get(pair) ?? { ok: new Set(), prefer: new Set() }
  for (const r of rows) {
    const k = keyOf(...r)
    entry.prefer.add(k)
    entry.ok.add(k)
  }
  index.set(pair, entry)
}

/** Tümü reddedilmiş çiftler — mevcut biçimlerle çözümü yok. */
export const unsolvedPairs = new Set(decisions.allRejected ?? [])

export const hasDecisions = (a, b) => index.has(`${a}${b}`)

/**
 * Bir çiftin yerleşimlerini kararlara göre süzer ve sıralar.
 *
 * Karar yoksa liste olduğu gibi döner — motor kendi puanını kullanır.
 * Karar varsa yalnız onaylananlar kalır, tercih edilen başa geçer.
 *
 * @param {string} a sol harf
 * @param {string} b sağ harf
 * @param {Array} placements pairPlacements çıktısı
 * @param {number} bandHeight kararlar bu bant için verildi
 */
export function applyDecisions(a, b, placements, bandHeight = BAND) {
  // Kararlar belirli bir bant yüksekliği için verildi; başka bantta geçmez.
  if (bandHeight !== BAND) return placements

  const entry = index.get(`${a}${b}`)
  if (!entry) return placements

  const approved = placements.filter((p) => entry.ok.has(signature(p)))
  if (!approved.length) return placements

  return approved.sort((x, y) => {
    const px = entry.prefer.has(signature(x)) ? 0 : 1
    const py = entry.prefer.has(signature(y)) ? 0 : 1
    return px - py || x.score - y.score
  })
}

export default decisions
