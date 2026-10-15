// Hangi harfe hangi ÖLÇÜDE kısa/dar biçim gerekiyor?
//
//   node tools/short-needs.mjs
//   node tools/short-needs.mjs --json      lab'e yapıştırılacak hâli
//   node tools/short-needs.mjs v g d       yalnız bu harfleri sor
//
// Çözümsüz çift için "bir biçim eksik" demek yetmiyor; hangi ölçüde
// eksik olduğu söylenmeli. Boşluk zaten geometride duruyor: sol harfin
// sağa açık her kutusu, sağ harften BELLİ bir ölçü istiyor.
//
// Bir kutu {w, h} ise sağ harf en çok (w-1) × h olabilir — 1 birim
// açıklık kutunun sol duvarına. Harfin o ölçüde biçimi yoksa kenetlenme
// kurulamaz; motor değil kütüphane eksiktir.
//
// Kısa biçim TÜRETİLEMEZ: derive.js yalnız satır/sütun ÇOĞALTABİLİR,
// eksiltemez. Yani bu ölçüler elle çizilmek zorunda.

import { readFileSync, writeFileSync } from 'node:fs'
import { bandVariants, cavities, pairPlacements, nestPlacements } from '../src/engine/fit.js'
import { widthLadder } from '../src/engine/derive.js'
import { CHARSET } from '../src/engine/glyphs.js'
import { bbox } from '../src/engine/grid.js'

const BAND = 9
const MIN_GLYPH = 3 // 3 satırdan kısa harf okunmuyor
const MAX_W = 9 // sol harf bu genişliğe kadar uzayabilir
// 1 birim genişlikte harf yalnız 'i'/'ı' olabilir; başka harf için
// 1 birimlik kutu talep değil, o çiftin yuvalanamadığının işareti.
const MIN_W = 2

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const only = new Set(argv.filter((a) => !a.startsWith('--')))

const triage = JSON.parse(readFileSync('src/data/pair-triage.json', 'utf8'))

/** Çiftin deliksiz bir yerleşimi var mı? */
const solved = (pair) => {
  const [a, b] = [...pair]
  const o = { bandHeight: BAND, limit: 80 }
  return (
    pairPlacements(a, b, o).some((p) => (p.wideVoid ?? 0) === 0) ||
    nestPlacements(a, b, { ...o, limit: 200 }).some((p) => p.wideVoid === 0)
  )
}

// Hangi çiftler gerçekten çözümsüz? triage'ın 'hard' listesi aday, ama
// aralarında bu arada çözülenler var — yeniden sınanıyor.
const stuck = triage.hard.filter((p) => [...p].every((c) => CHARSET.includes(c)) && !solved(p))

// Harf -> istenen ölçüler
const demand = new Map()

for (const pair of stuck) {
  const [a, b] = [...pair]
  if (only.size && !only.has(b)) continue

  // Sol harfin GENİŞLETİLMİŞ biçimleri de havuzda — nestPlacements nasıl
  // bakıyorsa burası da öyle bakmalı. Ustanın 'L'sinde alt çubuk sonraki
  // harfin genişliğine kadar uzuyor, yani boşluk büyüyor; yalnız asıl
  // biçimlere bakmak 'l'nin göbeğini 2 birim gösteriyordu.
  const leftPool = []
  for (const lv of bandVariants(a, BAND)) {
    for (const [, g] of widthLadder(lv, MAX_W)) leftPool.push(g)
  }

  // Her boşluğun yalnız EN BÜYÜK hâli istenir. cavities() her alt
  // dikdörtgeni döndürüyor; hepsini talep saymak aynı boşluğu
  // 1×3, 1×4, 1×5... diye altı kez listelemek demekti.
  const boxes = new Map()
  for (const lv of leftPool) {
    for (const c of cavities(lv.cells, 'right')) {
      const w = c.w - 1 // 1 birim açıklık
      if (w < MIN_W || c.h < MIN_GLYPH) continue
      const k = `${lv.id}|${c.y}`
      const cur = boxes.get(k)
      if (!cur || w * c.h > cur.w * cur.h) boxes.set(k, { w, h: c.h, via: lv.id, top: c.y })
    }
  }
  if (!boxes.size) continue

  // Sağ harfin eldeki en küçük kutusu — istenenle farkı asıl haber.
  const have = bandVariants(b, BAND).map((v) => bbox(v.cells))
  const fits = (w, h) => have.some((g) => g.w <= w && g.h <= h)

  for (const box of boxes.values()) {
    if (fits(box.w, box.h)) continue // bu kutu zaten doluyor, çift başka sebepten takılı
    const list = demand.get(b) ?? []
    const hit = list.find((d) => d.w === box.w && d.h === box.h)
    if (hit) { if (!hit.pairs.includes(pair)) hit.pairs.push(pair) }
    else list.push({ w: box.w, h: box.h, top: box.top, via: box.via, pairs: [pair] })
    demand.set(b, list)
  }
}

