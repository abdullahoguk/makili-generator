// Ustanın kaynaşmış bloklarında hangi glif biçimleri eksik?
//
//   node tools/missing-forms.mjs
//
// Blokları satırın metniyle hizalar: tek harfe birebir uyan bloklar bir harf
// tüketir, uymayanlar iki. Böylece her kaynaşma bloğunun HANGİ iki harften
// oluştuğu bilinir. Sonra blok, o iki harfin bilinen varyantlarına bölünmeye
// çalışılır; bölünemiyorsa eksik biçim ekrana basılır.
//
// Çıktı, kütüphaneye eklenecek biçimlerin listesidir.

import ref from '../src/data/reference.json' with { type: 'json' }
import lib from '../src/data/glyphs.json' with { type: 'json' }
import { widthLadder } from '../src/engine/derive.js'
import { toAscii, bbox, key } from '../src/engine/grid.js'

const BAND = 9

/** char -> [{art, w, h, cells, id}] , türetilmiş genişlikler dahil */
const byChar = new Map()
for (const [char, variants] of Object.entries(lib.glyphs)) {
  const seen = new Set()
  const list = []
  for (const v of variants) {
    for (const [, g] of widthLadder(v, 12)) {
      const art = toAscii(g.cells)
      if (seen.has(art)) continue
      seen.add(art)
      const b = bbox(g.cells)
      list.push({ art, w: b.w, h: b.h, cells: g.cells, id: g.id ?? v.id })
    }
  }
  byChar.set(char, list)
}

const artOf = (block) => block.art.join('\n')
const matchesSingle = (block, char) =>
  (byChar.get(char) ?? []).some((g) => g.art === artOf(block))

/** Blokları satır metniyle hizalar. */
function align(line) {
  const chars = [...line.text]
  const out = []
  let ci = 0
  for (const b of line.blocks) {
    if (ci < chars.length && matchesSingle(b, chars[ci])) {
      out.push({ block: b, chars: [chars[ci]] })
      ci += 1
    } else {
      out.push({ block: b, chars: chars.slice(ci, ci + 2) })
      ci += 2
    }
  }
  return { out, consumed: ci, total: chars.length }
}

/** Bloğu, verilen iki harfin bilinen varyantlarına bölmeye çalışır. */
function split(block, [a, b]) {
  const H = block.art.length
  const W = block.w
  const target = new Set()
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) if (block.art[y][x] === '#') target.add(key(x, y))

  const hits = []
  for (const g of byChar.get(a) ?? []) {
    if (g.w > W || g.h > H) continue
    for (let dx = 0; dx + g.w <= W; dx++) {
      for (let dy = 0; dy + g.h <= H; dy++) {
        const gb = bbox(g.cells)
        const placed = g.cells.map(([x, y]) => key(x - gb.x + dx, y - gb.y + dy))
        if (!placed.every((k) => target.has(k))) continue
        const rest = new Set(target)
        for (const k of placed) rest.delete(k)
        if (!rest.size) continue
        const restCells = [...rest].map((k) => k.split(',').map(Number))
        const restArt = toAscii(restCells)
        const known = (byChar.get(b) ?? []).some((h) => h.art === restArt)
        hits.push({ leftId: g.id, dx, dy, restArt, known })
      }
    }
  }
  return hits
}

// ---------------------------------------------------------------- çalıştır

const need = new Map() // "char|art" -> {char, art, seen}
let fused = 0
let reproducible = 0

for (const [li, line] of ref.lines.entries()) {
  const { out, consumed, total } = align(line)
  const tag = consumed === total ? '' : `  ⚠ hizalama ${consumed}/${total}`
  console.log(`\n=== ${li + 1}. satır "${line.text}" ${out.length} blok${tag} ===`)

  for (const item of out) {
    if (item.chars.length < 2) continue
    fused++
    const [a, b] = item.chars
    const label = `x${item.block.x} g=${item.block.w}  ${a}+${b}`

    const asIs = split(item.block, [a, b])
    const swapped = split(item.block, [b, a])
    const full = [...asIs, ...swapped].filter((h) => h.known)

    if (full.length) {
      reproducible++
      console.log(`${label}  ✓ mevcut varyantlarla bölünebiliyor`)
      continue
    }

    console.log(`${label}  ✗`)
    console.log(item.block.art.map((r) => '    ' + r).join('\n'))

    // En çok hücreyi açıklayan bölünme, eksik biçmi gösterir.
    const partial = [...asIs.map((h) => ({ ...h, left: a, right: b })),
                     ...swapped.map((h) => ({ ...h, left: b, right: a }))]
    if (partial.length) {
      partial.sort((p, q) => q.restArt.length - p.restArt.length)
      const best = partial[0]
      console.log(`    '${best.left}' tanındı (${best.leftId}), geriye kalan '${best.right}' biçimi:`)
      console.log(best.restArt.split('\n').map((r) => '      ' + r).join('\n'))
      const k = `${best.right}|${best.restArt}`
      if (!need.has(k)) need.set(k, { char: best.right, art: best.restArt, seen: 0 })
      need.get(k).seen++
    } else {
      console.log(`    iki harfin de bilinen hiçbir varyantı bu bloğun parçası değil`)
      for (const c of [a, b]) {
        const k = `${c}|BLOK ${item.block.w}x${BAND}`
        if (!need.has(k)) need.set(k, { char: c, art: item.block.art.join('\n'), seen: 0, whole: true })
        need.get(k).seen++
      }
    }
  }
}

console.log(`\n\n######## özet ########`)
console.log(`kaynaşma bloğu     : ${fused}`)
console.log(`mevcutla üretilen  : ${reproducible}`)
console.log(`eksik biçim adayı  : ${need.size}\n`)

for (const n of [...need.values()].sort((a, b) => b.seen - a.seen)) {
  console.log(`--- '${n.char}' ${n.whole ? '(bütün blok, ayrıştırılamadı)' : ''} ×${n.seen}`)
  console.log(n.art.split('\n').map((r) => '    ' + r).join('\n'))
}
