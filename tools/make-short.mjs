// Harflerin KISA biçimlerini üretir.
//
//   node tools/make-short.mjs              rapor
//   node tools/make-short.mjs --emit       glyphs.extra.json'a eklenecek JSON
//   node tools/make-short.mjs --write      src/data/short-candidates.json'a yaz
//   node tools/make-short.mjs --min 6      en kısa boy (varsayılan 6)
//
// Kısa biçim türetilemiyordu: derive.js satır/sütun ÇOĞALTABİLİYOR,
// eksiltemiyordu. Oysa ustanın elle çizdiği kısa biçimler incelenince
// kural ortaya çıkıyor — kısa biçim, tam boy biçimden YİNELENEN KOMŞU
// SATIRLARIN silinmesiyle elde ediliyor:
//
//     ###        ###
//     #.#        #.#
//     #.#   ->   ..#     (üstteki #.# satırlarından biri silindi)
//     ..#        ###
//     ###        #.#
//     #.#        ###
//     #.#
//     ###
//
// Bu, heighten()'ın (satır çoğaltma) tam tersi. Tersi olduğu için de
// güvenli: üretilen her kısa biçim geri uzatılınca kütüphanedeki bilinen
// biçme dönüyor, yani harfin kimliği bozulmuyor. Yeni bir harf icat
// edilmiyor, var olanın basamakları iniliyor.
//
// Üretilenler ÖNERİDİR. Hangisinin doğru durduğu insan kararı; lab'de
// 'çıkar' ile elenirler.

import { readFileSync, writeFileSync } from 'node:fs'
import { CHARSET, variantsOf } from '../src/engine/glyphs.js'
import { bbox, toAscii, cornerTouches, fromAscii } from '../src/engine/grid.js'
import { scoreBlock } from '../src/engine/fit.js'

const argv = process.argv.slice(2)
const emit = argv.includes('--emit')
const write = argv.includes('--write')
const minI = argv.indexOf('--min')
const MIN_H = minI >= 0 ? Number(argv[minI + 1]) : 5
const want = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--min')

// Desteklenen bant boyları. Bir biçim İKİ ayrı işe yarayabilir:
//   bant === boy  ->  o bandın TAM BOY biçimi
//   bant >  boy   ->  daha yüksek bantta DOLGU (l'nin göbeği gibi)
const BANDS = [5, 6, 7, 8, 9]

/**
 * Bu boy, bu bantta yasal olarak nerelere oturabilir?
 *
 * Glifin üstünde ya da altında tam 1 satır boşluk kalamaz — oraya kimse
 * giremez (fit.js'teki aynı kural). Bu yüzden 8 birimlik biçim 9'luk
 * bantta hiçbir yere oturamaz: üste yaslanırsa altta, bir aşağı inerse
 * üstte tek satır kalıyor. Ama bant 8 seçilirse aynı biçim o bandın tam
 * boy biçimidir. Yani boy tek başına iyi ya da kötü değil — hangi bantta
 * kullanıldığına bağlı.
 */
function placeableTops(h, band) {
  const out = []
  for (let top = 0; top + h <= band; top++) {
    if (top === 1 || band - (top + h) === 1) continue
    out.push(top)
  }
  return out
}

/** Bu boyun hangi bantta tam boy, hangilerinde dolgu olduğu. */
function usage(h) {
  return {
    fullBandAt: BANDS.includes(h) ? h : null,
    fillsIn: BANDS.filter((b) => b > h && placeableTops(h, b).length)
  }
}

const art = (cells) => toAscii(cells).split('\n')

/** Komşusuyla aynı olan her satırı tek tek silerek bir basamak iner. */
function stepDown(rows) {
  const out = []
  for (let i = 0; i + 1 < rows.length; i++) {
    if (rows[i] !== rows[i + 1]) continue
    out.push([...rows.slice(0, i), ...rows.slice(i + 1)])
  }
  return out
}

/** Bir biçimden inilebilen bütün kısa biçimler (boy -> satır dizileri). */
function ladderDown(rows, minH) {
  const seen = new Map([[rows.join('/'), rows]])
  let edge = [rows]
  while (edge.length) {
    const next = []
    for (const r of edge) {
      if (r.length <= minH) continue
      for (const s of stepDown(r)) {
        const k = s.join('/')
        if (seen.has(k)) continue
        seen.set(k, s)
        next.push(s)
      }
    }
    edge = next
  }
  seen.delete(rows.join('/'))
  return [...seen.values()]
}

