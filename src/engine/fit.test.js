import { describe, it, expect } from 'vitest'
import { fromAscii, toAscii } from './grid.js'
import {
  bandFill,
  pockets,
  scoreBlock,
  place,
  pairPlacements,
  clearance,
  NORMAL_GAP
} from './fit.js'

const G = (...rows) => fromAscii(rows.join('\n'))
const H = 9

// Ustanın afişinden gerçek biçimler.
const hFull = G('#.#', '#.#', '#.#', '#.#', '###', '#.#', '#.#', '#.#', '#.#')
const aRef = G('###', '#.#', '#.#', '..#', '###', '#.#', '#.#', '#.#', '###')
const iFull = G('#', '.', '#', '#', '#', '#', '#', '#', '#')
const iShort = G('#', '.', '#', '#', '#', '#')
const oShort = G('###', '#.#', '#.#', '###')

describe('bandFill', () => {
  it('bandı baştan sona dolduran biçimi geçirir', () => {
    expect(bandFill(hFull, H)).toMatchObject({ ok: true, topGap: 0 })
  })

  it('üstte boşluk kalan biçimi yakalar', () => {
    // 6 yüksekliğinde glif 9'luk banda tabana oturunca üstte 3 boşluk kalır.
    const r = bandFill(iShort, H)
    expect(r.ok).toBe(false)
    expect(r.topGap).toBe(3)
  })

  it('tam boy i geçer — ustanın kullandığı biçim', () => {
    expect(bandFill(iFull, H).ok).toBe(true)
  })

  it('kısa gliflerde boşluk hep üstte toplanır — her şey tabana oturur', () => {
    expect(bandFill(oShort, H)).toMatchObject({ ok: false, topGap: 5 })
  })
})

describe('pockets', () => {
  it("'o' biçiminin kapalı sayacını bulur", () => {
    const p = pockets(G('###', '#.#', '###'))
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ area: 1, enclosed: true })
  })

  it('kenara açık cebi kapalı saymaz', () => {
    const p = pockets(G('###', '#..', '###'))
    expect(p[0].enclosed).toBe(false)
    expect(p[0].openRight).toBe(true)
  })

  it('cep alanını doğru ölçer', () => {
    const p = pockets(G('#####', '#...#', '#...#', '#####'))
    expect(p[0].area).toBe(6)
  })
})

describe('scoreBlock', () => {
  it('ustanın biçimlerini kusursuz sayar', () => {
    for (const g of [hFull, aRef, iFull]) {
      const s = scoreBlock(g, H)
      expect(s.ok, toAscii(g)).toBe(true)
      expect(s.errors).toEqual([])
    }
  })

  it('bandı doldurmayan biçimi hatalı sayar ve boşluğu bildirir', () => {
    const s = scoreBlock(iShort, H)
    expect(s.ok).toBe(false)
    expect(s.errors.join(' ')).toMatch(/üst/i)
    expect(s.topGap).toBe(3)
  })

  it('köşeden birleşen biçimi reddeder', () => {
    const s = scoreBlock(G('#.', '.#'), 2)
    expect(s.ok).toBe(false)
    expect(s.errors.join(' ')).toMatch(/köşe/i)
  })
})

describe('place', () => {
  it('varsayılan ilerleme sol glif genişliği + 1 hücredir', () => {
    const r = place(hFull, aRef, 3 + NORMAL_GAP, { bandHeight: H })
    expect(r.ok).toBe(true)
    expect(r.width).toBe(7)
    // aradaki sütun tamamen boş
    expect(toAscii(r.cells).split('\n').every((row) => row[3] === '.')).toBe(true)
  })

  it('çakışan yerleşimi reddeder', () => {
    expect(place(hFull, aRef, 1, { bandHeight: H }).ok).toBe(false)
  })

  it('köşeden birleşmeye yol açan yerleşimi reddeder', () => {
    // Sol glifin üst-sağ ucu ile sağ glifin alt-sol ucu çapraz karşılaşır.
    const left = G('##', '#.')
    const right = G('.#', '##')
    expect(place(left, right, 2, { bandHeight: 2 }).ok).toBe(false)
  })

  it('harfler birbirine değiyorsa varsayılan olarak reddeder', () => {
    // Harf arası 1 birim değişmez; kaynaşma ancak açıkça istenirse.
    const left = G('#.', '#.', '##')
    const right = G('.#', '.#', '.#')
    const r = place(left, right, 2, { bandHeight: 3 })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/değiyor/)
  })

  it('izin verilince kaynaşmayı kabul eder ve işaretler', () => {
    const left = G('#.', '#.', '##')
    const right = G('.#', '.#', '.#')
    // place her glifi kendi kutusuna normalize eder: sağ glif 1 sütuna iner.
    const r = place(left, right, 2, { bandHeight: 3, allowContact: true })
    expect(r.ok).toBe(true)
    expect(r.fused).toBe(true)
    expect(r.interlocked).toBe(true)
    expect(r.width).toBe(3)
  })

})

