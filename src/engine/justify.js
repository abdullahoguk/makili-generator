// Satırları ortak bir genişliğe getirir.
//
// Harf ve kelime araları değişmez olduğundan tek serbestlik derecesi harf
// genişlikleridir. Bu yüzden:
//
//   1. Her satırın ULAŞILABİLİR genişlik kümesi alt-küme-toplamı ile bulunur.
//   2. Kümeler kesiştirilir — ortak genişlikler.
//   3. Bir hedef seçilir, her satır için en ucuz varyant ataması geri izlemeyle
//      bulunur.
//
// Maliyet karesel: genişletmeyi tek harfe yığmak yerine satıra yaymak için.
// Kesişim boşsa hiçbir kural esnetilmez; hangi satırın nereye ulaşamadığı
// raporlanır.

import { variantsOf, defaultVariant, resolveId } from './glyphs.js'
import { widthOptions } from './derive.js'
import {
  tokenize,
  layoutLine,
  naturalWidth,
  stack,
  spaceFlags,
  LETTER_GAP,
  WORD_GAP
} from './layout.js'
import { joinsFor, rowsFor } from './decisions.js'
import { thickenStack, weightToAmount } from './render/weight.js'
import { scoreBlock, intrinsicVoid, nestPlacements, bandVariants, BAND_HEIGHT } from './fit.js'
import { bbox } from './grid.js'

export const DEFAULTS = {
  maxGlyphWidth: 9, // bir harf en fazla bu kadar geniş olabilir
  maxWiden: 4, // tek harf en fazla bu kadar birim genişletilebilir
  tallOnly: true, // yalnız tam boy gövdeler; kısa varyantlar dizgiyi bozuyor
  // Komşu iki harfin yan yana gelmesinden doğan fazladan deliğin birim
  // bedeli. 0 = eski davranış (yalnız genişliğe bak). 1 birimlik delik, bir
  // harfi 1 birim germekle aynı bedelde.
  //
  // 1.5'i de denedim: iki metinde deliği ~%6 azaltıyor ama genişlemeyi son
  // harfe yığıyor (llll 19 birime 3,3,3,7 diye bölünüyor). Satır sonundaki
  // açık yanı kapatacak komşu olmadığı için orada boşluk bedava görünüyor.
  // Dağılımın yayılması daha önemli; 1'de kalındı.
  voidCost: 1,
  // Biçimin KENDİ boşluğunun birim bedeli. Eşleşme bedeli her glifin kendi
  // ağzını düşer — iki harfi yan yana koymanın ürettiği fazlalığı ölçmek
  // için doğru olan bu. Ama aynı harfin aynı genişlikteki biçimleri
  // arasında seçerken asıl ayırt edici tam o kendi boşluğu: 'a'nın 3 birimlik
  // 11 biçiminden hangisi daha sık dokuyorsa o. Ayrı terim olmasının sebebi
  // bu; ağırlığı daha düşük, yoksa harf kimliğini bastırır.
  //
  // Tarama ile 0.7. Üstü (1, 1.5) ölçülen deliği bir metinde ~%5 azaltıyor
  // ama genişlemeyi tek harfe yığıyor: 'llll' 19 birime 3,3,3,7 diye
  // bölünüyor. Bir harfi devleştirmek görünür bir kusur, ölçülen o kadarlık
  // fark değil — dağılımın yayılması yeğlendi.
  densityCost: 0.7
}

// ---------------------------------------------------------------- doku
//
// Hizalama uzun süre yalnız GENİŞLİĞE baktı: hedefe ulaşan en ucuz genişlik
// ataması. Ama aynı genişlikte birden çok biçim var ve hangisinin doğru
// olduğu komşusuna bağlı — yan yana iki biçim arasında kapanmamış delik
// kalabiliyor. Dizgi hedefi tutturuyor ama doku deliniyordu.
//
// Ölçü lab'dekiyle aynı: iki glifi normal açıklıkla yan yana koy, oluşan
// geniş deliği ölç, her ikisinin KENDİ açık ağzını düş. Kalan, yan yana
// gelmenin ürettiği fazladan boşluktur.

const voidCache = new Map()

/** Biçimin kendi geniş boşluğu — ne kadar seyrek dokuduğu. */
export function ownVoid(glyph, bandHeight = BAND_HEIGHT) {
  return intrinsicVoid(glyph.cells, bandHeight, glyph.id).wide
}


/**
 * Biçimin bir YANINDAKİ açık boşluk — satırın ucunda kapanmayan kısım.
 *
 * Satır ortasında yana açık boşluğu komşu doldurur, bu yüzden wideVoid onu
 * saymaz. Ama satırın SON harfinde sağda, İLK harfinde solda komşu yok:
 * orası dokuda gerçek delik olarak kalır.
 *
 * Bu terim olmadan çözücü bütün genişlemeyi son harfe yığıyordu — orada
 * boşluk bedava görünüyordu ('llll' 19 birime 3,3,3,7 diye bölünüyordu).
 */
