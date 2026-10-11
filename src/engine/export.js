// Dışa aktarma. Tarayıcıda çalışır; sunucu yok.

/** Dosya adı için güvenli, okunur bir kök üretir. */
export function slugify(text, fallback = 'makili') {
  const map = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }
  const s = text
    .toLowerCase()
    .replace(/[çğıöşü]/g, (c) => map[c])
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return s || fallback
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Nesne URL'i hemen serbest bırakılırsa Safari indirmeyi iptal edebiliyor.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportSvg(svgText, filename) {
  download(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

/**
 * SVG'yi canvas üzerinden PNG'ye çevirir.
 * @param {string} svgText
 * @param {number} scale  1 = SVG'nin kendi px ölçüsü
 */
export function exportPng(svgText, filename, scale = 2) {
  return new Promise((resolve, reject) => {
    const size = svgText.match(/width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/)
    if (!size) return reject(new Error('SVG ölçüsü okunamadı'))
    const w = Math.round(parseFloat(size[1]) * scale)
    const h = Math.round(parseFloat(size[2]) * scale)

    const img = new Image()
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' }))

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('PNG üretilemedi'))
        download(blob, filename)
        resolve()
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('SVG görüntüye çevrilemedi'))
    }
    img.src = url
  })
}
