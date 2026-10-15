<script setup>
// Çift laboratuvarı — iki harfin yan yana nasıl duracağına birlikte karar
// vermek için. Motor bütün geçerli yerleşimleri üretir ve kurallara göre
// puanlar; hangisinin doğru olduğu insan kararıdır, burada kaydedilir.
//
// Kararlar localStorage'da tutulur, JSON olarak dışa aktarılıp
// tools/pair-decisions.json'a kaydedilir ve oradan çözücüyü besler.

import { computed, reactive, ref, watch } from 'vue'
import GridArt from './GridArt.vue'
import PixelCanvas from './PixelCanvas.vue'
import ExportPop from './ExportPop.vue'
import { pairPlacements, BAND_HEIGHT } from '../engine/fit.js'

import { layoutWord } from '../engine/sequence.js'
import decisionStore, { hasDecisions, unsolvedPairs } from '../engine/decisions.js'
import { CHARSET, variantsOf } from '../engine/glyphs.js'
import { fromAscii, toAscii, bbox } from '../engine/grid.js'
import { alignLine, conflicts, isKnownForm } from '../engine/align.js'
import reference from '../data/reference.json'
import triage from '../data/pair-triage.json'
import shortNeeds from '../data/short-needs.json'

const STORE = 'makili.pair-decisions.v1'
const STORE_LABELS = 'makili.block-labels.v1'
const STORE_DRAWN = 'makili.drawn-blocks.v1'
const STORE_VARIANTS = 'makili.glyph-variants.v1'
const STORE_REJECTS = 'makili.glyph-rejects.v1'
const STORE_FILLS = 'makili.glyph-fills.v1'

// Sekmeler: lab tek bir uzun şeritti, sekiz bölüm üst üste. Çift kararı
// verirken çizim tahtası, çizerken kuyruk göz önünde duruyordu. Her iş
// kendi sekmesinde.
const TABS = [
  { id: 'cift', name: 'Çift' },
  { id: 'eksik', name: 'Eksikler' },
  { id: 'harf', name: 'Harf' },
  { id: 'cizim', name: 'Çizim' },
  { id: 'deneme', name: 'Deneme' }
]

const s = reactive({
  tab: 'cift',
  left: 'l',
  right: 'i',
  bandHeight: BAND_HEIGHT,
  allowInterlock: true,
  allowNesting: true,
  allowContact: false,
  strict: false,
  maxInterlock: 3,
  onlyUndecided: false,
  onlyHard: false,
  // harf varyantı tahtası
  vletter: 'a',
  vnote: '',
  vshort: false,
  word: 'hakbir',
  // Çift kuyruğu bu metinden çıkar: 841 çifti tek tek gezmek yerine
  // gerçekten geçen çiftlere, sıklık sırasına göre bakılır.
  corpus: `hak bir gönül verdi bana
ha demeden hayran olur
bir dem gelir şadan olur
bir dem gelir giryan olur`
})

const decisions = reactive(load())

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}')
  } catch {
    return {}
  }
}
watch(decisions, (d) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(d))
  } catch {
    /* özel pencerede yazılamaz, sorun değil */
  }
}, { deep: true })

const pairKey = computed(() => `${s.left}${s.right}`)

/**
 * Çiftin ayıklama durumu (tools/triage.mjs üretir).
 *
 *   clean  yan yana zaten temiz çözülüyor — işaretlemeye gerek yok
 *   nest   yalnız yuvalanmayla çözülüyor — kural hallediyor
 *   hard   biçim ya da karar gerekiyor — asıl bakılacak yer
 *
 * 841 çiftin 773'ü clean. Hepsini tek tek işaretlemek boşa emek; kuyruk
 * bunu söylemeyince "bunları işaretleyeyim mi?" sorusu her seferinde
 * yeniden doğuyordu.
 */
const triageSet = {
  clean: new Set(triage.clean),
  nest: new Set(triage.nest),
  hard: new Set(triage.hard)
}
const triageOf = (k) =>
  triageSet.hard.has(k) ? 'hard' : triageSet.nest.has(k) ? 'nest' : 'clean'
const TRIAGE_LABEL = { clean: 'gerek yok', nest: 'yuvalanma', hard: 'karar gerek' }

// ---- çift kuyruğu -------------------------------------------------------

/**
 * Sorunlu bir harfe odaklanıldığında çiftler sıklığa göre değil, KALAN DELİĞE
 * göre sıralanır: en kötüsü başta. Odaklı metinde her çift bir kez geçtiği
 * için sıklık hiçbir şey ayırt etmiyor, oysa denemeye en çok delik bırakandan
 * başlamak gerekiyor. Map boşken sıralama yine sıklığa düşer.
 */
const focusVoid = ref(new Map())