const flankCache = new Map()

export function flankVoid(glyph, side, bandHeight = BAND_HEIGHT) {
  const k = `${glyph.id}|${side}|${bandHeight}`
  const hit = flankCache.get(k)
  if (hit !== undefined) return hit

  const b = bbox(glyph.cells)
  const filled = new Set(glyph.cells.map(([x, y]) => `${x - b.x},${y - b.y}`))
  let n = 0
  for (let y = 0; y < b.h; y++) {
    if (side === 'right') {
      let x = b.w - 1
      while (x >= 0 && !filled.has(`${x},${y}`)) { n++; x-- }
    } else {
      let x = 0
      while (x < b.w && !filled.has(`${x},${y}`)) { n++; x++ }
    }
  }
  flankCache.set(k, n)
  return n
}

/**
 * İki glif yan yana konduğunda ARALARINDA kalan fazladan delik.
 *
 * `join` verilmezse ikisi de tabana yaslı, aralık 1 varsayılır. Kenetli ya da
 * kalkık bir yerleşim bambaşka bir geometridir: eskiden burası birleşimi hiç
 * görmediği için her kenetlenme tabana yaslı hâliyle fiyatlanıyordu — çözücü
 * de bedeli yanlış bildiği yerleşimleri seçiyordu.
 */
/** Tek glifin, iki yanı duvarla kapatılmış hâlde bıraktığı delik. */
const sealedCache = new Map()

function sealedVoid(g) {
  const k = g.id
  const hit = sealedCache.get(k)
  if (hit !== undefined) return hit
  // Ölçü glifin KENDİ kutusuyla sınırlı. Bant yüksekliğine göre ölçülünce
  // harfin altında/üstünde kalan boş satırlar da "kendi deliği" sayılıyor
  // ve pairVoid'den düşülüyordu: 'ra'nın altındaki 2x4 boşluk böyle sıfıra
  // iniyordu. Oysa o boşluk harfin özelliği değil, yerleşimin sonucu —
  // komşusu doldurmazsa dokuda delik kalır.
  const b = bbox(g.cells)
  const cells = g.cells.map(([x, y]) => [x - b.x + 1, y - b.y])
  for (let y = 0; y < b.h; y++) cells.push([0, y], [b.w + 1, y])
  const n = scoreBlock(cells, b.h).wideVoid
  sealedCache.set(k, n)
  return n
}

export function pairVoid(left, right, bandHeight = BAND_HEIGHT, join = null) {
  if (!left || !right) return 0
  const lb = bbox(left.cells)
  const rb = bbox(right.cells)
  const advance = join?.advance ?? lb.w + LETTER_GAP
  const lTop = join?.leftTop ?? bandHeight - lb.h
  const rTop = join?.rightTop ?? bandHeight - rb.h

  const k = `${left.id}|${right.id}|${bandHeight}|${advance}|${lTop}|${rTop}`
  const hit = voidCache.get(k)
  if (hit !== undefined) return hit

  const L = left.cells.map(([x, y]) => [x - lb.x + 1, y - lb.y + lTop])
  const R = right.cells.map(([x, y]) => [x - rb.x + advance + 1, y - rb.y + rTop])

  // Yanlar DUVARLA kapatılarak ölçülür. Çift tek başına ölçüldüğünde kenarları
  // açık görünür, scoreBlock da yana ulaşan boşluğu 'doldurulabilir' sayıp
  // bedava geçer; oysa satır ortasında o yanı komşu harf kapatıyor. Kapatmadan
  // ölçülünce kısa biçimler olduğundan ucuz görünüyordu.
  const right0 = advance + Math.max(lb.w, rb.w) + 2
  const wallR = Math.max(right0, 1 + advance + rb.w)
  const walls = []
  for (let y = 0; y < bandHeight; y++) walls.push([0, y], [wallR, y])
  const s = scoreBlock([...walls, ...L, ...R], bandHeight)

  // Delik SÜTUN ŞERİDİNE göre bölüştürülür: bu çift yalnız sol glifin
  // başladığı yerden sağ glifin başladığı yere kadarki sütunlardan
  // sorumlu. Bütün çerçeveyi saymak, her glifi iki kez (solundaki ve
  // sağındaki çiftte) cezalandırıyor ve satır toplamıyla bağı kopuyordu.
  // Sağ glifin kendi şeridini bir sonraki çift sayar; satırın sonunu
  // flankVoid kapatır.
  let out = 0
  for (const k of s.voidCells) {
    const x = Number(k.slice(0, k.indexOf(',')))
    if (x >= 1 && x < 1 + advance) out++
  }
  voidCache.set(k, out)
  return out
}

