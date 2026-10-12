// Uyum motoru — iki harfin yan yana nasıl durduğuna karar vermek için.
//
// Kurallar tahminle değil ölçümle kondu: ustanın afişi (sources/hakbir
// normal.png) hücre grid'ine çevrildi (tools/extract-reference.py) ve 67 blok
// tek tek incelendi. Çıkanlar:
//
//   1. Harf arası TAM 1 hücre. Kelime arası diye bir şey yok — dört satırdaki
//      boş sütun koşularının hepsi 1 genişliğinde.
//   2. Her BLOK hem üst hem alt çizgiye değiyor. 67/67. Kural harfe değil
//      bloğa ait: kısa bir glif, komşusunun iç boşluğuna yuvalanarak
//      kullanılabilir — birlikte oluşturdukları blok bandı doldurduğu sürece.
//   3. Köşeden birleşme yok. 27 benzersiz blokta 0 ihlal.
//   4. 4 satırda 11 kez iki harf kaynaşıyor: biri ötekinin sütununa giriyor,
//      aradaki boşluk yerel olarak korunurken blok tek parça oluyor.
//   5. Açıklık TAM 1 birim: iki kenar arasında ne sıfır (değme) ne iki
//      bırakılır. Harf komşusuna ya da çerçevesine tam bir hücre uzaklıkta
//      durur.
//
// Bu modül 1-3 ve 5'i denetler, 4'ü arar.

import { toSet, key, bbox, cornerTouches, components } from './grid.js'
import { variantsOf, defaultVariant } from './glyphs.js'
import { heightLadder } from './derive.js'

/** Harfler arası nominal boşluk. Değişmez. */
export const NORMAL_GAP = 1

/**
 * İki hücre kümesi arasındaki en yakın açıklık, hücre cinsinden.
 *
 * 0 = değiyorlar (kenardan ya da köşeden), 1 = aralarında tam bir hücre,
 * 2+ = uzaklar. Chebyshev uzaklığı kullanılır: köşe teması da 0 sayılır,
 * çünkü köşeden birleşme zaten yasak.
 */
export function clearance(aCells, bCells) {
  let best = Infinity
  for (const [ax, ay] of aCells) {
    for (const [bx, by] of bCells) {
      const d = Math.max(Math.abs(ax - bx), Math.abs(ay - by))
      if (d < best) best = d
      if (best <= 1) return best - 1
    }
  }
  return best - 1
}

/** Standart bant yüksekliği — ustanın bütün satırları 9 hücre. */
export const BAND_HEIGHT = 9

/**
 * Glif bandı dolduruyor mu?
 *
 * Her glif tabana oturur — ustanın bütün harfleri taban çizgisinde. Dolayısıyla
 * boşluk yalnız üstte kalabilir ve `topGap` tek ölçüdür.
 */
export function bandFill(cells, bandHeight = BAND_HEIGHT) {
  const b = bbox(cells)
  return {
    ok: b.h === bandHeight,
    topGap: Math.max(0, bandHeight - b.h),
    height: b.h
  }
}

/**
 * Glifin kendi kutusu içindeki boş cepler.
 * `enclosed`: hiçbir kenara açılmayan, tamamen çevrili cep (harfin sayacı).
 */
export function pockets(cells) {
  const b = bbox(cells)
  const filled = toSet(cells.map(([x, y]) => [x - b.x, y - b.y]))
  const seen = new Set()
  const out = []

  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const k = key(x, y)
      if (filled.has(k) || seen.has(k)) continue
      const stack = [[x, y]]
      seen.add(k)
      const comp = []
      while (stack.length) {
        const [cx, cy] = stack.pop()
        comp.push([cx, cy])
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue
          const nk = key(nx, ny)
          if (filled.has(nk) || seen.has(nk)) continue
          seen.add(nk)
          stack.push([nx, ny])
        }
      }
      const xs = comp.map((p) => p[0])
      const ys = comp.map((p) => p[1])
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      const openLeft = minX === 0
      const openRight = maxX === b.w - 1
      const openTop = minY === 0
      const openBottom = maxY === b.h - 1
      out.push({
        area: comp.length,
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
        openLeft,
        openRight,
        openTop,
        openBottom,
        enclosed: !openLeft && !openRight && !openTop && !openBottom
      })
    }
  }
  return out
}

/**
 * Bir bloğun kurallara uygunluğu ve boşluk ölçüleri.
 * @returns {{ ok, errors[], topGap, bottomGap, openArea, worstOpen, enclosedArea }}
 */
