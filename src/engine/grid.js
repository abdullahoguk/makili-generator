// Birim grid üzerinde hücre kümesi işlemleri ve biçim değişmezleri.
//
// Hücre = [x, y], tam sayı. Anahtar biçimi "x,y".

export const key = (x, y) => `${x},${y}`
export const parse = (k) => k.split(',').map(Number)

export const toSet = (cells) => new Set(cells.map(([x, y]) => key(x, y)))
export const toCells = (set) => [...set].map(parse).sort((a, b) => a[1] - b[1] || a[0] - b[0])

export function bbox(cells) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of cells) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
}

export function translate(cells, dx, dy) {
  return cells.map(([x, y]) => [x + dx, y + dy])
}

/** Hücreleri sol-üst köşeye taşır. */
export function normalize(cells) {
  const b = bbox(cells)
  return translate(cells, -b.x, -b.y)
}

export const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]]

/** Kenar komşuluğuna göre bağlı bileşenler. */
export function components(cells) {
  const set = toSet(cells)
  const seen = new Set()
  const out = []
  for (const k of set) {
    if (seen.has(k)) continue
    const stack = [k]
    seen.add(k)
    const comp = []
    while (stack.length) {
      const cur = stack.pop()
      const [x, y] = parse(cur)
      comp.push([x, y])
      for (const [dx, dy] of ORTHO) {
        const nk = key(x + dx, y + dy)
        if (set.has(nk) && !seen.has(nk)) {
          seen.add(nk)
          stack.push(nk)
        }
      }
    }
    out.push(comp)
  }
  return out
}

/**
 * Köşe teması: iki dolu hücre çaprazken, paylaştıkları iki ortogonal
 * komşudan ikisi de boşsa kareler yalnızca köşeden birleşmiş olur.
 * Latin Makili'de bu yasak — her kare kenardan birleşmeli.
 *
 * Dönen: ihlal eden çapraz çiftlerin listesi.
 */
export function cornerTouches(cells) {
  const set = toSet(cells)
  const hits = []
  for (const [x, y] of cells) {
    for (const [dx, dy] of [[1, 1], [1, -1]]) {
      const nx = x + dx
      const ny = y + dy
      if (!set.has(key(nx, ny))) continue
      if (set.has(key(nx, y)) || set.has(key(x, ny))) continue
      hits.push([[x, y], [nx, ny]])
    }
  }
  return hits
}

/** Biçim değişmezleri. Dönen: { ok, errors[] } */
export function validate(cells, { requireConnected = true } = {}) {
  const errors = []
  if (!cells.length) {
    errors.push('boş glif')
    return { ok: false, errors }
  }
  const corners = cornerTouches(cells)
  if (corners.length) {
    errors.push(
      `köşeden birleşen ${corners.length} çift: ` +
        corners.slice(0, 4).map(([a, b]) => `${a}|${b}`).join(' ')
    )
  }
  if (requireConnected) {
    const comps = components(cells)
    if (comps.length > 1) errors.push(`${comps.length} ayrık parça`)
  }
  return { ok: errors.length === 0, errors }
}

/** ASCII dökümü — hata ayıklama ve test için. */
export function toAscii(cells, on = '#', off = '.') {
  const b = bbox(cells)
  const grid = Array.from({ length: b.h }, () => Array(b.w).fill(off))
  for (const [x, y] of cells) grid[y - b.y][x - b.x] = on
  return grid.map((r) => r.join('')).join('\n')
}

/** ASCII'den hücrelere — testlerde glif yazmak için. */
export function fromAscii(art, on = '#') {
  const cells = []
  art.trim().split('\n').forEach((line, y) => {
    [...line].forEach((ch, x) => {
      if (ch === on) cells.push([x, y])
    })
  })
  return cells
}
