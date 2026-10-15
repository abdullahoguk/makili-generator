import { describe, it, expect } from 'vitest'
import { tokenize, lineWidth, naturalWidth, WORD_GAP, LETTER_GAP } from './layout.js'
import { reachableWidths, commonWidths, solveLine, justify, compose, pairVoid } from './justify.js'
import { widthOptions } from './derive.js'
import { variantsOf, defaultVariant } from './glyphs.js'
import { scoreBlock } from './fit.js'
import { bbox } from './grid.js'

describe('reachableWidths', () => {
  it('tek harf için harfin genişlik merdivenini verir', () => {
    // 'l' esner: boşluğu her satırda sağa açık. 'o' esnemez, sayacı kapalı.
    const r = reachableWidths(tokenize('l'), { maxGlyphWidth: 6 })
    expect([...r].sort((a, b) => a - b)).toEqual([3, 4, 5, 6])
  })

  it('sabit boşlukları toplama katar', () => {
    // iki harf + 1 birim harf arası
    const r = reachableWidths(tokenize('ll'), { maxGlyphWidth: 4 })
    expect(Math.min(...r)).toBe(3 + LETTER_GAP + 3)
    expect(Math.max(...r)).toBe(4 + LETTER_GAP + 4)
  })

  it('kelime arası boşluğu sabit tutar', () => {
    const r = reachableWidths(tokenize('l l'), { maxGlyphWidth: 3 })
    expect([...r]).toEqual([3 + WORD_GAP + 3])
  })

  it('genişleyemeyen harf tek genişlik verir', () => {
    expect([...reachableWidths(tokenize('ı'), { maxGlyphWidth: 9 })]).toEqual([1])
  })

  it('kapalı sayaçlı harf genişleyemez', () => {
    // 'o'nun sayacı çevrili: genişletmek onu 2 hücre yapardı.
    expect([...reachableWidths(tokenize('o'), { maxGlyphWidth: 9 })]).toEqual([3])
  })

  it('boş satır için sıfır verir', () => {
    expect([...reachableWidths(tokenize(''), {})]).toEqual([0])
  })
})

describe('commonWidths', () => {
  it('tüm satırların ulaşabildiği genişlikleri verir', () => {
    const lines = ['ll', 'lll'].map((t) => tokenize(t))
    const common = commonWidths(lines, { maxGlyphWidth: 9 })
    for (const w of common) {
      for (const l of lines) expect(reachableWidths(l, { maxGlyphWidth: 9 }).has(w)).toBe(true)
    }
    expect(common.length).toBeGreaterThan(0)
  })

  it('her satırın doğal genişliğinden küçük hedef önermez', () => {
    const lines = ['l', 'llll'].map(tokenize)
    const common = commonWidths(lines, { maxGlyphWidth: 9 })
    const widest = Math.max(...lines.map(naturalWidth))
    expect(Math.min(...common)).toBeGreaterThanOrEqual(widest)
  })

  it('ulaşılamıyorsa boş döner', () => {
    // 'ı' genişleyemez, tek başına bir satır olarak başka satıra uyamaz
    expect(commonWidths([tokenize('ı'), tokenize('lll')], { maxGlyphWidth: 9 })).toEqual([])
  })
})

describe('solveLine', () => {
  it('hedef genişliği tam tutturur', () => {
    const tokens = tokenize('llll')
    const target = 20
    const chosen = solveLine(tokens, target, { maxGlyphWidth: 9 })
    expect(chosen).not.toBeNull()
    expect(lineWidth(tokens, chosen.map((v) => v.w))).toBe(target)
  })

  it('ulaşılamayan hedef için null döner', () => {
    expect(solveLine(tokenize('ı'), 50, { maxGlyphWidth: 9 })).toBeNull()
  })

  it('genişlemeyi harflere dağıtır, tek harfi şişirmez', () => {
    // 'llll' dört özdeş, yanı tamamen açık harften oluşan yapay bir kelime.
    // wideVoid kenara açık boşluğu artık saymadığı için (komşu doldurur)
    // burada dağılımı eşitlemeye zorlayan bir bedel kalmıyor; sınanan
    // değişmez toplam genişliğin tam tutturulması.
    //
    // Gerçek metinde balonlaşma görülmüyor: varsayılan şiirde harf
    // genişlikleri 3'te kümeleniyor, en geniş 7.
    const tokens = tokenize('llll')
    const natural = naturalWidth(tokens)
    const chosen = solveLine(tokens, natural + 4, { maxGlyphWidth: 9 })
    expect(chosen.map((v) => v.w).reduce((a, b) => a + b, 0)).toBe(12 + 4)

    const real = justify('bir dem gelir şad olur')
    const widths = real.lines[0].items.map((it) => it.variant.w)
    expect(Math.max(...widths)).toBeLessThanOrEqual(7)
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
    // İki satır da 18'e ulaşabiliyor: 'l' ve 'd' esner (lale 15-23, ldc 11-19).
    const r = justify('lale\nldc', { target: 18 })
    expect(r.ok).toBe(true)
    expect(r.lines.every((l) => l.width === 18)).toBe(true)
  })

  it('ulaşılamayan hedefte başarısız olmaz, boşluk bırakıp bildirir', () => {
    // Eskiden burada hata veriyordu. Artık genişlik MÜMKÜN OLDUĞUNCA
    // eşitleniyor; yetişemeyen satır kendi en geniş halinde kalıp artan
    // payını bildiriyor.
    const r = justify('ı\nlale', { maxGlyphWidth: 9 })
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
    // Satırın genişliği, harf genişlikleri + SABİT boşluklardan ibaret.
    // Hedefe ulaşıp ulaşmaması ayrı mesele; boşluk hiçbir durumda esnemez.
    const r = justify('al cd\nlale bana')
    expect(r.ok).toBe(true)
    for (const line of r.lines) {
      expect(lineWidth(line.tokens, line.items.map((i) => i.variant.w))).toBe(line.width)
    }
  })
})