export function scoreBlock(cells, bandHeight = BAND_HEIGHT) {
  const errors = []

  const corners = cornerTouches(cells)
  if (corners.length) errors.push(`köşeden birleşen ${corners.length} çift`)

  const fill = bandFill(cells, bandHeight)
  if (fill.topGap > 0) errors.push(`üstte ${fill.topGap} hücre boşluk`)

  // Kenara açık cepler yazının dokusunda delik bırakır; kapalı sayaçlar
  // harfin kendi parçasıdır, ceza almaz.
  //
  // Ama hangi yöne açık olduğu önemli: SAĞA açık bir boşluğu sonraki harfin
  // uzantısı doldurabilir, SOLA açığı önceki harf doldurmuş olabilir. Üste
  // ya da alta açık boşluğu ise kimse dolduramaz — bant sınırına bakar.
  const ps = pockets(cells)
  const open = ps.filter((p) => !p.enclosed)
  const openArea = open.reduce((n, p) => n + p.area, 0)

  const side = (pred) => open.filter(pred).reduce((n, p) => n + p.area, 0)

  return {
    ok: errors.length === 0,
    errors,
    topGap: fill.topGap,
    openArea,
    // Yatay komşunun doldurabileceği boşluklar
    openRight: side((p) => p.openRight && !p.openTop && !p.openBottom),
    openLeft: side((p) => p.openLeft && !p.openTop && !p.openBottom),
    // Kimsenin dolduramayacağı boşluklar — bant sınırına açılıyor
    openVertical: side((p) => p.openTop || p.openBottom),
    worstOpen: open.reduce((m, p) => Math.max(m, p.area), 0),
    enclosedArea: ps.filter((p) => p.enclosed).reduce((n, p) => n + p.area, 0),
    parts: components(cells).length
  }
}

/**
 * İki glifin KARŞILIKLI kenarları arasındaki açıklıklar.
 *
 * Her satır için: o satırda ikisinin de mürekkebi varsa, aradaki boşluk kaç
 * hücre? Her sütun için aynısı dikeyde. Kural "iki kenar arasında sadece bir
 * birim boşluk" bu ölçüye bakar — en yakın noktaya değil, karşılaşan her
 * kenara.
 *
 * Harfin kendi açık ağzı (örneğin 'c'nin sağ tarafı) bu ölçüye girmez,
 * çünkü orada karşı tarafta öteki glifin mürekkebi yoktur.
 */
export function facingGaps(aCells, bCells) {
  const byRow = (cells) => {
    const m = new Map()
    for (const [x, y] of cells) {
      const cur = m.get(y)
      if (!cur) m.set(y, [x, x])
      else {
        if (x < cur[0]) cur[0] = x
        if (x > cur[1]) cur[1] = x
      }
    }
    return m
  }
  const byCol = (cells) => {
    const m = new Map()
    for (const [x, y] of cells) {
      const cur = m.get(x)
      if (!cur) m.set(x, [y, y])
      else {
        if (y < cur[0]) cur[0] = y
        if (y > cur[1]) cur[1] = y
      }
    }
    return m
  }

  const rows = []
  const ar = byRow(aCells)
  const br = byRow(bCells)
  for (const [y, a] of ar) {
    const b = br.get(y)
    if (!b) continue
    // hangisi solda
    const gap = a[1] < b[0] ? b[0] - a[1] - 1 : a[0] > b[1] ? a[0] - b[1] - 1 : -1
    rows.push(gap)
  }

  const cols = []
  const ac = byCol(aCells)
  const bc = byCol(bCells)
  for (const [x, a] of ac) {
    const b = bc.get(x)
    if (!b) continue
    const gap = a[1] < b[0] ? b[0] - a[1] - 1 : a[0] > b[1] ? a[0] - b[1] - 1 : -1
    cols.push(gap)
  }

  const all = [...rows, ...cols]
  return {
    rows,
    cols,
    worst: all.length ? Math.max(...all) : 0,
    overlapping: all.some((g) => g < 0)
  }
}

/**
 * İki glifi verilen ilerleme ve dikey kaymayla yan yana koyar.
 *
 * `advance` = sol glifin kökeninden sağ glifin kökenine yatay mesafe.
 *   Normal yerleşim `sol.w + NORMAL_GAP`. Daha küçüğü kenetlenmedir: sağ glif
 *   sol glifin sütunlarına girer.
 * `rightTop` = sağ glifin bant içindeki üst satırı. Varsayılan tabana oturtur.
 *   Daha küçük bir glif komşusunun iç boşluğuna yuvalanırken buradan kayar.
 *
 * Çakışma ya da köşe teması varsa yerleşim reddedilir.
 */