const cache = new Map()

/** Harfin genişlik -> glif eşlemesi. Türetme pahalı, önbelleklenir. */
function widthsFor(char, opts) {
  const band = opts.bandHeight ?? BAND_HEIGHT
  const k = `${char}|${opts.maxGlyphWidth}|${opts.maxWiden}|${opts.tallOnly}|${band}`
  const hit = cache.get(k)
  if (hit) return hit

  // Havuz BANDA göre kurulur: bandı dolduran biçimler. Eskiden yazılı
  // biçimler varsayılanın boyuna göre süzülüyordu, yani havuz 9'a
  // çakılıydı; 8'lik bantta hiçbir biçim bandı doldurmuyordu. Yükseklik
  // türetmesi de böylece havuza giriyor — kısa iskeletten o banda çıkan
  // biçimler kullanılabiliyor.
  const all = bandVariants(char, band)
  const pool = opts.tallOnly ? all.filter((v) => bbox(v.cells).h === band) : all
  let map = widthOptions(pool.length ? pool : all, opts.maxGlyphWidth)

  // Harfin en dar biçimi bile sınırdan genişse eleme her şeyi siler ve
  // satır hiç kurulamaz. Böyle bir harfte sınır değil harf belirleyicidir.
  if (!map.size) {
    const narrowest = Math.min(...(pool.length ? pool : all).map((v) => v.w))
    map = widthOptions(pool.length ? pool : all, narrowest)
  }

  // Tek harfin aşırı şişmesini engelle.
  const base = Math.min(...map.keys())
  for (const w of [...map.keys()]) {
    if (w - base > opts.maxWiden) map.delete(w)
  }

  cache.set(k, map)
  return map
}

/**
 * İki glif arasındaki olası İLERLEMELER: soldan sağa kaç birim gidilir.
 *
 * Varsayılan sol.w + boşluk. Buna ek olarak, lab'de onaylanmış kenetli ya da
 * tabandan kalkık bir yerleşim varsa onun ilerlemesi de seçenektir — 'li'de
 * 2 birim, çünkü i, l'nin sütunlarına giriyor.
 *
 * Yalnız ONAYLI yerleşimler kullanılıyor. Motor kendi başına kenetlenmeye
 * karar vermiyor: hangi çiftin iç içe geçebileceği tasarım kararı, lab'de
 * verilmiş olanlarla sınırlı.
 */
/**
 * Bir harf çifti için KURALLA türetilmiş yuvalanmalar.
 *
 * nestPlacements boşluğun geometrisinden üretiyor; burada yalnız deliksiz
 * olanlar alınıp birleşim biçimine çevriliyor. Böylece 'l'nin göbeğine
 * giren bir harf için önce lab'de onay vermek gerekmiyor — kural zaten
 * geçerli bir yerleşim olduğunu söylüyor.
 *
 * Çift başına bir kez hesaplanıp saklanıyor; çözücü her geçişte yeniden
 * üretemez, pahalı.
 */
const nestCache = new Map()

function nestJoins(leftChar, rightChar, band) {
  const k = `${leftChar}${rightChar}|${band}`
  let m = nestCache.get(k)
  if (m) return m
  m = new Map()
  for (const p of nestPlacements(leftChar, rightChar, { bandHeight: band, limit: 400 })) {
    if (p.wideVoid !== 0) continue
    const id = `${p.left.id}|${p.right.id}`
    const list = m.get(id) ?? []
    // Aynı biçim çifti için en fazla iki yuvalanma: DP'yi şişirmesin.
    if (list.length >= 2) continue
    list.push({ advance: p.advance, leftTop: p.left.top, rightTop: p.right.top })
    m.set(id, list)
  }
  nestCache.set(k, m)
  return m
}

const joinCache = new Map()

