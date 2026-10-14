// Satırları ortak bir genişliğe getirir.
//
// Harf ve kelime araları değişmez olduğundan tek serbestlik derecesi harf
// genişlikleridir. Bu yüzden:
//
//   1. Her satırın ULAŞILABİLİR genişlik kümesi alt-küme-toplamı ile bulunur.
//   2. Kümeler kesiştirilir — ortak genişlikler.
//   3. Bir hedef seçilir, her satır için en ucuz varyant ataması geri izlemeyle
//      bulunur.
//
// Maliyet karesel: genişletmeyi tek harfe yığmak yerine satıra yaymak için.
// Kesişim boşsa hiçbir kural esnetilmez; hangi satırın nereye ulaşamadığı
// raporlanır.

import { variantsOf, defaultVariant, resolveId } from './glyphs.js'
import { widthOptions } from './derive.js'
import {
  tokenize,
  layoutLine,
  naturalWidth,
  stack,
  spaceFlags,
  LETTER_GAP,
  WORD_GAP
} from './layout.js'
import { joinsFor, rowsFor } from './decisions.js'
import { thickenStack, weightToAmount } from './render/weight.js'
import { scoreBlock, intrinsicVoid, BAND_HEIGHT } from './fit.js'
import { bbox } from './grid.js'

export const DEFAULTS = {
  maxGlyphWidth: 9, // bir harf en fazla bu kadar geniş olabilir
  maxWiden: 4, // tek harf en fazla bu kadar birim genişletilebilir
  tallOnly: true, // yalnız tam boy gövdeler; kısa varyantlar dizgiyi bozuyor
  // Komşu iki harfin yan yana gelmesinden doğan fazladan deliğin birim
  // bedeli. 0 = eski davranış (yalnız genişliğe bak). 1 birimlik delik, bir
  // harfi 1 birim germekle aynı bedelde.
  //
  // 1.5'i de denedim: iki metinde deliği ~%6 azaltıyor ama genişlemeyi son
  // harfe yığıyor (llll 19 birime 3,3,3,7 diye bölünüyor). Satır sonundaki
  // açık yanı kapatacak komşu olmadığı için orada boşluk bedava görünüyor.
  // Dağılımın yayılması daha önemli; 1'de kalındı.
  voidCost: 1,
  // Biçimin KENDİ boşluğunun birim bedeli. Eşleşme bedeli her glifin kendi
  // ağzını düşer — iki harfi yan yana koymanın ürettiği fazlalığı ölçmek
  // için doğru olan bu. Ama aynı harfin aynı genişlikteki biçimleri
  // arasında seçerken asıl ayırt edici tam o kendi boşluğu: 'a'nın 3 birimlik
  // 11 biçiminden hangisi daha sık dokuyorsa o. Ayrı terim olmasının sebebi
  // bu; ağırlığı daha düşük, yoksa harf kimliğini bastırır.
  //
  // Tarama ile 0.7. Üstü (1, 1.5) ölçülen deliği bir metinde ~%5 azaltıyor
  // ama genişlemeyi tek harfe yığıyor: 'llll' 19 birime 3,3,3,7 diye
  // bölünüyor. Bir harfi devleştirmek görünür bir kusur, ölçülen o kadarlık
  // fark değil — dağılımın yayılması yeğlendi.
  densityCost: 0.7
}

// ---------------------------------------------------------------- doku
//
// Hizalama uzun süre yalnız GENİŞLİĞE baktı: hedefe ulaşan en ucuz genişlik
// ataması. Ama aynı genişlikte birden çok biçim var ve hangisinin doğru
// olduğu komşusuna bağlı — yan yana iki biçim arasında kapanmamış delik
// kalabiliyor. Dizgi hedefi tutturuyor ama doku deliniyordu.
//
// Ölçü lab'dekiyle aynı: iki glifi normal açıklıkla yan yana koy, oluşan
// geniş deliği ölç, her ikisinin KENDİ açık ağzını düş. Kalan, yan yana
// gelmenin ürettiği fazladan boşluktur.

const voidCache = new Map()

