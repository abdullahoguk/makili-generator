import { describe, it, expect } from 'vitest'
import { tokenize, lineWidth, naturalWidth, WORD_GAP, LETTER_GAP } from './layout.js'
import { reachableWidths, commonWidths, solveLine, justify, compose } from './justify.js'

describe('reachableWidths', () => {
  it('tek harf için harfin genişlik merdivenini verir', () => {
    const r = reachableWidths(tokenize('o'), { maxGlyphWidth: 6 })
    expect([...r].sort((a, b) => a - b)).toEqual([3, 4, 5, 6])
  })

  it('sabit boşlukları toplama katar', () => {
    // iki harf + 1 birim harf arası
    const r = reachableWidths(tokenize('oo'), { maxGlyphWidth: 4 })
    expect(Math.min(...r)).toBe(3 + LETTER_GAP + 3)
    expect(Math.max(...r)).toBe(4 + LETTER_GAP + 4)
  })

  it('kelime arası boşluğu sabit tutar', () => {
    const r = reachableWidths(tokenize('o o'), { maxGlyphWidth: 3 })
    expect([...r]).toEqual([3 + WORD_GAP + 3])
  })

  it('genişleyemeyen harf tek genişlik verir', () => {
    expect([...reachableWidths(tokenize('ı'), { maxGlyphWidth: 9 })]).toEqual([1])
  })

  it('boş satır için sıfır verir', () => {
    expect([...reachableWidths(tokenize(''), {})]).toEqual([0])
  })
})

describe('commonWidths', () => {
  it('tüm satırların ulaşabildiği genişlikleri verir', () => {
    const lines = ['oo', 'ooo'].map((t) => tokenize(t))
    const common = commonWidths(lines, { maxGlyphWidth: 9 })
    for (const w of common) {
      for (const l of lines) expect(reachableWidths(l, { maxGlyphWidth: 9 }).has(w)).toBe(true)
    }
    expect(common.length).toBeGreaterThan(0)
  })

  it('her satırın doğal genişliğinden küçük hedef önermez', () => {
    const lines = ['o', 'oooo'].map(tokenize)
    const common = commonWidths(lines, { maxGlyphWidth: 9 })
    const widest = Math.max(...lines.map(naturalWidth))
    expect(Math.min(...common)).toBeGreaterThanOrEqual(widest)
  })

  it('ulaşılamıyorsa boş döner', () => {
    // 'ı' genişleyemez, tek başına bir satır olarak başka satıra uyamaz
    expect(commonWidths([tokenize('ı'), tokenize('ooo')], { maxGlyphWidth: 9 })).toEqual([])
  })
})

describe('solveLine', () => {
  it('hedef genişliği tam tutturur', () => {
    const tokens = tokenize('oooo')
    const target = 20
    const chosen = solveLine(tokens, target, { maxGlyphWidth: 9 })
    expect(chosen).not.toBeNull()
    expect(lineWidth(tokens, chosen.map((v) => v.w))).toBe(target)
  })

  it('ulaşılamayan hedef için null döner', () => {
    expect(solveLine(tokenize('ı'), 50, { maxGlyphWidth: 9 })).toBeNull()
  })

  it('genişlemeyi harflere dağıtır, tek harfi şişirmez', () => {
    // 4 harfe 4 birim dağıtılacak: her harf 1 büyümeli, biri 4 değil.
    const tokens = tokenize('oooo')
    const natural = naturalWidth(tokens)
    const chosen = solveLine(tokens, natural + 4, { maxGlyphWidth: 9 })
    expect(chosen.map((v) => v.w)).toEqual([4, 4, 4, 4])
  })

  it('doğal genişlikte hiç genişletme yapmaz', () => {
    const tokens = tokenize('bana')
    const chosen = solveLine(tokens, naturalWidth(tokens), { maxGlyphWidth: 9 })
    expect(chosen.every((v) => !v.derived)).toBe(true)
  })
})

