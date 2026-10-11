// Kaynak SVG'yi birim grid hücrelerine çeviren ayrıştırıcı.
// Bağımlılık yok: kaynak Inkscape çıktısı, yalnız <rect> ve scale(-1,1) içeriyor.

export const UNIT = 1.3229166666 // mm, bir grid hücresi
const Y_OFFSET = 0.6614583333 // kaynakta y ekseni yarım hücre kaymış

const RECT_RE = /<rect\b([^>]*)\/?>/g
const ATTR_RE = /([\w:-]+)\s*=\s*"([^"]*)"/g

function attrs(chunk) {
  const out = {}
  let m
  ATTR_RE.lastIndex = 0
  while ((m = ATTR_RE.exec(chunk))) out[m[1]] = m[2]
  return out
}

/** SVG metnini grid hücresi kümesine çevirir. Dönen: Set<"x,y"> */
export function svgToCells(svgText) {
  const cells = new Set()
  let m
  RECT_RE.lastIndex = 0
  while ((m = RECT_RE.exec(svgText))) {
    const a = attrs(m[1])
    let x = parseFloat(a.x)
    const y = parseFloat(a.y)
    const w = parseFloat(a.width)
    const h = parseFloat(a.height)
    if (![x, y, w, h].every(Number.isFinite)) continue
    if ((a.transform || '').includes('scale(-1,1)')) x = -x - w

    const gx = Math.round(x / UNIT)
    const gw = Math.round(w / UNIT)
    const gy = Math.round((y - Y_OFFSET) / UNIT)
    const gh = Math.round(h / UNIT)
    for (let i = gx; i < gx + gw; i++) {
      for (let j = gy; j < gy + gh; j++) cells.add(`${i},${j}`)
    }
  }
  return cells
}

/** Kenar komşuluğuna göre bağlı bileşenler. Dönen: [{cells:[[x,y]], x,y,w,h}] */
export function connectedComponents(cells) {
  const seen = new Set()
  const comps = []
  for (const key of cells) {
    if (seen.has(key)) continue
    const queue = [key]
    seen.add(key)
    const comp = []
    while (queue.length) {
      const cur = queue.pop()
      const [cx, cy] = cur.split(',').map(Number)
      comp.push([cx, cy])
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nk = `${cx + dx},${cy + dy}`
        if (cells.has(nk) && !seen.has(nk)) {
          seen.add(nk)
          queue.push(nk)
        }
      }
    }
    comps.push(withBox(comp))
  }
  return comps
}

export function withBox(comp) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of comp) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { cells: comp, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

/** Bileşeni kendi sol-üst köşesine taşır. */
export function normalize(comp) {
  return {
    w: comp.w,
    h: comp.h,
    cells: comp.cells.map(([x, y]) => [x - comp.x, y - comp.y]).sort(cmpCell)
  }
}

export const cmpCell = (a, b) => a[1] - b[1] || a[0] - b[0]

/** Normalize edilmiş glifi ASCII olarak basar. */
export function toAscii(g, on = '#', off = '.') {
  const grid = Array.from({ length: g.h }, () => Array(g.w).fill(off))
  for (const [x, y] of g.cells) grid[y][x] = on
  return grid.map((r) => r.join('')).join('\n')
}
