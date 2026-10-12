// Ustanın bloklarını çözümler: hangi iki harften, hangi varyantlarla,
// hangi yerleşimle kurulmuş?
//
//   node tools/decompose.mjs            tüm geniş blokları çöz
//   node tools/decompose.mjs 4 34       yalnız 4. satır x34 bloğunu
//
// Yöntem kaba kuvvet ama ucuz: blok hücre kümesi bilindiği için, önce bir
// glifin bloğun ALT KÜMESİ olup olmadığına bakılır; öyleyse kalan hücreler
// tam olarak bir başka glife eşit mi diye denenir. Böylece 841 harf çiftini
// tek tek denemek gerekmez.
//
// Bu aynı zamanda motorun sınavı: ustanın çizdiğini üretemiyorsak
// kütüphanede ya da yerleşim kurallarında eksik var demektir.

import ref from '../src/data/reference.json' with { type: 'json' }
import lib from '../src/data/glyphs.json' with { type: 'json' }
import { widthLadder } from '../src/engine/derive.js'
import { fromAscii, toAscii, bbox, key } from '../src/engine/grid.js'

const BAND = 9

/** Her harfin bütün varyantları + sütun çoğaltmayla türetilenleri. */
function pool(maxWidth) {
  const out = []
  for (const [char, variants] of Object.entries(lib.glyphs)) {
    const seen = new Set()
    for (const v of variants) {
      for (const [w, g] of widthLadder(v, maxWidth)) {
        const art = toAscii(g.cells)
        if (seen.has(art)) continue
        seen.add(art)
        out.push({ char, id: g.id ?? v.id, w, h: bbox(g.cells).h, cells: g.cells, art })
      }
    }
  }
  return out
}

/** Glifi (dx, dy) konumuna taşıyıp hücre anahtarları kümesi verir. */
const at = (cells, dx, dy) => {
  const b = bbox(cells)
  return cells.map(([x, y]) => key(x - b.x + dx, y - b.y + dy))
}

/**
 * Bloğu iki glife ayırmaya çalışır.
 * @returns eşleşmelerin listesi
 */
function decompose(art, glyphs) {
  const rows = art
  const H = rows.length
  const W = rows[0].length
  const target = new Set()
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (rows[y][x] === '#') target.add(key(x, y))
  }

  const hits = []
  for (const g of glyphs) {
    if (g.w > W || g.h > H) continue
    for (let dx = 0; dx + g.w <= W; dx++) {
      for (let dy = 0; dy + g.h <= H; dy++) {
        const placed = at(g.cells, dx, dy)
        if (!placed.every((k) => target.has(k))) continue

        // Kalan hücreler tam olarak bir başka glif mi?
        const rest = new Set(target)
        for (const k of placed) rest.delete(k)
        if (!rest.size) continue

        const restCells = [...rest].map((k) => k.split(',').map(Number))
        const rb = bbox(restCells)
        const restArt = toAscii(restCells)

        for (const h of glyphs) {
          if (h.w !== rb.w || h.h !== rb.h) continue
          if (h.art !== restArt) continue
          const first = dx <= rb.x ? g : h
          const second = first === g ? h : g
          hits.push({
            left: first.char,
            leftId: first.id,
            right: second.char,
            rightId: second.id,
            outer: g.w * g.h >= rb.w * rb.h ? g.char : h.char,
            inner: g.w * g.h >= rb.w * rb.h ? h.char : g.char,
            a: { char: g.char, id: g.id, x: dx, y: dy, w: g.w, h: g.h },
            b: { char: h.char, id: h.id, x: rb.x, y: rb.y, w: rb.w, h: rb.h }
          })
        }
      }
    }
  }
  return hits
}

// ---------------------------------------------------------------- çalıştır

const [lineArg, xArg] = process.argv.slice(2)
const glyphs = pool(12)
console.log(`varyant havuzu: ${glyphs.length} (türetilmişler dahil)\n`)

let solved = 0
let unsolved = []

for (const [li, line] of ref.lines.entries()) {
  if (lineArg && Number(lineArg) !== li + 1) continue
  for (const b of line.blocks) {
    if (xArg && Number(xArg) !== b.x) continue
    // Tek harflik bloklar ilgi çekmiyor; kaynaşmaları arıyoruz.
    if (!xArg && b.w < 4) continue

    const label = `${li + 1}. satır x${b.x} g=${b.w}`
    const art = b.art.join('\n')

    // Önce tek harf: geniş olmak kaynaşma demek değil, m ve ü de geniş.
    const single = glyphs.filter((g) => g.art === art)
    if (single.length) {
      solved++
      console.log(`${label}  ✓ TEK HARF  ${[...new Set(single.map((g) => g.char))].join('/')}`)
      if (xArg) console.log(b.art.map((r) => '   ' + r).join('\n'))
      continue
    }

    const hits = decompose(b.art, glyphs)
    if (hits.length) {
      solved++
      // Aynı çözümün tekrarını ele
      const uniq = new Map()
      for (const h of hits) uniq.set(`${h.a.char}${h.a.id}${h.a.x},${h.a.y}|${h.b.char}${h.b.id}`, h)
      const list = [...uniq.values()]
      console.log(`${label}  ✓ ${list.length} çözüm`)
      for (const h of list.slice(0, 3)) {
        console.log(
          `   ${h.a.char}(${h.a.id}) ${h.a.w}x${h.a.h} @${h.a.x},${h.a.y}` +
            `  +  ${h.b.char}(${h.b.id}) ${h.b.w}x${h.b.h} @${h.b.x},${h.b.y}` +
            `   dış=${h.outer} iç=${h.inner}`
        )
      }
    } else {
      unsolved.push({ label, art: b.art })
      console.log(`${label}  ✗ çözülemedi`)
    }
    if (xArg) console.log(b.art.map((r) => '   ' + r).join('\n'))
  }
}

console.log(`\nçözülen ${solved}, çözülemeyen ${unsolved.length}`)
for (const u of unsolved) {
  console.log(`\n--- ${u.label} ---`)
  console.log(u.art.map((r) => '  ' + r).join('\n'))
}