describe('pairPlacements', () => {
  it('iki harf için geçerli yerleşimleri üretir ve puanlar', () => {
    const list = pairPlacements('h', 'a', { bandHeight: H })
    expect(list.length).toBeGreaterThan(0)
    for (const p of list) {
      expect(p.ok).toBe(true)
      expect(p.score).toBeTypeOf('number')
    }
  })

  it('en iyi yerleşim bandı dolduran ve boşluğu az olandır', () => {
    const [best] = pairPlacements('h', 'a', { bandHeight: H })
    expect(best.bandOk).toBe(true)
  })

  it('kenetlenmiş yerleşimler normalden dar olur', () => {
    const list = pairPlacements('l', 'i', { bandHeight: H, allowInterlock: true })
    const normal = list.filter((p) => !p.interlocked)
    const inter = list.filter((p) => p.interlocked)
    if (inter.length && normal.length) {
      expect(Math.min(...inter.map((p) => p.width))).toBeLessThan(
        Math.min(...normal.map((p) => p.width))
      )
    }
  })

  it('kenetlenme kapalıyken yalnız tam boşluklu yerleşim döner', () => {
    const list = pairPlacements('h', 'a', { bandHeight: H, allowInterlock: false })
    expect(list.every((p) => !p.interlocked)).toBe(true)
  })

  it('her yerleşim bandı doldurur — kural bloğa ait', () => {
    const list = pairPlacements('l', 'i', { bandHeight: H })
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((p) => p.bandOk)).toBe(true)
  })

  it('kısa glif komşusunun boşluğuna yuvalanabilir', () => {
    // 'i' kısa varyantı tek başına bandı doldurmaz ama 'l' ile birlikte dolar.
    const list = pairPlacements('l', 'i', { bandHeight: H, allowNesting: true })
    expect(list.some((p) => p.right.h < H)).toBe(true)
  })

  it('yuvalama kapalıyken her glif tabana oturur', () => {
    const list = pairPlacements('l', 'i', { bandHeight: H, allowNesting: false })
    expect(list.every((p) => !p.nested)).toBe(true)
  })

  it('bant yüksekliği değiştirilebilir', () => {
    for (const bh of [7, 9, 11]) {
      const list = pairPlacements('h', 'a', { bandHeight: bh })
      for (const p of list) expect(p.height).toBeLessThanOrEqual(bh)
    }
  })

  it('aynı sonucu veren yerleşimi bir kez döner', () => {
    const list = pairPlacements('h', 'a', { bandHeight: H })
    const sigs = list.map((p) => p.cells.map((c) => c.join(',')).sort().join('|'))
    expect(new Set(sigs).size).toBe(sigs.length)
  })
})

describe('place: leftCount', () => {
  it('sağ glifin hücrelerinin nerede başladığını bildirir', () => {
    const r = place(hFull, aRef, 4, { bandHeight: H })
    expect(r.leftCount).toBe(hFull.length)
    expect(r.cells.length).toBe(hFull.length + aRef.length)
  })
})

describe('clearance — açıklık tam 1 birim', () => {
  it('değen hücrelerde 0 verir', () => {
    expect(clearance([[0, 0]], [[1, 0]])).toBe(0)
  })

  it('köşeden temas da 0 sayılır', () => {
    expect(clearance([[0, 0]], [[1, 1]])).toBe(0)
  })

  it('arada tam bir hücre varsa 1 verir', () => {
    expect(clearance([[0, 0]], [[2, 0]])).toBe(1)
    expect(clearance([[0, 0]], [[0, 2]])).toBe(1)
  })

  it('uzak duranlarda 2+ verir', () => {
    expect(clearance([[0, 0]], [[4, 0]])).toBe(3)
  })

  it('en yakın çifti bulur', () => {
    expect(clearance([[0, 0], [9, 9]], [[2, 0], [20, 20]])).toBe(1)
  })
})

describe('place: açıklık kuralı', () => {
  it('2 birim uzaktaki yerleşimi reddeder', () => {
    const r = place(hFull, aRef, 5, { bandHeight: H })
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/açıklık/)
  })

  it('tam 1 birimlik yerleşimi kabul eder ve açıklığı bildirir', () => {
    const r = place(hFull, aRef, 4, { bandHeight: H })
    expect(r.ok).toBe(true)
    expect(r.clearance).toBe(1)
  })

  it('denetim kapatılabilir', () => {
    expect(place(hFull, aRef, 5, { bandHeight: H, requiredClearance: null }).ok).toBe(true)
  })
})

describe('pairPlacements: açıklık', () => {
  it('her yerleşimde açıklık tam 1 birimdir', () => {
    for (const [a, b] of [['l', 'i'], ['h', 'a'], ['b', 'i'], ['r', 'g']]) {
      for (const p of pairPlacements(a, b, { bandHeight: H })) {
        expect(p.clearance, `${a}+${b}`).toBe(1)
      }
    }
  })
})