function advanceOptions(leftChar, rightChar, left, right, afterSpace, band = BAND_HEIGHT) {
  const fallback = left.w + (afterSpace ? WORD_GAP : LETTER_GAP)
  const k = `${leftChar}${rightChar}|${left.id}|${right.id}|${afterSpace ? 'w' : 'l'}|${band}`
  const hit = joinCache.get(k)
  if (hit) return hit

  // Varsayılan yerleşimden farkı olmayan onaylı satırlar eklenmez: aynı şeyi
  // iki kez denemek hem boşuna hem de 'kenetli birleşim' sayımını şişirir.
  // Bant boyu artık değişken: buradaki ölçüler de o banda göre. Eskiden
  // BAND_HEIGHT sabiti kullanılıyordu, yani 9 dışındaki bantta doğal
  // hizalar ve boşluk yasağı yanlış hesaplanıyordu.
  const natLeft = band - left.h
  const natRight = band - right.h
  // Bir glifin üstünde/altında tam bir satır boşluk kalamaz — oraya kimse
  // giremez. Dizgi place() çağırmadığı için kural burada da sınanıyor.
  const badGap = (top, h) => top === 1 || band - (top + h) === 1

  const out = badGap(natLeft, left.h) || badGap(natRight, right.h)
    ? []
    : [{ advance: fallback, leftTop: null, rightTop: null, approved: false }]

  for (const j of joinsFor(`${leftChar}${rightChar}`, left.id, right.id)) {
    const same = j.advance === fallback && j.leftTop === natLeft && j.rightTop === natRight
    if (same) continue
    if (badGap(j.leftTop, left.h) || badGap(j.rightTop, right.h)) continue
    out.push({ ...j, approved: true })
  }
  // Kuralla türetilen yuvalanmalar: onay beklemeden kullanılabilir.
  for (const j of nestJoins(leftChar, rightChar, band).get(`${left.id}|${right.id}`) ?? []) {
    if (j.advance === fallback && j.leftTop === natLeft && j.rightTop === natRight) continue
    if (badGap(j.leftTop, left.h) || badGap(j.rightTop, right.h)) continue
    if (out.some((o) => o.advance === j.advance && o.leftTop === j.leftTop && o.rightTop === j.rightTop)) continue
    out.push({ ...j, approved: false, nested: true })
  }

  // Hiçbir birleşim kalmadıysa varsayılanı geri koy: satır hiç kurulamazsa
  // kural değil dizgi kırılır.
  if (!out.length) out.push({ advance: fallback, leftTop: null, rightTop: null, approved: false })
  joinCache.set(k, out)
  return out
}

/**
 * Onaylı birleşimlerin ATIFTA BULUNDUĞU biçimleri aday havuzuna ekler.
 *
 * Gerek şu: dizgi havuzu tam boy gövdelerle sınırlı ('kısa varyantlar
 * dizgiyi bozuyor'), oysa kenetlenmenin gerektirdiği biçim çoğu zaman kısa
 * ya da yükseklik türetmesi — ustanın 'li' kaynaşmasındaki i 1x7. O biçim
 * havuzda olmadığı için onaylı kenetlenme hiç ateşlenemiyordu.
 *
 * Çözüm, havuzu gevşetmek değil: yalnız ONAYLI bir birleşimin adı geçen
 * biçimleri, yalnız geçtiği konuma eklemek. Kısa biçim başıboş dolaşamaz,
 * ancak kendisi için onaylanmış komşulukta kullanılabilir.
 *
 * @returns {Array<Map<number, object[]>>} konum -> genişlik -> biçimler
 */
function injectionsFor(chars, band = BAND_HEIGHT) {
  const out = chars.map(() => new Map())
  const add = (i, g) => {
    if (!g) return
    // Enjeksiyon bant süzgecini atlıyordu: 7'lik bantta kararlardan gelen
    // 9 satırlık biçimler havuza giriyor ve çıktı sessizce 9 satır
    // oluyordu. Banda sığmayan biçim hiçbir koşulda kullanılamaz.
    if (bbox(g.cells).h > band) return
    const list = out[i].get(g.w) ?? []
    if (!list.some((x) => x.id === g.id)) list.push(g)
    out[i].set(g.w, list)
  }
  for (let i = 1; i < chars.length; i++) {
    const pair = `${chars[i - 1].char}${chars[i].char}`
    for (const row of rowsFor(pair)) {
      add(i - 1, resolveId(row[0]))
      add(i, resolveId(row[1]))
    }
    // Kuralla türetilen kenetlenmeler de biçim ister. Bunların çoğu BANDI
    // DOLDURMAYAN kısa biçimler — 'l'nin göbeğine giren alçak 'i' gibi — ve
    // widthsFor onları tallOnly ile eliyor. Kısa biçimi havuza topluca açmak
    // dokuyu bozuyor (deliği 255'ten 468'e çıkarıyor): tek başına duran kısa
    // harf altında kapanmayan boşluk bırakıyor. O yüzden yalnız TEMİZ bir
    // kenetlenmeye katılan biçim, yalnız o konumda açılıyor.
    for (const [ids] of nestJoins(chars[i - 1].char, chars[i].char, band)) {
      const [leftId, rightId] = ids.split('|')
      add(i - 1, resolveId(leftId))
      add(i, resolveId(rightId))
    }
  }
  return out
}

/** Satırın sabit boşluk toplamı — varyant seçiminden bağımsız. */
function gapTotal(tokens) {
  let gaps = 0
  let prev = null
  for (const t of tokens) {
    if (t.type === 'space') { gaps += WORD_GAP; prev = 'space'; continue }
    if (prev === 'glyph') gaps += LETTER_GAP
    prev = 'glyph'
  }
  return gaps
}

