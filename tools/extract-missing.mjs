// Çözülemeyen bloklardan EKSİK HARF BİÇİMİNİ çıkarır.
//
//   node tools/extract-missing.mjs
//   node tools/extract-missing.mjs --emit   glyphs.extra.json girdisi olarak bas
//
// learn-from-drawings bir bloğu çözemediğinde "şu harf için uyan varyant
// yok" diyor. Ama aranan biçim zaten çizimin içinde: soldan yerleşebilen
// harfleri yerleştir, sağdan yerleşebilenleri yerleştir, ortada kalan
// hücreler o harfin ta kendisidir.
//
// Böylece eksik biçimleri ayrıca çizmeye gerek kalmıyor — üçlüyü çizmek
// yetiyor, harf oradan okunuyor.

import { readFileSync } from 'node:fs'
import { bandVariants, BAND_HEIGHT as H } from '../src/engine/fit.js'
import { bbox, toAscii, key, cornerTouches, components } from '../src/engine/grid.js'

const emit = process.argv.includes('--emit')
const data = JSON.parse(readFileSync('tools/drawn-blocks.json', 'utf8'))

const parse = (art) => {
  const s = new Set()
  art.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') s.add(key(x, y)) }))
  return s
}
const at = (cells, dx, dy) => {
  const b = bbox(cells)
  return cells.map(([x, y]) => [x - b.x + dx, y - b.y + dy])
}

/** Soldan sağa yerleşebildiği kadar: [{char, cells, x}] ve kalan küme. */
function fromLeft(target, chars) {
  let left = new Set(target)
  let minX = 0
  const placed = []
  for (let i = 0; i < chars.length; i++) {
    let best = null
    for (const v of bandVariants(chars[i], H)) {
      const b = bbox(v.cells)
      for (let dx = minX; dx + b.w <= 40; dx++) {
        for (let dy = 0; dy + b.h <= H; dy++) {
          const cs = at(v.cells, dx, dy)
          if (!cs.every(([x, y]) => left.has(key(x, y)))) continue
          if (!best || dx < best.x) best = { char: chars[i], id: v.id, x: dx, cells: cs }
        }
      }
    }
    if (!best) return { placed, left, failedAt: i }
    for (const [x, y] of best.cells) left.delete(key(x, y))
    placed.push(best)
    minX = best.x + 1
  }
  return { placed, left, failedAt: null }
}

/** Sağdan sola yerleşebildiği kadar. */
function fromRight(target, chars) {
  let left = new Set(target)
  const maxXof = (s) => Math.max(...[...s].map((k) => Number(k.split(',')[0])))
  let maxX = maxXof(target)
  const placed = []
  for (let i = chars.length - 1; i >= 0; i--) {
    let best = null
    for (const v of bandVariants(chars[i], H)) {
      const b = bbox(v.cells)
      for (let dx = maxX - b.w + 1; dx >= 0; dx--) {
        for (let dy = 0; dy + b.h <= H; dy++) {
          const cs = at(v.cells, dx, dy)
          if (!cs.every(([x, y]) => left.has(key(x, y)))) continue
          if (!best || dx + b.w > best.right) best = { char: chars[i], id: v.id, x: dx, right: dx + b.w, cells: cs }
        }
      }
    }
    if (!best) return { placed, left, failedAt: i }
    for (const [x, y] of best.cells) left.delete(key(x, y))
    placed.push(best)
    maxX = best.x - 1
  }
  return { placed, left, failedAt: null }
}

const found = new Map() // char -> Map(ascii -> count)
let solvedElsewhere = 0

for (const block of data.blocks) {
  const chars = [...block.chars]
  if (chars.length < 2) continue
  const target = parse(block.art)

  const L = fromLeft(target, chars)
  if (L.failedAt === null && L.left.size === 0) { solvedElsewhere++; continue }
  const R = fromRight(target, chars)

  // Soldan i-1'e kadar, sağdan i+1'den sonuna kadar yerleştiyse ortada
  // kalan tam olarak i. harftir.
  const i = L.failedAt ?? chars.length - 1
  const leftOk = L.placed.length >= i
  const rightOk = R.placed.length >= chars.length - 1 - i
  if (!leftOk || !rightOk) continue

  const used = new Set()
  for (const p of L.placed.slice(0, i)) for (const [x, y] of p.cells) used.add(key(x, y))
  for (const p of R.placed.slice(0, chars.length - 1 - i)) for (const [x, y] of p.cells) used.add(key(x, y))
  const rest = [...target].filter((k) => !used.has(k)).map((k) => k.split(',').map(Number))
  if (!rest.length) continue

  // Tek parça ve köşe teması yoksa bu bir glif adayıdır.
  if (components(rest).length !== 1) continue
  if (cornerTouches(rest).length) continue

  const art = toAscii(rest)
  const ch = chars[i]
  if (!found.has(ch)) found.set(ch, new Map())
  const m = found.get(ch)
  m.set(art, (m.get(art) ?? 0) + 1)
}

console.log(`blok ${data.blocks.length} · zaten çözülen ${solvedElsewhere}`)
console.log(`eksik biçim çıkarılan harf: ${[...found.keys()].join(' ') || '—'}\n`)

const entries = []
for (const [ch, m] of found) {
  const sorted = [...m].sort((a, b) => b[1] - a[1])
  console.log(`'${ch}' — ${sorted.length} aday`)
  for (const [art, n] of sorted) {
    const rows = art.split('\n')
    console.log(`  ${rows[0].length}×${rows.length}  ${n} blokta geçiyor`)
    console.log(rows.map((r) => '     ' + r).join('\n'))
    entries.push({ char: ch, source: `extra:${ch}.blok${entries.length + 1}`, note: `çözülemeyen bloklardan çıkarıldı (${n} blok)`, art: rows })
  }
}

if (emit) console.log('\n' + JSON.stringify({ ascii: entries }, null, 2))
