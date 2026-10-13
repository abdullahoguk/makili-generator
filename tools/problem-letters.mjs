// Blok oluşturmakta zorlanan harfleri çıkarır.
//
//   node tools/problem-letters.mjs
//   node tools/problem-letters.mjs l t j p      yalnız bu harfleri incele
//
// Bazı harfler tek başına bir bloğu kaplamaz: büyük L, T, J, P gibi biçimler
// bandı doldursa da yanlarında kocaman boşluk bırakır. Komşuları o boşluğu
// doldurmazsa dokuda delik kalır.
//
// Her harf için ölçülenler:
//
//   doluluk     harfin kapladığı hücre / kutusunun alanı
//   kendi deliği tek başına bıraktığı iki hücre kalınlığındaki boşluk
//   ortalama    o harfle kurulan çiftlerde kalan fazladan delik
//   çözümsüz    hiç geçerli yerleşim üretmeyen komşu sayısı
//
// Son sütunlar asıl ölçü: bir harf tek başına boşluklu olabilir, önemli olan
// komşularıyla birlikte doku kurup kuramadığı.

import { bandVariants, pairPlacements, scoreBlock, intrinsicVoid } from '../src/engine/fit.js'
import { CHARSET } from '../src/engine/glyphs.js'
import { bbox, toAscii } from '../src/engine/grid.js'

const BAND = 9
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const letters = want.length ? want : CHARSET

const rows = []

for (const ch of letters) {
  const variants = bandVariants(ch, BAND)
  if (!variants.length) {
    rows.push({ ch, missing: true })
    continue
  }

  // Temsilci: önce BANDI DOLDURANLAR arasından en yoğunu. Kısa varyantlar
  // yoğun görünür ama tek başına blok kuramaz; onları temsilci saymak
  // karşılaştırmayı bozuyordu.
  const density = (v) => v.cells.length / (bbox(v.cells).w * bbox(v.cells).h)
  const full = variants.filter((v) => bbox(v.cells).h === BAND)
  const pool = full.length ? full : variants
  const best = pool.reduce((a, b) => (density(b) > density(a) ? b : a))
  const b = bbox(best.cells)
  const fill = density(best)
  const own = intrinsicVoid(best.cells, BAND, best.id).wide

  // Komşularla deneme: hem sol hem sağ konumda.
  let pairs = 0
  let dead = 0
  let excess = 0
  for (const other of CHARSET) {
    for (const [x, y] of [[ch, other], [other, ch]]) {
      const list = pairPlacements(x, y, { bandHeight: BAND, limit: 60 })
      pairs++
      if (!list.length) dead++
      else excess += list[0].excessWide ?? 0
    }
  }

  rows.push({
    ch,
    variants: variants.length,
    w: b.w,
    density: fill,
    own,
    fullBand: b.h === BAND,
    dead,
    pairs,
    avgExcess: excess / Math.max(1, pairs - dead),
    art: toAscii(best.cells)
  })
}

const scored = rows.filter((r) => !r.missing)
scored.sort((a, b) => b.dead - a.dead || b.avgExcess - a.avgExcess || a.density - b.density)

console.log('harf  var  en  doluluk  kendi  çözümsüz  ort.delik')
for (const r of scored) {
  console.log(
    `${r.ch.padEnd(5)} ${String(r.variants).padStart(3)} ${String(r.w).padStart(3)}` +
      `  ${r.density.toFixed(2).padStart(7)}  ${String(r.own).padStart(5)}` +
      `  ${`${r.dead}/${r.pairs}`.padStart(8)}  ${r.avgExcess.toFixed(2).padStart(9)}`
  )
}

const missing = rows.filter((r) => r.missing)
if (missing.length) console.log(`\nbanda sığmayan: ${missing.map((r) => r.ch).join(' ')}`)

const worst = scored.filter((r) => r.dead > 0 || r.avgExcess > 0.5 || r.density < 0.42)
console.log(`\n=== SORUNLU HARFLER (${worst.length})`)
console.log('Ölçüt: çözümsüz komşusu olan, ortalama deliği yüksek ya da doluluğu 0.42 altında.')
for (const r of worst) {
  console.log(
    `\n--- '${r.ch}'  doluluk ${r.density.toFixed(2)}  kendi deliği ${r.own}` +
      `  çözümsüz komşu ${r.dead}  ort.delik ${r.avgExcess.toFixed(2)}`
  )
  console.log(r.art.split('\n').map((l) => '    ' + l).join('\n'))
}
