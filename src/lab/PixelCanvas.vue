<script setup>
// Çizim tahtası — motorun bulamadığı biçimleri elle vermek için.
//
// Kurallar çizerken denetlenir, sonradan değil: köşe teması, bant doldurma,
// geniş boşluk, parça sayısı. Böylece çizim sırasında neyin bozulduğu görünür.
//
// İki kip var, çünkü kural tek harfte başka şey demek:
//
//   block  birkaç harflik blok. Geniş delik HATADIR — blokta kapanmamış
//          boşluk kalmamalı.
//   glyph  tek harfin varyantı. Harfin kendi açık ağzı (n'in altı, u'nun
//          üstü) zorunlu olarak geniş boşluktur; hata değil, ölçü. Buna
//          karşılık bandı baştan sona doldurmak ZORUNLUDUR.

import { computed, ref, watch } from 'vue'
import { cornerTouches, components, toAscii, bbox } from '../engine/grid.js'
import { scoreBlock } from '../engine/fit.js'

const props = defineProps({
  bandHeight: { type: Number, default: 9 },
  width: { type: Number, default: 7 },
  cell: { type: Number, default: 26 },
  mode: { type: String, default: 'block' }, // 'block' | 'glyph'
  // Kısa biçme izin: kütüphanede ö.short, ğ.short gibi 6-7 satırlık biçimler
  // var ve geçerli — üstlerine komşunun noktası/uzantısı geliyor. Bandı
  // doldurma zorunluluğu bu yüzden mutlak değil, bilinçli bir seçim.
  allowShort: { type: Boolean, default: false },
  // Ad alanı dışarıdan yönetiliyorsa (harf zaten seçilmişse) gizlenir.
  nameless: { type: Boolean, default: false },
  // Kaydetmeyi engelleyen dış durum: aynı biçim zaten var gibi.
  blocked: { type: String, default: '' }
})
const emit = defineEmits(['save', 'change'])

/**
 * İki katman var.
 *
 *   ink     harfin mürekkebi
 *   expect  KOMŞUNUN doldurması beklenen hücreler — harfin kendi boşluğu
 *           ama boş kalmaması gereken yer. Önceki ya da sonraki harfin
 *           gövdesi veya uzantısı buraya girecek.
 *
 * Ayrı katman olmasının sebebi: bu hücreler harfin parçası DEĞİL. Mürekkep
 * saysak glif bozulur; hiç tutmasak bilgi kaybolur. Boş ama işaretli.
 */
const LAYERS = ['ink', 'expect']

const W = ref(props.width)
watch(() => props.width, (v) => { W.value = v })

/** Dolu hücreler: "x,y" kümesi. */
const on = ref(new Set())
/** Komşunun doldurması beklenen hücreler. */
const expect = ref(new Set())
const layer = ref('ink')
const painting = ref(null) // 'add' | 'remove'
const label = ref('')

const current = computed(() => (layer.value === 'expect' ? expect : on))

const key = (x, y) => `${x},${y}`
const isOn = (x, y) => on.value.has(key(x, y))
const isExpect = (x, y) => expect.value.has(key(x, y))
const inLayer = (x, y) => (layer.value === 'expect' ? isExpect(x, y) : isOn(x, y))

function paint(x, y, mode) {
  const target = current.value
  const next = new Set(target.value)
  if (mode === 'add') next.add(key(x, y))
  else next.delete(key(x, y))
  target.value = next

  // Bir hücre hem mürekkep hem beklenen dolgu olamaz: beklenen dolgu
  // tanımı gereği BOŞ bir hücredir. Son boyanan kazanır.
  if (mode === 'add') {
    if (layer.value === 'expect' && on.value.has(key(x, y))) {
      const o = new Set(on.value)
      o.delete(key(x, y))
      on.value = o
    } else if (layer.value === 'ink' && expect.value.has(key(x, y))) {
      const e = new Set(expect.value)
      e.delete(key(x, y))
      expect.value = e
    }
  }
}

function down(x, y) {
  painting.value = inLayer(x, y) ? 'remove' : 'add'
  paint(x, y, painting.value)
}
function over(x, y) {
  if (painting.value) paint(x, y, painting.value)
}
const up = () => { painting.value = null }

const cells = computed(() => [...on.value].map((k) => k.split(',').map(Number)))
const expectCells = computed(() => [...expect.value].map((k) => k.split(',').map(Number)))

const glyphMode = computed(() => props.mode === 'glyph')