const glyphsOf = (tokens) => tokens.filter((t) => t.type === 'glyph')

/**
 * Bir harfin seçilebilir genişlikleri. `pin` verilmişse o harf o genişliğe
 * sabitlenmiştir — kullanıcı elle seçtiğinde çözücü ona dokunmaz.
 */
function optionsFor(char, index, opts) {
  let map = widthsFor(char, opts)

  // Onaylı birleşimlerin istediği biçimler — yalnız bu konumda.
  const inject = opts.injected?.[index]
  if (inject?.size) {
    map = new Map([...map].map(([w, list]) => [w, [...list]]))
    for (const [w, list] of inject) {
      const cur = map.get(w) ?? []
      for (const g of list) if (!cur.some((x) => x.id === g.id)) cur.push(g)
      map.set(w, cur)
    }
  }

  const pin = opts.pins?.[index]
  if (pin == null) return map

  // Sabitleme iki biçimde gelir: yalnız genişlik (sayı) ya da genişlik +
  // biçim kimliği. Kimlik varsa TAM O BİÇİM kullanılır — aynı genişlikte
  // birden çok biçim olduğu için yalnız genişliği sabitlemek yetmiyor,
  // çözücü başkasını seçebiliyordu.
  const w = typeof pin === 'object' ? pin.w : pin
  const list = map.get(w)
  if (!list) return map
  if (typeof pin === 'object' && pin.id) {
    const exact = list.find((g) => g.id === pin.id)
    if (exact) return new Map([[w, [exact]]])
  }
  return new Map([[w, list]])
}

/** Bir harfin o anki seçeneklerinden ilki — varsayılan biçim. */
const firstOf = (map, w) => map.get(typeof w === 'object' ? w.w : w)?.[0] ?? null

/** Satırın ulaşabildiği toplam genişlikler. */
export function reachableWidths(tokens, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const chars = glyphsOf(tokens)
  if (!chars.length) return new Set([0])
  const space = spaceFlags(tokens)
  const band = opts.bandHeight ?? BAND_HEIGHT
  opts.injected = opts.injected ?? injectionsFor(chars, band)

  // Durum: (glifin sol kenarı, seçilen biçim). Kenetlenme ilerlemeyi
  // değiştirdiği için genişlik artık yalnız genişliklerin toplamı değil.
  let states = new Map()
  for (const [w, list] of optionsFor(chars[0].char, 0, opts)) {
    for (const g of list) states.set(`0|${g.id}`, { x: 0, g })
  }

  for (let i = 1; i < chars.length; i++) {
    const map = optionsFor(chars[i].char, i, opts)
    const next = new Map()
    for (const st of states.values()) {
      for (const [, list] of map) {
        for (const g of list) {
          for (const j of advanceOptions(chars[i - 1].char, chars[i].char, st.g, g, space[i], band)) {
            const x = st.x + j.advance
            const k = `${x}|${g.id}`
            if (!next.has(k)) next.set(k, { x, g })
          }
        }
      }
    }
    states = next
    if (!states.size) return new Set()
  }

  const out = new Set()
  for (const st of states.values()) out.add(st.x + st.g.w)
  return out
}

/** Tüm satırların ortaklaşa ulaşabildiği genişlikler, küçükten büyüğe. */
export function commonWidths(lines, options = {}) {
  if (!lines.length) return []
  const sets = lines.map((t, i) =>
    reachableWidths(t, { ...options, pins: options.pinsByLine?.[i] })
  )
  const [first, ...rest] = sets
  return [...first].filter((w) => rest.every((s) => s.has(w))).sort((a, b) => a - b)
}

/**
 * Satırın hedefi aşmayan en büyük ulaşılabilir genişliği.
 * Tam hedefe yetişemeyen satırlar buraya kadar gider, kalanı boşluk olur.
 */
export function bestWidthUpTo(tokens, target, options = {}) {
  const reach = [...reachableWidths(tokens, options)].filter((w) => w <= target)
  return reach.length ? Math.max(...reach) : null
}

/**
 * Hedef genişliği tam tutturan en ucuz varyant atamasını bulur.
 * @returns glif dizisi, ya da hedefe ulaşılamıyorsa null
 */
