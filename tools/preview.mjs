// Geliştirme aracı — metni motordan geçirip SVG üretir.
//
//   node tools/preview.mjs "hak bir gönül verdi bana" [preset] [out.svg]
//   node tools/preview.mjs --file metin.txt stroke build/out.svg

import { readFileSync, writeFileSync } from 'node:fs'
import { composeNatural } from '../src/engine/layout.js'
import { compose } from '../src/engine/justify.js'
import { renderSvg, PRESETS } from '../src/engine/render/svg.js'
import { unsupported } from '../src/engine/glyphs.js'

const argv = process.argv.slice(2)
let text = argv[0] ?? 'hak bir gönül verdi bana'
if (text === '--file') {
  text = readFileSync(argv[1], 'utf8').trimEnd()
  argv.splice(0, 1)
}
const preset = argv[1] ?? 'normal'
const out = argv[2] ?? 'build/preview.svg'

if (!PRESETS[preset]) {
  console.error(`bilinmeyen preset: ${preset}. Seçenekler: ${Object.keys(PRESETS).join(', ')}`)
  process.exit(1)
}

const bad = unsupported(text)
if (bad.length) console.warn(`uyarı — kütüphanede yok: ${bad.join(' ')}`)

const style = { ...PRESETS[preset], cell: 12 }
const justified = process.env.NO_JUSTIFY ? null : compose(text, { weight: style.weight ?? 1 })
if (justified && !justified.ok) {
  console.warn('hizalama başarısız:')
  for (const w of justified.warnings) console.warn('  ' + w)
}
const composed = justified?.ok ? justified : composeNatural(text)
const svg = renderSvg(composed.cells, { ...style, resolution: composed.resolution ?? 1 })
writeFileSync(out, svg)

console.log(`"${text.replace(/\n/g, ' / ')}"`)
console.log(`preset ${preset}  grid ${composed.width}x${composed.height}  satır ${composed.lines.length}`)
console.log(`satır genişlikleri: ${composed.lines.map((l) => l.line.width).join(', ')}`)
if (justified?.ok) console.log(`hedef ${justified.target}  seçenekler: ${justified.candidates.slice(0, 14).join(', ')}${justified.candidates.length > 14 ? ' …' : ''}`)
console.log(`yazıldı: ${out}`)