/** Metinde fiilen geçen harf çiftleri, sıklığa göre. */
const queue = computed(() => {
  const counts = new Map()
  for (const line of s.corpus.toLowerCase().split('\n')) {
    const chars = [...line].filter((c) => CHARSET.includes(c))
    for (let i = 0; i < chars.length - 1; i++) {
      const k = chars[i] + chars[i + 1]
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([k, n]) => ({
      key: k,
      left: [...k][0],
      right: [...k][1],
      n,
      decided: Boolean(decisions[k] && Object.keys(decisions[k]).length),
      preferred: Object.values(decisions[k] ?? {}).some((v) => v.verdict === 'prefer'),
      // Depoya işlenmiş kararlar (tools/pair-decisions.json)
      saved: hasDecisions([...k][0], [...k][1]),
      unsolved: unsolvedPairs.has(k),
      triage: triageOf(k),
      void: focusVoid.value.get(k) ?? null
    }))
    .filter((q) => !s.onlyHard || q.triage === 'hard')
    .sort(
      (a, b) =>
        (b.void ?? -1) - (a.void ?? -1) || b.n - a.n || a.key.localeCompare(b.key)
    )
})

const queueStats = computed(() => ({
  total: queue.value.length,
  decided: queue.value.filter((q) => q.decided).length
}))

// ---- eksikler: çift ve üçlü ----------------------------------------------
//
// Bir çift üç şekilde eksik olabilir: motor hiç yerleşim üretemiyor,
// ürettiklerinin tümü reddedilmiş, ya da en iyisinde bile geniş delik var.
// Üçlüler ayrı sınanıyor çünkü iki çift tek tek iyi olsa da üçü tutmayabilir.

function ngrams(n) {
  const counts = new Map()
  for (const line of s.corpus.toLowerCase().split('\n')) {
    const chars = [...line].filter((c) => CHARSET.includes(c))
    for (let i = 0; i + n <= chars.length; i++) {
      const g = chars.slice(i, i + n).join('')
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])
}

const gapPairs = computed(() =>
  ngrams(2)
    .map(([k, n]) => {
      const [a, b] = [...k]
      const list = pairPlacements(a, b, { bandHeight: s.bandHeight, limit: 120 })
      let status
      if (unsolvedPairs.has(k)) status = 'reddedildi'
      else if (!list.length) status = 'yok'
      else if ((list[0].excessWide ?? 0) > 0) status = 'delik'
      else if (!hasDecisions(a, b)) status = 'kararsız'
      else status = 'tamam'
      return { k, n, status, best: list[0] ?? null }
    })
    .filter((x) => x.status !== 'tamam' && x.status !== 'kararsız')
)

const gapTriples = computed(() =>
  ngrams(3)
    .map(([k, n]) => {
      const r = layoutWord(k, { bandHeight: s.bandHeight })
      let status
      if (!r.ok) status = 'yok'
      else if (!r.bandOk) status = 'bant'
      else if (r.report.wideVoid > 0) status = 'delik'
      else status = 'tamam'
      return { k, n, status, run: r }
    })
    .filter((x) => x.status !== 'tamam')
    .slice(0, 36)
)

// ---- çizim tahtası -------------------------------------------------------

const board = ref(null)
const drawn = ref(loadDrawn())

function loadDrawn() {
  try {
    return JSON.parse(localStorage.getItem(STORE_DRAWN) ?? '[]')
  } catch {
    return []
  }
}
watch(drawn, (v) => {
  try { localStorage.setItem(STORE_DRAWN, JSON.stringify(v)) } catch { /* yok say */ }
}, { deep: true })

/** Eksik bir n-gramı tahtaya aktar: varsa en iyi yerleşim başlangıç olsun. */
function toBoard(item) {
  const art = item.best
    ? toAscii(item.best.cells).split('\n')
    : item.run?.ok
      ? toAscii(item.run.cells).split('\n')
      : Array.from({ length: s.bandHeight }, () => '.'.repeat(5))
  board.value?.load(art)
  board.value?.setLabel(item.k)
  document.getElementById('tahta')?.scrollIntoView({ behavior: 'smooth' })
}

/**
 * Aynı kombinasyon için birden çok çizim tutulur — bir çiftin/üçlünün tek
 * doğru biçimi yok, varyantları var. Yalnız birebir aynı çizim iki kez
 * eklenmez.
 */
function saveDrawn(block) {
  const art = block.art.join('\n')
  if (drawn.value.some((d) => d.chars === block.chars && d.art.join('\n') === art)) return
  drawn.value = [...drawn.value, { ...block, id: `${block.chars}-${Date.now().toString(36)}` }]
}
const removeDrawn = (id) => { drawn.value = drawn.value.filter((d) => d.id !== id) }

/** Bir kombinasyonun kaçıncı çizimi — listede numaralandırmak için. */
// ---- harf varyantları ----------------------------------------------------
//
// Çiftler ve üçlüler bir yere kadar: kütüphanede o harfin uygun bir biçimi
// yoksa hiçbir yerleşim kurtarmaz. Burada tek harfin yeni varyantı çiziliyor.
// Kayıt tools/glyphs.extra.json'un beklediği biçimde dışa aktarılır, oradan
// `npm run glyphs:build` ile kütüphaneye girer.

const glyphBoard = ref(null)
const variants = ref(loadVariants())

function loadVariants() {
  try {
    return JSON.parse(localStorage.getItem(STORE_VARIANTS) ?? '[]')
  } catch {
    return []
  }
}
watch(variants, (v) => {
  try { localStorage.setItem(STORE_VARIANTS, JSON.stringify(v)) } catch { /* yok say */ }
}, { deep: true })

/** Biçim imzası — hücre kümesi, kutunun sol üstüne taşınmış. Konum fark etmez. */
function shapeSig(cells) {
  const b = bbox(cells)
  return cells
    .map(([x, y]) => `${x - b.x},${y - b.y}`)
    .sort()
    .join('|')
}

/** Kütüphanedeki varyantlar — türetilmiş değil, asıl biçimler. */
const libVariants = computed(() => variantsOf(s.vletter) ?? [])

/**
 * Bu harfe hangi ÖLÇÜDE biçim bekleniyor — tools/short-needs.mjs ölçtü.
 *
 * "Biçim eksik" demek yetmiyor; hangi ölçüde eksik olduğu söylenmeli.
 * Boşluk zaten geometride duruyor: sol harfin sağa açık kutusu, sağ
 * harften belli bir ölçü istiyor. Kısa biçim TÜRETİLEMEZ (derive.js
 * çoğaltır, eksiltemez) — bu ölçüler elle çizilmek zorunda.
 */
const needsFor = computed(() =>
  (shortNeeds.needs ?? []).filter((n) => n.char === s.vletter)
)

/** Bu harf için çizilmiş yeni varyantlar. */
const myVariants = computed(() => variants.value.filter((v) => v.char === s.vletter))

/** Tahtadaki anlık çizim — yinelenme denetimi için canlı okunur. */
const glyphArt = ref('')
const onGlyphDraw = (art) => { glyphArt.value = art }

/** Kaydetmeyi engelleyen durum: aynı biçim kütüphanede ya da listede var mı. */
const variantBlocked = computed(() => {
  const art = glyphArt.value
  if (!art) return ''
  const sig = shapeSig(fromAscii(art))
  if (libVariants.value.some((v) => shapeSig(v.cells) === sig)) {
    return 'Bu biçim kütüphanede zaten var.'
  }
  if (myVariants.value.some((v) => shapeSig(fromAscii(v.art.join('\n'))) === sig)) {
    return 'Bu biçimi zaten çizdin.'
  }
  return ''
})

function saveVariant({ art, expect = [] }) {
  const char = s.vletter
  const n = variants.value.filter((v) => v.char === char).length + 1
  variants.value = [
    ...variants.value,
    {
      id: `${char}.v${n}-${Date.now().toString(36)}`,
      char,
      source: `extra:${char}.el${n}`,
      note: s.vnote.trim() || 'lab çizim tahtasında elle çizildi',
      short: s.vshort || undefined,
      expect: expect.length ? expect : undefined,
      art
    }
  ]
  s.vnote = ''
  glyphBoard.value?.clear()
  glyphArt.value = ''
}

const removeVariant = (id) => { variants.value = variants.value.filter((v) => v.id !== id) }

/** Kütüphanedeki ya da çizilmiş bir biçimi tahtaya al — üzerinde oynamak için. */
function variantToBoard(v) {
  const cells = v.cells ?? v
  glyphBoard.value?.load(toAscii(cells).split('\n'), v.id ? fillOf(v.id) : [])
  glyphArt.value = toAscii(cells)
  loadedId.value = v.id ?? null
}

/** Her harf için: kütüphanede kaç biçim var, kaç tane de sen çizdin. */
const letterCounts = computed(() =>
  CHARSET.map((ch) => ({
    ch,
    lib: (variantsOf(ch) ?? []).length,
    mine: variants.value.filter((v) => v.char === ch).length
  }))
)

// ---- hatalı biçimi kütüphaneden çıkarma --------------------------------
//
// Kaynak çizimden (letters.svg) gelen her biçim doğru değil: bazıları hatalı,
// bazıları yanlış harfe etiketlenmiş. Burada işaretlenenler
// tools/glyph-rejects.json'a aktarılır, build onları kütüphaneye hiç almaz.
//
// Kimlik biçimden türediği için (d.coso1) kütüphane değişse de aynı biçmi
// tutar — konuma dayalı numara olsa kayardı.

const rejects = ref(loadRejects())

function loadRejects() {
  try {
    return JSON.parse(localStorage.getItem(STORE_REJECTS) ?? '[]')
  } catch {
    return []
  }
}
watch(rejects, (v) => {
  try { localStorage.setItem(STORE_REJECTS, JSON.stringify(v)) } catch { /* yok say */ }
}, { deep: true })

const isRejected = (id) => rejects.value.some((r) => r.id === id)

function toggleReject(v) {
  if (isRejected(v.id)) {
    rejects.value = rejects.value.filter((r) => r.id !== v.id)
    return
  }
  rejects.value = [
    ...rejects.value,
    { id: v.id, char: s.vletter, source: v.source, reason: s.vnote.trim() || 'lab\'de hatalı işaretlendi' }
  ]
  s.vnote = ''
}

/**
 * Bu biçme atıfta bulunan onaylı kararlar. Biçim çıkarılırsa o kararlar
 * sessizce uygulanmaz hale gelir; karar vermeden önce görünmesi gerekiyor.
 */
function decisionsUsing(id) {
  const hits = []
  for (const [pair, rows] of Object.entries(decisionStore.ok ?? {})) {
    for (const row of rows) if (row[0] === id || row[1] === id) hits.push(pair)
  }
  return [...new Set(hits)]
}

// ---- komşunun doldurması beklenen hücreler -----------------------------
//
// Bir biçimin içinde kalan boşluk iki türlü olabilir: harfin kendi açık ağzı
// (öyle kalacak) ya da cümle akışında komşusunun kapatması gereken yer. İkisi
// ölçüyle ayırt edilemez — tasarımcı bilir. Burada işaretleniyor.
//
// Kayıt biçim kimliğine bağlı, hücreler biçimin kendi kutusuna göre.

const fills = ref(loadFills())

function loadFills() {
  try {
    return JSON.parse(localStorage.getItem(STORE_FILLS) ?? '[]')
  } catch {
    return []
  }
}
watch(fills, (v) => {
  try { localStorage.setItem(STORE_FILLS, JSON.stringify(v)) } catch { /* yok say */ }
}, { deep: true })

const fillOf = (id) => fills.value.find((f) => f.id === id)?.cells ?? []

/** Tahtadaki işaretleri, o an yüklü olan kütüphane biçmine bağla. */
const loadedId = ref(null)

function saveFill(cells) {
  const id = loadedId.value
  if (!id) return
  const rest = fills.value.filter((f) => f.id !== id)
  fills.value = cells.length
    ? [...rest, { id, char: s.vletter, cells, note: s.vnote.trim() || '' }]
    : rest
  s.vnote = ''
}

/**
 * Bir yerleşimde, SOL biçimin işaretli hücrelerinden kaçı doldu?
 *
 * İşaretler biçimin kendi kutusuna göre tutuluyor; yerleşimde sol biçim
 * nereye oturduysa oraya taşınıp blokta mürekkep var mı diye bakılıyor.
 * Dolan hücre komşusunun gövdesi ya da uzantısıyla kapanmış demektir —
 * işaretlemenin asıl sınaması bu.
 *
 * Yalnız kenetlenme bunu yapabilir: normal açıklıkta komşu, biçimin kendi
 * kutusunun içine giremez.
 */
function fillCheck(p) {
  const marks = fillOf(p.left.id)
  if (!marks.length) return null
  const leftCells = p.cells.slice(0, p.leftCount)
  const b = bbox(leftCells)
  const ink = new Set(p.cells.map(([x, y]) => `${x},${y}`))
  let filled = 0
  for (const [mx, my] of marks) {
    if (ink.has(`${b.x + mx},${b.y + my}`)) filled++
  }
  return { filled, total: marks.length }
}

function buildFills() {
  return JSON.stringify(
    {
      _note: 'Komşunun doldurması beklenen hücreler. tools/glyph-fills.json olarak kaydet.',
      fills: fills.value
    },
    null,
    2
  )
}

function buildRejects() {
  return JSON.stringify(
    {
      _note: 'Kütüphaneden çıkarılacak biçimler. tools/glyph-rejects.json olarak kaydet, sonra npm run glyphs:build.',
      rejected: rejects.value
    },
    null,
    2
  )
}

function buildVariants() {
  return JSON.stringify(
    {
      _note: 'Lab\'de çizilen harf varyantları. tools/glyphs.extra.json içindeki "ascii" dizisine eklenir, sonra npm run glyphs:build.',
      ascii: variants.value.map((v) => ({
        char: v.char,
        source: v.source,
        note: v.note,
        ...(v.short ? { short: true } : {}),
        ...(v.expect ? { expect: v.expect } : {}),
        art: v.art
      }))
    },
    null,
    2
  )
}

function drawnIndex(d) {
  const same = drawn.value.filter((x) => x.chars === d.chars)
  return same.length > 1 ? same.indexOf(d) + 1 : null
}

function buildDrawn() {
  return JSON.stringify(
    { note: 'Elle çizilmiş bloklar — tools/drawn-blocks.json olarak kaydet', blocks: drawn.value },
    null,
    2
  )
}

function goto(q) {
  s.left = q.left
  s.right = q.right
}

/**
 * Blok kurmakta zorlanan harfler (tools/problem-letters.mjs ile ölçüldü):
 * uzun ince kuyrukları var, yanlarında geniş boşluk bırakıyorlar. Bir tanesine
 * tıklayınca kuyruk o harfin bütün komşularıyla dolar.
 */
const PROBLEM_LETTERS = ['f', 't', 'p', 'v', 's', 'l', 'j']

function focusLetter(ch) {
  // Harfin her komşuyla hem sol hem sağ olduğu bir metin kur.
  s.corpus = CHARSET.map((o) => `${ch}${o} ${o}${ch}`).join('\n')

  // Her çifti ölç: en iyi yerleşiminde bile kalan fazladan delik. Çözümsüz
  // çift en başa gider (Infinity yerine büyük sayı — sıralama için yeter).
  const m = new Map()
  for (const other of CHARSET) {
    for (const [x, y] of [[ch, other], [other, ch]]) {
      const list = pairPlacements(x, y, { bandHeight: s.bandHeight, limit: 40 })
      m.set(`${x}${y}`, list.length ? (list[0].excessWide ?? 0) : 999)
    }
  }
  focusVoid.value = m

  // En kötü çiftin kendisine geç — harf solda mı sağda mı, çift ne diyorsa.
  const first = [...m].sort((a, b) => b[1] - a[1])[0]
  const worst = first ? [...first[0]] : [ch, CHARSET[0]]
  s.left = worst[0]
  s.right = worst[1]
}

function nextUndecided() {
  const i = queue.value.findIndex((q) => q.key === pairKey.value)
  const rest = [...queue.value.slice(i + 1), ...queue.value.slice(0, i + 1)]
  const target = rest.find((q) => !q.decided)
  if (target) goto(target)
}

/** Yerleşimin kimliği — hücre kümesinden türetilir, sıralama değişse de sabit. */
const sigOf = (p) => p.cells.map(([x, y]) => `${x},${y}`).sort().join(' ')

const placements = computed(() =>
  pairPlacements(s.left, s.right, {
    bandHeight: s.bandHeight,
    allowInterlock: s.allowInterlock,
    allowNesting: s.allowNesting,
    allowContact: s.allowContact,
    strict: s.strict,
    maxInterlock: s.maxInterlock,
    limit: 120
  })
)

const shown = computed(() => {
  const list = placements.value
  if (!s.onlyUndecided) return list
  return list.filter((p) => !verdictOf(p))
})

const verdictOf = (p) => decisions[pairKey.value]?.[sigOf(p)]?.verdict ?? null

function mark(p, verdict) {
  const k = pairKey.value
  if (!decisions[k]) decisions[k] = {}
  const sig = sigOf(p)
  if (decisions[k][sig]?.verdict === verdict) {
    delete decisions[k][sig]
    if (!Object.keys(decisions[k]).length) delete decisions[k]
    return
  }
  // Tercih tek olabilir: önceki tercihi düşür.
  if (verdict === 'prefer') {
    for (const key of Object.keys(decisions[k])) {
      if (decisions[k][key].verdict === 'prefer') decisions[k][key].verdict = 'ok'
    }
  }
  decisions[k][sig] = {
    verdict,
    left: p.left.id,
    right: p.right.id,
    advance: p.advance,
    leftTop: p.left.top,
    rightTop: p.right.top,
    width: p.width,
    bandHeight: s.bandHeight
  }
}

const counts = computed(() => {
  const d = decisions[pairKey.value] ?? {}
  const v = Object.values(d).map((x) => x.verdict)
  return {
    prefer: v.filter((x) => x === 'prefer').length,
    ok: v.filter((x) => x === 'ok').length,
    no: v.filter((x) => x === 'no').length
  }
})

const totalDecided = computed(() =>
  Object.values(decisions).reduce((n, d) => n + Object.keys(d).length, 0)
)

// ---- ustanın blokları: etiketleme ---------------------------------------
//
// Kütüphane ustanın gerçekte kullandığı biçimlerden ayrışıyor: tek harflik
// blokların çoğunu bile tutturamıyor, bu yüzden kaynaşmaları da üretemiyor.
// Hizalama algoritması bir ilk tahmin veriyor ama kesin değil — aynı biçimi
// iki ayrı harfe düşürebiliyor. Doğrusunu insan söyler, burada.

const labels = reactive(loadLabels())
function loadLabels() {
  try {
    return JSON.parse(localStorage.getItem(STORE_LABELS) ?? '{}')
  } catch {
    return {}
  }
}
watch(labels, (l) => {
  try {
    localStorage.setItem(STORE_LABELS, JSON.stringify(l))
  } catch {
    /* yok sayılır */
  }
}, { deep: true })

const alignments = computed(() => reference.lines.map((l) => alignLine(l)))

const formConflicts = computed(() => {
  const list = conflicts(alignments.value)
  return new Set(list.map((c) => c.art))
})

/** Benzersiz blok biçimleri + hizalamanın onlara verdiği harf tahmini. */
const masterBlocks = computed(() => {
  const byArt = new Map()
  for (const [li, a] of alignments.value.entries()) {
    if (!a) continue
    for (const st of a.steps) {
      const art = st.block.art
      if (!byArt.has(art)) {
        byArt.set(art, {
          art,
          w: st.block.w,
          cells: fromAscii(art),
          guesses: new Set(),
          count: 0,
          fused: false,
          lines: new Set()
        })
      }
      const rec = byArt.get(art)
      rec.guesses.add(st.chars)
      rec.count++
      rec.fused = rec.fused || st.fused
      rec.lines.add(li + 1)
    }
  }
  return [...byArt.values()]
    .map((r) => ({
      ...r,
      guess: [...r.guesses].join('/'),
      conflict: formConflicts.value.has(r.art),
      known: r.guesses.size === 1 && isKnownForm([...r.guesses][0], r.art)
    }))
    .sort((a, b) => Number(b.conflict) - Number(a.conflict) || b.w - a.w || b.count - a.count)
})

const labelOf = (b) => labels[b.art] ?? ''
const setLabel = (b, v) => {
  const t = v.trim()
  if (t) labels[b.art] = t
  else delete labels[b.art]
}

const labelStats = computed(() => ({
  total: masterBlocks.value.length,
  labelled: masterBlocks.value.filter((b) => labelOf(b)).length,
  conflicts: masterBlocks.value.filter((b) => b.conflict).length,
  known: masterBlocks.value.filter((b) => b.known).length
}))

function buildLabels() {
  return JSON.stringify(
    {
      note: 'Ustanın blok etiketleri — tools/block-labels.json olarak kaydet',
      source: reference.source,
      labels: masterBlocks.value
        .filter((b) => labelOf(b))
        .map((b) => ({ chars: labelOf(b), art: b.art.split('\n') }))
    },
    null,
    2
  )
}

// ---- kelime denemesi ----------------------------------------------------

/**
 * Kelimeyi BÜTÜN olarak dizer (sequence.js).
 *
 * Çift çift bakmak yetmiyordu: bir yerleşim tek başına kötü görünse de
 * sonraki harfin uzantısı boşluğu doldurabiliyor. Dizi çözücü her yeni harfi
 * birikmiş bütün mürekkebe karşı sınar ve asıl puanı sonda keser.
 */
const wordRun = computed(() =>
  layoutWord(s.word, {
    bandHeight: s.bandHeight,
    allowNesting: s.allowNesting,
    allowContact: s.allowContact,
    maxInterlock: s.maxInterlock
  })
)

const letters = CHARSET
const variantCount = (c) => (variantsOf(c) ?? []).length

// ---- dışa aktarma -------------------------------------------------------

/**
 * Eski kararları onarır: konuma dayalı glif kimliklerini bugünkü biçim
 * kimlikleriyle değiştirir.
 *
 * Kararlar bir dönem 'a.1' gibi SIRAYA dayalı kimlikle kaydedilmişti.
 * Kütüphaneden bir biçim çıkınca sonrakilerin numarası kayıyor ve karar
 * sessizce başka glifi gösteriyordu; bu yüzden kimlikler biçim özetine
 * (a.e9mkh) taşındı. localStorage'daki eski kayıtlar ise olduğu gibi kaldı
 * ve dışa aktarıldığında kullanılamıyor.
 *
 * Kurtarma mümkün, çünkü kararın ANAHTARI yerleşimin hücre imzası: aynı
 * imzayı bugünün yerleşimleri arasında arayıp kimlikleri oradan yazmak
 * yetiyor. Geometri aynıysa karar da aynı kararadır.
 */
const repairReport = ref('')

function repairDecisions() {
  let fixed = 0
  let already = 0
  const lost = []
  for (const [pair, byS] of Object.entries(decisions)) {
    const chars = [...pair]
    if (chars.length !== 2) continue
    const list = pairPlacements(chars[0], chars[1], {
      bandHeight: s.bandHeight,
      allowInterlock: true,
      allowNesting: true,
      maxInterlock: 3,
      limit: 4000
    })
    const bySig = new Map(list.map((p) => [sigOf(p), p]))
    for (const [sig, rec] of Object.entries(byS)) {
      const p = bySig.get(sig)
      if (!p) { lost.push(pair); continue }
      if (rec.left === p.left.id && rec.right === p.right.id) { already++; continue }
      rec.left = p.left.id
      rec.right = p.right.id
      rec.advance = p.advance
      rec.leftTop = p.left.top
      rec.rightTop = p.right.top
      fixed++
    }
  }
  const lostPairs = [...new Set(lost)]
  repairReport.value =
    `onarılan ${fixed} · zaten güncel ${already} · eşleşmeyen ${lost.length}` +
    (lostPairs.length ? ` (${lostPairs.join(' ')})` : '')
}

function buildDecisions() {
  return JSON.stringify(
    { note: 'Çift kararları — tools/pair-decisions.json olarak kaydet', decisions },
    null,
    2
  )
}
/**
 * Sekme üzerindeki sayı — o sekmede bekleyen iş.
 *
 * Boş dönerse hiç basılmıyor: sıfır göstermek, bakılacak bir şey varmış
 * izlenimi veriyor.
 */
function tabBadge(id) {
  if (id === 'cift') return totalDecided.value || ''
  if (id === 'eksik') return gapPairs.value.length + gapTriples.value.length || ''
  if (id === 'harf') return variants.value.length + rejects.value.length || ''
  if (id === 'cizim') return drawn.value.length || ''
  return ''
}

function clearAll() {
  for (const k of Object.keys(decisions)) delete decisions[k]
}
</script>

<template>
  <div class="lab">
    <header>
      <div class="brand">
        <h1>Çift laboratuvarı</h1>
        <p class="sub">
          İki harf yan yana geldiğinde ne olacağına birlikte karar vermek için.
          Motor kurallara uyan bütün yerleşimleri üretir ve puanlar; hangisinin
          doğru olduğu senin kararın.
        </p>
      </div>
      <dl class="facts">
        <div><dt>ölçüm</dt><dd>{{ reference.lines.length }} satır · {{ reference.fusionsTotal }} kaynaşma</dd></div>
        <div><dt>harf arası</dt><dd>{{ reference.metrics.letterGapCells.join(', ') }} hücre</dd></div>
        <div><dt>karar</dt><dd>{{ totalDecided }}</dd></div>
      </dl>
    </header>

    <main>
      <nav class="tabs">
        <button
          v-for="t in TABS"
          :key="t.id"
          class="navtab"
          :class="{ on: s.tab === t.id }"
          :aria-current="s.tab === t.id || undefined"
          @click="s.tab = t.id"
        >
          {{ t.name }}<em v-if="tabBadge(t.id)" class="mono">{{ tabBadge(t.id) }}</em>
        </button>
      </nav>

      <div class="work" :class="{ solo: s.tab !== 'cift' }">
      <aside v-show="s.tab === 'cift'" class="rail">
      <section class="panel">
        <h2 class="section-head">Çift</h2>
        <div class="pair">
          <label>
            <span class="label">sol</span>
            <select v-model="s.left">
              <option v-for="c in letters" :key="'l' + c" :value="c">
                {{ c }} ({{ variantCount(c) }})
              </option>
            </select>
          </label>
          <span class="plus">+</span>
          <label>
            <span class="label">sağ</span>
            <select v-model="s.right">
              <option v-for="c in letters" :key="'r' + c" :value="c">
                {{ c }} ({{ variantCount(c) }})
              </option>
            </select>
          </label>
        </div>

        <div class="opts">
          <label class="row">
            <span class="label">bant yüksekliği</span>
            <input v-model.number="s.bandHeight" type="range" min="5" max="15" step="2" />
            <b class="mono">{{ s.bandHeight }}</b>
          </label>
          <label class="row">
            <span class="label">en çok kenetlenme</span>
            <input v-model.number="s.maxInterlock" type="range" min="0" max="5" step="1" />
            <b class="mono">{{ s.maxInterlock }}</b>
          </label>
          <label class="chk">
            <input v-model="s.allowInterlock" type="checkbox" />
            <span>kenetlenme — sağ harf solun sütunlarına girebilsin</span>
          </label>
          <label class="chk">
            <input v-model="s.allowNesting" type="checkbox" />
            <span>yuvalanma — kısa harf komşusunun boşluğuna otursun</span>
          </label>
          <label class="chk">
            <input v-model="s.strict" type="checkbox" />
            <span>katı açıklık — karşılaşan <em>her</em> kenar tam 1 birim
              <em>(fazla katı: harflerin içeri çekilmiş kısımlarını eler)</em></span>
          </label>
          <label class="chk">
            <input v-model="s.allowContact" type="checkbox" />
            <span>kaynaşma — harfler birbirine değebilsin <em>(1 birim kuralını deler)</em></span>
          </label>
          <label class="chk">
            <input v-model="s.onlyUndecided" type="checkbox" />
            <span>yalnız karar verilmemişler</span>
          </label>
        </div>

        <div class="tally mono">
          <span class="t prefer">★ {{ counts.prefer }}</span>
          <span class="t ok">✓ {{ counts.ok }}</span>
          <span class="t no">✗ {{ counts.no }}</span>
          <span class="t dim">{{ placements.length }} yerleşim</span>
        </div>
      </section>

      <section class="panel">
        <h2 class="section-head">
          <span>Kuyruk</span>
          <span class="dim mono">{{ queueStats.decided }}/{{ queueStats.total }}</span>
        </h2>
        <p class="note">
          Bütün harf çiftlerini gezmene gerek yok — aşağıdaki metinde fiilen
          geçen çiftler, sıklık sırasına göre. <b>Dolu</b> olanların kararı depoya
          işlendi, <b>kalın çerçeveli</b> olanları bu oturumda işaretledin,
          <s>üstü çizili</s> olanların mevcut biçimlerle çözümü yok.
          Sorunlu bir harfe tıklarsan kuyruk o harfin bütün komşularıyla dolar
          ve sıralama <b>kalan deliğe</b> göre olur — en kötüsü başta, rakam da
          o delik.
        </p>
        <p class="note">
          <b>Her çifti işaretlemene gerek yok.</b> 841 sıralı çiftin
          {{ triage.clean.length }} tanesi yan yana zaten temiz çözülüyor,
          {{ triage.nest.length }} tanesi yuvalanma kuralıyla hallediliyor.
          Asıl bakılacak olan <b>{{ triage.hard.length }}</b> çift — altı
          çizili olanlar. Bir çifti yine de işaretlemek istersen
          <b>tercih (★)</b> koyman yeter.
        </p>
        <label class="check">
          <input v-model="s.onlyHard" type="checkbox" />
          <span>yalnız karar gereken çiftler ({{ triage.hard.length }})</span>
        </label>

        <div class="focus">
          <span class="label">sorunlu harf</span>
          <button
            v-for="ch in PROBLEM_LETTERS"
            :key="ch"
            class="chip mono"
            :title="`${ch} harfinin bütün komşularını kuyruğa al`"
            @click="focusLetter(ch)"
          >{{ ch }}</button>
        </div>
        <textarea v-model="s.corpus" class="corpus mono" rows="4" spellcheck="false" />
        <button class="solid wide" @click="nextUndecided">sonraki karar verilmemiş →</button>
        <div class="chips">
          <button
            v-for="q in queue"
            :key="q.key"
            class="chip mono"
            :class="{
              on: q.key === pairKey,
              hard: q.triage === 'hard',
              done: q.decided,
              star: q.preferred,
              saved: q.saved,
              unsolved: q.unsolved
            }"
            :title="`${TRIAGE_LABEL[q.triage]}${q.void != null ? ` · kalan delik ${q.void}` : ` · ${q.n} kez geçiyor`}${q.saved ? ' · kayıtlı karar var' : ''}${q.unsolved ? ' · çözümsüz' : ''}`"
            @click="goto(q)"
          >
            {{ q.key }}<em>{{ q.void != null ? q.void : q.n }}</em>
          </button>
        </div>
      </section>

      <section class="panel">
        <h2 class="section-head">Bakım</h2>
        <div class="maint">
          <button
            class="ghost"
            title="eski (konuma dayalı) kimlikleri bugünkü biçim kimlikleriyle değiştir"
            @click="repairDecisions"
          >kararları onar</button>
          <button class="ghost danger" @click="clearAll">çift kararlarını sil</button>
        </div>
        <p v-if="repairReport" class="note warn-note mono">{{ repairReport }}</p>
      </section>
      </aside>

      <section v-show="s.tab === 'cift'" class="results">
        <h2 class="section-head">
          <span>{{ s.left }} + {{ s.right }}</span>
          <span class="dim mono">{{ shown.length }} gösteriliyor</span>
          <ExportPop
            label="çift kararları"
            file="tools/pair-decisions.json"
            :build="buildDecisions"
          />
        </h2>

        <p v-if="!placements.length" class="empty">
          Bu ayarlarla geçerli yerleşim yok. Kenetlenme veya yuvalanmayı açmayı,
          ya da bant yüksekliğini değiştirmeyi dene.
        </p>

        <div v-else class="cards">
          <article
            v-for="p in shown"
            :key="sigOf(p)"
            class="card"
            :class="verdictOf(p)"
          >
            <GridArt
              :cells="p.cells"
              :band-height="s.bandHeight"
              :cell="13"
              :split="p.leftCount"
            />
            <dl class="meta mono">
              <div><dt>g</dt><dd>{{ p.width }}</dd></div>
              <div><dt>puan</dt><dd>{{ p.score }}</dd></div>
              <div><dt>boşluk</dt><dd>{{ p.openArea }}</dd></div>
            </dl>
            <p class="flags mono">
              <span v-if="p.interlocked" title="sağ harf solun sütunlarına girdi">kenetli</span>
              <span v-if="p.nested" title="harf tabandan kalkıp komşusuna yuvalandı">yuvalı</span>
              <span v-if="p.fused" class="warn" title="harfler birbirine değiyor">kaynak</span>
              <span v-if="p.cleanGap" class="dim" title="arada tam bir birim boş sütun">temiz</span>
              <span v-if="p.facingWorst > 1" class="warn" :title="`karşılıklı kenarda ${p.facingWorst} birim boşluk`">boşluk {{ p.facingWorst }}</span>
            </p>
            <p v-if="fillCheck(p)" class="fillcheck mono" :class="{ good: fillCheck(p).filled === fillCheck(p).total }">
              işaretli {{ fillCheck(p).filled }}/{{ fillCheck(p).total }} doldu
            </p>
            <p class="ids mono dim">{{ p.left.id }} · {{ p.right.id }}</p>
            <div class="verdict">
              <button :class="{ on: verdictOf(p) === 'prefer' }" title="tercih" @click="mark(p, 'prefer')">★</button>
              <button :class="{ on: verdictOf(p) === 'ok' }" title="olur" @click="mark(p, 'ok')">✓</button>
              <button :class="{ on: verdictOf(p) === 'no' }" title="olmaz" @click="mark(p, 'no')">✗</button>
            </div>
          </article>
        </div>
      </section>
      </div>

      <div class="full">
      <section v-show="s.tab === 'eksik'" class="panel">
        <h2 class="section-head">
          <span>Eksikler</span>
          <span class="dim mono">{{ gapPairs.length }} çift · {{ gapTriples.length }} üçlü</span>
        </h2>
        <p class="note">
          Metinde geçen ama çözülemeyen diziler. <b>yok</b> = motor hiç yerleşim
          üretemiyor · <b>reddedildi</b> = ürettiklerinin tümünü reddettin ·
          <b>delik</b> = en iyisinde bile geniş boşluk kalıyor · <b>bant</b> =
          blok bandı doldurmuyor. Üzerine tıkla, aşağıdaki tahtaya düşsün.
        </p>

        <h3 class="sub-head">Çift</h3>
        <div class="gaps">
          <button v-for="g in gapPairs" :key="g.k" class="gap" @click="toBoard(g)">
            <span class="mono gk">{{ g.k }}</span>
            <span class="mono gn">{{ g.n }}</span>
            <span class="gs">{{ g.status }}</span>
          </button>
          <p v-if="!gapPairs.length" class="note">eksik çift yok</p>
        </div>

        <h3 class="sub-head">Üçlü</h3>
        <div class="gaps">
          <button v-for="g in gapTriples" :key="g.k" class="gap" @click="toBoard(g)">
            <span class="mono gk">{{ g.k }}</span>
            <span class="mono gn">{{ g.n }}</span>
            <span class="gs">{{ g.status }}</span>
          </button>
          <p v-if="!gapTriples.length" class="note">eksik üçlü yok</p>
        </div>
      </section>

      <section v-show="s.tab === 'harf'" id="varyant" class="panel">
        <h2 class="section-head">
          <span>Harf varyantları</span>
          <span class="dim mono">
            {{ libVariants.length }} kütüphanede · {{ myVariants.length }} yeni
          </span>
          <span class="headtools">
            <ExportPop
              label="varyantlar"
              file="tools/glyphs.extra.json"
              :build="buildVariants"
            />
            <ExportPop
              label="çıkarılacaklar"
              file="tools/glyph-rejects.json"
              :build="buildRejects"
            />
            <ExportPop
              label="dolgular"
              file="tools/glyph-fills.json"
              :build="buildFills"
            />
          </span>
        </h2>
        <p class="note">
          Çift ve üçlü denemeleri bir yere kadar: kütüphanede o harfin uygun
          biçimi yoksa hiçbir yerleşim kurtarmaz. Burada <b>tek harfin</b> yeni
          varyantını çiziyorsun. Harfin kendi açık ağzı (n'in altı, u'nun üstü)
          delik saymaz — tek zorunluluk köşeden birleşme olmaması ve bandı
          baştan sona doldurması. Mevcut bir biçme tıklayıp üzerinde oynayabilirsin.
        </p>

        <div class="chips letters">
          <button
            v-for="l in letterCounts"
            :key="l.ch"
            class="chip mono"
            :class="{ on: l.ch === s.vletter, star: l.mine > 0 }"
            :title="`${l.lib} kütüphanede${l.mine ? ` · ${l.mine} yeni` : ''}`"
            @click="s.vletter = l.ch"
          >{{ l.ch }}<em>{{ l.lib + l.mine }}</em></button>
        </div>

        <h3 class="sub-head">Kütüphanedeki biçimler — '{{ s.vletter }}'</h3>
        <p class="note">
          Biçme tıklayınca tahtaya gelir. Hatalı olanı <b>çıkar</b> ile
          işaretle — kaynak çizimden gelen her biçim doğru değil, bazıları
          yanlış harfe etiketlenmiş. İşaretlediklerin dışa aktarılıp
          <span class="mono">tools/glyph-rejects.json</span>'a kaydedilir,
          build onları kütüphaneye hiç almaz.
          <br />
          Biçimi tahtaya alıp <b>komşu doldursun</b> katmanına geçersen,
          içinde boş kalan ama <b>komşusunun kapatması gereken</b> hücreleri
          tek tek işaretleyebilirsin. Çarpı işaretli hücreler aşağıdaki
          listede de görünür.
        </p>
        <div class="varlist">
          <figure v-for="v in libVariants" :key="v.id" :class="{ out: isRejected(v.id) }">
            <button class="plain" :title="`${v.id} · tahtaya al`" @click="variantToBoard(v)">
              <GridArt
                :cells="v.cells"
                :marks="fillOf(v.id)"
                :band-height="s.bandHeight"
                :cell="12"
              />
            </button>
            <figcaption class="mono">
              {{ v.w }}×{{ v.h }}<em v-if="v.master">usta</em>
              <em v-if="fillOf(v.id).length" class="fill">{{ fillOf(v.id).length }}✕</em>
            </figcaption>
            <button
              class="ghost tiny"
              :class="{ on: isRejected(v.id) }"
              :title="v.master
                ? 'AFİŞTEN gelen biçim — ustanın fiilen kullandığı form'
                : v.id"
              @click="toggleReject(v)"
            >{{ isRejected(v.id) ? 'geri al' : 'çıkar' }}</button>
            <p v-if="decisionsUsing(v.id).length" class="usedby mono">
              {{ decisionsUsing(v.id).length }} kararda:
              {{ decisionsUsing(v.id).join(' ') }}
            </p>
          </figure>
          <p v-if="!libVariants.length" class="note">bu harfin kütüphanede biçimi yok</p>
        </div>

        <p v-if="rejects.length" class="note warn-note">
          <b>{{ rejects.length }} biçim çıkarılmak üzere işaretli.</b>
          Dışa aktar · <span class="mono">tools/glyph-rejects.json</span> ·
          <span class="mono">npm run glyphs:build</span>. Çıkarılan biçme atıfta
          bulunan onaylı kararlar varsa build onları da sayar.
        </p>

        <div v-if="needsFor.length" class="needs">
          <h3 class="sub-head">'{{ s.vletter }}' için beklenen ölçü</h3>
          <p class="note">
            Ölçüler <b>üst sınır</b>: 1 birim açıklık düşülmüş. Soldaki harfin
            göbeği bu kadar yer bırakıyor, eldeki biçim sığmıyor. Kısa biçim
            türetilemez — motor satır/sütun çoğaltabilir, eksiltemez; bu
            yüzden elle çizilmesi gerekiyor.
          </p>
          <ul class="needlist mono">
            <li v-for="(n, i) in needsFor" :key="i">
              <b>en çok {{ n.w }}×{{ n.h }}</b>
              <span class="dim">üstten {{ n.top }}</span>
              <em v-if="n.have">
                eldeki en küçük {{ n.have.w }}×{{ n.have.h }}
                <template v-if="n.have.h > n.h">· {{ n.have.h - n.h }} satır kısa</template>
                <template v-if="n.have.w > n.w">· {{ n.have.w - n.w }} sütun dar</template>
              </em>
              <span class="unlocks">çözer: {{ n.unlocks.join(' ') }}</span>
            </li>
          </ul>
        </div>

        <h3 class="sub-head">Yeni varyant çiz</h3>
        <label class="field">
          <span class="label">not (ne için gerekti · ya da neden hatalı)</span>
          <input v-model="s.vnote" class="mono vnote" placeholder="dem, rde, had için dar göbekli d" />
        </label>
        <label class="check">
          <input v-model="s.vshort" type="checkbox" />
          <span>
            kısa biçim — bandı doldurmuyor, üstüne komşunun noktası ya da
            uzantısı gelecek (<span class="mono">ö.short</span>,
            <span class="mono">ğ.short</span> gibi)
          </span>
        </label>
        <PixelCanvas
          ref="glyphBoard"
          mode="glyph"
          nameless
          :band-height="s.bandHeight"
          :width="4"
          :allow-short="s.vshort"
          :blocked="variantBlocked"
          @change="onGlyphDraw"
          @save="saveVariant"
        />

        <p v-if="loadedId" class="note fillrow">
          Tahtada <span class="mono">{{ loadedId }}</span> yüklü.
          <button class="ghost tiny" @click="saveFill(glyphBoard?.expectCells ?? [])">
            işaretleri bu biçme kaydet
          </button>
        </p>

        <div v-if="myVariants.length" class="varlist mine">
          <figure v-for="v in myVariants" :key="v.id">
            <GridArt :cells="fromAscii(v.art.join('\n'))" :band-height="s.bandHeight" :cell="12" />
            <figcaption class="mono">{{ v.source.split('.').pop() }}</figcaption>
            <button class="ghost tiny" @click="removeVariant(v.id)">sil</button>
          </figure>
        </div>
      </section>

      <section v-show="s.tab === 'cizim'" id="tahta" class="panel">
        <h2 class="section-head">
          <span>Çizim tahtası</span>
          <span class="dim mono">
            {{ drawn.length }} çizim · {{ new Set(drawn.map((d) => d.chars)).size }} kombinasyon
          </span>
          <ExportPop label="çizimler" file="tools/drawn-blocks.json" :build="buildDrawn" />
        </h2>
        <p class="note">
          Motorun bulamadığı biçimi kendin ver. Sürükleyerek boya, tekrar
          tıklayarak sil. Kurallar çizerken denetleniyor — köşe teması, bant
          doldurma, geniş delik. Altına hangi harf(ler) olduğunu yaz ve kaydet.
          <b>Aynı kombinasyona birden çok çizim verebilirsin</b> — biri ötekinin
          üzerine yazmaz, varyant olarak biriker.
        </p>
        <PixelCanvas
          ref="board"
          :band-height="s.bandHeight"
          :width="7"
          @save="saveDrawn"
        />

        <div v-if="drawn.length" class="drawnlist">
          <figure v-for="d in drawn" :key="d.id">
            <GridArt :cells="fromAscii(d.art.join('\n'))" :band-height="s.bandHeight" :cell="11" />
            <figcaption class="mono">
              {{ d.chars }}<em v-if="drawnIndex(d)">{{ drawnIndex(d) }}</em>
            </figcaption>
            <button class="ghost tiny" @click="removeDrawn(d.id)">sil</button>
          </figure>
        </div>
      </section>

      <section v-show="s.tab === 'deneme'" class="panel">
        <h2 class="section-head">Kelime denemesi</h2>
        <input v-model="s.word" class="word" spellcheck="false" placeholder="hakbir" />
        <div v-if="wordRun.ok" class="wordout">
          <GridArt :cells="wordRun.cells" :band-height="s.bandHeight" :cell="14" />
          <dl class="meta mono">
            <div><dt>g</dt><dd>{{ wordRun.width }}</dd></div>
            <div><dt>puan</dt><dd>{{ wordRun.score }}</dd></div>
            <div><dt>doldurulamaz</dt><dd>{{ wordRun.report.openVertical }}</dd></div>
            <div><dt>sağa açık</dt><dd>{{ wordRun.report.openRight }}</dd></div>
            <div><dt>aday</dt><dd>{{ wordRun.alternatives }}</dd></div>
          </dl>
          <p v-if="!wordRun.bandOk" class="warnline">
            Bant dolmuyor — kütüphanede {{ s.bandHeight }} birime yetişen glif yok.
          </p>
        </div>
        <p v-else class="warnline">
          {{ wordRun.reason ?? `${wordRun.failedChar ?? ''} harfinde tıkandı (${wordRun.failedAt}. sıra)` }}
        </p>
        <p class="note">
          Kelime harf harf değil <b>bütün olarak</b> çözülüyor: her yeni harf
          o ana kadar birikmiş bütün mürekkebe göre sınanıyor, böylece bir
          harfin uzantısı iki harf geriye uzanabiliyor. Sağa açık boşluk ara
          adımlarda cezalandırılmıyor — sonraki harf doldurabilir.
        </p>
      </section>

      <section v-show="s.tab === 'cizim'" class="panel">
        <h2 class="section-head">
          <span>Ustanın blokları — etiketle</span>
          <span class="dim mono">
            {{ labelStats.labelled }}/{{ labelStats.total }} etiketli ·
            {{ labelStats.known }} kütüphanede var ·
            <b v-if="labelStats.conflicts" class="bad">{{ labelStats.conflicts }} çatışma</b>
          </span>
          <ExportPop
            label="blok etiketleri"
            file="tools/block-labels.json"
            :build="buildLabels"
          />
        </h2>
        <p class="note">
          Kütüphane, ustanın gerçekte kullandığı biçimlerden ayrışıyor — tek
          harflik blokların çoğunu bile tutturamıyor, bu yüzden kaynaşmaları da
          üretemiyor. Altındaki harf hizalama algoritmasının <em>tahmini</em>;
          kesin değil. <b class="bad">Kırmızı</b> olanlarda aynı biçim iki ayrı
          harfe düşmüş, yani kesin yanlış. Doğrusunu kutuya yaz — iki harfse
          bitişik yaz (<code>li</code>). Bunlar kütüphanenin gerçeği olacak.
        </p>
        <div class="master">
          <figure
            v-for="(b, i) in masterBlocks"
            :key="i"
            :class="{ bad: b.conflict, done: labelOf(b), fine: b.known }"
          >
            <GridArt :cells="b.cells" :band-height="9" :cell="11" />
            <figcaption class="mono">
              <span :class="{ bad: b.conflict }">{{ b.guess }}</span>
              <span class="dim">{{ b.w }}×9 ·{{ b.count }}</span>
            </figcaption>
            <input
              class="lbl mono"
              :value="labelOf(b)"
              :placeholder="b.guess"
              @input="setLabel(b, $event.target.value)"
            />
          </figure>
        </div>
      </section>

      </div>
    </main>
  </div>