// Harf tanınır kalmalı: silinen satırlar harfin AYIRT EDİCİ satırını
// yok etmemeli. Ayırt edici satır = o biçimde yalnız bir kez geçen satır
// (a'nın '..#'i, c'nin '#..'ı). Hepsi korunuyorsa biçim hâlâ o harf.
const uniqueRows = (rows) => {
  const n = new Map()
  for (const r of rows) n.set(r, (n.get(r) ?? 0) + 1)
  return [...n].filter(([, c]) => c === 1).map(([r]) => r)
}

const letters = want.length ? want : CHARSET
const made = {}
let total = 0

for (const ch of letters) {
  const base = variantsOf(ch) ?? []
  const existing = new Set(base.map((v) => art(v.cells).join('/')))
  const picked = new Map()

  for (const v of base) {
    const rows = art(v.cells)
    const keep = uniqueRows(rows)
    for (const s of ladderDown(rows, MIN_H)) {
      const k = s.join('/')
      if (existing.has(k) || picked.has(k)) continue
      // Ayırt edici satırların hepsi duruyor mu?
      if (!keep.every((r) => s.includes(r))) continue
      const cells = fromAscii(s.join('\n'))
      if (!cells.length) continue
      const b = bbox(cells)
      if (b.h < MIN_H) continue
      // Hiçbir bantta ne tam boy ne dolgu olabiliyorsa gerçekten çöp.
      const use = usage(b.h)
      if (!use.fullBandAt && !use.fillsIn.length) continue
      // Tek harfin kendi kuralları: köşeden birleşme olmasın, parçalanmasın.
      if (cornerTouches(cells).length) continue
      if (scoreBlock(cells, b.h).parts !== 1) continue
      picked.set(k, { h: b.h, w: b.w, from: v.id, art: s })
    }
  }

  if (!picked.size) continue
  const list = [...picked.values()].sort((a, b) => b.h - a.h || a.w - b.w)
  made[ch] = list
  total += list.length
}

console.log(`kısa biçim önerisi ${total}  ·  ${Object.keys(made).length} harf  ·  en kısa boy ${MIN_H}\n`)
console.log('harf  öneri   boylar')
for (const [ch, list] of Object.entries(made)) {
  const byH = {}
  for (const g of list) byH[g.h] = (byH[g.h] ?? 0) + 1
  console.log(
    `${ch.padEnd(5)} ${String(list.length).padStart(5)}   ` +
      Object.entries(byH).sort((a, b) => b[0] - a[0]).map(([h, n]) => `${h}:${n}`).join(' ')
  )
}

if (want.length) {
  for (const [ch, list] of Object.entries(made)) {
    for (const g of list.slice(0, 12)) {
      console.log(`\n--- '${ch}' ${g.w}×${g.h}  (${g.from})`)
      console.log(g.art.map((r) => '    ' + r).join('\n'))
    }
  }
}

const records = Object.entries(made).flatMap(([ch, list]) =>
  list.map((g) => ({
    char: ch,
    source: `short:${g.from}`,
    note: `kısa biçim — ${g.from} biçiminden ${g.h} satıra inildi (make-short.mjs)`,
    short: true,
    fullBandAt: usage(g.h).fullBandAt,
    fillsIn: usage(g.h).fillsIn,
    art: g.art
  }))
)

if (emit) console.log('\n' + JSON.stringify({ ascii: records }, null, 2))

if (write) {
  // Öneriler DOĞRUDAN kütüphaneye yazılmıyor. 261 biçmi birden eklemek
  // dizgiyi bozuyor: hedef genişlik seçimi dokuya bakmadığı için ortak
  // genişlik 73'ten 75'e kayıyor ve dörtlükte delik 10'dan 76'ya çıkıyor.
  // Önce insan eliyor, sonra kalanlar kütüphaneye giriyor.
  const p = 'src/data/short-candidates.json'
  writeFileSync(
    p,
    JSON.stringify(
      {
        _note:
          'tools/make-short.mjs üretir — ÖNERİ. Lab\'de elenir, kalanlar ' +
          'tools/glyphs.extra.json\'a eklenir. Kural: tam boy biçimden ' +
          'yinelenen komşu satırların silinmesi (heighten\'ın tersi).',
        minHeight: MIN_H,
        ascii: records
      },
      null,
      2
    ) + '\n'
  )
  console.log(`\n${p}: ${records.length} öneri yazıldı`)
}
