// P0 — kaynak SVG'den ham glif kütüphanesi çıkarır.
//
//   npm run glyphs:extract
//
// Kaynak düzeni: harfler sol blokta, satır başına bir harf, 12 birim aralıkla,
// alfabetik sırada. Rakamlar sağ blokta. Satır konumundan harf ataması yapılır;
// belirsiz satırlar (c/ç, g/ğ, ı/i, s/ş) işaretlenir ve elle onaylanır.
//
// Üretir:
//   build/glyphs.raw.json   satır/varyant yapısıyla ham kayıtlar
//   build/glyph-sheet.html  elle etiketleme için temas sayfası
//   build/sheet.svg         göz denetimi için tek parça kontak baskı
//   build/glyphs.ascii.txt  terminalde incelemek için ASCII dökümü

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { svgToCells, connectedComponents, normalize, toAscii, cmpCell } from './svg-grid.mjs'

const SRC = 'sources/latin makili letters.svg'
const OUT = 'build'

const ROW_PITCH = 12 // satırlar arası birim
const LEFT_BLOCK_MAX_X = 60 // bundan solu harf, sağı rakam

// Gövde mi aksan mı: gövdeler en az 4 birim yüksek. Genişlik ölçüt değil —
// 'ı' ve 'i' gövdeleri tek birim genişliğinde.
const isBody = (c) => c.h >= 4

// Satır sırasına karşılık gelen harfler. Birden çok harf = belirsiz satır,
// varyantların hangisinin hangi harf olduğu elle ayrılacak.
const ROW_DIGITS = ['0','1','2','3','4','5','6','7','8','9'].map((d) => [d])

const ROW_LETTERS = [
  ['a'], ['b'], ['c', 'ç'], ['d'], ['e'], ['f'], ['g', 'ğ'], ['h'],
  ['ı', 'i'], ['j'], ['k'], ['l'], ['m'], ['n'], ['o'], ['p'],
  ['r'], ['s', 'ş'], ['t'], ['u'], ['ü'], ['y'], ['z']
]

// ---------------------------------------------------------------- çıkarım

function extract() {
  const cells = svgToCells(readFileSync(SRC, 'utf8'))
  const all = connectedComponents(cells)

  // Sayfa dışı artıklar (eski çalışma) negatif koordinatlarda duruyor.
  const onPage = all.filter((c) => c.x >= 0 && c.y >= 0)
  const offPage = all.length - onPage.length

  const left = onPage.filter((c) => c.x < LEFT_BLOCK_MAX_X)
  const right = onPage.filter((c) => c.x >= LEFT_BLOCK_MAX_X)

  return {
    letters: buildRows(left, ROW_LETTERS),
    digits: buildRows(right, ROW_DIGITS),
    stats: { components: all.length, offPage, cells: cells.size }
  }
}

/** Bileşenleri satırlara böler, aksanları gövdelere bağlar, glif kaydı üretir. */
function buildRows(comps, rowLetters) {
  const bodies = comps.filter(isBody)
  const marks = comps.filter((c) => !isBody(c))

  const byRow = new Map()
  for (const b of bodies) {
    const k = Math.round((b.y + b.h) / ROW_PITCH)
    if (!byRow.has(k)) byRow.set(k, [])
    byRow.get(k).push(b)
  }

  const attached = new Set()
  const keys = [...byRow.keys()].sort((a, b) => a - b)

  const rows = keys.map((k, rowIndex) => {
    const bodiesInRow = byRow.get(k).sort((a, b) => a.x - b.x)
    const glyphs = bodiesInRow.map((body) => ({ body, marks: [] }))

    // Aynı satır bandındaki aksanları x örtüşmesine göre gövdeye bağla.
    for (const m of marks) {
      if (attached.has(m)) continue
      if (Math.abs(Math.round((m.y + m.h) / ROW_PITCH) - k) > 1) continue
      let best = null
      let bestGap = Infinity
      for (const g of glyphs) {
        const b = g.body
        const overlap = Math.min(m.x + m.w, b.x + b.w) - Math.max(m.x, b.x)
        if (overlap <= 0) continue
        const above = b.y - (m.y + m.h)
        const below = m.y - (b.y + b.h)
        const gap = above >= 0 ? above : below >= 0 ? below : -1
        if (gap < 0 || gap > 4) continue
        if (gap < bestGap) { bestGap = gap; best = g }
      }
      if (best) { best.marks.push(m); attached.add(m) }
    }

    const letters = rowLetters ? rowLetters[rowIndex] ?? null : null
    return {
      row: rowIndex,
      letters,
      ambiguous: !!letters && letters.length > 1,
      glyphs: glyphs.map((g, i) => ({
        variant: i,
        char: letters && letters.length === 1 ? letters[0] : null,
        ...flatten(g)
      }))
    }
  })

  return { rows, orphanMarks: marks.filter((m) => !attached.has(m)).map(normalize) }
}