</template>

<style scoped>
/* Izgara: solda sabit ray, sağda içerik. Tam genişlik bölümler ayrı bir
   kapsayıcıda, ızgaranın ALTINA iner — önceki sürümde grid-column: 1/-1
   kullanılmıştı ve sonraki bölümü dar sütuna itiyordu. */

.lab {
  min-height: 100dvh;
}

/* --- başlık: tek hiyerarşi sıçraması, altında yapısal çizgi ------------- */

/* Başlık bandı: önce dikey bir blok tu, ekranın üçte birini yiyordu ve
   altındaki işe ancak kaydırarak ulaşılıyordu. Sekmeler geldikten sonra
   başlığın o kadar yer tutması gerekmiyor — hiyerarşi duruyor, ölçü
   küçüldü. */
header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: calc(var(--u) * 4);
  border-bottom: 2px solid var(--rule);
  padding: calc(var(--u) * 2.5) calc(var(--u) * 4);
}
h1 {
  margin: 0;
  font-size: clamp(22px, 2.6vw, 32px);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.03em;
  text-transform: uppercase;
}
.sub {
  margin: var(--u) 0 0;
  max-width: 68ch;
  color: var(--ink-mute);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--u) * 4);
  margin: 0;
}

@media (max-width: 760px) {
  header {
    grid-template-columns: minmax(0, 1fr);
    gap: calc(var(--u) * 2);
  }
}
.facts div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.facts dt {
  font-size: var(--t-label);
  font-weight: 700;
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--ink-mute);
}
.facts dd {
  margin: 0;
  font-family: var(--mono);
  font-size: var(--t-data);
}