const report = computed(() => {
  const c = cells.value
  if (!c.length) return null
  const corners = cornerTouches(c)
  const parts = components(c)
  const s = scoreBlock(c, props.bandHeight)
  const b = bbox(c)
  // topGap = bant - yükseklik, yani bandı doldurmakla aynı ölçü.
  const fillsBand = b.h === props.bandHeight
  // İşaretli hücre gerçekten boş mu — mürekkeple çakışmamalı.
  const clash = expectCells.value.filter(([x, y]) => on.value.has(key(x, y))).length
  return {
    corners: corners.length,
    parts: parts.length,
    topGap: s.topGap,
    wideVoid: s.wideVoid,
    fillsBand,
    expect: expectCells.value.length,
    clash,
    w: b.w,
    h: b.h,
    ok: glyphMode.value
      ? corners.length === 0 && (fillsBand || props.allowShort)
      : corners.length === 0 && s.topGap === 0 && s.wideVoid === 0
  }
})

const ascii = computed(() => (cells.value.length ? toAscii(cells.value) : ''))

// Dışarıda canlı denetim yapılabilsin: aynı biçim zaten var mı gibi.
watch(ascii, (v) => emit('change', v))

function clear() {
  on.value = new Set()
  expect.value = new Set()
  label.value = ''
}

function load(art, marks = []) {
  const rows = Array.isArray(art) ? art : String(art).trim().split('\n')
  const next = new Set()
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => { if (ch === '#') next.add(key(x, y)) })
  })
  on.value = next
  expect.value = new Set(marks.map(([x, y]) => key(x, y)))
  W.value = Math.max(W.value, Math.max(...rows.map((r) => r.length)))
}
/** Dışarıdan ad verilebilsin: eksikler panelinden tahtaya aktarırken. */
const setLabel = (v) => { label.value = v }
defineExpose({ load, clear, setLabel, expectCells })

function save() {
  if (!cells.value.length || props.blocked) return
  emit('save', {
    chars: label.value.trim(),
    art: ascii.value.split('\n'),
    expect: expectCells.value
  })
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
      <label v-if="!nameless" class="field grow">
        <span class="label">bu blok hangi harf(ler)</span>
        <input v-model="label" class="mono" placeholder="ad · rd · lu" />
      </label>
      <button
        class="solid"
        :disabled="!report || (!nameless && !label.trim()) || Boolean(blocked)"
        :title="blocked || 'çizimi kaydet'"
        @click="save"
      >kaydet</button>
      <button class="ghost" @click="copy">ascii kopyala</button>
      <button class="ghost" @click="clear">temizle</button>
    </div>

    <div class="layers">
      <span class="label">boyanan</span>
      <button
        class="tab"
        :class="{ on: layer === 'ink' }"
        @click="layer = 'ink'"
      >mürekkep</button>
      <button
        class="tab"
        :class="{ on: layer === 'expect' }"
        title="harfin kendi boşluğu ama boş kalmaması gereken yer — komşusunun gövdesi ya da uzantısı buraya girecek"
        @click="layer = 'expect'"
      >komşu doldursun</button>
      <span v-if="expectCells.length" class="mono dim">{{ expectCells.length }} hücre işaretli</span>
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
          :class="{ on: isOn(x - 1, y - 1), expect: isExpect(x - 1, y - 1) }"
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
      <div v-if="!glyphMode" :class="{ bad: report.topGap > 0 }">
        <dt>üstte boşluk</dt><dd>{{ report.topGap }}</dd>
      </div>
      <div v-if="glyphMode" :class="{ bad: !report.fillsBand && !allowShort }">
        <dt>bandı dolduruyor</dt>
        <dd>{{ report.fillsBand ? 'evet' : allowShort ? 'hayır — kısa biçim' : 'hayır' }}</dd>
      </div>
      <div :class="{ bad: !glyphMode && report.wideVoid > 0 }">
        <dt>{{ glyphMode ? 'kendi deliği' : 'geniş delik' }}</dt>
        <dd>{{ report.wideVoid }}</dd>
      </div>
      <div v-if="report.expect" :class="{ bad: report.clash > 0 }">
        <dt>komşu doldursun</dt><dd>{{ report.expect }}</dd>
      </div>
      <div><dt>parça</dt><dd>{{ report.parts }}</dd></div>
      <div><dt>ölçü</dt><dd>{{ report.w }}×{{ report.h }}</dd></div>
    </dl>
    <p v-else class="report mono dim">boş</p>
    <p v-if="blocked" class="report mono bad-line">{{ blocked }}</p>
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
/* Beklenen dolgu boş bir hücredir: dolu değil, çapraz çizikli. */
.dot.expect {
  background:
    linear-gradient(to top right, transparent 46%, var(--signal) 46%, var(--signal) 54%, transparent 54%),
    linear-gradient(to bottom right, transparent 46%, var(--signal) 46%, var(--signal) 54%, transparent 54%);
  box-shadow: inset 0 0 0 1px var(--signal);
}

.layers {
  display: flex;
  align-items: center;
  gap: var(--u);
}
.tab {
  padding: 5px 10px;
  border: 1px solid var(--rule);
  background: none;
  font-size: var(--t-label);
  font-weight: 700;
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  cursor: pointer;
}
.tab.on {
  background: var(--ink);
  color: var(--paper);
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
.bad-line {
  color: var(--signal);
  font-weight: 700;
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
