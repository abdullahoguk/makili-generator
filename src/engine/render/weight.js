// Ağırlık ekseni — kontur kalınlığı.
//
// Grid tam sayı olduğu için ara kalınlıklar doğrudan ifade edilemez. Çözüm:
// hücreleri `scale` kat büyütüp alt-hücre çözünürlüğünde kalınlaştırmak.
// Kalınlaşma dış kutuya kırpılır, böylece harfin yer kaplaması değişmez ve
// satır hizalaması bozulmaz — kalınlık sayaçlardan yenir, tıpkı kaynak
// örneğindeki (sources/a/4.png) ağırlık varyantlarında olduğu gibi.

import { bbox, toSet, key } from '../grid.js'

/**
 * @param {Array<[number,number]>} cells
 * @param {object} o
 *   scale   her hücrenin kaça bölüneceği (çözünürlük)
 *   amount  alt-hücre cinsinden kalınlaşma; 0 = değişiklik yok
 * @returns {{ cells, scale }} büyütülmüş çözünürlükte hücreler
 */
export function thicken(cells, { scale = 3, amount = 0 } = {}) {
  const up = []
  for (const [x, y] of cells) {
    for (let i = 0; i < scale; i++) {
      for (let j = 0; j < scale; j++) up.push([x * scale + i, y * scale + j])
    }
  }
  if (amount <= 0) return { cells: up, scale }

  const clip = bbox(up)
  const inside = (x, y) =>
    x >= clip.x && y >= clip.y && x < clip.x + clip.w && y < clip.y + clip.h

  let cur = toSet(up)
  for (let step = 0; step < amount; step++) {
    const next = new Set(cur)
    for (const k of cur) {
      const [x, y] = k.split(',').map(Number)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx
        const ny = y + dy
        if (inside(nx, ny)) next.add(key(nx, ny))
      }
    }
    cur = next
  }
  return { cells: [...cur].map((k) => k.split(',').map(Number)), scale }
}

/**
 * Ağırlık değerini alt-hücre kalınlaşmasına çevirir.
 *
 * weight 1 = kaynak kalınlığı, weight 2 = sayaçlar kapanmadan önceki en kalın
 * hal. Üst sınır scale/2 - 1: bir birimlik sayaç iki yandan yenince en az
 * iki alt-hücre açık kalmalı, yoksa delik kapanır ve harf okunmaz olur.
 */
export function weightToAmount(weight, scale) {
  const max = Math.floor(scale / 2) - 1
  return Math.max(0, Math.min(max, Math.round((weight - 1) * max)))
}

/**
 * Yerleşmiş satır istifini alt-hücre çözünürlüğüne taşır ve her glifi TEK TEK
 * kalınlaştırır. Harf ve kelime araları dokunulmadan ölçeklenir — kalınlaşma
 * glifin kendi kutusuna kırpıldığı için boşluklara taşamaz.
 */
export function thickenStack(stacked, { scale = 8, amount = 0 } = {}) {
  const out = []
  for (const { line, x: lx, y: ly } of stacked.lines) {
    for (const it of line.items) {
      const local = thicken(it.variant.cells, { scale, amount }).cells
      const ox = (lx + it.x) * scale
      const oy = (ly + it.y) * scale
      for (const [cx, cy] of local) out.push([ox + cx, oy + cy])
    }
  }
  return { cells: out, scale, width: stacked.width * scale, height: stacked.height * scale }
}