/* --- ızgara ------------------------------------------------------------ */

/* Sekme çubuğu: yapısal çizgi üstünde etiket düzeyi tipografi. Seçili
   olan dolu zeminle değil, altındaki kalın çizgiyle belli oluyor — renk
   hiyerarşi kurmuyor, yapı kuruyor. */
.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  border-bottom: 2px solid var(--rule);
  background: var(--paper);
  position: sticky;
  top: 0;
  z-index: 10;
}

.navtab {
  display: flex;
  align-items: baseline;
  gap: calc(var(--u) * 0.75);
  padding: calc(var(--u) * 1.5) calc(var(--u) * 2.5);
  background: transparent;
  border: 0;
  border-bottom: 3px solid transparent;
  margin-bottom: -2px;
  font-size: var(--t-label);
  font-weight: 700;
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--ink-mute);
  cursor: pointer;
}

.navtab:hover {
  color: var(--ink);
}

.navtab.on {
  color: var(--ink);
  border-bottom-color: var(--ink);
}

.navtab em {
  font-style: normal;
  font-weight: 400;
  font-size: var(--t-data);
  letter-spacing: 0;
  text-transform: none;
  color: var(--ink-mute);
}

.work {
  display: grid;
  grid-template-columns: var(--rail) minmax(0, 1fr);
  align-items: start;
}

