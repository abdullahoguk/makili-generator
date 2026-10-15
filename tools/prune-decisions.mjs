// Kütüphanede artık olmayan biçimlere atıfta bulunan kararları temizler.
//
//   node tools/prune-decisions.mjs          ne olacağını göster
//   node tools/prune-decisions.mjs --write  uygula
//
// Bir biçim kütüphaneden çıkarıldığında (tools/glyph-rejects.json) ona
// atıfta bulunan onaylı yerleşimler sessizce işlemez hale gelir: çözücü o
// kimliği arar, bulamaz, karar uygulanmaz. Dosyada durmaları yanıltıcı —
// karar varmış gibi görünür, yokmuş gibi davranır.
//
// Bir çiftin BÜTÜN satırları düşerse o çift kararsız kalır; ayrıca bildirilir,
// çünkü lab'de yeniden karara bağlanması gerekir.
//
// DİKKAT: türetilmiş glif kimlikleri `taban^N` biçiminde (n.yd6m8^1 gibi) ve
// kütüphanede DURMAZ — çalışma anında üretilirler. Tabanı duruyorsa kimlik
// geçerlidir. Bu ayrım gözetilmezse araç bütün türetilmiş kararları
// "yok olmuş" sayıp siler.

import { readFileSync, writeFileSync } from 'node:fs'
import library from '../src/data/glyphs.json' with { type: 'json' }
import { resolveId } from '../src/engine/glyphs.js'
import { place, BAND_HEIGHT } from '../src/engine/fit.js'

const FILES = ['tools/pair-decisions.json', 'src/data/pair-decisions.json']
const write = process.argv.includes('--write')

const known = new Set()
for (const variants of Object.values(library.glyphs)) {
  for (const v of variants) known.add(v.id)
}

/** Türetilmiş kimliğin tabanı kütüphanede duruyorsa kimlik geçerlidir. */
const exists = (id) => known.has(String(id).split('^')[0])

const src = JSON.parse(readFileSync(FILES[0], 'utf8'))
const dropped = []
const emptied = []
const ok = {}

for (const [pair, rows] of Object.entries(src.ok ?? {})) {
  const kept = rows.filter((r) => {
    if (!exists(r[0]) || !exists(r[1])) {
      dropped.push({ pair, row: r, missing: [r[0], r[1]].filter((id) => !exists(id)) })
      return false
    }
    // Kimlikler duruyor ama yerleşim kurala uymuyor olabilir: kurallar
    // keskinleştikçe eskiden onaylanmış bir yerleşim geçersizleşebiliyor.
    // Dosyada durması yanıltıcı — karar varmış gibi görünür, çözücü ise
    // o yerleşimi hiç üretmez.
    const l = resolveId(r[0])
    const rg = resolveId(r[1])
    const p = place(l.cells, rg.cells, r[2], {
      bandHeight: BAND_HEIGHT, leftTop: r[3], rightTop: r[4]
    })
    if (!p.ok) {
      dropped.push({ pair, row: r, missing: [], reason: p.reason })
      return false
    }
    return true
  })
  if (kept.length) ok[pair] = kept
  else emptied.push(pair)
}

console.log(`çift ${Object.keys(src.ok ?? {}).length}  ·  düşen satır ${dropped.length}  ·  kararsız kalan çift ${emptied.length}`)
for (const d of dropped) {
  console.log(
    `  ${d.pair}  [${d.row.join(' ')}]  ` +
      (d.missing.length ? `yok: ${d.missing.join(' ')}` : `kurala aykırı: ${d.reason}`)
  )
}
if (emptied.length) console.log(`\nbütün satırları düşenler: ${emptied.join(' ')}  — lab'de yeniden karara bağla`)

if (!dropped.length) {
  console.log('\ntemiz, yapılacak bir şey yok')
} else if (write) {
  const out = { ...src, ok }
  for (const f of FILES) writeFileSync(f, JSON.stringify(out, null, 2) + '\n')
  console.log(`\nyazıldı: ${FILES.join(', ')}`)
} else {
  console.log('\nuygulamak için: node tools/prune-decisions.mjs --write')
}