export function place(leftCells, rightCells, advance, opts = {}) {
  const {
    bandHeight = BAND_HEIGHT,
    rightTop = null,
    leftTop = null,
    allowContact = false,
    // En yakın açıklık tam bu kadar olmalı. null = denetleme.
    requiredClearance = 1,
    // Katı kip: karşılaşan HER kenar çifti tam 1 birim olmalı, yalnız en
    // yakını değil. Ustanın kuralının tam okunuşu bu.
    strict = false
  } = opts
  const lb = bbox(leftCells)
  const rb = bbox(rightCells)

  const lDy = leftTop ?? bandHeight - lb.h
  const rDy = rightTop ?? bandHeight - rb.h

  const L = leftCells.map(([x, y]) => [x - lb.x, y - lb.y + lDy])
  const R = rightCells.map(([x, y]) => [x - rb.x + advance, y - rb.y + rDy])

  const set = toSet(L)
  for (const [x, y] of R) {
    if (set.has(key(x, y))) {
      return { ok: false, reason: 'çakışma', cells: [], width: 0 }
    }
  }

  // İki harfin mürekkebi birbirine değiyor mu? Değişmez kural aralarında
  // 1 birim boşluk olması; kaynaşma yalnız açıkça izin verilirse geçerli.
  let contact = 0
  for (const [x, y] of R) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (set.has(key(x + dx, y + dy))) contact++
    }
  }
  if (contact && !allowContact) {
    return { ok: false, reason: 'harfler birbirine değiyor', cells: [], width: 0 }
  }

  // Açıklık tam 1 birim olmalı — ne değsin ne uzakta dursun. Uzak duran
  // harfler arada 2+ hücrelik delik bırakır, dokuyu deler.
  const gap = clearance(L, R)
  if (requiredClearance != null && !contact && gap !== requiredClearance) {
    return {
      ok: false,
      reason: gap > requiredClearance ? `açıklık ${gap} birim, 1 olmalı` : 'harfler çakışıyor',
      cells: [],
      width: 0
    }
  }

  const cells = [...L, ...R]
  const corners = cornerTouches(cells)
  if (corners.length) {
    return { ok: false, reason: `köşeden birleşme (${corners.length})`, cells, width: 0 }
  }

  const facing = facingGaps(L, R)
  if (strict && facing.worst > 1) {
    return {
      ok: false,
      reason: `karşılıklı kenarda ${facing.worst} birim boşluk`,
      cells: [],
      width: 0
    }
  }

  const b = bbox(cells)
  const normal = lb.w + NORMAL_GAP

  // Sağ glif sol glifin sütunlarına giriyor mu
  const interlocked = advance < normal
  // Sağ glif tabandan yukarı kalkmış mı — komşusunun boşluğuna yuvalanma
  const nested = rDy !== bandHeight - rb.h || lDy !== bandHeight - lb.h

  const occupied = new Set(cells.map(([x]) => x))
  const cleanGap = !interlocked && !occupied.has(lb.w)

  return {
    ok: true,
    cells,
    // cells = [...sol, ...sağ]; sağ glifin nerede başladığı, gösterimde
    // iki harfi ayırt edebilmek için.
    leftCount: L.length,
    width: b.w,
    height: b.h,
    advance,
    normalAdvance: normal,
    rightTop: rDy,
    interlocked,
    nested,
    clearance: gap,
    facingWorst: facing.worst,
    fused: contact > 0,
    cleanGap,
    saved: normal - advance
  }
}

/**
 * Harfin banda sığan bütün varyantları — kısalar ve yükseklik türetmesiyle
 * elde edilenler dahil.
 *
 * Yükseklik merdiveni şart: ustanın 'li' kaynaşmasındaki i 1x7, tek başına
 * duran i ise 1x9. Aradaki basamak kütüphanede yok, satır çoğaltmayla
 * türetiliyor.
 *
 * Kısa varyantlar tek başına bandı doldurmaz ama komşusunun boşluğuna
 * yuvalanabilir; eleme tek glif düzeyinde değil, blok düzeyinde yapılır.
 *
 * Hiçbiri sığmıyorsa BOŞ döner — eksikliği gizlemek yerine çağıran hata versin.
 */
const bandCache = new Map()

export function bandVariants(char, bandHeight = BAND_HEIGHT) {
  const k = `${char}|${bandHeight}`
  const hit = bandCache.get(k)
  if (hit) return hit

  const out = []
  const seen = new Set()
  for (const v of variantsOf(char) ?? []) {
    const base = bbox(v.cells).h
    if (base > bandHeight) continue
    for (const [, g] of heightLadder(v, bandHeight)) {
      const sig = g.cells.map(([x, y]) => `${x},${y}`).sort().join('|')
      if (seen.has(sig)) continue
      seen.add(sig)
      out.push({ ...g, id: g.id ?? v.id })
    }
  }
  bandCache.set(k, out)
  return out
}