/* Ray yalnız Çift sekmesinde var; ötekilerde tek kolon. */
.work.solo {
  grid-template-columns: minmax(0, 1fr);
}

/* Başlıktaki araç kümesi: birden çok dışa aktarma varsa yan yana. */
.headtools {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--u) * 0.5);
}

/* Başlık iki parçalıyken space-between doğru durur; dışa aktarma üçüncü
   parça olarak eklendiğinde sağa yaslanması gerekiyor. */
.section-head > :last-child:not(:nth-child(2)),
.section-head > .headtools {
  margin-left: auto;
}

.maint {
  display: flex;
  flex-wrap: wrap;
  gap: var(--u);
}

.maint .danger:hover {
  border-color: var(--signal);
  color: var(--signal);
}
.rail {
  border-right: 2px solid var(--rule);
  position: sticky;
  top: 0;
  max-height: 100dvh;
  overflow-y: auto;
}
.full {
  border-top: 2px solid var(--rule);
}

.panel,
.results {
  padding: calc(var(--u) * 3);
}
.panel + .panel {
  border-top: 1px solid var(--rule-hair);
}
.full .panel + .panel {
  border-top: 2px solid var(--rule);
}
.dim {
  color: var(--ink-mute);
}

/* --- kontroller: tek kalıp, her yerde aynı ------------------------------ */

