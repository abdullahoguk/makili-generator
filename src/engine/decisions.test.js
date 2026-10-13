import { describe, it, expect } from 'vitest'
import { applyDecisions, hasDecisions, unsolvedPairs } from './decisions.js'
import { pairPlacements } from './fit.js'

const H = 9

describe('applyDecisions', () => {
  it('kararı olmayan çifti olduğu gibi bırakır', () => {
    const list = pairPlacements('z', 'z', { bandHeight: H })
    expect(applyDecisions('z', 'z', list)).toBe(list)
  })

  it('kararı olan çiftte yalnız onaylananları bırakır', () => {
    const list = pairPlacements('g', 'e', { bandHeight: H })
    const kept = applyDecisions('g', 'e', list)
    expect(kept.length).toBeGreaterThan(0)
    expect(kept.length).toBeLessThan(list.length)
  })

  it('onaylananların hepsi gerçekten üretilebiliyor', () => {
    for (const pair of ['ge', 'me', 'ye', 'an', 'ak']) {
      const [a, b] = [...pair]
      const list = pairPlacements(a, b, { bandHeight: H })
      const kept = applyDecisions(a, b, list)
      expect(kept.length, pair).toBeGreaterThan(0)
    }
  })

  it('başka bant yüksekliğinde kararları uygulamaz', () => {
    const list = pairPlacements('g', 'e', { bandHeight: 11 })
    expect(applyDecisions('g', 'e', list, 11)).toBe(list)
  })

  it('hiçbiri eşleşmezse listeyi boşaltmaz', () => {
    // Dar arama: onaylı yerleşim listede olmayabilir; o zaman eleme yapılmaz.
    const list = pairPlacements('g', 'e', { bandHeight: H, maxInterlock: 0, limit: 1 })
    expect(applyDecisions('g', 'e', list).length).toBe(list.length)
  })

  it('çözümsüz çiftleri bildirir', () => {
    expect(unsolvedPairs.has('ad')).toBe(true)
    expect(unsolvedPairs.has('ge')).toBe(false)
  })

  it('hasDecisions karar varlığını söyler', () => {
    expect(hasDecisions('g', 'e')).toBe(true)
    expect(hasDecisions('z', 'z')).toBe(false)
  })
})
