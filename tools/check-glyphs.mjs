// Kütüphanedeki biçimleri KURALA karşı denetler.
//
//   node tools/check-glyphs.mjs            hepsini tara
//   node tools/check-glyphs.mjs a k g      yalnız bu harfler
//   node tools/check-glyphs.mjs --emit     kusurluları çıkarma listesi olarak bas
//
// Değişmez kural: boşluk BİR YÖNDE tam bir birim kalmalı. İki yönde birden
// değil — ustanın 'o' sayacı 1 birim geniş ama 7 birim uzun, 'g'nin alt
// kanalı 3 birim uzun ama 1 birim kalın. İkisi de kurala uygun.
//
// Ölçünün kesin karşılığı: BOŞ 2×2 KARE olmayacak. Bir yerde 2×2 boşluk
// varsa orada boşluk iki yönde birden iki birim demektir.
//
// Tek istisna kenara açık yanlar: 'r' 4w, 't' 7w, 'z' 9w biçimlerinin yanı
// boydan boya açıktır ve orayı komşu harf ya da uzantısı doldurur. O yüzden
// bütün hücreleri kenara erişebilen bir 2×2 kusur sayılmaz.

import { writeFileSync } from 'node:fs'
import library from '../src/data/glyphs.json' with { type: 'json' }
import { cornerTouches, toAscii, bbox } from '../src/engine/grid.js'
import { widthOptions, heightLadder } from '../src/engine/derive.js'

const args = process.argv.slice(2)
const emit = args.includes('--emit')
const want = args.filter((a) => !a.startsWith('--'))

/** Hücreye satırı boyunca kenardan ulaşılabiliyor mu — komşu doldurabilir mi? */
function reachable(filled, w, h) {
  const out = new Set()
  for (let y = 0; y < h; y++) {
    let L = 0
    while (L < w && !filled.has(`${L},${y}`)) L++
    let R = w - 1
    while (R >= 0 && !filled.has(`${R},${y}`)) R--
    for (let x = 0; x < L; x++) out.add(`${x},${y}`)
    for (let x = R + 1; x < w; x++) out.add(`${x},${y}`)
  }
  return out
}

/** Kapanmayacak boş 2×2 kareler. */
function wideSpots(cells) {
  const b = bbox(cells)
  const filled = new Set(cells.map(([x, y]) => `${x - b.x},${y - b.y}`))
  const open = reachable(filled, b.w, b.h)
  const out = []
  for (let y = 0; y + 1 < b.h; y++) {
    for (let x = 0; x + 1 < b.w; x++) {
      const quad = [`${x},${y}`, `${x + 1},${y}`, `${x},${y + 1}`, `${x + 1},${y + 1}`]
      if (quad.some((k) => filled.has(k))) continue
      if (quad.every((k) => open.has(k))) continue // yanı açık, komşu doldurur
      out.push({ x, y })
    }
  }
  return out
}

const rows = []
let total = 0

/** Yazılı biçimler + onlardan türetilen bütün genişlik ve yükseklikler. */
function* allForms(char, variants) {
  for (const v of variants) yield v
  const tall = variants.filter((v) => v.h === variants[0].h)
  for (const [, list] of widthOptions(tall.length ? tall : variants, 9)) {
    for (const g of list) if (g.derived) yield g
  }
  for (const v of variants) {
    for (const [, g] of heightLadder(v, 9)) if (g.derived) yield g
  }
}

for (const [char, variants] of Object.entries(library.glyphs)) {
  if (want.length && !want.includes(char)) continue
  const seen = new Set()
  for (const v of allForms(char, variants)) {
    const sig = v.cells.map(([x, y]) => `${x},${y}`).sort().join('|')
    if (seen.has(sig)) continue
    seen.add(sig)
    total++
    const corners = cornerTouches(v.cells)
    const gaps = wideSpots(v.cells)
    if (!corners.length && !gaps.length) continue
    rows.push({ char, v, corners: corners.length, gaps })
  }
}

console.log(`biçim ${total} (yazılı + türetilmiş)  ·  kusurlu ${rows.length}\n`)

for (const r of rows) {
  const g = r.gaps.map((x) => `${x.x},${x.y}`).join('  ')
  console.log(
    `--- '${r.char}'  ${r.v.id}  ${r.v.w}×${r.v.h}  ${r.v.source}${r.v.master ? '  ⚠ AFİŞTEN' : ''}`
  )
  if (r.corners) console.log(`    köşeden birleşme: ${r.corners}`)
  if (r.gaps.length) console.log(`    kapanmayan 2×2 boşluk (${r.gaps.length}): ${g}`)
  console.log(toAscii(r.v.cells).split('\n').map((l) => '    ' + l).join('\n'))
}

if (emit && rows.length) {
  const out = {
    _note: 'tools/check-glyphs.mjs ile bulunan kurala aykırı biçimler. Gözden geçirip tools/glyph-rejects.json içine al.',
    rejected: rows.map((r) => ({
      id: r.v.id,
      char: r.char,
      source: r.v.source,
      reason: r.corners
        ? `köşeden birleşme (${r.corners})`
        : `kapanmayan ${r.gaps.length} adet 2×2 boşluk`
    }))
  }
  writeFileSync('build/glyph-rejects.suggested.json', JSON.stringify(out, null, 2))
  console.log('\nöneri yazıldı: build/glyph-rejects.suggested.json')
}