.pair {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: end;
  gap: var(--u);
}
.pair label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.plus {
  font-weight: 700;
  padding-bottom: 6px;
}
select,
.word,
.corpus,
.text {
  width: 100%;
  padding: 7px 8px;
  background: var(--paper-pure);
  border: 1px solid var(--rule);
  font-family: var(--mono);
  font-size: var(--t-data);
}
select:focus,
.word:focus,
.corpus:focus {
  outline: 0;
  border-color: var(--signal);
}

.opts {
  margin-top: calc(var(--u) * 2);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.row {
  display: grid;
  grid-template-columns: 1fr 84px 2ch;
  align-items: center;
  gap: var(--u);
}
.row input,
.chk input {
  accent-color: var(--signal);
}
.row b {
  font-family: var(--mono);
  text-align: right;
}
.chk {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 7px;
  align-items: start;
  font-size: var(--t-data);
  line-height: 1.4;
  cursor: pointer;
}
.chk input {
  margin: 3px 0 0;
}
.chk em {
  font-style: normal;
  color: var(--signal);
}

.tally {
  display: flex;
  gap: calc(var(--u) * 2);
  margin-top: calc(var(--u) * 2);
  padding-top: var(--u);
  border-top: 1px solid var(--rule-hair);
}
.t.prefer {
  font-weight: 700;
}

/* --- kuyruk: çipler. Durum renkle değil dolgu/konturla anlatılır, böylece
       gri tonda da okunur. ------------------------------------------------ */

.corpus {
  margin-bottom: var(--u);
  line-height: 1.6;
}
.focus {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
  margin-bottom: var(--u);
}
.focus .label {
  margin-right: 4px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-top: var(--u);
}
.chip {
  display: flex;
  align-items: baseline;
  gap: 4px;
  padding: 2px 5px;
  border: 1px solid var(--rule-hair);
  background: var(--paper-pure);
  font-family: var(--mono);
  font-size: var(--t-data);
  cursor: pointer;
}
.chip em {
  font-style: normal;
  font-size: 9px;
  color: var(--ink-mute);
}
.chip:hover {
  border-color: var(--ink);
}
/* kayıtlı karar: dolu */
.chip.saved {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}
.chip.saved em {
  color: var(--paper);
}
/* bu oturumda işaretlendi: kalın kontur */
.chip.done {
  border-width: 2px;
  border-color: var(--ink);
  font-weight: 700;
}
/* çözümsüz: üstü çizili */
.chip.hard {
  border-bottom: 2px solid var(--signal);
}
.chip.unsolved {
  text-decoration: line-through;
  color: var(--ink-mute);
}
/* seçili: tek sinyal rengi burada, konumu göstermek için */
.chip.on {
  outline: 2px solid var(--signal);
  outline-offset: 1px;
}

/* --- yerleşim kartları -------------------------------------------------- */

.empty {
  margin: 0;
  padding: calc(var(--u) * 3);
  border: 1px solid var(--signal);
  color: var(--ink-mute);
}
.fillcheck {
  margin: 0;
  font-weight: 700;
  color: var(--signal);
}
.fillcheck.good {
  color: var(--ink);
}

.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  /* kadar genişle: gri ayırıcı zemin yalnız kartların altında kalsın */
  width: fit-content;
  max-width: 100%;
  background: var(--rule-hair);
  border: 1px solid var(--rule-hair);
}
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  min-width: 122px;
  padding: calc(var(--u) * 1.5);
  background: var(--paper-pure);
  border-left: 3px solid transparent;
}
.card.prefer {
  border-left-color: var(--signal);
}
.card.ok {
  border-left-color: var(--ink);
}
.card.no {
  opacity: 0.35;
}
.meta {
  display: flex;
  gap: var(--u);
  margin: 0;
  font-size: 10px;
}
.meta div {
  display: flex;
  gap: 3px;
}
.meta dt {
  color: var(--ink-mute);
}
.meta dd {
  margin: 0;
  font-weight: 700;
}
.flags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.flags span {
  padding: 1px 4px;
  border: 1px solid var(--rule-hair);
}
.flags .warn {
  border-color: var(--signal);
  color: var(--signal);
}
.ids {
  margin: 0;
  font-size: 9px;
}
.verdict {
  display: flex;
  gap: 1px;
  margin-top: auto;
}
.verdict button {
  width: 30px;
  height: 26px;
  border: 1px solid var(--rule);
  background: var(--paper);
  cursor: pointer;
  line-height: 1;
}
.verdict button:hover {
  border-color: var(--signal);
}
.verdict button.on {
  background: var(--ink);
  color: var(--paper);
}

