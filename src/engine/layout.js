// Metni birim grid üzerine yerleştirir.
//
// Değişmezler (asla esnetilmez):
//   - harfler arası tam LETTER_GAP hücre
//   - kelimeler arası tam WORD_GAP hücre
// Dolayısıyla satır genişliğinin tek serbestlik derecesi varyant seçimidir.
//
// Bir istisna var: KENETLENME. Usta bazı çiftleri iç içe geçiriyor — 'li'de
// i, l'nin iç boşluğuna giriyor; 'rg'de g, r'nin kucağına oturuyor. Orada
// aradaki açıklık yine 1 birim, ama sağ harf sol harfin SÜTUNLARINA giriyor,
// yani ilerleme sol.w + 1'den küçük oluyor.
//
// Bu yüzden harf arası mesafe `advance` olarak modellendi: varsayılanı
// sol.w + boşluk, ama bir çift için onaylı kenetli yerleşim varsa daha
// küçük olabilir. Harfin bant içindeki dikey yeri de aynı şekilde serbest:
// kısa bir harf tabana oturabilir ya da üste asılabilir ('ai'de i üstte,
// çünkü üstünde boşluk kalmamalı).

import { defaultVariant, variantsOf, variantById, has } from './glyphs.js'

export const LETTER_GAP = 1

// Kelime arası diye bir şey yok. Ustanın afişi ölçüldü
// (tools/extract-reference.py): dört satırdaki boş sütun koşularının hepsi
// 1 hücre. Kelimeler kesintisiz akıyor; okuma, harflerin biçiminden çıkıyor.
export const WORD_GAP = 1

export const LINE_GAP = 1

/**
 * Metni harf dizisine böler; boşluklar kelime sınırı olarak işaretlenir.
 *
 * Kütüphanede karşılığı olmayan karakterler ATILIR — dizgi yalnız çizilebilen
 * şeylerden oluşur. Atılanları kullanıcıya bildirmek çağıranın işi;
 * glyphs.unsupported() hangi karakterlerin düştüğünü söyler.
 */
export function tokenize(line) {
  const out = []
  for (const ch of line.toLowerCase()) {
    if (ch === ' ') {
      if (out.length && out[out.length - 1].type !== 'space') out.push({ type: 'space' })
    } else if (has(ch)) {
      out.push({ type: 'glyph', char: ch })
    }
  }
  while (out.length && out[out.length - 1].type === 'space') out.pop()
  return out
}

/**
 * Bir satırın toplam genişliği: glif genişlikleri + sabit boşluklar.
 *
 * `joins` verilirse i. glifin bir öncekine göre ilerlemesi oradan okunur
 * (kenetlenme); verilmezse varsayılan sol.w + boşluk.
 *
 * @param {number[]} widths seçilen varyant genişlikleri, sıra tokenlarla aynı
 * @param {Array<{advance:number}|null>} [joins] i. eleman i-1 ile i arasını anlatır
 */
export function lineWidth(tokens, widths, joins = null) {
  const glyphs = tokens.filter((t) => t.type === 'glyph')
  if (!glyphs.length) return 0

  // Boşluk hangi gliften önce geliyor: o birleşimde kelime arası kullanılır.
  const afterSpace = spaceFlags(tokens)

  let x = 0
  for (let i = 1; i < widths.length; i++) {
    const join = joins?.[i]
    x += join?.advance ?? widths[i - 1] + (afterSpace[i] ? WORD_GAP : LETTER_GAP)
  }
  return x + widths[widths.length - 1]
}

/** i. glif bir boşluktan sonra mı geliyor? */
function spaceFlags(tokens) {
  const out = []
  let pendingSpace = false
  for (const t of tokens) {
    if (t.type === 'space') { pendingSpace = true; continue }
    out.push(pendingSpace)
    pendingSpace = false
  }
  return out
}

export { spaceFlags }

/** Satırın varsayılan varyantlarla doğal genişliği. */
export function naturalWidth(tokens) {
  const widths = tokens.filter((t) => t.type === 'glyph').map((t) => defaultVariant(t.char).w)
  return lineWidth(tokens, widths)
}

/**
 * Seçilmiş varyantlarla satırı yerleştirir.
 * @returns {{ width, height, baseline, items: Array }}
 */
export function layoutLine(tokens, chosen, joins = null) {
  const items = []
  const glyphs = tokens.filter((t) => t.type === 'glyph')
  const afterSpace = spaceFlags(tokens)

  let x = 0
  for (let i = 0; i < glyphs.length; i++) {
    const v = chosen[i]
    if (i > 0) {
      const join = joins?.[i]
      x += join?.advance ?? chosen[i - 1].w + (afterSpace[i] ? WORD_GAP : LETTER_GAP)
    }
    items.push({ char: glyphs[i].char, variant: v, x, join: joins?.[i] ?? null })
  }

  // Dikey yer: varsayılan taban hizası, ama birleşim açıkça söylüyorsa o.
  //
  // `top` bant içindeki üst satır. Kenetli/yuvalı yerleşimlerde iki glifin
  // de yeri birleşimde yazılı; biri bir öncekiyle, öbürü bir sonrakiyle
  // belirlenebildiği için sonra gelen kazanır — yerleşim soldan sağa kurulur.
  const band = Math.max(...chosen.map((v) => v.h))
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    it.top = band - it.variant.h
    const join = joins?.[i]
    if (join?.rightTop != null) it.top = join.rightTop
    const next = joins?.[i + 1]
    if (next?.leftTop != null) it.top = next.leftTop
  }

  const height = Math.max(...items.map((it) => it.top + it.variant.h), band)
  for (const it of items) {
    it.y = it.top
    it.ascent = it.variant.baseline
  }

  const width = items.length
    ? Math.max(...items.map((it) => it.x + it.variant.w))
    : 0

  return { width, height, baseline: height, items, tokens }
}

/** Yerleşimi tek bir hücre kümesine düzleştirir. */
export function toCells(line) {
  const cells = []
  for (const it of line.items) {
    for (const [cx, cy] of it.variant.cells) cells.push([it.x + cx, it.y + cy])
  }
  return cells
}

export function stack(lines, { align = 'left', lineGap = LINE_GAP, width: forced = null } = {}) {
  const width = forced ?? Math.max(...lines.map((l) => l.width))
  const cells = []
  let y = 0
  const placed = []
  for (const line of lines) {
    const dx = align === 'center' ? Math.floor((width - line.width) / 2)
      : align === 'right' ? width - line.width
      : 0
    for (const [cx, cy] of toCells(line)) cells.push([cx + dx, cy + y])
    placed.push({ line, x: dx, y })
    y += line.height + lineGap
  }
  return { width, height: y - lineGap, cells, lines: placed }
}

/** Varsayılan varyantlarla, hizalama yapmadan düz dizgi. */
export function composeNatural(text, opts) {
  const lines = text.split('\n').map((raw) => {
    const tokens = tokenize(raw)
    const chosen = tokens.filter((t) => t.type === 'glyph').map((t) => defaultVariant(t.char))
    return layoutLine(tokens, chosen)
  })
  return stack(lines, opts)
}

export { variantsOf, variantById, defaultVariant }
