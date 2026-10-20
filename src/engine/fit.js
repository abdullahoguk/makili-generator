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
import { heightLadder, widthLadder } from './derive.js'

/** Harfler arası nominal boşluk. Değişmez. */
export const NORMAL_GAP = 1

/**
 * Bir glifin üstünde/altındaki boşluğa HARF sığması için gereken en az
 * yükseklik: 1 birim açıklık + en kısa harfin 3 satırı.
 *
 * Bu bir YASAK değil, ölçü. Yasak olan yalnız 1 satırlık boşluk (aşağıya
 * bakın); 2-3 satır harf almaz ama tasarımın parçası olabilir — ustanın
 * 'li' ve 'rg' kaynaşmalarında öyle.
 */
export const MIN_FILLABLE_GAP = 4

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
  const b = bbox(cells)
  const filled = toSet(cells.map(([x, y]) => [x - b.x, y - b.y]))

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

  // Bir hücre KALINLIĞINDAKİ boşluklar kuralın kendisidir: harfler arası
  // kanal, sayaç yarığı, aksan boşluğu. Kusur ancak boşluk iki hücre
  // kalınlaşınca başlar — gözün delik gördüğü yer.
  //
  // Kalınlık, cebin sınırlayıcı kutusuyla ÖLÇÜLEMEZ: L biçiminde bir kanal
  // her yerinde bir hücre ince olduğu halde kutusu geniş çıkar. Doğru ölçü
  // yerel: boş bir hücre, tamamen boş bir 2x2 karenin parçasıysa kalındır.
  const empty = new Set()
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) if (!filled.has(key(x, y))) empty.add(key(x, y))
  }
  const thick = new Set()
  for (let y = 0; y < b.h - 1; y++) {
    for (let x = 0; x < b.w - 1; x++) {
      const quad = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]
      if (quad.every(([qx, qy]) => empty.has(key(qx, qy)))) {
        for (const [qx, qy] of quad) thick.add(key(qx, qy))
      }
    }
  }
  // Kapalı sayaçlar harfin kendi parçası; onları saymıyoruz.
  const enclosedCells = new Set()
  for (const p of ps) {
    if (!p.enclosed) continue
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) if (empty.has(key(x, y))) enclosedCells.add(key(x, y))
    }
  }

  // Kenara SATIRI BOYUNCA erişilebilen hücreler de sayılmaz: orayı komşu
  // harf ya da uzantısı doldurur. Ustanın 'r' 4w, 't' 7w, 'z' 9w biçimleri
  // tam böyle — yanı boydan boya açık.
  //
  // Bu ayrım olmadan ölçü, elle çizilmiş geçerli blokları "geniş delik"
  // diye eliyordu: 77 çizimin 11'i yalnız bu yüzden kusurlu görünüyordu.
  const sideOpen = new Set()
  for (let y = 0; y < b.h; y++) {
    let L = 0
    while (L < b.w && !filled.has(key(L, y))) L++
    let R = b.w - 1
    while (R >= 0 && !filled.has(key(R, y))) R--
    for (let x = 0; x < L; x++) sideOpen.add(key(x, y))
    for (let x = R + 1; x < b.w; x++) sideOpen.add(key(x, y))
  }

  let wide = 0
  // Sayılan delik hücrelerinin kendisi de veriliyor: dizgi, bir çiftin
  // deliğini SÜTUN ŞERİDİNE göre bölüştürmek için hangi hücrenin nerede
  // olduğunu bilmek zorunda. Toplam sayı aynı kalıyor.
  const voidCells = new Set()
  for (const k of thick) {
    if (enclosedCells.has(k) || sideOpen.has(k)) continue
    wide++
    voidCells.add(k)
  }

  return {
    voidCells,
    ok: errors.length === 0,
    errors,
    topGap: fill.topGap,
    openArea,
    // Yatay komşunun doldurabileceği boşluklar
    openRight: side((p) => p.openRight && !p.openTop && !p.openBottom),
    openLeft: side((p) => p.openLeft && !p.openTop && !p.openBottom),
    // Kimsenin dolduramayacağı boşluklar — bant sınırına açılıyor
    openVertical: side((p) => p.openTop || p.openBottom),
    wideVoid: wide,
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
 * Bir glifin TEK BAŞINA bıraktığı boşluk.
 *
 * Harfin kendi açık ağzı (n'nin altı, u'nun üstü, c'nin sağı) bir kusur değil,
 * biçimin kendisidir. Bir çifti değerlendirirken bunları ceza saymak harfleri
 * kendi tasarımları yüzünden cezalandırmak olur; ölçülmesi gereken, yan yana
 * gelmenin ÜRETTİĞİ fazladan boşluktur.
 */
const intrinsicCache = new Map()

export function intrinsicVoid(cells, bandHeight = BAND_HEIGHT, id = null) {
  const key = id ? `${id}|${bandHeight}` : null
  if (key && intrinsicCache.has(key)) return intrinsicCache.get(key)

  const b = bbox(cells)
  const lifted = cells.map(([x, y]) => [x - b.x, y - b.y + (bandHeight - b.h)])
  const s = scoreBlock(lifted, bandHeight)
  const out = {
    vertical: s.openVertical,
    left: s.openLeft,
    right: s.openRight,
    wide: s.wideVoid
  }
  if (key) intrinsicCache.set(key, out)
  return out
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
    // Katı kip: karşılaşan HER kenar çifti tam 1 birim olmalı.
    //
    // VARSAYILAN KAPALI. Bu, "açıklık tam 1 birim" kuralının fazla düz
    // okunuşuydu: harflerin içeri çekilmiş kısımları var ('e'nin bir satırı
    // geri çekilir) ve orada açıklık doğal olarak 1'den büyük olur. Elle
    // çizilmiş bloklar bunu gösterdi — katı kip onların çoğunu eliyordu.
    //
    // Kuralın doğru karşılığı iki ölçüde: en yakın açıklık tam 1 (clearance)
    // ve hiçbir yerde iki hücre kalınlığında boşluk kalmaması (wideVoid).
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

  // Bir glifin üstünde ya da altında TAM BİR SATIR boşluk kalamaz.
  //
  // Oraya girecek ne varsa yandan gelir ve araya 1 birim açıklık ister.
  // Boşluğun yüksekliğine göre:
  //
  //   1 satır  ölü — açıklıktan sonra yer kalmıyor, giren yapışır
  //   2 satır  1 açıklık + 1 satırlık bir KOL: büyük t'nin kolu girebilir
  //   3 satır  harf almaz ama kapalı cebin parçası olabilir
  //   4+       1 açıklık + en kısa harf (3 satır): küçük c, n sığar
  //
  // Yasak bu yüzden yalnız tek satıra. Ustanın 'li' ve 'rg' kaynaşmaları
  // 2-3 satırlık boşluk taşıyor; onları elemek yanlış olurdu.
  for (const [dy, h] of [[lDy, lb.h], [rDy, rb.h]]) {
    if (dy === 1 || bandHeight - (dy + h) === 1) {
      return { ok: false, reason: 'üstte/altta doldurulamayan 1 satır boşluk', cells: [], width: 0 }
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

/** Bu boy bantta yasal olarak durabiliyor mu? (1 satırlık boşluk yasağı) */
export function placeableHeight(h, bandHeight = BAND_HEIGHT) {
  for (let top = 0; top + h <= bandHeight; top++) {
    if (top === 1 || bandHeight - (top + h) === 1) continue
    return true
  }
  return false
}

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
      // Bantta hiç yasal duruşu olmayan boylar havuza girmesin. Glifin
      // üstünde ya da altında tam 1 satır boşluk kalamaz; 9'luk bantta
      // 8 birimlik biçimin iki duruşu da bu yüzden yasak (üste yaslanırsa
      // altta, bir aşağı inerse üstte tek satır kalıyor). Böyle biçimler
      // yalnız place()'in reddettiği dallar üretiyordu — 230 bant
      // varyantının 34'ü.
      if (!placeableHeight(bbox(g.cells).h, bandHeight)) continue
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
    strict = false,
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

            // Harflerin kendi açık ağızlarını düş; kalan, bu yerleşimin
            // ürettiği fazladan boşluktur.
            const li = intrinsicVoid(lv.cells, bandHeight, lv.id)
            const ri = intrinsicVoid(rv.cells, bandHeight, rv.id)
            const excess = {
              vertical: Math.max(0, s.openVertical - li.vertical - ri.vertical),
              left: Math.max(0, s.openLeft - li.left - ri.left),
              right: Math.max(0, s.openRight - li.right - ri.right),
              // Asıl ölçü: harflerin kendi geniş boşluklarını düştükten sonra
              // yan yana gelmenin ürettiği geniş delik.
              wide: Math.max(0, s.wideVoid - li.wide - ri.wide)
            }

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
              // Asıl ölçü: yan yana gelmenin ÜRETTİĞİ boşluk.
              wideVoid: s.wideVoid,
              excessWide: excess.wide,
              excessVertical: excess.vertical,
              excessLeft: excess.left,
              excessRight: excess.right,
              worstOpen: s.worstOpen,
              parts: s.parts,
              score: cost(p, s, excess)
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
function cost(placement, s, excess) {
  return (
    s.topGap * 100 +
    Math.max(0, (placement.facingWorst ?? 1) - 1) * 20 +
    // Harflerin kendi ağızları değil, yerleşimin ürettiği fazlalık cezalanır;
    // ve yalnız GENİŞ boşluk delik sayılır — bir hücrelik açıklık kuraldır.
    excess.wide * 6 +
    excess.vertical * 2 +
    excess.right * 1 +
    excess.left * 2 +
    placement.width
  )
}

// --------------------------------------------------------------- boşluk uydurma
//
// Çift çift onaylamak ölçeklenmiyor: 29 harf, 841 çift, her çiftte yüzlerce
// yerleşim. Oysa ustanın yaptığı şey kuralla anlatılabilir — bir harfin
// BOŞLUĞUNA komşunun uygun yükseklikteki versiyonu sığıyorsa oraya girer:
//
//   büyük L'nin alt çubuğu sonraki harfin altına uzanır, o harf 2 birim
//   kısalıp üste yaslanarak L'nin göbeğine oturur;
//   büyük t'nin üst kolları önceki ve sonraki harfin üstünü örter, onlar
//   kısalıp tabana yaslanır;
//   kuyruksuz büyük c'nin göbeğine küçük n sığar.
//
// Üçü de aynı ölçü: KENARA AÇIK bir dikdörtgen boşluk + içine 1 birim
// açıklıkla sığan bir varyant. Bu yüzden yerleşimi aramak yerine boşluğun
// geometrisinden TÜRETİYORUZ.

/**
 * Bir biçmin bir kenarına açık dikdörtgen boşlukları.
 *
 * side='right': her satırda sağdan içeri kaç hücre boş. Ardışık satır
 * aralıklarının en dar ortak genişliği o aralığın kullanılabilir kutusudur.
 *
 * @returns {Array<{x, y, w, h}>} kutular, biçmin kendi kutusuna göre
 */
export function cavities(cells, side = 'right') {
  const b = bbox(cells)
  const filled = toSet(cells.map(([x, y]) => [x - b.x, y - b.y]))
  const free = []
  for (let y = 0; y < b.h; y++) {
    let n = 0
    if (side === 'right') {
      let x = b.w - 1
      while (x >= 0 && !filled.has(key(x, y))) { n++; x-- }
    } else {
      let x = 0
      while (x < b.w && !filled.has(key(x, y))) { n++; x++ }
    }
    free.push(n)
  }

  const out = []
  for (let y1 = 0; y1 < b.h; y1++) {
    let w = Infinity
    for (let y2 = y1; y2 < b.h; y2++) {
      w = Math.min(w, free[y2])
      if (w < 2) break // 1 birim açıklık + en az 1 birim glif
      out.push({ x: side === 'right' ? b.w - w : 0, y: y1, w, h: y2 - y1 + 1 })
    }
  }
  return out
}

/**
 * İki harfin YUVALANMIŞ yerleşimleri — boşluk geometrisinden türetilmiş.
 *
 * Arama değil inşa: sol harfin sağa açık her kutusu için, sağ harfin o
 * kutuya 1 birim açıklıkla sığan varyantları doğrudan yerleştirilir.
 * Ardından place() değişmezleri sınar (köşe teması, açıklık, çakışma).
 */
export function nestPlacements(a, bChar, o = {}) {
  const { bandHeight = BAND_HEIGHT, limit = 200, maxWidth = 9 } = o

  // Sol harfin GENİŞLETİLMİŞ biçimleri de havuzda: ustanın 'L'sinde alt
  // çubuk sonraki harfin genişliğine kadar uzuyor, yani boşluk büyüyor.
  // Genişletme yalnız yanı açık biçimlerde yasal (derive.js), tam da bu
  // durum.
  const base = bandVariants(a, bandHeight)
  const left = []
  const seenLeft = new Set()
  for (const v of base) {
    for (const [, g] of widthLadder(v, maxWidth)) {
      if (seenLeft.has(g.id ?? g)) continue
      seenLeft.add(g.id ?? g)
      left.push(g)
    }
  }
  const right = bandVariants(bChar, bandHeight)
  const out = []
  const seen = new Set()

  for (const lv of left) {
    const lb = bbox(lv.cells)
    const lTop = bandHeight - lb.h
    for (const cav of cavities(lv.cells, 'right')) {
      for (const rv of right) {
        const rb = bbox(rv.cells)
        // kutunun soluna 1 birim açıklık, sonra glif
        if (rb.w > cav.w - 1) continue
        if (rb.h > cav.h) continue
        const advance = cav.x + 1
        for (let dy = 0; dy + rb.h <= cav.h; dy++) {
          const rightTop = lTop + cav.y + dy
          if (rightTop + rb.h > bandHeight) continue
          const p = place(lv.cells, rv.cells, advance, {
            bandHeight,
            leftTop: lTop,
            rightTop
          })
          if (!p.ok) continue
          const s = scoreBlock(p.cells, bandHeight)
          if (s.topGap > 0) continue
          const sig = p.cells.map(([x, y]) => `${x},${y}`).sort().join('|')
          if (seen.has(sig)) continue
          seen.add(sig)
          out.push({
            ...p,
            left: { char: a, id: lv.id, w: lb.w, h: lb.h, top: lTop },
            right: { char: bChar, id: rv.id, w: rb.w, h: rb.h, top: rightTop },
            nested: true,
            wideVoid: s.wideVoid,
            cavity: cav
          })
          if (out.length >= limit) return out
        }
      }
    }
  }
  return out
}