/** Biçimin kendi geniş boşluğu — ne kadar seyrek dokuduğu. */
export function ownVoid(glyph, bandHeight = BAND_HEIGHT) {
  return intrinsicVoid(glyph.cells, bandHeight, glyph.id).wide
}


export function pairVoid(left, right, bandHeight = BAND_HEIGHT) {
  if (!left || !right) return 0
  const k = `${left.id}|${right.id}|${bandHeight}`
  const hit = voidCache.get(k)
  if (hit !== undefined) return hit

  const lb = bbox(left.cells)
  const rb = bbox(right.cells)
  const L = left.cells.map(([x, y]) => [x - lb.x, y - lb.y + (bandHeight - lb.h)])
  const R = right.cells.map(([x, y]) => [
    x - rb.x + lb.w + LETTER_GAP,
    y - rb.y + (bandHeight - rb.h)
  ])
  const s = scoreBlock([...L, ...R], bandHeight)
  const li = intrinsicVoid(left.cells, bandHeight, left.id)
  const ri = intrinsicVoid(right.cells, bandHeight, right.id)
  const out = Math.max(0, s.wideVoid - li.wide - ri.wide)
  voidCache.set(k, out)
  return out
}

const cache = new Map()

/** Harfin genişlik -> glif eşlemesi. Türetme pahalı, önbelleklenir. */
function widthsFor(char, opts) {
  const k = `${char}|${opts.maxGlyphWidth}|${opts.maxWiden}|${opts.tallOnly}`
  const hit = cache.get(k)
  if (hit) return hit

  const all = variantsOf(char) ?? []
  const def = defaultVariant(char)
  const pool = opts.tallOnly ? all.filter((v) => v.h === def.h) : all
  const map = widthOptions(pool.length ? pool : all, opts.maxGlyphWidth)

  // Tek harfin aşırı şişmesini engelle.
  const base = Math.min(...map.keys())
  for (const w of [...map.keys()]) {
    if (w - base > opts.maxWiden) map.delete(w)
  }

  cache.set(k, map)
  return map
}

/**
 * İki glif arasındaki olası İLERLEMELER: soldan sağa kaç birim gidilir.
 *
 * Varsayılan sol.w + boşluk. Buna ek olarak, lab'de onaylanmış kenetli ya da
 * tabandan kalkık bir yerleşim varsa onun ilerlemesi de seçenektir — 'li'de
 * 2 birim, çünkü i, l'nin sütunlarına giriyor.
 *
 * Yalnız ONAYLI yerleşimler kullanılıyor. Motor kendi başına kenetlenmeye
 * karar vermiyor: hangi çiftin iç içe geçebileceği tasarım kararı, lab'de
 * verilmiş olanlarla sınırlı.
 */
const joinCache = new Map()

function advanceOptions(leftChar, rightChar, left, right, afterSpace) {
  const fallback = left.w + (afterSpace ? WORD_GAP : LETTER_GAP)
  const k = `${leftChar}${rightChar}|${left.id}|${right.id}|${afterSpace ? 'w' : 'l'}`
  const hit = joinCache.get(k)
  if (hit) return hit

  // Varsayılan yerleşimden farkı olmayan onaylı satırlar eklenmez: aynı şeyi
  // iki kez denemek hem boşuna hem de 'kenetli birleşim' sayımını şişirir.
  const natLeft = BAND_HEIGHT - left.h
  const natRight = BAND_HEIGHT - right.h
  const out = [{ advance: fallback, leftTop: null, rightTop: null, approved: false }]
  for (const j of joinsFor(`${leftChar}${rightChar}`, left.id, right.id)) {
    const same = j.advance === fallback && j.leftTop === natLeft && j.rightTop === natRight
    if (same) continue
    out.push({ ...j, approved: true })
  }
  joinCache.set(k, out)
  return out
}

