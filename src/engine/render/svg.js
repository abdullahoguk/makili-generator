// Yerleşmiş hücreleri SVG'ye çevirir.
//
// Stil üç dik eksenden oluşur:
//   paint  : fill | outline | both | skeleton
//   corner : none | fillet | chamfer   (miktar `cornerSize`, 0..0.5 hücre)
//   weight : kontur kalınlığı, hücre cinsinden (boşluk her zaman 1 hücre)
//
// Adlandırılmış presetler bu eksenlerin birer kombinasyonu — yeni stil eklemek
// eksene yeni bir değer eklemek demek.

import { outline } from './outline.js'
import { bbox } from '../grid.js'

export const PRESETS = {
  normal: { paint: 'fill', corner: 'none' },
  stroke: { paint: 'outline', corner: 'none' },
  'stroke+fill': { paint: 'both', corner: 'none' },
  line: { paint: 'skeleton', corner: 'none' },
  fillet: { paint: 'fill', corner: 'fillet', cornerSize: 0.5 },
  chamfer: { paint: 'fill', corner: 'chamfer', cornerSize: 0.5 }
}

export const DEFAULTS = {
  paint: 'fill',
  corner: 'none',
  cornerSize: 0.5,
  cell: 10, // bir hücrenin px karşılığı
  padding: 2, // hücre cinsinden kenar boşluğu
  ink: '#111111',
  paper: '#ffffff',
  strokeWidth: 1, // px, outline ve skeleton için
  transparent: false
}

/**
 * @param {Array<[number,number]>} cells yerleşmiş hücreler
 * @param {object} style DEFAULTS ile birleştirilir
 * @returns {string} SVG belgesi
 */
export function renderSvg(cells, style = {}) {
  const s = { ...DEFAULTS, ...style }
  const b = bbox(cells)
  const pad = s.padding
  const W = (b.w + pad * 2) * s.cell
  const H = (b.h + pad * 2) * s.cell

  // Çizimi sol-üste normalize edip kenar boşluğu kadar ötele.
  const local = cells.map(([x, y]) => [x - b.x, y - b.y])
  const rings = outline(local)
  const d = pathData(rings, s)

  const body = paintBody(d, local, s)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    s.transparent ? '' : `<rect width="100%" height="100%" fill="${s.paper}"/>`,
    `<g transform="translate(${pad * s.cell} ${pad * s.cell})">`,
    body,
    '</g>',
    '</svg>'
  ].join('')
}

function paintBody(d, cells, s) {
  switch (s.paint) {
    case 'fill':
      return `<path d="${d}" fill="${s.ink}" fill-rule="nonzero"/>`
    case 'outline':
      return `<path d="${d}" fill="none" stroke="${s.ink}" stroke-width="${s.strokeWidth}" stroke-linejoin="miter"/>`
    case 'both':
      return (
        `<path d="${d}" fill="${s.ink}" fill-rule="nonzero"/>` +
        `<path d="${skeletonData(cells, s)}" fill="none" stroke="${s.paper}" stroke-width="${s.strokeWidth}" stroke-linecap="square"/>`
      )
    case 'skeleton':
      return `<path d="${skeletonData(cells, s)}" fill="none" stroke="${s.ink}" stroke-width="${s.strokeWidth}" stroke-linecap="square"/>`
    default:
      throw new Error(`bilinmeyen paint: ${s.paint}`)
  }
}

/** Halkaları, köşe işlemi uygulanmış path verisine çevirir. */
function pathData(rings, s) {
  const k = s.cell
  if (s.corner === 'none') {
    return rings
      .map((r) => `M${r[0][0] * k} ${r[0][1] * k}` + r.slice(1).map(([x, y]) => `L${x * k} ${y * k}`).join('') + 'Z')
      .join('')
  }
  const r = Math.max(0, Math.min(0.5, s.cornerSize)) * k
  return rings.map((ring) => cornerRing(ring, r, k, s.corner)).join('')
}

/**
 * Bir halkanın her köşesini yarıçap/kesme kadar kısaltır.
 * Kısaltma, köşeye komşu iki kenarın yarısını aşamaz — aksi halde kenarlar
 * birbirine girer.
 */
function cornerRing(ring, r, k, mode) {
  const n = ring.length
  const P = ring.map(([x, y]) => [x * k, y * k])
  let d = ''

  for (let i = 0; i < n; i++) {
    const prev = P[(i - 1 + n) % n]
    const cur = P[i]
    const next = P[(i + 1) % n]

    const inLen = dist(prev, cur)
    const outLen = dist(cur, next)
    const cut = Math.min(r, inLen / 2, outLen / 2)

    const a = lerp(cur, prev, cut / inLen)
    const b = lerp(cur, next, cut / outLen)

    if (i === 0) d += `M${fmt(a)}`
    else d += `L${fmt(a)}`

    if (cut > 0) {
      d += mode === 'fillet' ? `Q${fmt(cur)} ${fmt(b)}` : `L${fmt(b)}`
    }
  }
  return d + 'Z'
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1])
const lerp = (from, to, t) => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
const fmt = (p) => `${round(p[0])} ${round(p[1])}`
const round = (v) => Math.round(v * 100) / 100

/**
 * İskelet: her dolu hücrenin merkezini, dolu komşularının merkezine bağlar.
 * Kaynak örneklerindeki tek çizgili ("line") biçim budur.
 */
function skeletonData(cells, s) {
  const k = s.cell
  const set = new Set(cells.map(([x, y]) => `${x},${y}`))
  const c = (x, y) => [(x + 0.5) * k, (y + 0.5) * k]
  const seg = []
  for (const [x, y] of cells) {
    // Her kenarı bir kez çiz: yalnız sağ ve alt komşuya bak.
    if (set.has(`${x + 1},${y}`)) seg.push([c(x, y), c(x + 1, y)])
    if (set.has(`${x},${y + 1}`)) seg.push([c(x, y), c(x, y + 1)])
  }
  // Tek başına duran hücreler (i'nin noktası) görünsün diye nokta kadar çizgi.
  for (const [x, y] of cells) {
    const alone =
      !set.has(`${x + 1},${y}`) && !set.has(`${x - 1},${y}`) &&
      !set.has(`${x},${y + 1}`) && !set.has(`${x},${y - 1}`)
    if (alone) seg.push([c(x, y), c(x, y)])
  }
  return seg.map(([a, b]) => `M${fmt(a)}L${fmt(b)}`).join('')
}