/* --- kelime denemesi ---------------------------------------------------- */

.wordout {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: calc(var(--u) * 4);
  margin-top: calc(var(--u) * 2);
}
.warnline {
  margin: calc(var(--u) * 2) 0 0;
  padding-left: calc(var(--u) * 1.5);
  border-left: 2px solid var(--signal);
}

/* --- ustanın blokları --------------------------------------------------- */

.master {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  width: fit-content;
  max-width: 100%;
  margin-top: calc(var(--u) * 2);
  background: var(--rule-hair);
  border: 1px solid var(--rule-hair);
}
.master figure {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 96px;
  margin: 0;
  padding: var(--u);
  background: var(--paper-pure);
}
.master figure.bad {
  outline: 2px solid var(--signal);
  outline-offset: -2px;
}
.master figure.fine {
  opacity: 0.4;
}
figcaption {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  font-size: 9px;
}
figcaption em {
  font-style: normal;
  color: var(--signal);
}
.bad {
  color: var(--signal);
}
.lbl {
  width: 100%;
  padding: 1px 0;
  border: 0;
  border-bottom: 1px solid var(--rule);
  background: transparent;
  font-family: var(--mono);
  text-align: center;
}
.lbl:focus {
  outline: 0;
  border-color: var(--signal);
}

/* --- eksikler ----------------------------------------------------------- */

