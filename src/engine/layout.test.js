import { describe, it, expect } from 'vitest'
import { tokenize, layoutLine, naturalWidth, composeNatural, WORD_GAP, LETTER_GAP } from './layout.js'
import { defaultVariant } from './glyphs.js'

describe('tokenize', () => {
  it('harf ve kelime sınırı üretir', () => {
    expect(tokenize('ab c').map((t) => t.type)).toEqual(['glyph', 'glyph', 'space', 'glyph'])
  })

  it('büyük harfi küçültür', () => {
    expect(tokenize('AB').map((t) => t.char)).toEqual(['a', 'b'])
  })

  it('ardışık boşlukları teke indirir', () => {
    expect(tokenize('a   b').filter((t) => t.type === 'space')).toHaveLength(1)
  })

  it('baştaki ve sondaki boşluğu atar', () => {
    expect(tokenize('  ab  ').map((t) => t.type)).toEqual(['glyph', 'glyph'])
  })

  it('kütüphanede olmayan karakteri atar', () => {
    // 'x' ve 'q' Latin Makili alfabesinde yok.
    expect(tokenize('axq').map((t) => t.char)).toEqual(['a'])
  })
})

describe('layoutLine', () => {
  it('desteklenmeyen karakter içeren metni çökertmez', () => {
    const tokens = tokenize('test xqw')
    const chosen = tokens.filter((t) => t.type === 'glyph').map((t) => defaultVariant(t.char))
    expect(() => layoutLine(tokens, chosen)).not.toThrow()
  })

  it('harf arasına tam bir birim koyar', () => {
    const tokens = tokenize('oo')
    const chosen = tokens.map(() => defaultVariant('o'))
    const line = layoutLine(tokens, chosen)
    expect(line.items[1].x - (line.items[0].x + line.items[0].variant.w)).toBe(LETTER_GAP)
  })

  it('kelime arasına tam WORD_GAP koyar', () => {
    const tokens = tokenize('o o')
    const chosen = [defaultVariant('o'), defaultVariant('o')]
    const line = layoutLine(tokens, chosen)
    expect(line.items[1].x - (line.items[0].x + line.items[0].variant.w)).toBe(WORD_GAP)
  })

  it('farklı yükseklikteki glifleri taban çizgisine oturtur', () => {
    const tokens = tokenize('ai')
    const chosen = tokens.map((t) => defaultVariant(t.char))
    const line = layoutLine(tokens, chosen)
    for (const it of line.items) {
      expect(it.y + it.variant.baseline).toBe(line.baseline)
    }
  })
})

describe('composeNatural', () => {
  it('desteklenmeyen karakterli çok satırlı metni işler', () => {
    expect(() => composeNatural('test xqw\nolur')).not.toThrow()
  })

  it('tüm karakterleri atılan satırı sayar ama boş bırakır', () => {
    expect(naturalWidth(tokenize('xqw'))).toBe(0)
  })
})
