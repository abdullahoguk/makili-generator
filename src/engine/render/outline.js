// Hücre kümesinin birleşik sınırını kapalı halkalara çıkarır.
//
// Köşeden birleşme yasağı burada karşılığını veriyor: hiçbir sınır noktasından
// birden fazla kenar çıkmaz, dolayısıyla sınır her zaman basit kapalı
// halkalardan oluşur ve tek geçişte dolaşılabilir.
//
// Dönen halkalar grid koordinatında: dış halkalar saat yönünde (y aşağı),
// delikler saat yönünün tersine — SVG'nin nonzero dolgu kuralıyla uyumlu.

import { toSet, key } from '../grid.js'

const pt = (x, y) => `${x},${y}`

/** @returns {Array<Array<[number,number]>>} halkalar */
export function outline(cells) {
  const filled = toSet(cells)
  const edges = new Map() // başlangıç noktası -> bitiş noktası

  for (const [x, y] of cells) {
    // Komşusu boş olan her kenar sınırdadır. Yönler hücreyi solda bırakacak
    // şekilde seçildi; bu da dışta saat yönü, delikte ters yön verir.
    if (!filled.has(key(x, y - 1))) edges.set(pt(x, y), pt(x + 1, y)) // üst →
    if (!filled.has(key(x + 1, y))) edges.set(pt(x + 1, y), pt(x + 1, y + 1)) // sağ ↓
    if (!filled.has(key(x, y + 1))) edges.set(pt(x + 1, y + 1), pt(x, y + 1)) // alt ←
    if (!filled.has(key(x - 1, y))) edges.set(pt(x, y + 1), pt(x, y)) // sol ↑
  }

  const rings = []
  while (edges.size) {
    const start = edges.keys().next().value
    const ring = []
    let cur = start
    do {
      const next = edges.get(cur)
      if (next === undefined) break // olmamalı; köşe kuralı bunu garanti eder
      edges.delete(cur)
      ring.push(cur.split(',').map(Number))
      cur = next
    } while (cur !== start)
    if (ring.length >= 4) rings.push(collinear(ring))
  }
  return rings
}

/** Aynı doğrultudaki ardışık noktaları eler. */
function collinear(ring) {
  const out = []
  const n = ring.length
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]
    const cur = ring[i]
    const next = ring[(i + 1) % n]
    const turn = (cur[0] - prev[0]) * (next[1] - cur[1]) - (cur[1] - prev[1]) * (next[0] - cur[0])
    if (turn !== 0) out.push(cur)
  }
  return out
}

/** Halkaları SVG path verisine çevirir. scale = hücre kenarı. */
export function ringsToPath(rings, scale = 1) {
  return rings
    .map((ring) => {
      const [first, ...rest] = ring
      return (
        `M${first[0] * scale} ${first[1] * scale}` +
        rest.map(([x, y]) => `L${x * scale} ${y * scale}`).join('') +
        'Z'
      )
    })
    .join('')
}
