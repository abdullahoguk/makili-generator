// Kelimeyi bütün olarak dizer.
//
// Çift çift karar vermek yetmiyor. Bir yerleşim tek başına bakıldığında
// "olmaz" görünebilir ama sonraki harfin uzantısı o boşluğa girerse kabul
// edilebilir hale gelir — örneğin 'ac'nin altında kalan boşluğu, göbeği dar
// bir 'd' doldurabilir. Karar ancak sırayı gördükten sonra verilebilir.
//
// Bu yüzden arama demet (beam) aramasıdır: her adımda kısmi dizilimlerin en
// iyileri saklanır, yeni harf BİRİKMİŞ BÜTÜN MÜREKKEBE karşı sınanır (yalnız
// bir öncekine değil), ve asıl puan dizi bittiğinde kesilir — o noktada hangi
// boşlukların dolmadan kaldığı belli olur.

import { bbox, key, toSet, cornerTouches } from './grid.js'
import { has } from './glyphs.js'
import {
  bandVariants,
  pairPlacements,
  scoreBlock,
  clearance,
  NORMAL_GAP,
  BAND_HEIGHT
} from './fit.js'
import { applyDecisions, hasDecisions } from './decisions.js'

/** Varsayılan demet genişliği. Büyütmek sonucu iyileştirir, yavaşlatır. */
export const BEAM = 48

const DEFAULTS = {
  bandHeight: BAND_HEIGHT,
  beam: BEAM,
  maxInterlock: 3,
  allowNesting: true,
  allowContact: false,
  requiredClearance: 1,
  strict: false,
  // Lab'de verilmiş çift kararlarına uy. Kapatmak arama uzayını açar.
  useDecisions: true
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)

/**
 * Onaylanmış çift yerleşimleri; sağ glifin hücreleri sol glifin kökenine göre.
 * Sonuç önbelleklenir — dizi çözücü aynı çifti çok kez sorar.
 */
const stepCache = new Map()

function approvedSteps(a, b, o) {
  const key = `${a}${b}|${o.bandHeight}|${o.maxInterlock}|${o.allowNesting}|${o.allowContact}|${o.strict}`
  const hit = stepCache.get(key)
  if (hit) return hit

  const all = pairPlacements(a, b, {
    bandHeight: o.bandHeight,
    allowNesting: o.allowNesting,
    allowContact: o.allowContact,
    maxInterlock: o.maxInterlock,
    strict: o.strict,
    limit: 400
  })
  const steps = applyDecisions(a, b, all, o.bandHeight).map((p) => ({
    advance: p.advance,
    left: p.left,
    right: {
      ...p.right,
      // place() sağ glifi zaten konumlamıştı; sol glifin kökenine göre al.
      cells: p.cells.slice(p.leftCount)
    }
  }))
  stepCache.set(key, steps)
  return steps
}

/**
 * Yeni glifin birikmiş mürekkebe göre geçerliliği.
 *
 * Değme (açıklık 0) yasak, uzak durma (açıklık 2+) yasak: tam 1 olmalı.
 * Birikmiş kümeyle çakışma da yasak. Köşe kuralı birleşik küme üzerinde.
 */
function admits(accCells, accSet, glyphCells, o) {
  for (const [x, y] of glyphCells) {
    if (accSet.has(key(x, y))) return null // çakışma
  }

  const gap = clearance(accCells, glyphCells)
  if (!o.allowContact && gap === 0) return null
  if (o.requiredClearance != null && gap !== o.requiredClearance) return null

  const merged = [...accCells, ...glyphCells]
  if (cornerTouches(merged).length) return null
  return merged
}

/**
 * @param {string} word
 * @param {object} options bkz. DEFAULTS
 * @returns {{ ok, chars, cells, placed, score, failedAt }}
 */
