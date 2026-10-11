import { describe, it, expect } from 'vitest'
import { fromAscii, toAscii, cornerTouches, validate, components, bbox, normalize } from './grid.js'

describe('fromAscii / toAscii', () => {
  it('gidiş dönüş aynı kalır', () => {
    const art = ['###', '#.#', '###'].join('\n')
    expect(toAscii(fromAscii(art))).toBe(art)
  })
})

describe('bbox / normalize', () => {
  it('kutuyu ve sol-üst taşımayı doğru hesaplar', () => {
    const cells = [[5, 3], [6, 3], [5, 4]]
    expect(bbox(cells)).toEqual({ x: 5, y: 3, w: 2, h: 2 })
    expect(normalize(cells)).toEqual([[0, 0], [1, 0], [0, 1]])
  })
})

describe('cornerTouches', () => {
  it('yalnız köşeden birleşen çifti yakalar', () => {
    const cells = fromAscii(['#.', '.#'].join('\n'))
    expect(cornerTouches(cells)).toHaveLength(1)
  })

  it('diğer çapraz yönü de yakalar', () => {
    const cells = fromAscii(['.#', '#.'].join('\n'))
    expect(cornerTouches(cells)).toHaveLength(1)
  })

  it('ortak kenar komşusu varsa ihlal saymaz', () => {
    // L biçimi: çapraz çift var ama aralarında dolu bir kenar komşusu da var.
    const cells = fromAscii(['##', '.#'].join('\n'))
    expect(cornerTouches(cells)).toHaveLength(0)
  })

  it('dolu blokta ihlal yok', () => {
    expect(cornerTouches(fromAscii(['###', '###', '###'].join('\n')))).toHaveLength(0)
  })
})

describe('components', () => {
  it('kenar komşuluğuna göre ayırır, çaprazı birleştirmez', () => {
    expect(components(fromAscii(['#.', '.#'].join('\n')))).toHaveLength(2)
    expect(components(fromAscii(['##', '.#'].join('\n')))).toHaveLength(1)
  })
})

describe('validate', () => {
  it('geçerli glifi kabul eder', () => {
    const o = fromAscii(['###', '#.#', '###'].join('\n'))
    expect(validate(o)).toEqual({ ok: true, errors: [] })
  })

  it('köşe temasını reddeder', () => {
    const r = validate(fromAscii(['#.', '.#'].join('\n')))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toContain('köşeden birleşen')
  })

  it('istendiğinde ayrık parçayı reddeder', () => {
    const i = fromAscii(['#', '.', '#'].join('\n'))
    expect(validate(i).ok).toBe(false)
    expect(validate(i, { requireConnected: false }).ok).toBe(true)
  })

  it('boş glifi reddeder', () => {
    expect(validate([]).ok).toBe(false)
  })
})