/**
 * İki harfin bütün geçerli yerleşimleri, iyiden kötüye sıralı.
 *
 * @param {string} a sol harf
 * @param {string} b sağ harf
 * @param {object} o
 *   bandHeight      bant yüksekliği
 *   allowInterlock  kenetlenmiş (dar) yerleşimler de denensin mi
 *   maxInterlock    en fazla kaç hücre kenetlensin
 */
export function pairPlacements(a, b, o = {}) {
  const {
    bandHeight = BAND_HEIGHT,
    allowInterlock = true,
    maxInterlock = 3,
    allowNesting = true,
    requireBandFill = true,
    allowContact = false,
    requiredClearance = 1,
    // Varsayılan katı: ustanın kuralı karşılaşan her kenar için geçerli.
    strict = true,
    limit = 200
  } = o

  const left = bandVariants(a, bandHeight)
  const right = bandVariants(b, bandHeight)
  const out = []
  const seen = new Set()

  for (const lv of left) {
    const lh = bbox(lv.cells).h
    const lw = bbox(lv.cells).w
    const lTops = allowNesting ? range(0, bandHeight - lh) : [bandHeight - lh]

    for (const rv of right) {
      const rh = bbox(rv.cells).h
      const rTops = allowNesting ? range(0, bandHeight - rh) : [bandHeight - rh]
      const normal = lw + NORMAL_GAP
      const lo = allowInterlock ? Math.max(1, normal - maxInterlock) : normal

      for (const leftTop of lTops) {
        for (const rightTop of rTops) {
          for (let adv = normal; adv >= lo; adv--) {
            const p = place(lv.cells, rv.cells, adv, {
              bandHeight,
              leftTop,
              rightTop,
              allowContact,
              requiredClearance,
              strict
            })
            if (!p.ok) continue

            const s = scoreBlock(p.cells, bandHeight)
            // Blok bandı doldurmalı — kural harfe değil bloğa ait.
            if (requireBandFill && s.topGap > 0) continue

            // Aynı hücre kümesine farklı yoldan varılabiliyor; bir kez göster.
            const sig = p.cells.map(([x, y]) => `${x},${y}`).sort().join('|')
            if (seen.has(sig)) continue
            seen.add(sig)

            out.push({
              ...p,
              left: { char: a, id: lv.id, w: lw, h: lh, top: leftTop },
              right: { char: b, id: rv.id, w: bbox(rv.cells).w, h: rh, top: rightTop },
              bandOk: s.topGap === 0,
              openArea: s.openArea,
              openRight: s.openRight,
              openLeft: s.openLeft,
              openVertical: s.openVertical,
              worstOpen: s.worstOpen,
              parts: s.parts,
              score: cost(p, s)
            })
          }
        }
      }
    }
  }
  return out.sort((x, y) => x.score - y.score).slice(0, limit)
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)

/**
 * Yerleşim maliyeti — küçük daha iyi.
 *
 * Ağırlıklar ustanın işinden okundu: bandı doldurmak pazarlık konusu değil
 * (67/67), açık boşluk dokuyu deler, kenetlenme ise tercih edilen bir çözüm
 * (11 kez kullanılmış) ama zorunlu değil.
 */
/**
 * Yerleşim maliyeti — küçük daha iyi.
 *
 * Bandı doldurmamak pazarlık konusu değil (ustanın işinde 67/67). Ondan sonra
 * dokudaki delikler gelir: açık cep ne kadar az ve küçükse o kadar iyi.
 * Genişlik en hafif terim — hizalama zaten genişliği ayrı bir eksen olarak
 * kullanıyor, burada dar olanı körü körüne yeğlemek okunurluğu bozuyor.
 */
/**
 * Yerleşim maliyeti — küçük daha iyi.
 *
 * Boşluklar yönlerine göre ayrı ağırlıkta: sağa açık bir boşluğu sonraki
 * harfin uzantısı doldurabilir, o yüzden hafif cezalandırılır. Üste ya da
 * alta açık boşluğu kimse dolduramaz, ağır cezalandırılır. Çift tek başına
 * bakıldığında "olmaz" görünen bir yerleşim, dizide kabul edilebilir olabilir
 * — karar sırayı gördükten sonra verilir (bkz. sequence.js).
 */
function cost(placement, s) {
  return (
    s.topGap * 100 +
    Math.max(0, (placement.facingWorst ?? 1) - 1) * 20 +
    s.openVertical * 4 +
    s.openRight * 1 +
    s.openLeft * 3 +
    s.worstOpen * 2 +
    placement.width
  )
}
