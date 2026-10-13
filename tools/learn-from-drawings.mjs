// Elle çizilmiş blokları çözümler.
//
//   node tools/learn-from-drawings.mjs
//   node tools/learn-from-drawings.mjs --emit   onaylı çift kararlarını bas
//
// İki iş yapar:
//
//   1. DENETİM — her çizim kurallara uyuyor mu: köşe teması, bant doldurma,
//      geniş delik, harfler arası tam 1 birim açıklık.
//
//   2. ÇÖZÜMLEME — blok hangi gliflerden, hangi hizalamayla kurulmuş?
//      Soldan sağa geri izlemeli arama: her harf için kütüphanedeki (ve
//      yükseklikten türetilmiş) varyantlar denenir, blokta birebir oturan
//      bulunur. Oturmuyorsa eksik biçim var demektir — hangisi olduğu
//      kalan hücrelerden okunur.
//
// Çözülen bloklardan ardışık çiftler çıkarılıp onaylı karar olarak
// verilebilir: usta nasıl koyduysa motor da öyle koysun.

import { readFileSync } from 'node:fs'
import { bandVariants, scoreBlock, clearance } from '../src/engine/fit.js'
import { cornerTouches, toAscii, bbox, key } from '../src/engine/grid.js'

const data = JSON.parse(readFileSync('tools/drawn-blocks.json', 'utf8'))
const BAND = data.bandHeight ?? 9
const emit = process.argv.includes('--emit')

const parse = (art) => {
  const set = new Set()
  art.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') set.add(key(x, y)) }))
  return set
}

/** Glifi (dx, dy) konumuna taşır. */
function at(cells, dx, dy) {
  const b = bbox(cells)
  return cells.map(([x, y]) => [x - b.x + dx, y - b.y + dy])
}

/**
 * Bloğu harflere ayırır. Soldan sağa, her harf bir öncekinden sağda başlar.
 * Dönen: [{char, id, x, top, cells}] ya da null.
 */
function decompose(target, chars) {
  const total = target.size

  function step(i, remaining, minX, acc) {
    if (i === chars.length) return remaining.size === 0 ? acc : null

    for (const v of bandVariants(chars[i], BAND)) {
      const b = bbox(v.cells)
      for (let dx = minX; dx + b.w <= 40; dx++) {
        for (let dy = 0; dy + b.h <= BAND; dy++) {
          const placed = at(v.cells, dx, dy)
          let fits = true
          for (const [x, y] of placed) {
            if (!remaining.has(key(x, y))) { fits = false; break }
          }
          if (!fits) continue

          const left = new Set(remaining)
          for (const [x, y] of placed) left.delete(key(x, y))

          // Kalan hücre sayısı, kalan harflerin alabileceğinden azsa boşuna.
          const out = step(i + 1, left, dx + 1, [
            ...acc,
            { char: chars[i], id: v.id, x: dx, top: dy, w: b.w, h: b.h, cells: placed }
          ])
          if (out) return out
        }
      }
    }
    return null
  }

  return step(0, new Set(target), 0, [])
}

/**
 * Çözülemeyen blokta nereye kadar gidilebiliyor?
 * Soldan başlayıp mümkün olan en çok harfi yerleştirir, kalanı döndürür —
 * kalan hücreler kütüphanede eksik olan biçimi gösterir.
 */
function partial(target, chars) {
  let remaining = new Set(target)
  let minX = 0
  const placed = []

  for (let i = 0; i < chars.length; i++) {
    let best = null
    for (const v of bandVariants(chars[i], BAND)) {
      const b = bbox(v.cells)
      for (let dx = minX; dx + b.w <= 40; dx++) {
        for (let dy = 0; dy + b.h <= BAND; dy++) {
          const cells = at(v.cells, dx, dy)
          if (!cells.every(([x, y]) => remaining.has(key(x, y)))) continue
          // en soldaki, en çok hücre kaplayan
          if (!best || dx < best.x || (dx === best.x && cells.length > best.cells.length)) {
            best = { char: chars[i], id: v.id, x: dx, top: dy, cells }
          }
        }
      }
    }
    if (!best) return { placed, remaining, failedAt: i, failedChar: chars[i] }
    for (const [x, y] of best.cells) remaining.delete(key(x, y))
    placed.push(best)
    minX = best.x + 1
  }
  return { placed, remaining, failedAt: null }
}

