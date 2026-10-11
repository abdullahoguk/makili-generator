import { describe, it, expect } from 'vitest'
import { outline } from './outline.js'
import { fromAscii } from '../grid.js'

const ring = (art) => outline(fromAscii(art.join('\n')))

describe('outline', () => {
  it('tek hücre dört köşeli bir halka verir', () => {
    const rings = ring(['#'])
    expect(rings).toHaveLength(1)
    expect(rings[0]).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]])
  })

  it('eş doğrultulu noktaları eler', () => {
    // 3x1 şerit: 4 köşe, ara noktalar atılmalı.
    expect(ring(['###'])[0]).toHaveLength(4)
  })

  it('deliği ayrı halka olarak verir', () => {
    const rings = ring(['###', '#.#', '###'])
    expect(rings).toHaveLength(2)
    expect(rings.map((r) => r.length).sort()).toEqual([4, 4])
  })

  it('deliğin yönü dışın tersidir', () => {
    const [a, b] = ring(['###', '#.#', '###'])
    expect(Math.sign(area(a))).toBe(-Math.sign(area(b)))
  })

  it('ayrık parçalar ayrı halka verir', () => {
    expect(ring(['#.#'])).toHaveLength(2)
  })

  it('L biçiminin tek halkası altı köşelidir', () => {
    expect(ring(['##', '#.'])[0]).toHaveLength(6)
  })

  it('kütüphanedeki her glif kapalı halkalar üretir', async () => {
    const { default: lib } = await import('../../data/glyphs.json', { with: { type: 'json' } })
    for (const [char, variants] of Object.entries(lib.glyphs)) {
      for (const v of variants) {
        const rings = outline(v.cells)
        expect(rings.length, `${char} ${v.id}`).toBeGreaterThan(0)
        for (const r of rings) expect(r.length, `${char} ${v.id}`).toBeGreaterThanOrEqual(4)
      }
    }
  })
})

/** İşaretli alan — sarım yönünü belirler. */
function area(ring) {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}
