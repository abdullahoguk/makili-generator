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
import { widthMap } from './derive.js'
import { tokenize, layoutLine, naturalWidth, stack, LETTER_GAP, WORD_GAP } from './layout.js'
import { thickenStack, weightToAmount } from './render/weight.js'

export const DEFAULTS = {
  maxGlyphWidth: 9, // bir harf en fazla bu kadar geniş olabilir
  maxWiden: 4, // tek harf en fazla bu kadar birim genişletilebilir
  tallOnly: true // yalnız tam boy gövdeler; kısa varyantlar dizgiyi bozuyor
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
  const map = widthMap(pool.length ? pool : all, opts.maxGlyphWidth)

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

/** Satırın ulaşabildiği toplam genişlikler. */
export function reachableWidths(tokens, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const chars = glyphsOf(tokens)
  let sums = new Set([0])
  for (const t of chars) {
    const widths = [...widthsFor(t.char, opts).keys()]
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
  const sets = lines.map((t) => reachableWidths(t, options))
  const [first, ...rest] = sets
  return [...first].filter((w) => rest.every((s) => s.has(w))).sort((a, b) => a - b)
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

  const maps = chars.map((t) => widthsFor(t.char, opts))
  const bases = maps.map((m) => Math.min(...m.keys()))

  // dp[i] : i. harften sonra ulaşılan genişlik -> { cost, w, prev }
  let dp = new Map([[0, { cost: 0, from: null, w: 0 }]])
  const layers = [dp]

  for (let i = 0; i < chars.length; i++) {
    const remainingMin = bases.slice(i + 1).reduce((a, b) => a + b, 0)
    const next = new Map()
    for (const [sum, state] of dp) {
      for (const [w, glyph] of maps[i]) {
        const s = sum + w
        if (s + remainingMin > goal) continue // bu daldan hedefe yetişilemez
        const c = state.cost + stretchCost(w - bases[i], glyph)
        const cur = next.get(s)
        if (!cur || c < cur.cost) next.set(s, { cost: c, from: sum, w, glyph })
      }
    }
    dp = next
    layers.push(dp)
    if (!dp.size) return null
  }

  if (!dp.has(goal)) return null

  const out = []
  let sum = goal
  for (let i = chars.length; i > 0; i--) {
    const st = layers[i].get(sum)
    out.unshift(st.glyph)
    sum = st.from
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

  // Tek satır hizalanacak bir şey değil; doğal genişliğinde kalır.
  if (content.length === 1 && opts.target == null) {
    const tokens = content[0]
    const chosen = glyphsOf(tokens).map((t) => defaultVariant(t.char))
    const line = layoutLine(tokens, chosen)
    return {
      ok: true,
      target: line.width,
      lines: [{ ...line, tokens }],
      candidates: [...reachableWidths(tokens, opts)].sort((a, b) => a - b),
      warnings
    }
  }

  const candidates = commonWidths(content, opts)

  if (!candidates.length) {
    const naturals = content.map(naturalWidth)
    const widest = Math.max(...naturals)
    content.forEach((tokens, i) => {
      const reach = reachableWidths(tokens, opts)
      const max = Math.max(...reach)
      if (max < widest) {
        warnings.push(
          `${i + 1}. satır en fazla ${max} birime ulaşabiliyor, en geniş satır ${widest} birim. ` +
            `Genişleyemeyen harfler: ${stuckChars(tokens, opts).join(' ') || '—'}`
        )
      }
    })
    if (!warnings.length) {
      warnings.push('Satırların ulaşabildiği genişlikler kesişmiyor; ortak bir hedef yok.')
    }
    return { ok: false, target: null, lines: [], candidates: [], warnings }
  }

  // Hedef: verilmişse o, yoksa en geniş doğal genişliğe en yakın ortak değer.
  let target = opts.target
  if (target == null) {
    const widest = Math.max(...content.map(naturalWidth))
    target = candidates.reduce((best, w) =>
      Math.abs(w - widest) < Math.abs(best - widest) ? w : best
    )
  } else if (!candidates.includes(target)) {
    return {
      ok: false,
      target,
      lines: [],
      candidates,
      warnings: [`${target} birim ulaşılabilir değil. Geçerli genişlikler: ${candidates.join(', ')}`]
    }
  }

  const lines = []
  for (const tokens of content) {
    const chosen = solveLine(tokens, target, opts)
    if (!chosen) {
      return {
        ok: false,
        target,
        lines: [],
        candidates,
        warnings: [`${lines.length + 1}. satır ${target} birime tam oturmuyor.`]
      }
    }
    lines.push({ ...layoutLine(tokens, chosen), tokens })
  }

  return { ok: true, target, lines, candidates, warnings }
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

  const s = stack(r.lines, options)
  const weight = options.weight ?? 1
  if (weight === 1) return { ...r, ...s, resolution: 1 }

  const scale = options.weightScale ?? 8
  const t = thickenStack(s, { scale, amount: weightToAmount(weight, scale) })
  return { ...r, ...s, ...t, lines: s.lines, resolution: scale }
}
