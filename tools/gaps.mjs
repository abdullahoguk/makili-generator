// Eksik ve sorunlu çiftleri/üçlüleri çıkarır.
//
//   node tools/gaps.mjs                       varsayılan metinle
//   node tools/gaps.mjs metin.txt             kendi metninle
//   node tools/gaps.mjs --json > gaps.json    makine okunur çıktı
//
// Neyi "sorun" sayıyoruz:
//
//   ÇİFT
//     yok        motor hiç geçerli yerleşim üretemiyor
//     reddedildi lab'de tüm yerleşimleri reddedilmiş
//     kararsız   üretiyor ama hiç onay almamış — bakılmamış demek
//     delik      en iyi yerleşimde bile GENİŞ boşluk kalıyor. Bir hücrelik
//                açıklık kuralın kendisidir (harf arası kanal, sayaç yarığı);
//                kusur ancak iki hücreden geniş VE yüksek bir cepte başlar.
//
//   ÜÇLÜ
//     Üçlüler ayrı bir mesele: iki çift tek tek iyi olsa da üçü bir arada
//     tutmayabilir, ya da tersine — tek başına kötü görünen bir çift,
//     üçüncü harfin uzantısı boşluğu doldurunca iyi hale gelebilir.
//     Bu yüzden üçlüler dizi çözücüyle ayrıca sınanıyor.

import { readFileSync } from 'node:fs'
import { pairPlacements } from '../src/engine/fit.js'
import { layoutWord } from '../src/engine/sequence.js'
import { hasDecisions, unsolvedPairs } from '../src/engine/decisions.js'
import { CHARSET } from '../src/engine/glyphs.js'

const BAND = 9

const DEFAULT_TEXT = `hak bir gönül verdi bana
ha demeden hayran olur
bir dem gelir şadan olur
bir dem gelir giryan olur
bir dem gelir İsa gibi
ölmüşleri diri kılar
bir dem girer kibir evine
firavn ile haman olur
bir dem döner Cebrail'e
rahmet saçar her mahfile
bir dem gelir gümrah olur
miskin yunus hayran olur`

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const file = args.find((a) => !a.startsWith('--'))
const text = file ? readFileSync(file, 'utf8') : DEFAULT_TEXT

/** Metindeki n-gramlar, sıklığa göre. Kelime sınırı yok — yazı kesintisiz. */
function ngrams(src, n) {
  const counts = new Map()
  for (const line of src.toLowerCase().split('\n')) {
    const chars = [...line].filter((c) => CHARSET.includes(c))
    for (let i = 0; i + n <= chars.length; i++) {
      const g = chars.slice(i, i + n).join('')
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])
}

// ---------------------------------------------------------------- çiftler

const pairs = ngrams(text, 2).map(([key, n]) => {
  const [a, b] = [...key]
  const list = pairPlacements(a, b, { bandHeight: BAND, limit: 200 })
  const best = list[0]
  const decided = hasDecisions(a, b)

  let status
  if (unsolvedPairs.has(key)) status = 'reddedildi'
  else if (!list.length) status = 'yok'
  else if (!decided) status = 'kararsız'
  else if ((best?.excessWide ?? 0) > 0) status = 'delik'
  else status = 'tamam'

  return {
    key,
    n,
    status,
    placements: list.length,
    decided,
    worstVoid: best?.excessWide ?? null,
    width: best?.width ?? null
  }
})

// ---------------------------------------------------------------- üçlüler

const triples = ngrams(text, 3).map(([key, n]) => {
  const r = layoutWord(key, { bandHeight: BAND })
  const [a, b, c] = [...key]
  const left = `${a}${b}`
  const right = `${b}${c}`

  let status
  if (!r.ok) status = 'yok'
  else if (!r.bandOk) status = 'bant'
  else if (r.report.wideVoid > 0) status = 'delik'
  else status = 'tamam'

  return {
    key,
    n,
    status,
    width: r.ok ? r.width : null,
    void: r.ok ? r.report.wideVoid : null,
    // Alt çiftlerinin durumu: üçlü sorunluysa suç hangisinde?
    pairs: [left, right].map((k) => pairs.find((p) => p.key === k)?.status ?? '—')
  }
})

// ---------------------------------------------------------------- rapor

const BAD = new Set(['yok', 'reddedildi', 'delik', 'bant'])
const problemPairs = pairs.filter((p) => BAD.has(p.status))
const unreviewed = pairs.filter((p) => p.status === 'kararsız')
const problemTriples = triples.filter((t) => BAD.has(t.status))

if (asJson) {
  console.log(JSON.stringify({ pairs, triples }, null, 2))
} else {
  const tally = (list) => {
    const m = new Map()
    for (const x of list) m.set(x.status, (m.get(x.status) ?? 0) + 1)
    return [...m].map(([k, v]) => `${k} ${v}`).join('  ')
  }

  console.log(`metin: ${file ?? '(varsayılan şiir)'}`)
  console.log(`çift : ${pairs.length}   ${tally(pairs)}`)
  console.log(`üçlü : ${triples.length}   ${tally(triples)}\n`)

  console.log(`=== SORUNLU ÇİFTLER (${problemPairs.length}) — sıklığa göre`)
  console.log('çift  kez  durum       yerleşim  delik')
  for (const p of problemPairs) {
    console.log(
      `${p.key.padEnd(5)} ${String(p.n).padStart(3)}  ${p.status.padEnd(11)}` +
        ` ${String(p.placements).padStart(8)}  ${p.worstVoid ?? '-'}`
    )
  }

  console.log(`\n=== BAKILMAMIŞ ÇİFTLER (${unreviewed.length}) — yerleşim var, karar yok`)
  console.log(unreviewed.map((p) => `${p.key}(${p.n})`).join('  ') || '—')

  console.log(`\n=== SORUNLU ÜÇLÜLER (${problemTriples.length}) — sıklığa göre`)
  console.log('üçlü  kez  durum   genişlik  delik   alt çiftler')
  for (const t of problemTriples.slice(0, 40)) {
    console.log(
      `${t.key.padEnd(5)} ${String(t.n).padStart(3)}  ${t.status.padEnd(7)}` +
        ` ${String(t.width ?? '-').padStart(8)}  ${String(t.void ?? '-').padStart(5)}   ${t.pairs.join(' / ')}`
    )
  }
  if (problemTriples.length > 40) console.log(`… ve ${problemTriples.length - 40} tane daha`)

  // Alt çiftleri sağlam olduğu halde tutmayan üçlüler: asıl ilginç olanlar,
  // çünkü sorun çiftlerde değil üçlünün kendisinde.
  const emergent = problemTriples.filter((t) => t.pairs.every((s) => s === 'tamam'))
  console.log(`\n=== ÇİFTLERİ SAĞLAM AMA ÜÇLÜSÜ TUTMAYANLAR (${emergent.length})`)
  console.log('Bunlarda sorun çiftlerde değil; üç harf bir arada durmuyor.')
  console.log(emergent.map((t) => `${t.key}(${t.n})`).join('  ') || '—')
}