/**
 * Onaylı birleşimlerin ATIFTA BULUNDUĞU biçimleri aday havuzuna ekler.
 *
 * Gerek şu: dizgi havuzu tam boy gövdelerle sınırlı ('kısa varyantlar
 * dizgiyi bozuyor'), oysa kenetlenmenin gerektirdiği biçim çoğu zaman kısa
 * ya da yükseklik türetmesi — ustanın 'li' kaynaşmasındaki i 1x7. O biçim
 * havuzda olmadığı için onaylı kenetlenme hiç ateşlenemiyordu.
 *
 * Çözüm, havuzu gevşetmek değil: yalnız ONAYLI bir birleşimin adı geçen
 * biçimleri, yalnız geçtiği konuma eklemek. Kısa biçim başıboş dolaşamaz,
 * ancak kendisi için onaylanmış komşulukta kullanılabilir.
 *
 * @returns {Array<Map<number, object[]>>} konum -> genişlik -> biçimler
 */
function injectionsFor(chars) {
  const out = chars.map(() => new Map())
  const add = (i, g) => {
    if (!g) return
    const list = out[i].get(g.w) ?? []
    if (!list.some((x) => x.id === g.id)) list.push(g)
    out[i].set(g.w, list)
  }
  for (let i = 1; i < chars.length; i++) {
    for (const row of rowsFor(`${chars[i - 1].char}${chars[i].char}`)) {
      add(i - 1, resolveId(row[0]))
      add(i, resolveId(row[1]))
    }
  }
  return out
}

/** Satırın sabit boşluk toplamı — varyant seçiminden bağımsız. */
function gapTotal(tokens) {
  let gaps = 0
  let prev = null
  for (const t of tokens) {
    if (t.type === 'space') { gaps += WORD_GAP; prev = 'space'; continue }
    if (prev === 'glyph') gaps += LETTER_GAP
    prev = 'glyph'
  }
  return gaps
}

const glyphsOf = (tokens) => tokens.filter((t) => t.type === 'glyph')

/**
 * Bir harfin seçilebilir genişlikleri. `pin` verilmişse o harf o genişliğe
 * sabitlenmiştir — kullanıcı elle seçtiğinde çözücü ona dokunmaz.
 */
function optionsFor(char, index, opts) {
  let map = widthsFor(char, opts)

  // Onaylı birleşimlerin istediği biçimler — yalnız bu konumda.
  const inject = opts.injected?.[index]
  if (inject?.size) {
    map = new Map([...map].map(([w, list]) => [w, [...list]]))
    for (const [w, list] of inject) {
      const cur = map.get(w) ?? []
      for (const g of list) if (!cur.some((x) => x.id === g.id)) cur.push(g)
      map.set(w, cur)
    }
  }

  const pin = opts.pins?.[index]
  if (pin == null) return map

  // Sabitleme iki biçimde gelir: yalnız genişlik (sayı) ya da genişlik +
  // biçim kimliği. Kimlik varsa TAM O BİÇİM kullanılır — aynı genişlikte
  // birden çok biçim olduğu için yalnız genişliği sabitlemek yetmiyor,
  // çözücü başkasını seçebiliyordu.
  const w = typeof pin === 'object' ? pin.w : pin
  const list = map.get(w)
  if (!list) return map
  if (typeof pin === 'object' && pin.id) {
    const exact = list.find((g) => g.id === pin.id)
    if (exact) return new Map([[w, [exact]]])
  }
  return new Map([[w, list]])
}

/** Bir harfin o anki seçeneklerinden ilki — varsayılan biçim. */
const firstOf = (map, w) => map.get(typeof w === 'object' ? w.w : w)?.[0] ?? null

/** Satırın ulaşabildiği toplam genişlikler. */
export function reachableWidths(tokens, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const chars = glyphsOf(tokens)
  if (!chars.length) return new Set([0])
  const space = spaceFlags(tokens)
  opts.injected = opts.injected ?? injectionsFor(chars)

  // Durum: (glifin sol kenarı, seçilen biçim). Kenetlenme ilerlemeyi
  // değiştirdiği için genişlik artık yalnız genişliklerin toplamı değil.
  let states = new Map()
  for (const [w, list] of optionsFor(chars[0].char, 0, opts)) {
    for (const g of list) states.set(`0|${g.id}`, { x: 0, g })
  }

  for (let i = 1; i < chars.length; i++) {
    const map = optionsFor(chars[i].char, i, opts)
    const next = new Map()
    for (const st of states.values()) {
      for (const [, list] of map) {
        for (const g of list) {
          for (const j of advanceOptions(chars[i - 1].char, chars[i].char, st.g, g, space[i])) {
            const x = st.x + j.advance
            const k = `${x}|${g.id}`
            if (!next.has(k)) next.set(k, { x, g })
          }
        }
      }
    }
    states = next
    if (!states.size) return new Set()
  }

  const out = new Set()
  for (const st of states.values()) out.add(st.x + st.g.w)
  return out
}

