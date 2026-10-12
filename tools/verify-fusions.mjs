// Motorun sınavı: ustanın kaynaşmış bloklarını üretebiliyor muyuz?
//
//   node tools/verify-fusions.mjs
//
// Her kaynaşma bloğu için bütün harf çiftleri denenir; pairPlacements'ın
// ürettiği hücre kümelerinden biri bloğa birebir eşitse geçer.

import ref from '../src/data/reference.json' with { type: 'json' }
import { pairPlacements } from '../src/engine/fit.js'
import { CHARSET } from '../src/engine/glyphs.js'
import { toAscii } from '../src/engine/grid.js'

const strict = !process.argv.includes('--loose')
const targets = []
for (const [li, line] of ref.lines.entries())
  for (const b of line.blocks)
    if (b.w >= 4) targets.push({ label: `${li + 1}.satır x${b.x}`, art: b.art.join('\n'), w: b.w })

console.log(`${targets.length} geniş blok, katı=${strict}\n`)

// Çiftleri bir kez üret, sonuçları imzaya göre indeksle.
const index = new Map()
for (const a of CHARSET) {
  for (const b of CHARSET) {
    for (const p of pairPlacements(a, b, { bandHeight: 9, strict, maxInterlock: 6, limit: 400 })) {
      const art = toAscii(p.cells)
      if (!index.has(art)) index.set(art, `${a}+${b}`)
    }
  }
}
console.log(`motorun üretebildiği benzersiz blok: ${index.size}\n`)

let hit = 0
for (const t of targets) {
  const who = index.get(t.art)
  if (who) { hit++; console.log(`${t.label} g=${t.w}  ✓  ${who}`) }
  else console.log(`${t.label} g=${t.w}  ✗`)
}
console.log(`\nüretilebilen ${hit}/${targets.length}`)
