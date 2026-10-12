// Kural tabanlı genişlik türetmesi.
//
// Satır hizalaması boşlukları değiştiremediği için tek serbestlik derecesi
// harf genişlikleridir. Kaynak kütüphanedeki genişlik çeşitliliği az (çoğu
// glif 3 birim), bu yüzden ara genişlikler sütun çoğaltmayla türetilir.
//
// Sütun çoğaltma seçilmesinin nedeni: bir sütunun kopyası yanına eklendiğinde
// köşe teması yasağı yapısal olarak korunur. İki özdeş komşu sütun arasında
// çapraz bir çift oluşsa bile paylaşılan kenar komşusu zorunlu olarak doludur.
// Bağlılık da aynı nedenle korunur. Dolayısıyla tek denetlenecek şey estetik:
// hangi sütunun çoğaltılacağı.

import { bbox } from './grid.js'

/** Glifi sütunlara ayırır; her sütun dolu satır numaralarının kümesi. */
export function columnsOf(glyph) {
  const cols = Array.from({ length: glyph.w }, () => new Set())
  for (const [x, y] of glyph.cells) cols[x].add(y)
  return cols
}

/**
 * Çoğaltılabilir sütunlar.
 *
 * Bir sütun ancak kendi başına dikey bir gövde oluşturmuyorsa çoğaltılabilir:
 * dolu olduğu her satırda yatay komşularından en az biri de dolu olmalı.
 * Aksi halde kopyası gövdeyi iki kat kalınlaştırır ve ağırlık ekseni bozulur.
 *
 * Boş sütunlar da çoğaltılmaz — harfler arası boşluğu büyütmüş olurdu.
 */
export function duplicableColumns(glyph) {
  const cols = columnsOf(glyph)
  const out = []
  for (let c = 0; c < cols.length; c++) {
    if (cols[c].size === 0) continue
    const left = cols[c - 1]
    const right = cols[c + 1]
    let ok = true
    for (const y of cols[c]) {
      if (!left?.has(y) && !right?.has(y)) { ok = false; break }
    }
    if (ok) out.push(c)
  }
  return out
}

/**
 * Glifi `n` birim genişletir. Çoğaltmalar uygun sütunlara sırayla dağıtılır,
 * böylece tek bir sayaç şişmek yerine biçim dengeli büyür.
 *
 * @returns yeni glif, ya da genişletilemiyorsa null
 */
export function widen(glyph, n) {
  if (n <= 0) return glyph
  const targets = duplicableColumns(glyph)
  if (!targets.length) return null

  // Sütun başına kaç kopya: soldan sağa eşit dağıt.
  const extra = new Map(targets.map((c) => [c, 0]))
  for (let i = 0; i < n; i++) {
    const c = targets[i % targets.length]
    extra.set(c, extra.get(c) + 1)
  }

  const cols = columnsOf(glyph)
  const cells = []
  let x = 0
  for (let c = 0; c < cols.length; c++) {
    const copies = 1 + (extra.get(c) ?? 0)
    for (let k = 0; k < copies; k++) {
      for (const y of cols[c]) cells.push([x, y])
      x++
    }
  }

  const b = bbox(cells)
  return {
    ...glyph,
    derivedFrom: glyph.id ?? glyph.source,
    derived: { widenBy: n },
    id: glyph.id ? `${glyph.id}+${n}` : undefined,
    w: b.w,
    h: b.h,
    cells: cells.sort((a, b2) => a[1] - b2[1] || a[0] - b2[0])
  }
}

/**
 * Glifin kendi genişliğinden `maxWidth`e kadar ulaşabildiği her genişlik.
 * @returns {Map<number, object>} genişlik -> glif
 */
export function widthLadder(glyph, maxWidth) {
  const out = new Map([[glyph.w, glyph]])
  for (let w = glyph.w + 1; w <= maxWidth; w++) {
    const g = widen(glyph, w - glyph.w)
    if (g) out.set(w, g)
  }
  return out
}

/**
 * Bir harfin tüm varyantlarından, genişlik -> en uygun glif eşlemesi.
 * Aynı genişliğe birden çok yoldan ulaşılabiliyorsa türetilmemiş olan
 * yeğlenir; ikisi de türetilmişse daha az çoğaltma yapan kazanır.
 */
export function widthMap(variants, maxWidth) {
  const out = new Map()
  for (const v of variants) {
    for (const [w, g] of widthLadder(v, maxWidth)) {
      const cur = out.get(w)
      if (!cur || cost(g) < cost(cur)) out.set(w, g)
    }
  }
  return out
}

const cost = (g) => (g.derived ? g.derived.widenBy ?? g.derived.heightenBy ?? 0 : 0)

// ---------------------------------------------------------------- yükseklik
//
// Genişlik türetmesinin dikey ikizi. Gerekçesi de aynı: ustanın afişinde aynı
// harf farklı yüksekliklerde kullanılıyor ('li' kaynaşmasındaki i 1x7, tek
// başına duran i ise 1x9) ve aradaki basamaklar kütüphanede yok.
//
// Uygulama devrik üzerinden: satırları sütun gibi görüp aynı kuralı işletmek,
// mantığı iki kez yazmaktan iyi.

const transpose = (glyph) => ({
  ...glyph,
  w: glyph.h,
  h: glyph.w,
  cells: glyph.cells.map(([x, y]) => [y, x])
})

/** Çoğaltılabilir satırlar — kendi başına yatay çubuk oluşturmayanlar. */
export function duplicableRows(glyph) {
  return duplicableColumns(transpose(glyph))
}

/**
 * Glifi `n` birim uzatır. Satır kopyaları uygun satırlara dağıtılır.
 * @returns yeni glif, ya da uzatılamıyorsa null
 */
export function heighten(glyph, n) {
  if (n <= 0) return glyph
  const t = widen(transpose(glyph), n)
  if (!t) return null
  const back = transpose(t)
  return {
    ...glyph,
    derivedFrom: glyph.id ?? glyph.source,
    derived: { heightenBy: n },
    id: glyph.id ? `${glyph.id}^${n}` : undefined,
    w: back.w,
    h: back.h,
    cells: back.cells.sort((a, b) => a[1] - b[1] || a[0] - b[0])
  }
}

/** Glifin kendi yüksekliğinden `maxHeight`e kadar ulaşabildiği her yükseklik. */
export function heightLadder(glyph, maxHeight) {
  const out = new Map([[glyph.h ?? bbox(glyph.cells).h, glyph]])
  const base = glyph.h ?? bbox(glyph.cells).h
  for (let h = base + 1; h <= maxHeight; h++) {
    const g = heighten(glyph, h - base)
    if (g) out.set(h, g)
  }
  return out
}