describe('justify', () => {
  it('tüm satırları aynı genişliğe getirir', () => {
    const r = justify('hak bir gönül verdi bana\nha demeyen hayran olur\nbir dem gelir giryan olur')
    expect(r.ok).toBe(true)
    const widths = r.lines.map((l) => l.width)
    expect(new Set(widths).size).toBe(1)
    expect(widths[0]).toBe(r.target)
  })

  it('istenen hedef genişliği kullanır', () => {
    const r = justify('bana\nolur', { target: 30 })
    expect(r.ok).toBe(true)
    expect(r.lines.every((l) => l.width === 30)).toBe(true)
  })

  it('ulaşılamayan hedefte başarısız olmaz, boşluk bırakıp bildirir', () => {
    // Eskiden burada hata veriyordu. Artık genişlik MÜMKÜN OLDUĞUNCA
    // eşitleniyor; yetişemeyen satır kendi en geniş halinde kalıp artan
    // payını bildiriyor.
    const r = justify('ı\nolur', { maxGlyphWidth: 9 })
    expect(r.ok).toBe(true)
    expect(r.slack).toBeGreaterThan(0)
    expect(r.warnings.join(' ')).toMatch(/ulaş/i)
  })

  it('tek satırı doğal genişliğinde bırakır', () => {
    const r = justify('bana')
    expect(r.ok).toBe(true)
    expect(r.lines[0].width).toBe(naturalWidth(tokenize('bana')))
  })

  it('boşlukları asla esnetmez', () => {
    const r = justify('ab cd\nolur bana')
    expect(r.ok).toBe(true)
    for (const line of r.lines) {
      expect(lineWidth(line.tokens, line.items.map((i) => i.variant.w))).toBe(r.target)
    }
  })
})

describe('pins — elle sabitlenen harf genişlikleri', () => {
  it('sabitlenen harf o genişlikte kalır', () => {
    const r = justify('bana\nolur', { pinsByLine: { 0: { 0: 6 } } })
    expect(r.ok).toBe(true)
    expect(r.lines[0].items[0].variant.w).toBe(6)
  })

  it('sabitleme ulaşılabilir genişlikleri daraltır', () => {
    const wide = justify('bana\nolur')
    const pinned = justify('bana\nolur', { pinsByLine: { 0: { 0: 6 } } })
    expect(pinned.candidates.length).toBeLessThan(wide.candidates.length)
  })

  it('sabitleme sonrası kalan harfler hedefi tutturur', () => {
    const r = justify('bana\nolur', { pinsByLine: { 0: { 0: 5 } } })
    expect(r.ok).toBe(true)
    expect(new Set(r.lines.map((l) => l.width)).size).toBe(1)
  })
})

describe('justify: false — hizalama kapalı', () => {
  it('satırları doğal genişliğinde bırakır', () => {
    const r = justify('bana\nolur bana', { justify: false })
    expect(r.ok).toBe(true)
    expect(r.lines[0].width).toBe(naturalWidth(tokenize('bana')))
    expect(r.lines[1].width).toBe(naturalWidth(tokenize('olur bana')))
  })

  it('kapalıyken bile sabitlemeye uyar', () => {
    const r = justify('bana', { justify: false, pinsByLine: { 0: { 0: 6 } } })
    expect(r.lines[0].items[0].variant.w).toBe(6)
  })
})

describe('justify: genişlik mümkün olduğunca eşit', () => {
  it('ortak genişlik varsa hepsini tam o genişliğe getirir', () => {
    const r = justify('bana\nolur')
    expect(r.ok).toBe(true)
    expect(r.lines.every((l) => l.slack === 0)).toBe(true)
  })

  it('ortak genişlik yoksa başarısız olmaz, boşluk bırakır', () => {
    // 'ı' genişleyemez; uzun satırla ortak genişlik yok.
    const r = justify('ı\nolurbana')
    expect(r.ok).toBe(true)
    expect(r.lines.some((l) => l.slack > 0)).toBe(true)
  })

  it('artan payı satır satır bildirir', () => {
    const r = justify('ı\nolurbana')
    expect(r.warnings.join(' ')).toMatch(/artan pay/i)
    expect(r.slack).toBeGreaterThan(0)
  })

  it('hiçbir satır hedefi aşmaz', () => {
    const r = justify('ı\nolurbana')
    for (const l of r.lines) expect(l.width).toBeLessThanOrEqual(r.target)
  })

  it('kısa satır hedefin içine yaslanır', () => {
    const left = compose('ı\nolurbana', { align: 'left' })
    const right = compose('ı\nolurbana', { align: 'right' })
    expect(left.width).toBe(right.width)
    const minX = (c) => c.lines[0].x
    expect(minX(right)).toBeGreaterThan(minX(left))
  })
})