/** Tüm satırların ortaklaşa ulaşabildiği genişlikler, küçükten büyüğe. */
export function commonWidths(lines, options = {}) {
  if (!lines.length) return []
  const sets = lines.map((t, i) =>
    reachableWidths(t, { ...options, pins: options.pinsByLine?.[i] })
  )
  const [first, ...rest] = sets
  return [...first].filter((w) => rest.every((s) => s.has(w))).sort((a, b) => a - b)
}

/**
 * Satırın hedefi aşmayan en büyük ulaşılabilir genişliği.
 * Tam hedefe yetişemeyen satırlar buraya kadar gider, kalanı boşluk olur.
 */
export function bestWidthUpTo(tokens, target, options = {}) {
  const reach = [...reachableWidths(tokens, options)].filter((w) => w <= target)
  return reach.length ? Math.max(...reach) : null
}

/**
 * Hedef genişliği tam tutturan en ucuz varyant atamasını bulur.
 * @returns glif dizisi, ya da hedefe ulaşılamıyorsa null
 */
export function solveLine(tokens, target, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const chars = glyphsOf(tokens)
  opts.injected = opts.injected ?? injectionsFor(chars)
  if (!chars.length) return target === 0 ? Object.assign([], { joins: [] }) : null

  const maps = chars.map((t, i) => optionsFor(t.char, i, opts))
  const bases = maps.map((m) => Math.min(...m.keys()))
  const band = opts.bandHeight ?? BAND_HEIGHT
  const voidCost = opts.voidCost ?? DEFAULTS.voidCost
  const densityCost = opts.densityCost ?? DEFAULTS.densityCost
  const space = spaceFlags(tokens)

  // Durum: (glifin SOL KENARI, seçilen biçim).
  //
  // Eskiden genişliklerin toplamıydı ve boşluklar dışarıdan sabit ekleniyordu.
  // Kenetlenme ilerlemeyi değiştirdiği için bu artık geçerli değil: 'li'de
  // i, l'nin sütunlarına giriyor ve ilerleme 4 yerine 2 oluyor. Sol kenarı
  // taşımak hem kenetli hem normal durumu aynı denklemle anlatıyor.
  //
  // Satır genişliği = son glifin sol kenarı + genişliği.
  let dp = new Map()
  for (const [w, list] of maps[0]) {
    for (const glyph of list) {
      const c = stretchCost(w - bases[0], glyph) + densityCost * ownVoid(glyph, band)
      const k = `0|${glyph.id}`
      const cur = dp.get(k)
      if (!cur || c < cur.cost) dp.set(k, { cost: c, x: 0, glyph, from: null, join: null })
    }
  }
  const layers = [dp]

  for (let i = 1; i < chars.length; i++) {
    // Kalan harfler en dar hallerinde bile ne kadar yer ister?
    //
    // ALT sınır olmalı, yoksa geçerli dallar budanır: kenetlenme ilerlemeyi
    // 1 birime kadar indirebiliyor, dolayısıyla kalan her harf en az 1 birim
    // ilerletir, son harf de kendi en dar genişliğini ekler.
    const rest = chars.length - 1 - i
    const remainingMin = rest + bases[chars.length - 1]
    const next = new Map()

    for (const [prevKey, st] of dp) {
      for (const [w, list] of maps[i]) {
        const stretch = stretchCost(w - bases[i], list[0])
        for (const glyph of list) {
          const base =
            st.cost +
            stretch +
            voidCost * pairVoid(st.glyph, glyph, band) +
            densityCost * ownVoid(glyph, band)

          for (const j of advanceOptions(
            chars[i - 1].char,
            chars[i].char,
            st.glyph,
            glyph,
            space[i]
          )) {
            const x = st.x + j.advance
            if (x + remainingMin > target) continue
            // Onaylı kenetlenme küçük bir indirim alır: ustanın fiilen
            // kullandığı biçim, motorun kendi bulduğuna yeğlenir.
            const c = base - (j.approved ? 0.5 : 0)
            const k = `${x}|${glyph.id}`
            const cur = next.get(k)
            if (!cur || c < cur.cost) {
              next.set(k, { cost: c, x, glyph, from: prevKey, join: j.approved ? j : null })
            }
          }
        }
      }
    }
    dp = next
    layers.push(dp)
    if (!dp.size) return null
  }

  // Hedefi tam tutturanlar arasından en ucuzu.
  let best = null
  let bestKey = null
  for (const [k, st] of dp) {
    if (st.x + st.glyph.w !== target) continue
    if (!best || st.cost < best.cost) { best = st; bestKey = k }
  }
  if (!best) return null

  const out = []
  const joins = []
  let key = bestKey
  for (let i = chars.length - 1; i >= 0; i--) {
    const st = layers[i].get(key)
    out.unshift(st.glyph)
    joins.unshift(st.join)
    key = st.from
  }
  // Birleşimler glif dizisine iliştirilir: layoutLine'ın ihtiyacı olan ikinci
  // bilgi bu, ama çağıranların çoğu yalnız biçimlerle ilgileniyor.
  return Object.assign(out, { joins })
}

