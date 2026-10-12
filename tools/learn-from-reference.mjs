// Ustanın afişinden glif biçimlerini öğrenir.
//
//   node tools/learn-from-reference.mjs           rapor
//   node tools/learn-from-reference.mjs --write   build/learned.json yaz
//
// Sorun şu: bloklar ile metin harfleri birebir değil — bazı bloklar iki harf
// taşıyor. Hangisinin hangisi olduğu baştan bilinmiyor.
//
// Çözüm dinamik programlama: her blok 1 ya da 2 harf tüketebilir; kütüphanede
// zaten tanınan biçimler bedava, tanınmayan tek harf biçimi ucuz, kaynaşma
// pahalı. Toplam maliyeti en aza indiren hizalama seçilir. Böylece tanınan
// bloklar çapa olur, tanınmayanlar da hangi harfe ait olduğunu söyler.
//
// Çıktı: her harf için ustanın kullandığı biçimler; kütüphanede olmayanlar
// işaretli.

import ref from '../src/data/reference.json' with { type: 'json' }
import lib from '../src/data/glyphs.json' with { type: 'json' }
import { writeFileSync } from 'node:fs'
import { widthLadder } from '../src/engine/derive.js'
import { toAscii } from '../src/engine/grid.js'

// Maliyetler. Kaynaşma gerçekten olur ama nadirdir; tanınmayan tek biçim
// ondan çok daha olası — harfin bilinen genişliğini aşmadığı sürece.
// Bir 'l' 5 hücre genişliğinde tek başına durmaz; o blok kaynaşmadır.
const COST_KNOWN = 0
const COST_NEW_SINGLE = 2
const COST_OVERWIDE = 4 // bilinen en geniş varyantı aşan her hücre için
const COST_FUSION = 5

const known = new Map() // char -> Set(art)
const baseWidth = new Map() // char -> tasarlanmış en geniş varyant
for (const [char, variants] of Object.entries(lib.glyphs)) {
  const set = new Set()
  for (const v of variants) for (const [, g] of widthLadder(v, 12)) set.add(toAscii(g.cells))
  known.set(char, set)
  baseWidth.set(char, Math.max(...variants.map((v) => v.w)))
}
const isKnown = (char, art) => known.get(char)?.has(art) ?? false

/** Tanınmayan tek harf biçiminin maliyeti; genişlik aştıkça artar. */
function singleCost(char, block) {
  if (isKnown(char, block.art)) return COST_KNOWN
  const over = Math.max(0, block.w - (baseWidth.get(char) ?? 3))
  return COST_NEW_SINGLE + over * COST_OVERWIDE
}

/** Bir satırı hizalar: blok başına 1 veya 2 harf. */
function align(line) {
  const chars = [...line.text]
  const blocks = line.blocks.map((b) => ({ ...b, art: b.art.join('\n') }))
  const nB = blocks.length
  const nC = chars.length

  const INF = Infinity
  const dp = Array.from({ length: nB + 1 }, () => new Array(nC + 1).fill(INF))
  const from = Array.from({ length: nB + 1 }, () => new Array(nC + 1).fill(null))
  dp[0][0] = 0

  for (let bi = 0; bi < nB; bi++) {
    for (let ci = 0; ci <= nC; ci++) {
      if (dp[bi][ci] === INF) continue
      const b = blocks[bi]

      if (ci + 1 <= nC) {
        const c = chars[ci]
        const cost = singleCost(c, b)
        if (dp[bi][ci] + cost < dp[bi + 1][ci + 1]) {
          dp[bi + 1][ci + 1] = dp[bi][ci] + cost
          from[bi + 1][ci + 1] = { take: 1, cost }
        }
      }
      if (ci + 2 <= nC) {
        const cost = COST_FUSION
        if (dp[bi][ci] + cost < dp[bi + 1][ci + 2]) {
          dp[bi + 1][ci + 2] = dp[bi][ci] + cost
          from[bi + 1][ci + 2] = { take: 2, cost }
        }
      }
    }
  }

  if (dp[nB][nC] === INF) return null

  const out = []
  let bi = nB
  let ci = nC
  while (bi > 0) {
    const step = from[bi][ci]
    out.unshift({
      block: blocks[bi - 1],
      chars: chars.slice(ci - step.take, ci),
      fused: step.take === 2,
      known: step.cost === COST_KNOWN
    })
    bi -= 1
    ci -= step.take
  }
  return { steps: out, cost: dp[nB][nC] }
}

// ---------------------------------------------------------------- çalıştır

const forms = new Map() // char -> Map(art -> count)
let fusions = 0
let newSingles = 0
let knownSingles = 0

for (const [li, line] of ref.lines.entries()) {
  const r = align(line)
  if (!r) {
    console.log(`${li + 1}. satır: hizalanamadı`)
    continue
  }
  const fused = r.steps.filter((s) => s.fused).length
  console.log(
    `${li + 1}. satır "${line.text}"  ${r.steps.length} blok / ${line.text.length} harf` +
      `  kaynaşma=${fused}  (çıkarıcı: ${line.fusions})  maliyet=${r.cost}`
  )

  for (const s of r.steps) {
    if (s.fused) {
      fusions++
      continue
    }
    const c = s.chars[0]
    if (s.known) knownSingles++
    else newSingles++
    if (!forms.has(c)) forms.set(c, new Map())
    const m = forms.get(c)
    m.set(s.block.art, (m.get(s.block.art) ?? 0) + 1)
  }
}

console.log(
  `\ntanınan tek harf ${knownSingles}, yeni tek harf ${newSingles}, kaynaşma ${fusions}`
)

const newForms = []
for (const [char, m] of [...forms].sort()) {
  const unknown = [...m].filter(([art]) => !isKnown(char, art))
  if (!unknown.length) continue
  for (const [art, n] of unknown) newForms.push({ char, art, count: n })
}

console.log(`\nkütüphanede olmayan biçim: ${newForms.length}\n`)
for (const f of newForms.sort((a, b) => b.count - a.count || a.char.localeCompare(b.char))) {
  const rows = f.art.split('\n')
  console.log(`--- '${f.char}'  ${rows[0].length}x${rows.length}  ×${f.count}`)
  console.log(rows.map((r) => '    ' + r).join('\n'))
}

if (process.argv.includes('--write')) {
  const out = {
    note: 'Ustanın afişinden öğrenilen biçimler — elle gözden geçirilecek',
    source: ref.source,
    forms: newForms.map((f) => ({ char: f.char, count: f.count, art: f.art.split('\n') }))
  }
  writeFileSync('build/learned.json', JSON.stringify(out, null, 2))
  console.log('\nyazıldı: build/learned.json')
}
