// Motoru Vue reaktivitesine bağlar. Tek kaynak: burada tutulan state.

import { reactive, computed } from 'vue'
import { compose } from '../engine/justify.js'
import { renderSvg, PRESETS, DEFAULTS as STYLE_DEFAULTS } from '../engine/render/svg.js'
import { unsupported } from '../engine/glyphs.js'

const SAMPLE = `hak bir gönül verdi bana
ha demeden hayran olur
bir dem gelir şadan olur
bir dem gelir giryan olur`

export function useComposition() {
  const state = reactive({
    text: SAMPLE,

    // stil eksenleri
    paint: 'fill',
    corner: 'none',
    cornerSize: 0.5,
    weight: 1,

    // sunum
    ink: '#111110',
    paper: '#f2f1ec',
    transparent: false,
    cell: 14,
    strokeRatio: 0.1,
    padding: 2,
    align: 'left',
    lineGap: 1,

    // hizalama
    justifyOn: true,
    target: null, // null = motor seçsin
    pinsByLine: {}, // { satır: { harfSırası: { w, id } } }

    showGrid: true
  })

  const missing = computed(() => unsupported(state.text))

  const composed = computed(() =>
    compose(state.text, {
      justify: state.justifyOn,
      target: state.target ?? undefined,
      pinsByLine: state.pinsByLine,
      align: state.align,
      lineGap: state.lineGap,
      weight: state.weight
    })
  )

  const baseStyle = computed(() => ({
    ...STYLE_DEFAULTS,
    paint: state.paint,
    corner: state.corner,
    cornerSize: state.cornerSize,
    cell: state.cell,
    strokeRatio: state.strokeRatio,
    padding: state.padding,
    ink: state.ink,
    paper: state.paper,
    resolution: composed.value.resolution ?? 1
  }))

  function render(style) {
    const c = composed.value
    if (!c.ok || !c.cells.length) return ''
    return renderSvg(c.cells, style)
  }

  // Önizlemede zemini SVG değil tuval div'i boyar; aksi halde opak kağıt
  // dikdörtgeni, altındaki birim grid'i örtüyor.
  const previewSvg = computed(() => render({ ...baseStyle.value, transparent: true }))

  // Dışa aktarılan dosya kullanıcının zemin tercihini taşır.
  const exportSvg = computed(() =>
    render({ ...baseStyle.value, transparent: state.transparent })
  )

  /** Bir harfin seçilebilir genişlikleri ve o an hangisinde olduğu. */
  function glyphAt(lineIndex, glyphIndex) {
    const line = composed.value.lines?.[lineIndex]
    const item = line?.line?.items?.[glyphIndex] ?? line?.items?.[glyphIndex]
    return item ?? null
  }

  function pin(lineIndex, glyphIndex, width, id = null) {
    const byLine = { ...state.pinsByLine }
    const row = { ...(byLine[lineIndex] ?? {}) }
    if (width == null) delete row[glyphIndex]
    // Genişlik değil BİÇİM sabitlenir: aynı genişlikte birden çok biçim var,
    // yalnız genişlik sabitlenirse çözücü başkasını seçebiliyordu.
    else row[glyphIndex] = { w: width, id }
    if (Object.keys(row).length) byLine[lineIndex] = row
    else delete byLine[lineIndex]
    state.pinsByLine = byLine
  }

  const clearPins = () => {
    state.pinsByLine = {}
  }

  function applyPreset(name) {
    const p = PRESETS[name]
    if (!p) return
    state.paint = p.paint ?? 'fill'
    state.corner = p.corner ?? 'none'
    state.cornerSize = p.cornerSize ?? 0.5
    state.weight = p.weight ?? 1
  }

  /** Şu anki eksen kombinasyonu bir presete denk geliyorsa adı. */
  const activePreset = computed(() => {
    for (const [name, p] of Object.entries(PRESETS)) {
      if (
        (p.paint ?? 'fill') === state.paint &&
        (p.corner ?? 'none') === state.corner &&
        (p.weight ?? 1) === state.weight
      ) {
        return name
      }
    }
    return null
  })

  return {
    state,
    composed,
    previewSvg,
    exportSvg,
    missing,
    glyphAt,
    pin,
    clearPins,
    applyPreset,
    activePreset
  }
}

export { PRESETS, SAMPLE }
