// Motorun sınavı: ustanın kaynaşmış bloklarını üretebiliyor muyuz?
//
//   node tools/verify-fusions.mjs            katı kip (varsayılan)
//   node tools/verify-fusions.mjs --loose    açıklık kuralı gevşek
//
// tools/block-labels.json elle etiketlenmiş doğruluk kaynağıdır: hangi bloğun
// hangi harf çiftinden kurulduğu orada yazıyor. Her çift için motorun ürettiği
// yerleşimler aranır; blok birebir çıkıyorsa geçer.
//
// Geçemezse eksik, yerleşim kuralında değil kütüphanededir: o harfin o
// biçimi yok demektir.

import { readFileSync } from 'node:fs'
import { pairPlacements } from '../src/engine/fit.js'
import { toAscii, fromAscii, bbox } from '../src/engine/grid.js'
import { variantsOf } from '../src/engine/glyphs.js'

const strict = !process.argv.includes('--loose')
const { labels } = JSON.parse(readFileSync('tools/block-labels.json', 'utf8'))
const fusions = labels.filter((l) => [...l.chars].length === 2)
const singles = labels.filter((l) => [...l.chars].length === 1)

console.log(`etiketli blok: ${labels.length}  (tek harf ${singles.length}, kaynaşma ${fusions.length})`)
console.log(`katı açıklık: ${strict}\n`)

// Önce tek harfler kütüphanede var mı?
let missingSingles = 0
for (const l of singles) {
  const art = l.art.join('\n')
  const have = (variantsOf(l.chars) ?? []).some((v) => toAscii(v.cells) === art)
  if (!have) {
    missingSingles++
    console.log(`tek harf '${l.chars}' kütüphanede YOK`)
  }
}
console.log(`tek harf eksiği: ${missingSingles}/${singles.length}\n`)

let hit = 0
for (const l of fusions) {
  const [a, b] = [...l.chars]
  const art = l.art.join('\n')
  const list = pairPlacements(a, b, { bandHeight: 9, strict, maxInterlock: 6, limit: 2000 })
  const match = list.find((p) => toAscii(p.cells) === art)

  if (match) {
    hit++
    console.log(`${l.chars}  ✓  ${match.left.id} + ${match.right.id}  ilerleme=${match.advance}`)
  } else {
    const w = l.art[0].length
    console.log(`${l.chars}  ✗  ${list.length} yerleşim denendi, hiçbiri tutmadı (hedef ${w}x9)`)
    // Hangi yarı eksik? Hedefin alt kümesi olan varyant var mı?
    for (const c of [a, b]) {
      const fits = (variantsOf(c) ?? []).filter((v) => {
        const bb = bbox(v.cells)
        return bb.w <= w && bb.h <= 9
      })
      console.log(`     '${c}': ${fits.length} varyant banda sığıyor`)
    }
  }
}
console.log(`\nüretilebilen kaynaşma: ${hit}/${fusions.length}`)