/** Gövde + aksanları tek hücre kümesinde birleştirip normalize eder. */
function flatten({ body, marks }) {
  const pts = [...body.cells]
  for (const m of marks) pts.push(...m.cells)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of pts) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return {
    w: maxX - minX + 1,
    h: maxY - minY + 1,
    cells: pts.map(([x, y]) => [x - minX, y - minY]).sort(cmpCell),
    // Taban çizgisi: gövdenin alt kenarının birleşik kutu içindeki konumu.
    baselineFromTop: body.y + body.h - minY,
    markCount: marks.length,
    src: { x: body.x, y: body.y }
  }
}

// ---------------------------------------------------------------- çıktılar

function flatList(set, kind) {
  const out = []
  for (const row of set.rows) {
    for (const g of row.glyphs) {
      out.push({ kind, row: row.row, letters: row.letters, ambiguous: row.ambiguous, ...g })
    }
  }
  return out
}

function asciiDump(items, orphans) {
  const lines = []
  for (const g of items) {
    const tag = g.char ?? (g.letters ? g.letters.join('/') : '?')
    lines.push(`[${g.kind} r${g.row} v${g.variant}] ${tag}  ${g.w}x${g.h}  aksan:${g.markCount}`)
    lines.push(toAscii(g))
    lines.push('')
  }
  if (orphans.length) {
    lines.push(`--- bağlanmamış ${orphans.length} parça ---`)
    for (const o of orphans) { lines.push(`${o.w}x${o.h}`); lines.push(toAscii(o)); lines.push('') }
  }
  return lines.join('\n')
}

/** Satır satır, göz denetimi için tek parça SVG kontak baskı. */
function contactSvg(sets) {
  const S = 8, PAD = 6, LABEL = 46, ROW_H = 13 * S + 14
  const lines = []
  let y = 24
  let width = 600

  for (const [kind, set] of sets) {
    lines.push(`<text x="8" y="${y}" font-family="monospace" font-size="13" font-weight="bold">${kind}</text>`)
    y += 10
    for (const row of set.rows) {
      const tag = row.letters ? row.letters.join('/') : `r${row.row}`
      lines.push(
        `<text x="8" y="${y + 9 * S}" font-family="monospace" font-size="15" fill="${
          row.ambiguous ? '#e5241c' : '#111'
        }">${tag}</text>`
      )
      let x = LABEL
      for (const g of row.glyphs) {
        const top = y + (13 - g.h) * S
        for (const [cx, cy] of g.cells) {
          lines.push(`<rect x="${x + cx * S}" y="${top + cy * S}" width="${S}" height="${S}"/>`)
        }
        lines.push(
          `<text x="${x}" y="${y + 13 * S + 10}" font-family="monospace" font-size="9" fill="#999">${g.variant}</text>`
        )
        x += g.w * S + PAD * 2
      }
      width = Math.max(width, x + 20)
      y += ROW_H
    }
    y += 20
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}"><rect width="100%" height="100%" fill="#fff"/><g fill="#111" shape-rendering="crispEdges">${lines.join('')}</g></svg>`
}