export function solveLine(tokens, target, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const chars = glyphsOf(tokens)
  opts.injected = opts.injected ?? injectionsFor(chars, opts.bandHeight ?? BAND_HEIGHT)
  if (!chars.length) return target === 0 ? Object.assign([], { joins: [] }) : null

  const maps = chars.map((t, i) => optionsFor(t.char, i, opts))
  const bases = maps.map((m) => Math.min(...m.keys()))
  const band = opts.bandHeight ?? BAND_HEIGHT
  const voidCost = opts.voidCost ?? DEFAULTS.voidCost
  const densityCost = opts.densityCost ?? DEFAULTS.densityCost
  const space = spaceFlags(tokens)

  // Durum: (glifin SOL KENARI, seçilen biçim).
  //
  // Eskiden genişliklerin toplamıydı ve boşluklar dışarıdan sabit ekleniyordu.
  // Kenetlenme ilerlemeyi değiştirdiği için bu artık geçerli değil: 'li'de
  // i, l'nin sütunlarına giriyor ve ilerleme 4 yerine 2 oluyor. Sol kenarı
  // taşımak hem kenetli hem normal durumu aynı denklemle anlatıyor.
  //
  // Satır genişliği = son glifin sol kenarı + genişliği.
  let dp = new Map()
  for (const [w, list] of maps[0]) {
    for (const glyph of list) {
      const c =
        stretchCost(w - bases[0], glyph) +
        densityCost * ownVoid(glyph, band) +
        // satır başı: solda komşu yok, yan boşluk kapanmıyor
        voidCost * flankVoid(glyph, 'left', band)
      const k = `0|${glyph.id}`
      const cur = dp.get(k)
      if (!cur || c < cur.cost) dp.set(k, { cost: c, x: 0, glyph, from: null, join: null })
    }
  }
  const layers = [dp]

  for (let i = 1; i < chars.length; i++) {
    // Kalan harfler en dar hallerinde bile ne kadar yer ister?
    //
    // ALT sınır olmalı, yoksa geçerli dallar budanır: kenetlenme ilerlemeyi
    // 1 birime kadar indirebiliyor, dolayısıyla kalan her harf en az 1 birim
    // ilerletir, son harf de kendi en dar genişliğini ekler.
    const rest = chars.length - 1 - i
    const remainingMin = rest + bases[chars.length - 1]
    const next = new Map()

    for (const [prevKey, st] of dp) {
      for (const [w, list] of maps[i]) {
        const stretch = stretchCost(w - bases[i], list[0])
        for (const glyph of list) {
          const base = st.cost + stretch + densityCost * ownVoid(glyph, band)

          for (const j of advanceOptions(
            chars[i - 1].char,
            chars[i].char,
            st.glyph,
            glyph,
            space[i],
            band
          )) {
            const x = st.x + j.advance
            if (x + remainingMin > target) continue
            // Delik bedeli birleşim BAŞINA ölçülür: aynı iki biçim, kenetli
            // konduğunda bambaşka bir delik bırakır.
            // Onaylı kenetlenme küçük bir indirim alır: ustanın fiilen
            // kullandığı biçim, motorun kendi bulduğuna yeğlenir.
            const c =
              base +
              voidCost * pairVoid(st.glyph, glyph, band, j) -
              (j.approved ? 0.5 : 0)
            const k = `${x}|${glyph.id}`
            const cur = next.get(k)
            if (!cur || c < cur.cost) {
              // Kurala dayalı kenetlenmenin de dikey kaydırması saklanmalı;
              // yalnız onaylıları saklamak yuvalanmayı seçip uygulamamak
              // demekti.
              next.set(k, { cost: c, x, glyph, from: prevKey, join: j.leftTop == null ? null : j })
            }
          }
        }
      }
    }
    dp = next
    layers.push(dp)
    if (!dp.size) return null
  }

  // Hedefi tam tutturanlar arasından en ucuzu.
  let best = null
  let bestKey = null
  let bestCost = Infinity
  for (const [k, st] of dp) {
    if (st.x + st.glyph.w !== target) continue
    // satır sonu: sağda komşu yok
    const c = st.cost + voidCost * flankVoid(st.glyph, 'right', band)
    if (c < bestCost) { best = st; bestKey = k; bestCost = c }
  }
  if (!best) return null

  const out = []
  const joins = []
  let key = bestKey
  for (let i = chars.length - 1; i >= 0; i--) {
    const st = layers[i].get(key)
    out.unshift(st.glyph)
    joins.unshift(st.join)
    key = st.from
  }
  // Birleşimler glif dizisine iliştirilir: layoutLine'ın ihtiyacı olan ikinci
  // bilgi bu, ama çağıranların çoğu yalnız biçimlerle ilgileniyor.
  return Object.assign(out, { joins })
}

/**
 * Karesel maliyet: dört harfi birer birim genişletmek (4×1=4), tek harfi dört
 * birim genişletmekten (1×16=16) ucuz. Böylece esneme satıra yayılır.
 * Türetilmemiş varyantlar küçük bir indirim alır — tasarlanmış biçim yeğlenir.
 */
function stretchCost(delta, glyph) {
  return delta * delta + (glyph.derived ? 0.25 : 0)
}

