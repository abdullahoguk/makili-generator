// Hangi çiftler gerçekten senin kararını istiyor?
//
//   node tools/triage.mjs
//
// 841 sıralı çiftin çoğu kendiliğinden temiz çözülür: yan yana koyunca
// açıklık 1 birim, köşe teması yok, blok bandı doluyor ve fazladan delik
// kalmıyor. Orada karar verecek bir şey yok — motor seçsin.
//
// Geriye kalanlar iki kümeye ayrılır: yalnız YUVALANMAYLA çözülenler
// (nestPlacements kuralı hallediyor) ve hiçbir yolla çözülemeyenler.
// İnsanın bakması gereken yalnız sonuncusu — ve onlar genelde belirli
// harflerde kümelenir, yani eksik olan karar değil BİÇİMDİR.

import { CHARSET } from '../src/engine/glyphs.js'
import {
  bandVariants, place, scoreBlock, intrinsicVoid, nestPlacements, BAND_HEIGHT as H
} from '../src/engine/fit.js'
import { bbox } from '../src/engine/grid.js'

const cache = new Map()
const vars = (c) => {
  if (!cache.has(c)) cache.set(c, bandVariants(c, H))
  return cache.get(c)
}

/** Yan yana, taban hizasında, fazladan deliksiz bir yerleşim var mı? */
function cleanSideBySide(a, b) {
  for (const lv of vars(a)) {
    const lb = bbox(lv.cells)
    for (const rv of vars(b)) {
      const rb = bbox(rv.cells)
      const p = place(lv.cells, rv.cells, lb.w + 1, {
        bandHeight: H, leftTop: H - lb.h, rightTop: H - rb.h
      })
      if (!p.ok) continue
      const s = scoreBlock(p.cells, H)
      if (s.topGap > 0) continue
      const li = intrinsicVoid(lv.cells, H, lv.id)
      const ri = intrinsicVoid(rv.cells, H, rv.id)
      if (Math.max(0, s.wideVoid - li.wide - ri.wide) === 0) return true
    }
  }
  return false
}

const clean = []
const nest = []
const hard = []
for (const a of CHARSET) {
  for (const b of CHARSET) {
    if (cleanSideBySide(a, b)) { clean.push(a + b); continue }
    if (nestPlacements(a, b, { limit: 40 }).some((p) => p.wideVoid === 0)) { nest.push(a + b); continue }
    hard.push(a + b)
  }
}

const n = CHARSET.length ** 2
console.log(`sıralı çift ${n}`)
console.log(`  yan yana temiz çözülüyor   : ${clean.length}  (karar gerekmez)`)
console.log(`  yalnız yuvalanmayla        : ${nest.length}  (${nest.join(' ')})`)
console.log(`  karar/biçim gerekiyor      : ${hard.length}`)

const byLetter = new Map()
for (const p of hard) {
  for (const c of p) byLetter.set(c, (byLetter.get(c) ?? 0) + 1)
}
const top = [...byLetter].sort((x, y) => y[1] - x[1])
console.log(`\nzor çiftlerde en çok geçen harfler: ${top.slice(0, 6).map(([c, k]) => `${c}:${k}`).join('  ')}`)
console.log(`\nzor çiftler:\n  ${hard.join(' ')}`)
