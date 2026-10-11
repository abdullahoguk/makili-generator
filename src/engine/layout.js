// Metni birim grid üzerine yerleştirir.
//
// Değişmezler (asla esnetilmez):
//   - harfler arası tam LETTER_GAP hücre
//   - kelimeler arası tam WORD_GAP hücre
// Dolayısıyla satır genişliğinin tek serbestlik derecesi varyant seçimidir.

import { defaultVariant, variantsOf, variantById, has } from './glyphs.js'

export const LETTER_GAP = 1
export const WORD_GAP = 3
export const LINE_GAP = 1

/** Metni harf dizisine böler; boşluklar kelime sınırı olarak işaretlenir. */
export function tokenize(line) {
  const out = []
  for (const ch of line.toLowerCase()) {
    if (ch === ' ') {
      if (out.length && out[out.length - 1].type !== 'space') out.push({ type: 'space' })
    } else if (has(ch)) {
      out.push({ type: 'glyph', char: ch })
    } else {
      out.push({ type: 'unknown', char: ch })
    }
  }
  while (out.length && out[out.length - 1].type === 'space') out.pop()
  return out
}

/**
 * Bir satırın toplam genişliği: glif genişlikleri + sabit boşluklar.
 * @param {number[]} widths seçilen varyant genişlikleri, sıra tokenlarla aynı
 */
export function lineWidth(tokens, widths) {
  let w = 0
  let i = 0
  let prev = null
  for (const t of tokens) {
    if (t.type === 'space') {
      w += WORD_GAP
      prev = 'space'
      continue
    }
    if (prev === 'glyph') w += LETTER_GAP
    w += widths[i++]
    prev = 'glyph'
  }
  return w
}

/** Satırın varsayılan varyantlarla doğal genişliği. */
export function naturalWidth(tokens) {
  const widths = tokens.filter((t) => t.type !== 'space').map((t) => defaultVariant(t.char).w)
  return lineWidth(tokens, widths)
}

/**
 * Seçilmiş varyantlarla satırı yerleştirir.
 * @returns {{ width, height, baseline, items: Array }}
 */
export function layoutLine(tokens, chosen) {
  const items = []
  let x = 0
  let i = 0
  let prev = null
  let maxAscent = 0
  let maxDescent = 0

  for (const t of tokens) {
    if (t.type === 'space') {
      x += WORD_GAP
      prev = 'space'
      continue
    }
    if (prev === 'glyph') x += LETTER_GAP
    const v = chosen[i++]
    // Taban çizgisi hizası: glifin gövde altı satırın taban çizgisine oturur.
    const ascent = v.baseline
    const descent = v.h - v.baseline
    if (ascent > maxAscent) maxAscent = ascent
    if (descent > maxDescent) maxDescent = descent
    items.push({ char: t.char, variant: v, x, ascent })
    x += v.w
    prev = 'glyph'
  }

  // Hücreleri satır koordinatına taşı: taban çizgisi y = maxAscent.
  for (const it of items) {
    it.y = maxAscent - it.ascent
  }

  return { width: x, height: maxAscent + maxDescent, baseline: maxAscent, items }
}

/** Yerleşimi tek bir hücre kümesine düzleştirir. */
export function toCells(line) {
  const cells = []
  for (const it of line.items) {
    for (const [cx, cy] of it.variant.cells) cells.push([it.x + cx, it.y + cy])
  }
  return cells
}

/** Birden çok satırı dikey olarak istifler; her satır kendi x ofsetiyle. */
export function stack(lines, { align = 'left', lineGap = LINE_GAP } = {}) {
  const width = Math.max(...lines.map((l) => l.width))
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
    const chosen = tokens.filter((t) => t.type !== 'space').map((t) => defaultVariant(t.char))
    return layoutLine(tokens, chosen)
  })
  return stack(lines, opts)
}

export { variantsOf, variantById, defaultVariant }