function sheet(sets, stats) {
  const S = 9
  const svgFor = (g) =>
    `<svg viewBox="0 0 ${g.w * S} ${g.h * S}" width="${g.w * S}" height="${g.h * S}">${g.cells
      .map(([x, y]) => `<rect x="${x * S}" y="${y * S}" width="${S}" height="${S}"/>`)
      .join('')}</svg>`

  const card = (kind, row, g) => `
    <figure class="g">
      <div class="art">${svgFor(g)}</div>
      <figcaption>${g.w}&times;${g.h}${g.markCount ? ` <em>+${g.markCount}</em>` : ''}</figcaption>
      <input data-key="${kind}.${row.row}.${g.variant}" value="${g.char ?? ''}" placeholder="?">
    </figure>`

  const block = ([kind, set]) => `
    <h2>${kind} <span>${set.rows.length} satır</span></h2>
    ${set.rows
      .map(
        (row) => `
      <section class="row${row.ambiguous ? ' amb' : ''}">
        <div class="tag">${row.letters ? row.letters.join(' / ') : `#${row.row}`}</div>
        <div class="grid">${row.glyphs.map((g) => card(kind, row, g)).join('')}</div>
      </section>`
      )
      .join('')}`

  return `<!doctype html>
<meta charset="utf-8">
<title>Latin Makili — glif temas sayfası</title>
<style>
  :root { --ink:#111; --accent:#e5241c; --paper:#fff; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--paper); color:var(--ink);
         font:14px/1.4 "Helvetica Neue",Helvetica,Inter,Arial,sans-serif }
  header { border-bottom:2px solid var(--ink); padding:40px 40px 28px }
  h1 { margin:0; font-size:72px; line-height:.9; letter-spacing:-.04em; font-weight:700;
       text-transform:uppercase }
  .meta { margin-top:16px; display:flex; gap:40px; font-size:11px; text-transform:uppercase;
          letter-spacing:.1em }
  .meta b { color:var(--accent) }
  main { padding:40px 40px 120px }
  h2 { margin:56px 0 0; font-size:11px; text-transform:uppercase; letter-spacing:.14em;
       border-bottom:1px solid var(--ink); padding-bottom:10px; display:flex;
       justify-content:space-between }
  h2 span { color:#999 }
  .row { display:flex; gap:24px; align-items:flex-start; padding:18px 0;
         border-bottom:1px solid #e3e3e3 }
  .row.amb { background:#fffbe6; margin:0 -12px; padding-left:12px; padding-right:12px }
  .tag { width:64px; flex:none; font-size:28px; font-weight:700; line-height:1 }
  .row.amb .tag { color:var(--accent) }
  .grid { display:flex; flex-wrap:wrap; gap:18px }
  .g { margin:0; display:flex; flex-direction:column; align-items:center; gap:6px; width:72px }
  .art { height:92px; display:flex; align-items:flex-end }
  .art svg { fill:var(--ink); shape-rendering:crispEdges }
  figcaption { font-size:9px; letter-spacing:.06em; color:#999 }
  figcaption em { color:var(--accent); font-style:normal }
  input { width:100%; border:0; border-bottom:1px solid var(--ink); font:inherit; font-size:17px;
          text-align:center; padding:2px 0; background:transparent }
  input:focus { outline:0; border-color:var(--accent); background:#fff6f5 }
  .bar { position:fixed; left:0; right:0; bottom:0; background:var(--ink); color:#fff;
         padding:14px 40px; display:flex; gap:24px; align-items:center }
  button { font:inherit; font-weight:700; text-transform:uppercase; letter-spacing:.08em;
           background:var(--accent); color:#fff; border:0; padding:12px 22px; cursor:pointer }
  textarea { flex:1; height:44px; font:11px/1.3 ui-monospace,monospace }
</style>
<header>
  <h1>Glif temas<br>sayfası</h1>
  <div class="meta">
    <span>kaynak <b>${SRC}</b></span>
    <span>bileşen <b>${stats.components}</b></span>
    <span>sayfa dışı <b>${stats.offPage}</b></span>
  </div>
</header>
<main>
  <p style="max-width:52ch;color:#555">Sarı satırlar belirsiz — iki harf aynı satırda.
  Her glifin altındaki kutuya harfini yaz, boş bırakılanlar kütüphaneye girmez.
  Bitince <b>Etiketleri kopyala</b>, sonucu <code>tools/labels.json</code> olarak kaydet.</p>
  ${sets.map(block).join('')}
</main>
<div class="bar">
  <button id="copy">Etiketleri kopyala</button>
  <textarea id="out" readonly placeholder="JSON buraya gelecek"></textarea>
</div>
<script>
  const out = document.getElementById('out')
  const collect = () => {
    const map = {}
    document.querySelectorAll('input[data-key]').forEach(i => {
      if (i.value.trim()) map[i.dataset.key] = i.value.trim()
    })
    return JSON.stringify(map, null, 2)
  }
  document.addEventListener('input', () => { out.value = collect() })
  document.getElementById('copy').onclick = () => {
    out.value = collect(); out.select(); navigator.clipboard.writeText(out.value)
  }
</script>`
}

// ---------------------------------------------------------------- çalıştır

const { letters, digits, stats } = extract()
const sets = [['letters', letters], ['digits', digits]]

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true })

writeFileSync(
  `${OUT}/glyphs.raw.json`,
  JSON.stringify({ source: SRC, rowPitch: ROW_PITCH, stats, letters, digits }, null, 2)
)
writeFileSync(`${OUT}/sheet.svg`, contactSvg(sets))
writeFileSync(`${OUT}/glyph-sheet.html`, sheet(sets, stats))
writeFileSync(
  `${OUT}/glyphs.ascii.txt`,
  asciiDump([...flatList(letters, 'letters'), ...flatList(digits, 'digits')], [
    ...letters.orphanMarks,
    ...digits.orphanMarks
  ])
)

const nL = flatList(letters, 'letters').length
const nD = flatList(digits, 'digits').length
console.log(`bileşen        : ${stats.components}  (sayfa dışı ${stats.offPage})`)
console.log(`harf satırı    : ${letters.rows.length}   glif: ${nL}`)
console.log(`rakam satırı   : ${digits.rows.length}   glif: ${nD}`)
console.log(`bağlanmamış    : ${letters.orphanMarks.length + digits.orphanMarks.length}`)
console.log(`belirsiz satır : ${letters.rows.filter((r) => r.ambiguous).map((r) => r.letters.join('/')).join(', ')}`)
console.log(`\nyazıldı: ${OUT}/{glyphs.raw.json, glyph-sheet.html, sheet.svg, glyphs.ascii.txt}`)
