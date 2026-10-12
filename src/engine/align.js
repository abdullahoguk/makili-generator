// Ustanın bloklarını satırın metniyle hizalar.
//
// Bloklar ile harfler birebir değil: bazı bloklar iki harf taşıyor (kaynaşma).
// Hangisinin hangisi olduğu baştan bilinmez, bu yüzden dinamik programlama
// ile en ucuz hizalama aranır:
//
//   - kütüphanede tanınan biçim  : bedava
//   - tanınmayan tek harf biçimi : ucuz, ama harfin bilinen genişliğini
//                                  aştıkça pahalılaşır (bir 'l' beş hücre
//                                  genişliğinde tek başına durmaz)
//   - kaynaşma                   : pahalı, çünkü nadir
//
// Sonuç KESİN DEĞİLDİR. Aynı biçim iki ayrı harfe düşebiliyorsa hizalama
// kaymış demektir; bu yüzden lab'de insan eliyle düzeltilir. Buradaki çıktı
// yalnız ilk tahmindir.

import { widthLadder } from './derive.js'
import { toAscii } from './grid.js'
import lib from '../data/glyphs.json' with { type: 'json' }

export const COSTS = {
  known: 0,
  newSingle: 2,
  overWide: 4, // bilinen en geniş varyantı aşan her hücre için
  fusion: 5
}

const known = new Map()
const baseWidth = new Map()
for (const [char, variants] of Object.entries(lib.glyphs)) {
  const set = new Set()
  for (const v of variants) for (const [, g] of widthLadder(v, 12)) set.add(toAscii(g.cells))
  known.set(char, set)
  baseWidth.set(char, Math.max(...variants.map((v) => v.w)))
}

export const isKnownForm = (char, art) => known.get(char)?.has(art) ?? false

export function singleCost(char, block) {
  if (isKnownForm(char, block.art)) return COSTS.known
  const over = Math.max(0, block.w - (baseWidth.get(char) ?? 3))
  return COSTS.newSingle + over * COSTS.overWide
}

/**
 * @param {{text:string, blocks:Array}} line reference.json'daki satır
 * @returns {{steps:Array, cost:number} | null}
 */
export function alignLine(line) {
  const chars = [...line.text]
  const blocks = line.blocks.map((b) => ({ ...b, art: b.art.join('\n') }))
  const nB = blocks.length
  const nC = chars.length

  const dp = Array.from({ length: nB + 1 }, () => new Array(nC + 1).fill(Infinity))
  const from = Array.from({ length: nB + 1 }, () => new Array(nC + 1).fill(null))
  dp[0][0] = 0

  for (let bi = 0; bi < nB; bi++) {
    for (let ci = 0; ci <= nC; ci++) {
      if (dp[bi][ci] === Infinity) continue
      const b = blocks[bi]

      if (ci + 1 <= nC) {
        const cost = singleCost(chars[ci], b)
        if (dp[bi][ci] + cost < dp[bi + 1][ci + 1]) {
          dp[bi + 1][ci + 1] = dp[bi][ci] + cost
          from[bi + 1][ci + 1] = { take: 1, cost }
        }
      }
      if (ci + 2 <= nC && dp[bi][ci] + COSTS.fusion < dp[bi + 1][ci + 2]) {
        dp[bi + 1][ci + 2] = dp[bi][ci] + COSTS.fusion
        from[bi + 1][ci + 2] = { take: 2, cost: COSTS.fusion }
      }
    }
  }

  if (dp[nB][nC] === Infinity) return null

  const steps = []
  let bi = nB
  let ci = nC
  while (bi > 0) {
    const step = from[bi][ci]
    steps.unshift({
      block: blocks[bi - 1],
      chars: chars.slice(ci - step.take, ci).join(''),
      fused: step.take === 2,
      known: step.cost === COSTS.known
    })
    bi -= 1
    ci -= step.take
  }
  return { steps, cost: dp[nB][nC] }
}

/**
 * Hizalamanın tutarlılığı: aynı biçim birden çok harfe düşüyorsa hizalama
 * kaymıştır. Döndürülen çatışmalar lab'de kırmızı gösterilir.
 */
export function conflicts(alignments) {
  const formToChars = new Map()
  for (const a of alignments) {
    if (!a) continue
    for (const s of a.steps) {
      if (s.fused) continue
      if (!formToChars.has(s.block.art)) formToChars.set(s.block.art, new Set())
      formToChars.get(s.block.art).add(s.chars)
    }
  }
  return [...formToChars]
    .filter(([, chars]) => chars.size > 1)
    .map(([art, chars]) => ({ art, chars: [...chars] }))
}