/**
 * Metni satırlara böler, ortak genişliğe hizalar ve yerleştirir.
 *
 * @param {string} text
 * @param {object} options
 *   target        istenen genişlik; verilmezse ortaklardan en uygunu seçilir
 *   align         tek satırda ya da hizalama kapalıyken kullanılır
 *   maxGlyphWidth, maxWiden
 * @returns {{ ok, target, lines, candidates, warnings }}
 */
export function justify(text, options = {}) {
  const opts = { ...DEFAULTS, ...options }
  const raw = text.split('\n')
  const tokenLines = raw.map(tokenize)
  const content = tokenLines.filter((t) => glyphsOf(t).length)
  const warnings = []

  if (!content.length) {
    return { ok: false, target: 0, lines: [], candidates: [], warnings: ['metin boş'] }
  }

  // Bant boyu değişken olduğundan, o banda biçimi olmayan harfler olabilir.
  // Bunu SESSİZCE geçmek en kötüsü: çözücü bir şey bulamayınca varsayılan
  // biçime düşüyor, o da 9 satırlık; 7'lik bant isteyip 9 satırlık çıktı
  // alıyordun. Eksikler baştan, adlarıyla bildiriliyor.
  {
    const band = opts.bandHeight ?? BAND_HEIGHT
    const need = new Set()
    for (const t of content.flatMap(glyphsOf)) {
      if (!bandVariants(t.char, band).some((v) => bbox(v.cells).h === band)) need.add(t.char)
    }
    if (need.size) {
      return {
        ok: false,
        target: 0,
        lines: [],
        candidates: [],
        warnings: [
          `${band} birimlik bandı dolduran biçimi olmayan harf: ${[...need].join(' ')}`
        ],
        missingAtBand: [...need]
      }
    }
  }

  // Hizalama kapalı: her satır doğal genişliğinde, sabitlenenler hariç.
  if (opts.justify === false) {
    const lines = content.map((tokens, li) => {
      const pins = opts.pinsByLine?.[li]
      const line = naturalLine(tokens, { ...opts, pins })
      if (line) return { ...line, tokens }
      // Çözücü bir şey bulamazsa son çare varsayılan biçimler. Bant
      // denetimi yukarıda yapıldığı için buraya ancak başka bir sebeple
      // düşülür; yine de bant dışı bir şey üretmesin.
      const chosen = glyphsOf(tokens).map((t) => defaultVariant(t.char))
      return { ...layoutLine(tokens, chosen, []), tokens }
    })
    return {
      ok: true,
      target: Math.max(...lines.map((l) => l.width)),
      lines,
      candidates: [],
      warnings
    }
  }

  // Tek satır hizalanacak bir şey değil; doğal genişliğinde kalır.
  if (content.length === 1 && opts.target == null) {
    const tokens = content[0]
    const pins = opts.pinsByLine?.[0]
    let line = naturalLine(tokens, { ...opts, pins })
    if (!line) {
      const chosen = glyphsOf(tokens).map((t) => defaultVariant(t.char))
      line = layoutLine(tokens, chosen, [])
    }
    return {
      ok: true,
      target: line.width,
      lines: [{ ...line, tokens }],
      candidates: [...reachableWidths(tokens, { ...opts, pins })].sort((a, b) => a - b),
      warnings
    }
  }

  const candidates = commonWidths(content, opts)

  // Her satırın ULAŞABİLDİĞİ en dar genişlik — sabitlemeler dahil. Doğal
  // genişlik yetmiyor: bir harfi 6 birime sabitlemek satırın asgarisini
  // yükseltir, hedef bunun altında seçilirse o satır hiçbir şeye sığmaz.
  const floors = content.map((t, li) =>
    Math.min(...reachableWidths(t, { ...opts, pins: opts.pinsByLine?.[li] }))
  )
  const widest = Math.max(...floors)

  // Hedef: verilmişse o; ortak genişlik varsa en geniş doğal genişliğe en
  // yakını; yoksa doğrudan en geniş doğal genişlik. Son durumda satırlar
  // yetişebildiği kadar yaklaşır, kalanı boşluk olarak bildirilir.
  let target = opts.target
  if (target == null) {
    target = candidates.length
      ? candidates.reduce((best, w) => (Math.abs(w - widest) < Math.abs(best - widest) ? w : best))
      : widest
  }

  const lines = []
  for (const [li, tokens] of content.entries()) {
    const pins = opts.pinsByLine?.[li]
    let width = target
    let chosen = solveLine(tokens, target, { ...opts, pins })

    if (!chosen) {
      // Tam hedefe yetişemiyor: hedefi aşmayan en büyük genişliğe git.
      const fallback = bestWidthUpTo(tokens, target, { ...opts, pins })
      if (fallback == null) {
        warnings.push(
          `${li + 1}. satır ${target} birime sığmıyor; en dar hali bile daha geniş. ` +
            `Genişleyemeyen harfler: ${stuckChars(tokens, opts).join(' ') || '—'}`
        )
        return { ok: false, target, lines: [], candidates, warnings }
      }
      width = fallback
      chosen = solveLine(tokens, fallback, { ...opts, pins })
      if (!chosen) {
        warnings.push(`${li + 1}. satır çözülemedi.`)
        return { ok: false, target, lines: [], candidates, warnings }
      }
    }

    const line = { ...layoutLine(tokens, chosen, chosen.joins), tokens }
    line.slack = target - line.width
    lines.push(line)
  }

  const short = lines.filter((l) => l.slack > 0)
  if (short.length) {
    warnings.push(
      `${short.length} satır hedefe tam ulaşamadı. Artan pay: ` +
        lines
          .map((l, i) => (l.slack ? `${i + 1}. satır ${l.slack}` : null))
          .filter(Boolean)
          .join(', ') +
        '. Hizalamayı seç ya da boşluğa dekoratif blok koy.'
    )
  }

  return { ok: true, target, lines, candidates, warnings, slack: short.length }
}

