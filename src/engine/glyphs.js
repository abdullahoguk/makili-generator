// Glif kütüphanesine erişim.

import { heighten } from './derive.js'
import library from '../data/glyphs.json' with { type: 'json' }

export const CHARSET = library.charset.split('')

/** char -> varyant dizisi (genişliğe göre sıralı). */
export const variantsOf = (char) => library.glyphs[char] ?? null

export const has = (char) => Boolean(library.glyphs[char])

/**
 * Harfin varsayılan varyantı: tam boy gövde (en yüksek), eşitlikte en dar.
 * Metin bir şey belirtmediğinde kullanılan biçim budur.
 */
export function defaultVariant(char) {
  const vs = variantsOf(char)
  if (!vs) return null
  return vs.reduce((best, v) => (v.h > best.h || (v.h === best.h && v.w < best.w) ? v : best))
}

export function variantById(id) {
  const char = id.split('.')[0]
  return variantsOf(char)?.find((v) => v.id === id) ?? null
}

/**
 * Kimlikten glif: türetilmiş kimlikler (`i.do417^1`) de çözülür.
 *
 * Lab'de verilen kararlar türetilmiş biçimlere atıfta bulunabiliyor —
 * ustanın 'li' kaynaşmasındaki i 1x7, kütüphanede ise 1x6 ve 1x9 var.
 * Aradaki basamak satır çoğaltmayla üretiliyor ve kimliği `^1` alıyor.
 */
export function resolveId(id) {
  const [base, lift] = String(id).split('^')
  const g = variantById(base)
  if (!g) return null
  if (!lift) return g
  return heighten(g, Number(lift))
}

/** Kütüphanede olmayan karakterler. */
export function unsupported(text) {
  const bad = new Set()
  for (const ch of text.toLowerCase()) {
    if (ch === ' ' || ch === '\n') continue
    if (!has(ch)) bad.add(ch)
  }
  return [...bad]
}

export default library