export function layoutWord(word, options = {}) {
  const o = { ...DEFAULTS, ...options }
  const chars = [...word.toLowerCase()].filter((c) => c !== ' ' && has(c))

  if (!chars.length) {
    return {
      ok: false,
      reason: 'çizilebilir karakter yok',
      chars: [], cells: [], placed: [], score: Infinity, failedAt: 0
    }
  }

  // Banda sığmayan harf varsa en baştan söyle — dikey germe henüz yok.
  const tooTall = [...new Set(chars)].filter(
    (c) => bandVariants(c, o.bandHeight).length === 0
  )
  if (tooTall.length) {
    return {
      ok: false,
      reason: `${o.bandHeight} birimlik banda sığmayan harf: ${tooTall.join(' ')}`,
      tooTall,
      chars, cells: [], placed: [], score: Infinity, failedAt: 0
    }
  }

  // Başlangıç: ilk harfin bütün duruşları.
  let beam = []
  for (const v of bandVariants(chars[0], o.bandHeight)) {
    const b = bbox(v.cells)
    const tops = o.allowNesting
      ? range(0, o.bandHeight - b.h)
      : [o.bandHeight - b.h]
    for (const top of tops) {
      const cells = v.cells.map(([x, y]) => [x - b.x, y - b.y + top])
      beam.push({
        cells,
        set: toSet(cells),
        placed: [{ char: chars[0], id: v.id, x: 0, top, w: b.w, h: b.h, cells }],
        right: b.w
      })
    }
  }
  beam = prune(beam, o)

  for (let i = 1; i < chars.length; i++) {
    const char = chars[i]
    const prev = chars[i - 1]

    // Bu çift için onaylanmış yerleşimler varsa yalnız onlar denenir.
    // Kararlar (sol varyant, sağ varyant, ilerleme, hizalar) dörtlüsünü
    // sabitlediği için arama o çiftte tek bir dala iner.
    const approved =
      o.useDecisions && hasDecisions(prev, char)
        ? approvedSteps(prev, char, o)
        : null

    const variants = bandVariants(char, o.bandHeight)
    const next = []

    for (const state of beam) {
      if (approved) {
        for (const step of approved) {
          const last = state.placed[state.placed.length - 1]
          if (last.char !== prev || last.id !== step.left.id || last.top !== step.left.top) continue
          const cells = step.right.cells.map(([x, y]) => [x + last.x, y])
          const merged = admits(state.cells, state.set, cells, o)
          if (!merged) continue
          next.push({
            cells: merged,
            set: toSet(merged),
            placed: [
              ...state.placed,
              {
                char,
                id: step.right.id,
                x: last.x + step.advance,
                top: step.right.top,
                w: step.right.w,
                h: step.right.h,
                cells
              }
            ],
            right: Math.max(state.right, last.x + step.advance + step.right.w)
          })
        }
        continue
      }

      for (const v of variants) {
        const b = bbox(v.cells)
        const tops = o.allowNesting
          ? range(0, o.bandHeight - b.h)
          : [o.bandHeight - b.h]
        const normal = state.right + NORMAL_GAP
        const lowest = Math.max(1, normal - o.maxInterlock)

        for (const top of tops) {
          for (let adv = normal; adv >= lowest; adv--) {
            const cells = v.cells.map(([x, y]) => [x - b.x + adv, y - b.y + top])
            const merged = admits(state.cells, state.set, cells, o)
            if (!merged) continue

            next.push({
              cells: merged,
              set: toSet(merged),
              placed: [
                ...state.placed,
                { char, id: v.id, x: adv, top, w: b.w, h: b.h, cells }
              ],
              right: Math.max(state.right, adv + b.w)
            })
          }
        }
      }
    }

    if (!next.length) {
      // Buraya kadar geleni döndür; nerede tıkandığını söyle.
      const best = beam[0]
      return {
        ok: false,
        chars,
        cells: best?.cells ?? [],
        placed: best?.placed ?? [],
        score: Infinity,
        failedAt: i,
        failedChar: char
      }
    }
    beam = prune(next, o)
  }

  const best = beam[0]
  const s = scoreBlock(best.cells, o.bandHeight)
  const b = bbox(best.cells)
  return {
    ok: true,
    chars,
    cells: best.cells,
    placed: best.placed,
    width: b.w,
    height: b.h,
    // Bant doldu mu? Kütüphanede bant yüksekliğine yetişen glif yoksa
    // dolmaz — dikey germe henüz yok, bunu gizlemek yerine bildiriyoruz.
    bandOk: s.topGap === 0,
    score: finalCost(best, s),
    report: s,
    alternatives: beam.length
  }
}

/**
 * Ara adımlarda eleme ölçütü.
 *
 * Burada SAĞA açık boşluk cezalandırılmaz — sonraki harf onu doldurabilir.
 * Yalnız bir daha kapanamayacak olanlar (üste/alta açık, sola açık) ve
 * genişlik sayılır.
 */
// Bandın üstünde kalan boşluk da delik: blok bandı baştan sona doldurmalı.
// Ölçüye giriyordu ama maliyete hiç girmiyordu — kısa biçim bandın altına
// yaslanınca bedava görünüyor, tek harflik kelime 9 yerine 7 satır
// yüksekliğinde çıkıyordu.
function partialCost(state, o) {
  const s = scoreBlock(state.cells, o.bandHeight)
  return s.topGap * 4 + s.openVertical * 4 + s.openLeft * 3 + s.worstOpen + state.right
}

/** Dizi bittiğinde: artık sağa açık boşluk da doldurulamaz, tam ceza. */
function finalCost(state, s) {
  return (
    s.topGap * 4 +
    s.openVertical * 4 +
    s.openLeft * 3 +
    s.openRight * 3 +
    s.worstOpen * 2 +
    state.right
  )
}

function prune(states, o) {
  for (const st of states) st._c = partialCost(st, o)
  states.sort((a, b) => a._c - b._c)

  // Aynı hücre kümesine farklı yoldan varılmış olabilir.
  const seen = new Set()
  const out = []
  for (const st of states) {
    const sig = st.cells.map(([x, y]) => `${x},${y}`).sort().join('|')
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(st)
    if (out.length >= o.beam) break
  }
  return out
}