.sub-head {
  margin: calc(var(--u) * 3) 0 var(--u);
  font-size: var(--t-label);
  font-weight: 700;
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--ink-mute);
}
.gaps {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}
.gap {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 3px 7px;
  border: 1px solid var(--rule-hair);
  background: var(--paper-pure);
  cursor: pointer;
}
.gap:hover {
  border-color: var(--signal);
}
.gk {
  font-weight: 700;
}
.gn {
  font-size: 9px;
  color: var(--ink-mute);
}
.gs {
  font-size: 9px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-mute);
}

/* --- çizim listesi ------------------------------------------------------ */

/* Beklenen ölçü listesi: talep, çizim tahtasının hemen üstünde dursun. */
.needs {
  margin: calc(var(--u) * 2) 0 0;
  padding: var(--u) calc(var(--u) * 1.5);
  border-left: 2px solid var(--signal);
  background: var(--paper-pure);
}

.needlist {
  margin: var(--u) 0 0;
  padding: 0;
  list-style: none;
}

.needlist li {
  display: flex;
  flex-wrap: wrap;
  gap: var(--u);
  align-items: baseline;
  padding: calc(var(--u) * 0.5) 0;
  border-top: 1px solid var(--rule-hair);
}

.needlist li:first-child {
  border-top: 0;
}

.needlist em {
  font-style: normal;
  color: var(--ink-mute);
}

.needlist .unlocks {
  margin-left: auto;
  color: var(--ink-mute);
}

/* Varyant şeridi: biçimler yan yana, altında ölçüsü. Tıklanabilir olanı
   çerçeve değil imleç belli eder — çerçeve ızgarayı bulandırıyor. */
.varlist {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--u) * 2);
  margin-bottom: calc(var(--u) * 2);
}
.varlist figure {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}
.varlist figcaption {
  color: var(--ink-mute);
  display: flex;
  gap: 5px;
  align-items: baseline;
}
.varlist figcaption em.fill {
  color: var(--signal);
}
.varlist figcaption em {
  font-style: normal;
  font-size: var(--t-label);
  font-weight: 700;
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  color: var(--ink);
}
.varlist .plain {
  padding: 0;
  border: 0;
  background: none;
  cursor: copy;
  display: block;
}
.varlist .plain:hover {
  outline: 2px solid var(--signal);
  outline-offset: 2px;
}
/* Çıkarılmak üzere işaretli biçim: soluk ve üstü çizili. Renk değil, yapı. */
.varlist figure.out {
  opacity: 0.45;
}
.varlist figure.out figcaption {
  text-decoration: line-through;
}
.varlist .ghost.tiny.on {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}
.varlist .usedby {
  margin: 0;
  max-width: 120px;
  color: var(--signal);
  font-weight: 700;
}
.warn-note {
  border-left: 3px solid var(--signal);
  padding-left: var(--u);
}
.chips.letters {
  margin-bottom: calc(var(--u) * 2);
}
.vnote {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--rule);
  background: var(--paper-pure);
  font-family: var(--mono);
  font-size: var(--t-data);
}
.vnote:focus {
  outline: 0;
  border-color: var(--signal);
}

.drawnlist {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  width: fit-content;
  max-width: 100%;
  margin-top: calc(var(--u) * 3);
  background: var(--rule-hair);
  border: 1px solid var(--rule-hair);
}
.drawnlist figure {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 96px;
  margin: 0;
  padding: var(--u);
  background: var(--paper-pure);
}
.tiny {
  padding: 2px 6px;
  font-size: 9px;
}

/* --- ortak: not, düğme -------------------------------------------------- */

.note {
  margin: calc(var(--u) * 1.5) 0 0;
  max-width: 76ch;
  font-size: var(--t-data);
  line-height: 1.6;
  color: var(--ink-mute);
}
.solid,
.ghost {
  padding: 9px 16px;
  border: 1px solid var(--rule);
  font-size: var(--t-label);
  font-weight: 700;
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  cursor: pointer;
}
.solid {
  background: var(--ink);
  color: var(--paper);
}
.solid:hover {
  background: var(--signal);
  border-color: var(--signal);
}
.solid.wide {
  width: 100%;
}
.ghost {
  background: none;
}
.ghost:hover {
  border-color: var(--signal);
}
@media (max-width: 900px) {
  .work {
    grid-template-columns: 1fr;
  }
  .rail {
    position: static;
    max-height: none;
    border-right: 0;
    border-bottom: 2px solid var(--rule);
  }
}
</style>
