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

import { variantsOf, defaultVariant } from './glyphs.js'
import { widthOptions } from './derive.js'
import { tokenize, layoutLine, naturalWidth, stack, LETTER_GAP, WORD_GAP } from './layout.js'
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
  voidCost: 1,
  // Biçimin KENDİ boşluğunun birim bedeli. Eşleşme bedeli her glifin kendi
  // ağzını düşer — iki harfi yan yana koymanın ürettiği fazlalığı ölçmek
  // için doğru olan bu. Ama aynı harfin aynı genişlikteki biçimleri
  // arasında seçerken asıl ayırt edici tam o kendi boşluğu: 'a'nın 3 birimlik
  // 11 biçiminden hangisi daha sık dokuyorsa o. Ayrı terim olmasının sebebi
  // bu; ağırlığı daha düşük, yoksa harf kimliğini bastırır.
  //
  // 0.7 taramayla seçildi: bunun altında delik artıyor, üstünde hiçbir şey
  // değişmiyor. Sütun çoğaltma daraldıktan sonra eşik 0.35'ten buraya kaydı.
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
  const map = widthsFor(char, opts)
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
  let sums = new Set([0])
  for (const [i, t] of chars.entries()) {
    const widths = [...optionsFor(t.char, i, opts).keys()]
    const next = new Set()
    for (const s of sums) for (const w of widths) next.add(s + w)
    sums = next
  }
  const gaps = gapTotal(tokens)
  return new Set([...sums].map((s) => s + gaps))
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
  const goal = target - gapTotal(tokens)
  if (goal < 0) return null
  if (!chars.length) return goal === 0 ? [] : null

  const maps = chars.map((t, i) => optionsFor(t.char, i, opts))
  const bases = maps.map((m) => Math.min(...m.keys()))
  const band = opts.bandHeight ?? BAND_HEIGHT
  const voidCost = opts.voidCost ?? DEFAULTS.voidCost
  const densityCost = opts.densityCost ?? DEFAULTS.densityCost

  // Durum artık yalnız ulaşılan genişlik değil, SON SEÇİLEN BİÇİM de.
  // Doku bedeli komşuluğa bağlı olduğu için önceki harfin hangi biçimde
  // olduğunu bilmeden sonraki harfin bedeli hesaplanamaz.
  //
  // Anahtar: `${ulaşılanGenişlik}|${glifKimliği}`.
  let dp = new Map([['0|', { cost: 0, sum: 0, from: null, glyph: null }]])
  const layers = [dp]

  for (let i = 0; i < chars.length; i++) {
    const remainingMin = bases.slice(i + 1).reduce((a, b) => a + b, 0)
    const next = new Map()
    for (const [prevKey, state] of dp) {
      for (const [w, list] of maps[i]) {
        const s = state.sum + w
        if (s + remainingMin > goal) continue // bu daldan hedefe yetişilemez
        const stretch = stretchCost(w - bases[i], list[0])
        for (const glyph of list) {
          const c =
            state.cost +
            stretch +
            voidCost * pairVoid(state.glyph, glyph, band) +
            densityCost * ownVoid(glyph, band)
          const k = `${s}|${glyph.id}`
          const cur = next.get(k)
          if (!cur || c < cur.cost) next.set(k, { cost: c, sum: s, from: prevKey, glyph })
        }
      }
    }
    dp = next
    layers.push(dp)
    if (!dp.size) return null
  }

  // Hedefe ulaşanlar arasından en ucuzu.
  let best = null
  let bestKey = null
  for (const [k, st] of dp) {
    if (st.sum !== goal) continue
    if (!best || st.cost < best.cost) { best = st; bestKey = k }
  }
  if (!best) return null

  const out = []
  let key = bestKey
  for (let i = chars.length; i > 0; i--) {
    const st = layers[i].get(key)
    out.unshift(st.glyph)
    key = st.from
  }
  return out
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
      return { ...layoutLine(tokens, chosen), tokens }
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
    const line = layoutLine(tokens, chosen)
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

    const line = { ...layoutLine(tokens, chosen), tokens }
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
