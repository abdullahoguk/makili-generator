<script setup>
// Çizim tahtası — motorun bulamadığı biçimleri elle vermek için.
//
// Kurallar çizerken denetlenir, sonradan değil: köşe teması, bant doldurma,
// geniş boşluk, parça sayısı. Böylece çizim sırasında neyin bozulduğu görünür.

import { computed, ref, watch } from 'vue'
import { cornerTouches, components, toAscii, bbox } from '../engine/grid.js'
import { scoreBlock } from '../engine/fit.js'

const props = defineProps({
  bandHeight: { type: Number, default: 9 },
  width: { type: Number, default: 7 },
  cell: { type: Number, default: 26 }
})
const emit = defineEmits(['save'])

const W = ref(props.width)
watch(() => props.width, (v) => { W.value = v })

/** Dolu hücreler: "x,y" kümesi. */
const on = ref(new Set())
const painting = ref(null) // 'add' | 'remove'
const label = ref('')

const key = (x, y) => `${x},${y}`
const isOn = (x, y) => on.value.has(key(x, y))

function paint(x, y, mode) {
  const next = new Set(on.value)
  if (mode === 'add') next.add(key(x, y))
  else next.delete(key(x, y))
  on.value = next
}

function down(x, y) {
  painting.value = isOn(x, y) ? 'remove' : 'add'
  paint(x, y, painting.value)
}
function over(x, y) {
  if (painting.value) paint(x, y, painting.value)
}
const up = () => { painting.value = null }

const cells = computed(() => [...on.value].map((k) => k.split(',').map(Number)))

const report = computed(() => {
  const c = cells.value
  if (!c.length) return null
  const corners = cornerTouches(c)
  const parts = components(c)
  const s = scoreBlock(c, props.bandHeight)
  const b = bbox(c)
  return {
    corners: corners.length,
    parts: parts.length,
    topGap: s.topGap,
    wideVoid: s.wideVoid,
    w: b.w,
    h: b.h,
    ok: corners.length === 0 && s.topGap === 0 && s.wideVoid === 0
  }
})

const ascii = computed(() => (cells.value.length ? toAscii(cells.value) : ''))

function clear() {
  on.value = new Set()
  label.value = ''
}

function load(art) {
  const rows = Array.isArray(art) ? art : String(art).trim().split('\n')
  const next = new Set()
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => { if (ch === '#') next.add(key(x, y)) })
  })
  on.value = next
  W.value = Math.max(W.value, Math.max(...rows.map((r) => r.length)))
}
/** Dışarıdan ad verilebilsin: eksikler panelinden tahtaya aktarırken. */
const setLabel = (v) => { label.value = v }
defineExpose({ load, clear, setLabel })

function save() {
  if (!cells.value.length) return
  emit('save', { chars: label.value.trim(), art: ascii.value.split('\n') })
}

const copy = () => navigator.clipboard?.writeText(ascii.value).catch(() => {})
</script>

<template>
  <div class="canvas" @pointerup="up" @pointerleave="up">
    <div class="tools">
      <label class="field narrow">
        <span class="label">genişlik</span>
        <input v-model.number="W" type="number" min="1" max="24" />
      </label>
      <label class="field grow">
        <span class="label">bu blok hangi harf(ler)</span>
        <input v-model="label" class="mono" placeholder="ad · rd · lu" />
      </label>
      <button class="solid" :disabled="!report || !label.trim()" @click="save">kaydet</button>
      <button class="ghost" @click="copy">ascii kopyala</button>
      <button class="ghost" @click="clear">temizle</button>
    </div>

    <div class="board" :style="{ '--c': cell + 'px' }">
      <div
        v-for="y in bandHeight"
        :key="y"
        class="line"
      >
        <button
          v-for="x in W"
          :key="x"
          class="dot"
          :class="{ on: isOn(x - 1, y - 1) }"
          :aria-label="`${x - 1},${y - 1}`"
          @pointerdown.prevent="down(x - 1, y - 1)"
          @pointerenter="over(x - 1, y - 1)"
        />
      </div>
    </div>

    <dl v-if="report" class="report mono">
      <div :class="{ bad: report.corners > 0 }">
        <dt>köşe teması</dt><dd>{{ report.corners }}</dd>
      </div>
      <div :class="{ bad: report.topGap > 0 }">
        <dt>üstte boşluk</dt><dd>{{ report.topGap }}</dd>
      </div>
      <div :class="{ bad: report.wideVoid > 0 }">
        <dt>geniş delik</dt><dd>{{ report.wideVoid }}</dd>
      </div>
      <div><dt>parça</dt><dd>{{ report.parts }}</dd></div>
      <div><dt>ölçü</dt><dd>{{ report.w }}×{{ report.h }}</dd></div>
    </dl>
    <p v-else class="report mono dim">boş</p>
  </div>
</template>

<style scoped>
.canvas {
  display: flex;
  flex-direction: column;
  gap: calc(var(--u) * 2);
  align-items: flex-start;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: var(--u);
  width: 100%;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.field.grow {
  flex: 1;
  min-width: 180px;
}
.field.narrow {
  width: 72px;
  flex: none;
}
.field input {
  padding: 6px 8px;
  border: 1px solid var(--rule);
  background: var(--paper-pure);
  font-family: var(--mono);
  font-size: var(--t-data);
  width: 100%;
}
.field input:focus {
  outline: 0;
  border-color: var(--signal);
}

/* Tahta: hücreler kare, çizgiler tek ağırlıkta. Dolu hücre mürekkep. */
.board {
  border: 1px solid var(--rule);
  background: var(--paper-pure);
  touch-action: none;
  user-select: none;
}
.line {
  display: flex;
}
.dot {
  width: var(--c);
  height: var(--c);
  padding: 0;
  border: 0;
  border-right: 1px solid var(--rule-hair);
  border-bottom: 1px solid var(--rule-hair);
  background: transparent;
  cursor: crosshair;
}
.line:last-child .dot {
  border-bottom: 0;
}
.dot:last-child {
  border-right: 0;
}
.dot.on {
  background: var(--ink);
}
.dot:hover {
  box-shadow: inset 0 0 0 1px var(--signal);
}

.report {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--u) * 2);
  margin: 0;
}
.report div {
  display: flex;
  gap: 5px;
}
.report dt {
  color: var(--ink-mute);
}
.report dd {
  margin: 0;
  font-weight: 700;
}
.report .bad dd,
.report .bad dt {
  color: var(--signal);
}
.dim {
  color: var(--ink-mute);
}

.solid,
.ghost {
  padding: 7px 12px;
  border: 1px solid var(--rule);
  font-size: var(--t-label);
  font-weight: 700;
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  cursor: pointer;
}
.solid {
  background: var(--ink);
  color: var(--paper);
}
.solid:disabled {
  background: var(--paper);
  color: var(--ink-mute);
  cursor: not-allowed;
}
.solid:hover:not(:disabled) {
  background: var(--signal);
  border-color: var(--signal);
}
.ghost {
  background: none;
}
.ghost:hover {
  border-color: var(--signal);
}
</style>
