import { describe, it, expect } from 'vitest'
import { fromAscii, toAscii, validate } from './grid.js'
import { columnsOf, duplicableColumns, widen, widthLadder } from './derive.js'

const g = (...rows) => ({ cells: fromAscii(rows.join('\n')), w: rows[0].length, h: rows.length })
const art = (cells) => toAscii(cells).split('\n')

describe('columnsOf', () => {
  it('sütunları dolu satır kümesi olarak verir', () => {
    expect(columnsOf(g('##', '#.', '##'))).toEqual([
      new Set([0, 1, 2]),
      new Set([0, 2])
    ])
  })
})

describe('duplicableColumns', () => {
  it("'o' biçiminde yalnız iç sütunu çoğaltılabilir sayar", () => {
    const o = g('###', '#.#', '#.#', '###')
    expect(duplicableColumns(o)).toEqual([1])
  })

  it('tek başına dikey gövde oluşturan sütunu reddeder', () => {
    // Orta sütun her satırda dolu ve komşuları boş: çoğaltılırsa gövde kalınlaşır.
    const i = g('.#.', '.#.', '.#.')
    expect(duplicableColumns(i)).toEqual([])
  })

  it('boş sütunu çoğaltılabilir saymaz', () => {
    const split = g('#.#', '#.#')
    expect(duplicableColumns(split)).toEqual([])
  })
})

describe('widen', () => {
  it("'o'yu bir birim genişletir, sayacı büyütür", () => {
    const o = g('###', '#.#', '#.#', '###')
    expect(art(widen(o, 1).cells)).toEqual(['####', '#..#', '#..#', '####'])
  })

  it('iki birim genişletir', () => {
    const o = g('###', '#.#', '###')
    expect(art(widen(o, 2).cells)).toEqual(['#####', '#...#', '#####'])
  })

  it('çoğaltılabilir sütun yoksa null döner', () => {
    expect(widen(g('.#.', '.#.'), 1)).toBeNull()
  })

  it('sonuç her zaman değişmezleri korur', () => {
    const letters = [
      g('###', '#.#', '#.#', '###', '#..', '#.#', '#.#', '#.#', '###'),
      g('###', '#..', '#..', '###'),
      g('#.#', '#.#', '#.#', '###')
    ]
    for (const l of letters) {
      for (let n = 1; n <= 4; n++) {
        const wide = widen(l, n)
        if (!wide) continue
        expect(validate(wide.cells, { requireConnected: false }).ok).toBe(true)
        expect(wide.w).toBe(l.w + n)
        expect(wide.h).toBe(l.h)
      }
    }
  })

  it('genişletmeyi sütunlara dağıtır, hep aynısını şişirmez', () => {
    // İki ayrı sayacı olan biçim: iki birim eklenince her sayaç bir büyür.
    const two = g('#####', '#.#.#', '#####')
    expect(art(widen(two, 2).cells)).toEqual(['#######', '#..#..#', '#######'])
  })
})

describe('widthLadder', () => {
  it('taban genişlikten hedefe kadar her genişliği verir', () => {
    const o = g('###', '#.#', '###')
    const ladder = widthLadder(o, 6)
    expect([...ladder.keys()]).toEqual([3, 4, 5, 6])
    expect(ladder.get(3)).toBe(o)
    expect(ladder.get(5).w).toBe(5)
  })

  it('genişletilemeyen biçim için yalnız kendi genişliğini verir', () => {
    const i = g('#', '#', '#')
    expect([...widthLadder(i, 5).keys()]).toEqual([1])
  })
})