/**
 * Karesel maliyet: dört harfi birer birim genişletmek (4×1=4), tek harfi dört
 * birim genişletmekten (1×16=16) ucuz. Böylece esneme satıra yayılır.
 * Türetilmemiş varyantlar küçük bir indirim alır — tasarlanmış biçim yeğlenir.
 */
function stretchCost(delta, glyph) {
  return delta * delta + (glyph.derived ? 0.25 : 0)
}

/**
 * Metni satırlara böler, ortak genişliğe hizalar ve yerleştirir.
 *
 * @param {string} text
 * @param {object} options
 *   target        istenen genişlik; verilmezse ortaklardan en uygunu seçilir
 *   align         tek satırda ya da hizalama kapalıyken kullanılır
 *   maxGlyphWidth, maxWiden
 * @returns {{ ok, target, lines, candidates, warnings }}
 */
export function justify(text, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const raw = text.split('\n')
  const tokenLines = raw.map(tokenize)
  const content = tokenLines.filter((t) => glyphsOf(t).length)
  const warnings = []

  if (!content.length) {
    return { ok: false, target: 0, lines: [], candidates: [], warnings: ['metin boş'] }
  }

  // Hizalama kapalı: her satır doğal genişliğinde, sabitlenenler hariç.
  if (opts.justify === false) {
    const lines = content.map((tokens, li) => {
      const pins = opts.pinsByLine?.[li]
      const chosen = glyphsOf(tokens).map((t, i) => {
        const pin = pins?.[i]
        const g = pin != null ? firstOf(optionsFor(t.char, i, { ...opts, pins }), pin) : null
        return g ?? defaultVariant(t.char)
      })
      return { ...layoutLine(tokens, chosen, chosen.joins), tokens }
    })
    return {
      ok: true,
      target: Math.max(...lines.map((l) => l.width)),
      lines,
      candidates: [],
      warnings
    }
  }

  // Tek satır hizalanacak bir şey değil; doğal genişliğinde kalır.
  if (content.length === 1 && opts.target == null) {
    const tokens = content[0]
    const pins = opts.pinsByLine?.[0]
    const chosen = glyphsOf(tokens).map((t, i) => {
      const pin = pins?.[i]
      const g = pin != null ? firstOf(optionsFor(t.char, i, { ...opts, pins }), pin) : null
      return g ?? defaultVariant(t.char)
    })
    const line = layoutLine(tokens, chosen, chosen.joins)
    return {
      ok: true,
      target: line.width,
      lines: [{ ...line, tokens }],
      candidates: [...reachableWidths(tokens, { ...opts, pins })].sort((a, b) => a - b),
      warnings
    }
  }

  const candidates = commonWidths(content, opts)

  // Her satırın ULAŞABİLDİĞİ en dar genişlik — sabitlemeler dahil. Doğal
  // genişlik yetmiyor: bir harfi 6 birime sabitlemek satırın asgarisini
  // yükseltir, hedef bunun altında seçilirse o satır hiçbir şeye sığmaz.
  const floors = content.map((t, li) =>
    Math.min(...reachableWidths(t, { ...opts, pins: opts.pinsByLine?.[li] }))
  )
  const widest = Math.max(...floors)

  // Hedef: verilmişse o; ortak genişlik varsa en geniş doğal genişliğe en
  // yakını; yoksa doğrudan en geniş doğal genişlik. Son durumda satırlar
  // yetişebildiği kadar yaklaşır, kalanı boşluk olarak bildirilir.
  let target = opts.target
  if (target == null) {
    target = candidates.length
      ? candidates.reduce((best, w) => (Math.abs(w - widest) < Math.abs(best - widest) ? w : best))
      : widest
  }

  const lines = []
  for (const [li, tokens] of content.entries()) {
    const pins = opts.pinsByLine?.[li]
    let width = target
    let chosen = solveLine(tokens, target, { ...opts, pins })

    if (!chosen) {
      // Tam hedefe yetişemiyor: hedefi aşmayan en büyük genişliğe git.
      const fallback = bestWidthUpTo(tokens, target, { ...opts, pins })
      if (fallback == null) {
        warnings.push(
          `${li + 1}. satır ${target} birime sığmıyor; en dar hali bile daha geniş. ` +
            `Genişleyemeyen harfler: ${stuckChars(tokens, opts).join(' ') || '—'}`
        )
        return { ok: false, target, lines: [], candidates, warnings }
      }
      width = fallback
      chosen = solveLine(tokens, fallback, { ...opts, pins })
      if (!chosen) {
        warnings.push(`${li + 1}. satır çözülemedi.`)
        return { ok: false, target, lines: [], candidates, warnings }
      }
    }

    const line = { ...layoutLine(tokens, chosen, chosen.joins), tokens }
    line.slack = target - line.width
    lines.push(line)
  }

  const short = lines.filter((l) => l.slack > 0)
  if (short.length) {
    warnings.push(
      `${short.length} satır hedefe tam ulaşamadı. Artan pay: ` +
        lines
          .map((l, i) => (l.slack ? `${i + 1}. satır ${l.slack}` : null))
          .filter(Boolean)
          .join(', ') +
        '. Hizalamayı seç ya da boşluğa dekoratif blok koy.'
    )
  }

  return { ok: true, target, lines, candidates, warnings, slack: short.length }
}

/** Genişlik merdiveni tek basamaklı olan harfler — hizalamayı kilitleyenler. */
function stuckChars(tokens, opts) {
  const stuck = new Set()
  for (const t of glyphsOf(tokens)) {
    if (widthsFor(t.char, opts).size === 1) stuck.add(t.char)
  }
  return [...stuck]
}

/**
 * Hizalanmış satırları tek hücre kümesine istifler.
 *
 * `weight` 1'den büyükse istif alt-hücre çözünürlüğüne taşınır ve her glif
 * tek tek kalınlaştırılır; dönen `resolution` renderSvg'ye verilmelidir.
 */
export function compose(text, options = {}) {
  const r = justify(text, options)
  if (!r.ok) return { ...r, cells: [], width: 0, height: 0, resolution: 1 }

  // Satırlar hedefin içine yaslanır; hedef, en geniş satırdan büyük olabilir.
  const s = stack(r.lines, { ...options, width: r.target })
  const weight = options.weight ?? 1
  if (weight === 1) return { ...r, ...s, resolution: 1 }

  const scale = options.weightScale ?? 8
  const t = thickenStack(s, { scale, amount: weightToAmount(weight, scale) })
  return { ...r, ...s, ...t, lines: s.lines, resolution: scale }
}