// ---------------------------------------------------------------- çalıştır

let clean = 0
let solved = 0
const unsolved = []
const approved = {}

for (const block of data.blocks) {
  const chars = [...block.chars]
  const target = parse(block.art)
  const cells = [...target].map((k) => k.split(',').map(Number))

  // 1. denetim
  const corners = cornerTouches(cells)
  const s = scoreBlock(cells, BAND)
  const problems = []
  if (corners.length) problems.push(`köşe teması ${corners.length}`)
  if (s.topGap) problems.push(`üstte ${s.topGap} boşluk`)
  if (s.wideVoid) problems.push(`geniş delik ${s.wideVoid}`)
  if (!problems.length) clean++

  // 2. çözümleme
  const parts = decompose(target, chars)

  const tag = problems.length ? `  ⚠ ${problems.join(', ')}` : ''
  if (parts) {
    solved++
    // harfler arası açıklık gerçekten 1 mi
    const gaps = []
    for (let i = 1; i < parts.length; i++) {
      gaps.push(clearance(parts.slice(0, i).flatMap((p) => p.cells), parts[i].cells))
    }
    const gapTag = gaps.every((g) => g === 1) ? '' : `  açıklık: ${gaps.join(',')}`
    console.log(
      `${block.chars.padEnd(4)} ✓  ` +
        parts.map((p) => `${p.char}:${p.id}@${p.x},${p.top}`).join('  ') +
        gapTag + tag
    )

    // ardışık çiftleri onaylı karar olarak biriktir
    for (let i = 1; i < parts.length; i++) {
      const L = parts[i - 1]
      const R = parts[i]
      const pair = `${L.char}${R.char}`
      const row = [L.id, R.id, R.x - L.x, L.top, R.top]
      approved[pair] = approved[pair] ?? []
      if (!approved[pair].some((r) => r.join('|') === row.join('|'))) approved[pair].push(row)
    }
  } else {
    unsolved.push({ block, problems })
    console.log(`${block.chars.padEnd(4)} ✗  çözülemedi${tag}`)
  }
}

console.log(`\nçizim ${data.blocks.length}  ·  kurallara uygun ${clean}  ·  çözülen ${solved}`)

if (unsolved.length) {
  console.log(`\n=== ÇÖZÜLEMEYENLER (${unsolved.length}) — kütüphanede eksik biçim var`)
  for (const u of unsolved) {
    console.log(`\n--- ${u.block.chars}${u.problems.length ? '  ⚠ ' + u.problems.join(', ') : ''}`)
    const pr = partial(parse(u.block.art), [...u.block.chars])
    if (pr.failedAt != null) {
      console.log(
        `    '${pr.failedChar}' (${pr.failedAt + 1}. harf) için uyan varyant yok.` +
          (pr.placed.length ? `  Yerleşen: ${pr.placed.map((p) => p.char).join('')}` : '')
      )
    } else {
      console.log(`    harfler yerleşti ama ${pr.remaining.size} hücre artıyor`)
    }
    if (pr.remaining.size) {
      const rc = [...pr.remaining].map((k) => k.split(',').map(Number))
      console.log('    artan hücreler:')
      console.log(toAscii(rc).split('\n').map((r) => '      ' + r).join('\n'))
    }
  }
}

const pairCount = Object.values(approved).reduce((n, v) => n + v.length, 0)
console.log(`\n=== ÇİZİMLERDEN ÇIKAN ÇİFT YERLEŞİMİ: ${pairCount} (${Object.keys(approved).length} çift)`)
console.log(Object.keys(approved).sort().join(' '))

if (emit) {
  console.log('\n' + JSON.stringify({ ok: approved }, null, 2))
}
