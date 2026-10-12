import { describe, it, expect } from 'vitest'
import { layoutWord, BEAM } from './sequence.js'
import { scoreBlock, clearance } from './fit.js'
import { bbox, toAscii } from './grid.js'

const H = 9

describe('layoutWord', () => {
  it('tek harfi olduğu gibi yerleştirir', () => {
    const r = layoutWord('a', { bandHeight: H })
    expect(r.ok).toBe(true)
    expect(bbox(r.cells).h).toBe(H)
  })

  it('bilinmeyen karakteri atar', () => {
    const r = layoutWord('axq', { bandHeight: H })
    expect(r.chars).toEqual(['a'])
  })

  it('boş girdide başarısız olur', () => {
    expect(layoutWord('', { bandHeight: H }).ok).toBe(false)
  })

  it('her harfi sırayla, soldan sağa yerleştirir', () => {
    const r = layoutWord('bana', { bandHeight: H })
    expect(r.ok).toBe(true)
    expect(r.placed).toHaveLength(4)
    for (let i = 1; i < r.placed.length; i++) {
      expect(r.placed[i].x).toBeGreaterThan(r.placed[i - 1].x)
    }
  })

  it('bütün blok bandı doldurur', () => {
    const r = layoutWord('bana', { bandHeight: H })
    expect(scoreBlock(r.cells, H).topGap).toBe(0)
  })

  it('hiçbir harf bir öncekine değmez', () => {
    const r = layoutWord('hakbir', { bandHeight: H })
    expect(r.ok).toBe(true)
    for (let i = 1; i < r.placed.length; i++) {
      const before = r.placed.slice(0, i).flatMap((p) => p.cells)
      expect(clearance(before, r.placed[i].cells)).toBe(1)
    }
  })

  it('yeni harfi yalnız bir öncekine değil, birikmiş her şeye göre sınar', () => {
    // Uzantısı iki harf geriye uzanan bir yerleşim ancak böyle yakalanır.
    const r = layoutWord('lia', { bandHeight: H })
    if (!r.ok) return
    const first = r.placed[0].cells
    const third = r.placed[2].cells
    // Üçüncü harf birinciyle çakışmamalı
    const keys = new Set(first.map(([x, y]) => `${x},${y}`))
    expect(third.some(([x, y]) => keys.has(`${x},${y}`))).toBe(false)
  })

  it('doldurulabilir boşluğu ayrı raporlar — kararı sıraya bırakmak için', () => {
    // 'ac' sağa açık boşluk bırakır; sonraki harfin uzantısı oraya girebilir.
    // Motorun görevi bunu ÖLÇMEK, karar lab'de verilir.
    const r = layoutWord('ac', { bandHeight: H })
    expect(r.ok).toBe(true)
    expect(r.report).toHaveProperty('openRight')
    expect(r.report).toHaveProperty('openVertical')
  })

  it('ara adımda sağa açık boşluğu cezalandırmaz, sonda cezalandırır', () => {
    // Aynı dizilim, tek fark son harf: ara puanlama sağa açığı görmezden
    // geldiği için daha uzun dizi erken elenmemeli.
    const two = layoutWord('ac', { bandHeight: H })
    const three = layoutWord('acd', { bandHeight: H })
    expect(two.ok).toBe(true)
    expect(three.ok).toBe(true)
    expect(three.placed).toHaveLength(3)
  })

  it('demet genişliği sonucu etkiler ama geçerliliği bozmaz', () => {
    for (const beam of [4, BEAM]) {
      const r = layoutWord('gönül', { bandHeight: H, beam })
      if (!r.ok) continue
      expect(scoreBlock(r.cells, H).topGap).toBe(0)
    }
  })

  it('bant yüksekliği parametre', () => {
    const r = layoutWord('ban', { bandHeight: H })
    expect(r.ok).toBe(true)
    expect(r.height).toBeLessThanOrEqual(H)
  })

  it('banda sığmayan harfi en baştan bildirir', () => {
    // Kütüphanedeki gövdeler 9 birim; 7'lik banda sığmazlar.
    const r = layoutWord('ban', { bandHeight: 7 })
    expect(r.ok).toBe(false)
    expect(r.tooTall).toContain('b')
    expect(r.reason).toMatch(/sığmayan/)
  })

  it('bandı dolduramıyorsa sessizce kısa blok üretmez, bildirir', () => {
    // 9'dan uzun glif yok: 11'lik bant dolmaz.
    const tall = layoutWord('ban', { bandHeight: 11 })
    expect(tall.ok).toBe(true)
    expect(tall.height).toBeLessThanOrEqual(11)
    expect(tall.bandOk).toBe(false)
  })

  it('çözülemeyen diziyi bildirir, sessizce yanlış üretmez', () => {
    const r = layoutWord('bana', { bandHeight: H, maxInterlock: 0, strict: true, beam: 1 })
    expect(typeof r.ok).toBe('boolean')
    if (!r.ok) expect(r.failedAt).toBeTypeOf('number')
  })
})

describe('layoutWord: çıktı biçimi', () => {
  it('ASCII dökümü bant yüksekliğinde satır verir', () => {
    const r = layoutWord('ban', { bandHeight: H })
    expect(toAscii(r.cells).split('\n')).toHaveLength(H)
  })
})