// Bastırılan ölçüleri at: 4×5 çizilirse 3×4 de sığar, ikisini ayrı
// talep olarak listelemek çizim kuyruğunu şişiriyor.
for (const [ch, list] of demand) {
  const keep = list.filter(
    (d) => !list.some((o) => o !== d && o.w >= d.w && o.h >= d.h && (o.w > d.w || o.h > d.h))
  )
  demand.set(ch, keep.length ? keep : list)
}

// En çok çift açan ölçü önce.
const rows = [...demand].map(([ch, list]) => {
  list.sort((x, y) => y.pairs.length - x.pairs.length || y.w * y.h - x.w * x.h)
  const have = bandVariants(ch, BAND).map((v) => bbox(v.cells))
  const min = have.length
    ? have.reduce((a, g) => (g.w * g.h < a.w * a.h ? g : a))
    : null
  return { ch, list, min, total: list.reduce((n, d) => n + d.pairs.length, 0) }
})
rows.sort((a, b) => b.total - a.total)

const asked = new Set(rows.flatMap((r) => r.list.flatMap((d) => d.pairs)))

if (asJson) {
  const out = {
    _note:
      'tools/short-needs.mjs üretir — ELLE DÜZENLEME. Her satır: o harfe ' +
      'çizilmesi gereken bir kutu. w/h ÜST SINIR, 1 birim açıklık düşülmüş.',
    bandHeight: BAND,
    stuck: stuck.length,
    needs: rows.flatMap((r) => r.list.map((d) => ({
      char: r.ch,
      w: d.w,
      h: d.h,
      top: d.top,
      cavityOf: d.via,
      have: r.min ? { w: r.min.w, h: r.min.h } : null,
      unlocks: d.pairs
    })))
  }
  writeFileSync('src/data/short-needs.json', JSON.stringify(out, null, 2) + '\n')
  console.log(`src/data/short-needs.json yazıldı — ${out.needs.length} ölçü`)
  process.exit(0)
}

console.log(`çözümsüz çift ${stuck.length}  ·  biçim bekleyen harf ${rows.length}\n`)
console.log('Her kutu: sağ harfin EN ÇOK o ölçüde olması gerekir (1 birim açıklık düşülmüş).')
console.log('Kısa biçim türetilemez — derive.js çoğaltır, eksiltemez. Bunlar elle çizilecek.\n')

for (const r of rows) {
  const cur = r.min ? `${r.min.w}×${r.min.h}` : 'yok'
  console.log(`--- '${r.ch}'  eldeki en küçük ${cur}  ·  ${r.total} çift bekliyor`)
  for (const d of r.list.slice(0, 6)) {
    // Asıl haber ölçü değil FARK: eldeki biçim kaç satır/sütun fazla.
    const dh = r.min ? r.min.h - d.h : null
    const dw = r.min ? r.min.w - d.w : null
    const need = [
      dh > 0 ? `${dh} satır kısa` : null,
      dw > 0 ? `${dw} sütun dar` : null
    ].filter(Boolean).join(' + ') || 'bu ölçüde biçim'
    console.log(
      `    en çok ${String(d.w + '×' + d.h).padEnd(5)} üstten ${d.top}` +
        `  →  ${need}  ·  ${d.via} boşluğu` +
        `  →  ${d.pairs.slice(0, 10).join(' ')}` +
        (d.pairs.length > 10 ? ` +${d.pairs.length - 10}` : '')
    )
  }
  if (r.list.length > 6) console.log(`    +${r.list.length - 6} ölçü daha`)
}

// Boşlukları AÇAN harf kim? Tek bir sol harf onlarca çifti kilitliyorsa
// haber "15 harfe biçim çiz" değil, "şu harfin boşluğu yanlış ölçüde".
const byLeft = new Map()
for (const r of rows) {
  for (const d of r.list) {
    for (const pair of d.pairs) {
      const a = [...pair][0]
      const set = byLeft.get(a) ?? new Set()
      set.add(pair)
      byLeft.set(a, set)
    }
  }
}
const left = [...byLeft].sort((x, y) => y[1].size - x[1].size)
console.log('\n=== BOŞLUĞU AÇAN SOL HARF')
for (const [ch, set] of left) {
  console.log(`  '${ch}'  ${set.size} çift  ·  ${[...set].join(' ')}`)
}
if (left.length && left[0][1].size >= 5) {
  console.log(
    `\n'${left[0][0]}' tek başına ${left[0][1].size} çifti kilitliyor. ` +
      `Sağdaki her harfe ayrı biçim çizmek yerine '${left[0][0]}' için\n` +
      `göbeği bu ölçüye uyan bir biçim çizmek daha az iş.`
  )
}

// Çözümsüzün hepsi ölçü beklemiyor: sol harfin hiç boşluğu yoksa
// yuvalanma zaten gündemde değil, o çift başka sebepten takılı.
const other = stuck.filter((p) => !asked.has(p))
if (other.length) {
  console.log(
    `\n${other.length} çift ölçü beklemiyor — sol harfin yuvalanacak boşluğu yok:\n  ` +
      other.join(' ')
  )
}

if (!rows.length) console.log('Bekleyen biçim yok: çözümsüz çiftler ölçüden değil başka sebepten takılı.')
