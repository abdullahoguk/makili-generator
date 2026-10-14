import { describe, it, expect } from 'vitest'
import { fromAscii, toAscii, validate } from './grid.js'
import {
  columnsOf,
  duplicableColumns,
  widen,
  widthLadder,
  widthOptions,
  heighten,
  heightLadder
} from './derive.js'
import { bbox } from './grid.js'
import library from '../data/glyphs.json' with { type: 'json' }

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
  it("'o' gibi kapalı sayaçlı biçimde hiçbir sütun çoğaltılamaz", () => {
    // Sayacı büyütmek "aralarda yalnız 1 birim boşluk" kuralını çiğner.
    const o = g('###', '#.#', '#.#', '###')
    expect(duplicableColumns(o)).toEqual([])
  })

  it('yanı boydan boya açık biçimde çoğaltmaya izin verir', () => {
    // Ustanın 'r' 4w biçimi: boşluk her satırda sağa açık, komşunun
    // uzantısı girebilir.
    const r = g('###', '#..', '#..', '#..')
    expect(duplicableColumns(r)).toEqual([1, 2])
  })

  it('çentikli sayacı yana açık saymaz', () => {
    // Tek satırdan kenara değen sayaç doldurulamaz: komşu yandan gelir,
    // araya giren dolu hücre yolu keser.
    const c = g('###', '#.#', '#..', '#.#', '###')
    expect(duplicableColumns(c)).toEqual([])
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
  it('kapalı sayacı büyütmez — genişletemiyorsa null döner', () => {
    const o = g('###', '#.#', '#.#', '###')
    expect(widen(o, 1)).toBeNull()
  })

  it('yana açık boşluğu genişletir', () => {
    const r = g('###', '#..', '#..', '###')
    expect(art(widen(r, 2).cells)).toEqual(['#####', '#....', '#....', '#####'])
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

  it('genişletmeyi uygun sütunlara dağıtır, hep aynısını şişirmez', () => {
    // Biri sağa biri sola açık iki boşluk: iki birim eklenince ikisi de büyür.
    const two = g('#####', '#....', '#####', '....#', '#####')
    expect(art(widen(two, 2).cells)).toEqual([
      '#######',
      '#......',
      '#######',
      '......#',
      '#######'
    ])
  })

  it('hiçbir türetme kapanmayan 2×2 boşluk üretmez', () => {
    // Değişmez: boşluk BİR yönde 1 birim kalmalı. Boş 2×2 kare, boşluğun iki
    // yönde birden iki birim olduğu yer demektir. Tek istisna kenara açık
    // yanlar — orayı komşu doldurur.
    //
    // Bütün kütüphane, bütün genişlikler. Sütun çoğaltma eskiden 'a'nın
    // sayacını 2 hücre yapıyordu; bu sınama onu bir daha geçirmez.
    const bad = []
    for (const [char, variants] of Object.entries(library.glyphs)) {
      const tall = variants.filter((v) => v.h === variants[0].h)
      for (const [, list] of widthOptions(tall.length ? tall : variants, 9)) {
        for (const g of list) {
          const b = bbox(g.cells)
          const filled = new Set(g.cells.map(([x, y]) => `${x - b.x},${y - b.y}`))
          // satırı boyunca kenara erişen hücreler: komşu doldurabilir
          const open = new Set()
          for (let y = 0; y < b.h; y++) {
            let L = 0
            while (L < b.w && !filled.has(`${L},${y}`)) L++
            let R = b.w - 1
            while (R >= 0 && !filled.has(`${R},${y}`)) R--
            for (let x = 0; x < L; x++) open.add(`${x},${y}`)
            for (let x = R + 1; x < b.w; x++) open.add(`${x},${y}`)
          }
          for (let y = 0; y + 1 < b.h; y++) {
            for (let x = 0; x + 1 < b.w; x++) {
              const quad = [`${x},${y}`, `${x + 1},${y}`, `${x},${y + 1}`, `${x + 1},${y + 1}`]
              if (quad.some((k) => filled.has(k))) continue
              if (quad.every((k) => open.has(k))) continue
              bad.push(`${char} ${g.id ?? g.source} ${g.w}×${g.h} @${x},${y}`)
            }
          }
        }
      }
    }
    expect(bad).toEqual([])
  })
})

describe('widthLadder', () => {
  it('taban genişlikten hedefe kadar her genişliği verir', () => {
    const r = g('###', '#..', '#..', '###')
    const ladder = widthLadder(r, 6)
    expect([...ladder.keys()]).toEqual([3, 4, 5, 6])
    expect(ladder.get(3)).toBe(r)
    expect(ladder.get(5).w).toBe(5)
  })

  it('kapalı sayaçlı biçim için yalnız kendi genişliğini verir', () => {
    const o = g('###', '#.#', '###')
    expect([...widthLadder(o, 6).keys()]).toEqual([3])
  })

  it('genişletilemeyen biçim için yalnız kendi genişliğini verir', () => {
    const i = g('#', '#', '#')
    expect([...widthLadder(i, 5).keys()]).toEqual([1])
  })
})

describe('heighten / heightLadder', () => {
  it("'i' gövdesini uzatır, noktayı çoğaltmaz", () => {
    const i = g('#', '.', '#', '#', '#', '#')
    const taller = heighten(i, 1)
    expect(art(taller.cells)).toEqual(['#', '.', '#', '#', '#', '#', '#'])
  })

  it('ustanın li kaynaşmasındaki 1x7 i biçimine ulaşır', () => {
    const i = g('#', '.', '#', '#', '#', '#')
    expect(art(heightLadder(i, 7).get(7).cells)).toEqual(
      ['#', '.', '#', '#', '#', '#', '#']
    )
  })

  it("'o' biçimini dikeyde büyütür — sayaç 1 birim geniş kalır", () => {
    // Dikeyde uzamak kurala aykırı değil: ustanın 'o' sayacı 1 geniş, 7 uzun.
    const o = g('###', '#.#', '###')
    expect(art(heighten(o, 2).cells)).toEqual(['###', '#.#', '#.#', '#.#', '###'])
  })

  it('tek başına yatay çubuk olan satırı çoğaltmaz', () => {
    expect(heighten(g('...', '###', '...'), 1)).toBeNull()
  })

  it('sonuç değişmezleri korur', () => {
    const letters = [
      g('###', '#.#', '#.#', '###', '#..', '###', '#.#', '#.#', '###'),
      g('#.#', '#.#', '#.#', '#.#', '###', '#.#', '#.#', '#.#', '#.#')
    ]
    for (const l of letters) {
      for (let n = 1; n <= 3; n++) {
        const t = heighten(l, n)
        if (!t) continue
        expect(validate(t.cells, { requireConnected: false }).ok).toBe(true)
        expect(t.h).toBe(l.h + n)
        expect(t.w).toBe(l.w)
      }
    }
  })
})
