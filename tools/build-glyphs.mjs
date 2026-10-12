// P0 — ham çıkarım + elle etiketleri birleştirip çalışma kütüphanesini yazar.
//
//   npm run glyphs:build
//
// Girdi : build/glyphs.raw.json, tools/labels.json, tools/glyphs.extra.json
// Çıktı : src/data/glyphs.json

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fromAscii, bbox, validate } from '../src/engine/grid.js'

const RAW = 'build/glyphs.raw.json'
const LABELS = 'tools/labels.json'
const EXTRA = 'tools/glyphs.extra.json'
const BLOCKS = 'tools/block-labels.json'
const OUT = 'src/data/glyphs.json'

// v1 karakter seti. Bu listede olmayan hiçbir şey kütüphaneye girmez.
const CHARSET = 'abcçdefgğhıijklmnoöprsştuüvyz'.split('')

const raw = JSON.parse(readFileSync(RAW, 'utf8'))
const labels = existsSync(LABELS) ? JSON.parse(readFileSync(LABELS, 'utf8')) : {}
const extra = existsSync(EXTRA) ? JSON.parse(readFileSync(EXTRA, 'utf8')) : { glyphs: [] }
const blocks = existsSync(BLOCKS) ? JSON.parse(readFileSync(BLOCKS, 'utf8')) : { labels: [] }

const byChar = new Map(CHARSET.map((c) => [c, []]))
const skipped = []

for (const row of raw.letters.rows) {
  for (const g of row.glyphs) {
    const key = `letters.${row.row}.${g.variant}`
    const char = labels[key] ?? g.char
    if (!char) {
      skipped.push({ key, reason: 'etiketsiz', w: g.w, h: g.h })
      continue
    }
    if (!byChar.has(char)) {
      skipped.push({ key, reason: `karakter seti dışı: ${char}`, w: g.w, h: g.h })
      continue
    }
    byChar.get(char).push({
      source: key,
      w: g.w,
      h: g.h,
      baseline: g.baselineFromTop,
      cells: g.cells
    })
  }
}

// Elle tasarlanmış ekler (kaynakta olmayan harfler ve varyantlar).
// ASCII olarak yazılır; burada hücrelere çevrilip değişmezlere karşı doğrulanır.
for (const g of extra.ascii ?? []) {
  if (!byChar.has(g.char)) {
    skipped.push({ key: g.source, reason: `karakter seti dışı: ${g.char}` })
    continue
  }
  const cells = fromAscii(g.art.join('\n'))
  const check = validate(cells, { requireConnected: false })
  if (!check.ok) {
    skipped.push({ key: g.source, reason: `geçersiz: ${check.errors.join('; ')}` })
    continue
  }
  const b = bbox(cells)
  byChar.get(g.char).push({
    source: g.source,
    proposed: g.proposed || undefined,
    note: g.note,
    w: b.w,
    h: b.h,
    baseline: b.h,
    cells
  })
}

// Ustanın afişinden elle etiketlenmiş biçimler. Doğruluk kaynağı bunlar:
// harf çiziminden (letters.svg) çıkanlar bir öneri, afişte fiilen kullanılan
// biçim ise kanıt. Çakışırsa afiş kazanır.
let fromMaster = 0
for (const l of blocks.labels ?? []) {
  if (l.chars.length !== 1) continue // çok harfli = kaynaşma, glif değil
  const char = l.chars
  if (!byChar.has(char)) {
    skipped.push({ key: `afiş:${char}`, reason: 'karakter seti dışı' })
    continue
  }
  const cells = fromAscii(l.art.join('\n'))
  const check = validate(cells, { requireConnected: false })
  if (!check.ok) {
    skipped.push({ key: `afiş:${char}`, reason: `geçersiz: ${check.errors.join('; ')}` })
    continue
  }
  const b = bbox(cells)
  byChar.get(char).push({
    source: `afiş:${char}`,
    master: true,
    w: b.w,
    h: b.h,
    baseline: b.h,
    cells
  })
  fromMaster++
}

// Aynı biçim birden çok kaynaktan gelmiş olabilir; afişten geleni tut.
for (const [char, variants] of byChar) {
  const seen = new Map()
  for (const v of variants) {
    const art = v.cells.map(([x, y]) => `${x},${y}`).sort().join('|')
    const prev = seen.get(art)
    if (!prev || (v.master && !prev.master)) seen.set(art, v)
  }
  byChar.set(char, [...seen.values()])
}

// Her harfin varyantları genişliğe göre sıralı; ilk varyant varsayılan.
const glyphs = {}
for (const [char, variants] of byChar) {
  if (!variants.length) continue
  // Afişten doğrulanmış biçimler önce — varsayılan varyant oradan seçilsin.
  variants.sort((a, b) => Number(Boolean(b.master)) - Number(Boolean(a.master)) || a.w - b.w || a.h - b.h)
  glyphs[char] = variants.map((v, i) => ({ id: `${char}.${i}`, ...v }))
}

const missing = CHARSET.filter((c) => !glyphs[c])

writeFileSync(
  OUT,
  JSON.stringify(
    {
      note: 'Üretilmiş dosya — elle düzenleme. Kaynak: tools/build-glyphs.mjs',
      charset: CHARSET.join(''),
      missing,
      glyphs
    },
    null,
    2
  )
)

const counts = Object.entries(glyphs).map(([c, v]) => `${c}:${v.length}`)
console.log(`afişten   : ${fromMaster} biçim (doğruluk kaynağı)`)
console.log(`harf      : ${Object.keys(glyphs).length}/${CHARSET.length}`)
console.log(`varyant   : ${Object.values(glyphs).reduce((n, v) => n + v.length, 0)}`)
console.log(`eksik     : ${missing.length ? missing.join(' ') : '—'}`)
if (skipped.length) {
  console.log(`atlandı   : ${skipped.length}`)
  for (const s of skipped) console.log(`  ${s.key}  ${s.reason}`)
}
console.log(`\n${counts.join('  ')}`)
console.log(`\nyazıldı: ${OUT}`)