/** Genişlik merdiveni tek basamaklı olan harfler — hizalamayı kilitleyenler. */
function stuckChars(tokens, opts) {
  const stuck = new Set()
  for (const t of glyphsOf(tokens)) {
    if (widthsFor(t.char, opts).size === 1) stuck.add(t.char)
  }
  return [...stuck]
}

/**
 * Hizalanmış satırları tek hücre kümesine istifler.
 *
 * `weight` 1'den büyükse istif alt-hücre çözünürlüğüne taşınır ve her glif
 * tek tek kalınlaştırılır; dönen `resolution` renderSvg'ye verilmelidir.
 */
/** Satırın gerçek deliği — yerleşmiş hücreler üzerinden. */
function lineVoid(line, band) {
  const cells = []
  let right = 0
  for (const it of line.items) {
    const b = bbox(it.variant.cells)
    for (const [x, y] of it.variant.cells) cells.push([x - b.x + it.x + 1, y - b.y + it.y])
    right = Math.max(right, it.x + b.w)
  }
  // Satırın İKİ UCU duvarla kapatılır. scoreBlock yana ulaşan boşluğu
  // "komşu doldurur" diye bedava geçiyor; satırın ucunda komşu yok, orası
  // bitmiş blokun dış hattında bir çentik olarak kalıyor. Kapatmadan
  // ölçülünce 'ra' gibi altı boş biçimler satır başında bedava görünüyordu.
  for (let y = 0; y < band; y++) cells.push([0, y], [right + 1, y])
  return scoreBlock(cells, band).wideVoid
}

/**
 * Hedef genişlik dayatılmadan en iyi satır.
 *
 * Hizalama kapalıyken eskiden her harf için defaultVariant alınıyordu:
 * ne biçim seçimi ne kenetlenme çalışıyordu, bu yüzden 'l' gibi göbekli
 * harfler boşluklu kalıyordu. Artık ulaşılabilir en dar birkaç genişlik
 * denenip deliği en az olan seçiliyor — hizalama açıkken hangi kural
 * geçerliyse kapalıyken de aynısı geçerli.
 */
function naturalLine(tokens, opts) {
  const band = opts.bandHeight ?? BAND_HEIGHT
  // En dar birkaç genişlik yeter: kare kufi zaten sıkı dokuyu istiyor,
  // hepsini denemek etkileşimli kullanım için fazla yavaş.
  const widths = [...reachableWidths(tokens, opts)].sort((a, b) => a - b).slice(0, 12)
  let best = null
  for (const w of widths) {
    const chosen = solveLine(tokens, w, opts)
    if (!chosen) continue
    const line = layoutLine(tokens, chosen, chosen.joins)
    // Dar olana hafif eğilim: eşit delikte sıkı olan yeğlenir.
    const score = lineVoid(line, band) + 0.05 * w
    if (!best || score < best.score) best = { score, line }
  }
  return best?.line ?? null
}

export function compose(text, options = {}) {
  const r = justify(text, options)
  if (!r.ok) return { ...r, cells: [], width: 0, height: 0, resolution: 1 }

  // Satırlar hedefin içine yaslanır; hedef, en geniş satırdan büyük olabilir.
  const s = stack(r.lines, { ...options, width: r.target })
  const weight = options.weight ?? 1
  if (weight === 1) return { ...r, ...s, resolution: 1 }

  const scale = options.weightScale ?? 8
  const t = thickenStack(s, { scale, amount: weightToAmount(weight, scale) })
  return { ...r, ...s, ...t, lines: s.lines, resolution: scale }
}
