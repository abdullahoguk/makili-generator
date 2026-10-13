// Çift kararlarını denetler: tutarsızlık, şüpheli varyant, çözümsüz çift.
//
//   node tools/analyze-decisions.mjs
//
// "Arada yanlış işaretlediklerim olabilir" dendiği için makineyle aranabilecek
// üç şey var:
//
//   1. Geçersiz kayıt — kütüphanede olmayan varyanta ya da artık üretilemeyen
//      bir yerleşime atıfta bulunan karar.
//   2. Şüpheli varyant — hiçbir 'olur' kararında geçmeyen, ama 'olmaz'larda
//      sık görünen glif. Bu çift kararı değil, glif kararıdır: o biçim
//      kütüphaneden çıkmalı.
//   3. Çözümsüz çift — tüm yerleşimleri reddedilmiş çift. Yeni biçim gerekir.

import { readFileSync } from 'node:fs'
import { pairPlacements, place, bandVariants } from '../src/engine/fit.js'
import { variantsOf } from '../src/engine/glyphs.js'
import { toAscii, bbox } from '../src/engine/grid.js'

const d = JSON.parse(readFileSync('tools/pair-decisions.json', 'utf8'))
const BAND = d.bandHeight ?? 9

const okEntries = []
for (const [pair, rows] of Object.entries(d.ok)) {
  for (const [left, right, advance, leftTop, rightTop] of rows) {
    okEntries.push({ pair, left, right, advance, leftTop, rightTop })
  }
}

console.log(`olur kararı: ${okEntries.length}`)
console.log(`reddedilen  : ${Object.values(d.rejectedCounts).reduce((a, b) => a + b, 0)}`)
console.log(`çözümsüz çift: ${d.allRejected.join(' ')}\n`)

// --- 1. geçersiz kayıt --------------------------------------------------
const byId = new Map()
for (const e of okEntries) {
  for (const id of [e.left, e.right]) {
    const char = id.split('.')[0]
    if (byId.has(id)) continue
    const g = bandVariants(char, BAND).find((v) => v.id === id)
    if (g) byId.set(id, g)
  }
}

const broken = []
for (const e of okEntries) {
  const L = byId.get(e.left)
  const R = byId.get(e.right)
  if (!L || !R) {
    broken.push({ ...e, why: !L ? `${e.left} kütüphanede yok` : `${e.right} kütüphanede yok` })
    continue
  }
  const p = place(L.cells, R.cells, e.advance, {
    bandHeight: BAND,
    leftTop: e.leftTop,
    rightTop: e.rightTop
  })
  if (!p.ok) broken.push({ ...e, why: `yerleşim artık geçersiz: ${p.reason}` })
}

console.log(`--- geçersiz olur kaydı: ${broken.length}`)
for (const b of broken) console.log(`   ${b.pair}  ${b.left} + ${b.right}  — ${b.why}`)

// --- 2. şüpheli varyant -------------------------------------------------
// Kullanım sayısı TABAN kimliğe yazılır: 'u.0^5' onaylanmışsa 'u.0' biçimi
// kabul görmüş demektir, yalnız yüksekliği türetilmiştir. Bunu ayırmamak
// sağlam biçimleri şüpheli göstermeye yol açıyordu.
const okUse = new Map()
const okDerived = new Map()
for (const e of okEntries) {
  for (const id of [e.left, e.right]) {
    const base = id.split('^')[0]
    okUse.set(base, (okUse.get(base) ?? 0) + 1)
    if (id.includes('^')) okDerived.set(base, (okDerived.get(base) ?? 0) + 1)
  }
}

const CHARS = [...new Set(okEntries.flatMap((e) => [e.left, e.right]).map((i) => i.split('.')[0]))]
console.log(`\n--- hiç 'olur' almamış biçimler`)
console.log(`    (türetilmiş hali onaylanmışsa taban biçim de sayılır)`)
let suspect = 0
for (const char of CHARS.sort()) {
  const designed = (variantsOf(char) ?? []).map((v) => v.id)
  const never = designed.filter((id) => !okUse.has(id))
  if (!never.length) continue
  suspect += never.length
  console.log(`  '${char}': ${never.join(' ')}   (olur alan: ${designed.filter((i) => okUse.has(i)).join(' ') || '—'})`)
}
console.log(`  toplam şüpheli: ${suspect}`)

// --- 3. çözümsüz çiftler ------------------------------------------------
console.log(`\n--- çözümsüz çiftler: kaç yerleşim denenmişti?`)
for (const pair of d.allRejected) {
  const [a, b] = [...pair]
  const n = pairPlacements(a, b, { bandHeight: BAND, limit: 500 }).length
  console.log(`  ${pair}: motor ${n} yerleşim üretiyor, hepsi reddedildi`)
}

// --- 4. şüpheli varyantların biçimi -------------------------------------
console.log(`\n--- şüpheli biçimler`)
for (const char of CHARS.sort()) {
  for (const v of variantsOf(char) ?? []) {
    if (okUse.has(v.id)) continue
    const b = bbox(v.cells)
    console.log(`\n  '${char}' ${v.id}  ${b.w}x${b.h}${v.master ? '  [AFİŞ]' : ''}`)
    console.log(toAscii(v.cells).split('\n').map((r) => '     ' + r).join('\n'))
  }
}