describe('pins — elle sabitlenen harf genişlikleri', () => {
  it('sabitlenen harf o genişlikte kalır', () => {
    // 'l' sabitlenebilir bir genişliğe esneyen harf.
    const r = justify('lale\nbana', { pinsByLine: { 0: { 0: 6 } } })
    expect(r.ok).toBe(true)
    expect(r.lines[0].items[0].variant.w).toBe(6)
  })

  it('sabitleme ulaşılabilir genişlikleri daraltır', () => {
    const wide = justify('lale\nbana')
    const pinned = justify('lale\nbana', { pinsByLine: { 0: { 0: 6 } } })
    expect(pinned.candidates.length).toBeLessThan(wide.candidates.length)
  })

  it('sabitleme sonrası kalan harfler hedefi tutturur', () => {
    const r = justify('lale\nbana', { pinsByLine: { 0: { 0: 5 } } })
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
    const r = justify('lale', { justify: false, pinsByLine: { 0: { 0: 6 } } })
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

describe('doku: aynı genişlikte biçim seçimi', () => {
  it('bir genişlikte birden çok biçim taşınır', () => {
    // 'a'nın bütün biçimleri 3 birim. Tek biçim tutulsaydı elle çizilen
    // varyantlar dizgide hiç görünmezdi.
    const def = defaultVariant('a')
    const pool = (variantsOf('a') ?? []).filter((v) => v.h === def.h)
    const opts = widthOptions(pool, 9)
    expect(opts.get(3).length).toBeGreaterThan(1)
    // Aynı hücre kümesi iki kez listelenmez.
    const sigs = opts.get(3).map((g) => g.cells.map(([x, y]) => `${x},${y}`).sort().join('|'))
    expect(new Set(sigs).size).toBe(sigs.length)
  })

  it('pairVoid yan yana gelmenin ÜRETTİĞİ deliği ölçer, harfin kendi ağzını değil', () => {
    const l = defaultVariant('l')
    // Kendi başına 'l' boşlukludur; kendi ağzı eşleşme bedeline girmemeli.
    expect(pairVoid(l, l)).toBeGreaterThanOrEqual(0)
    expect(pairVoid(null, l)).toBe(0)
    expect(pairVoid(l, null)).toBe(0)
  })

  it('doku bedeli açıkken satırda daha az delik kalır', () => {
    const text = 'hak bir gönül verdi bana\nha demeyen hayran olur'
    const holes = (o) => {
      const r = compose(text, o)
      expect(r.ok).toBe(true)
      let total = 0
      for (const l of r.lines) {
        const line = l.line ?? l
        const cells = []
        for (const it of line.items) {
          const b = bbox(it.variant.cells)
          for (const [x, y] of it.variant.cells) cells.push([x - b.x + it.x, y - b.y + it.y])
        }
        total += scoreBlock(cells, 9).wideVoid
      }
      return total
    }
    const off = holes({ voidCost: 0, densityCost: 0 })
    const on = holes({})
    expect(on).toBeLessThan(off)
  })

  it('doku bedeli hedef genişliği bozmaz', () => {
    const r = compose('hak bir gönül verdi bana\nha demeyen hayran olur')
    expect(r.ok).toBe(true)
    for (const l of r.lines) expect((l.line ?? l).width).toBe(r.target)
  })
})
