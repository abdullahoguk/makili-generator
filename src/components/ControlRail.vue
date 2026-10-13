<script setup>
// Sol ray: tüm kontroller tek bir dikey ritimde. Swiss'te hiyerarşi
// kutulardan değil, etiket–kural–değer tekrarından çıkar.
import { computed } from 'vue'
import FieldRow from './FieldRow.vue'
import SegmentedControl from './SegmentedControl.vue'
import WidthRuler from './WidthRuler.vue'
import { PRESETS } from '../engine/render/svg.js'
import { naturalWidth, tokenize } from '../engine/layout.js'
import { exportSvg, exportPng, slugify } from '../engine/export.js'

const props = defineProps({
  state: { type: Object, required: true },
  composed: { type: Object, required: true },
  svg: { type: String, default: '' },
  missing: { type: Array, default: () => [] },
  activePreset: { type: String, default: null }
})
const emit = defineEmits(['preset', 'clear-pins'])

const presetOptions = Object.keys(PRESETS).map((k) => ({ value: k, label: k }))

const paintOptions = [
  { value: 'fill', label: 'dolu' },
  { value: 'outline', label: 'kontur' },
  { value: 'both', label: 'ikisi' },
  { value: 'skeleton', label: 'çizgi' }
]
const cornerOptions = [
  { value: 'none', label: 'keskin' },
  { value: 'fillet', label: 'yuvarlak' },
  { value: 'chamfer', label: 'pah' }
]
const alignOptions = [
  { value: 'left', label: 'sol' },
  { value: 'center', label: 'orta' },
  { value: 'right', label: 'sağ' }
]

/**
 * Hedefe tam ulaşamayan satırların artan payı. Hizalama açıkken de olabilir:
 * satırların ortak bir genişliği yoksa motor en geniş satırı hedef alır,
 * yetişemeyen satır kendi en büyük genişliğinde kalır. O boşluğun nereye
 * gideceği — sol, orta, sağ — sanatçının kararı, o yüzden hizalama denetimi
 * bu durumda da açık kalmalı.
 */
const slackLines = computed(() =>
  (props.composed.lines ?? [])
    .map((l, i) => ({ n: i + 1, slack: (l.line ?? l).slack ?? 0 }))
    .filter((l) => l.slack > 0)
)

const widest = computed(() => {
  const lines = props.state.text.split('\n').filter((l) => l.trim())
  if (!lines.length) return null
  return Math.max(...lines.map((l) => naturalWidth(tokenize(l))))
})

const pinCount = computed(() =>
  Object.values(props.state.pinsByLine).reduce((n, row) => n + Object.keys(row).length, 0)
)

const stem = computed(() => slugify(props.state.text.split('\n')[0] ?? ''))

const onSvg = () => exportSvg(props.svg, `${stem.value}.svg`)
const onPng = (scale) => exportPng(props.svg, `${stem.value}@${scale}x.png`, scale)
</script>

<template>
  <div class="rail">
    <FieldRow label="metin">
      <textarea
        v-model="state.text"
        class="text"
        rows="5"
        spellcheck="false"
        placeholder="yazıyı buraya"
      />
      <p v-if="missing.length" class="warn mono">
        kütüphanede yok: <b>{{ missing.join(' ') }}</b>
      </p>
    </FieldRow>

    <FieldRow label="stil" :value="activePreset ?? 'özel'">
      <SegmentedControl
        :model-value="activePreset"
        :options="presetOptions"
        @update:model-value="emit('preset', $event)"
      />
    </FieldRow>

    <FieldRow label="boyama">
      <SegmentedControl v-model="state.paint" :options="paintOptions" />
    </FieldRow>

    <FieldRow label="köşe" :value="state.corner === 'none' ? null : state.cornerSize.toFixed(2)">
      <SegmentedControl v-model="state.corner" :options="cornerOptions" />
      <input
        v-if="state.corner !== 'none'"
        v-model.number="state.cornerSize"
        class="slider"
        type="range"
        min="0.05"
        max="0.5"
        step="0.05"
      />
    </FieldRow>

    <FieldRow
      v-if="state.paint !== 'fill'"
      label="çizgi kalınlığı"
      :value="state.strokeRatio.toFixed(2)"
    >
      <input
        v-model.number="state.strokeRatio"
        class="slider"
        type="range"
        min="0.02"
        max="0.3"
        step="0.01"
      />
    </FieldRow>

    <FieldRow v-if="state.paint !== 'skeleton'" label="ağırlık" :value="state.weight.toFixed(2)">
      <input v-model.number="state.weight" class="slider" type="range" min="1" max="2" step="0.05" />
    </FieldRow>

    <FieldRow label="hizalama" :value="composed.ok ? composed.target : '—'">
      <label class="check">
        <input v-model="state.justifyOn" type="checkbox" />
        <span>satırları aynı genişliğe getir</span>
      </label>

      <template v-if="state.justifyOn">
        <WidthRuler
          v-model="state.target"
          :candidates="composed.candidates ?? []"
          :natural="widest"
        />
        <button v-if="state.target != null" class="ghost" type="button" @click="state.target = null">
          hedefi motora bırak
        </button>
      </template>

      <!-- Hizalama: satırlar hedefe tam ulaşamadığında da gerekiyor. -->
      <SegmentedControl
        v-if="!state.justifyOn || slackLines.length"
        v-model="state.align"
        :options="alignOptions"
      />

      <p v-for="w in composed.warnings ?? []" :key="w" class="warn">{{ w }}</p>

      <button v-if="pinCount" class="ghost" type="button" @click="emit('clear-pins')">
        {{ pinCount }} sabitlemeyi temizle
      </button>
    </FieldRow>

    <FieldRow label="satır arası" :value="state.lineGap">
      <input v-model.number="state.lineGap" class="slider" type="range" min="0" max="6" step="1" />
    </FieldRow>

    <FieldRow label="renk">
      <div class="colors">
        <label class="swatch">
          <input v-model="state.ink" type="color" />
          <span class="mono">mürekkep</span>
        </label>
        <label class="swatch">
          <input v-model="state.paper" type="color" :disabled="state.transparent" />
          <span class="mono">kağıt</span>
        </label>
      </div>
      <label class="check">
        <input v-model="state.transparent" type="checkbox" />
        <span>saydam zemin</span>
      </label>
      <label class="check">
        <input v-model="state.showGrid" type="checkbox" />
        <span>grid'i göster</span>
      </label>
    </FieldRow>

    <FieldRow label="hücre" :value="`${state.cell} px`">
      <input v-model.number="state.cell" class="slider" type="range" min="4" max="40" step="1" />
    </FieldRow>

    <FieldRow label="kenar boşluğu" :value="`${state.padding} birim`">
      <input v-model.number="state.padding" class="slider" type="range" min="0" max="12" step="1" />
    </FieldRow>

    <FieldRow label="dışa aktar">
      <div class="out">
        <button type="button" class="solid" :disabled="!svg" @click="onSvg">svg</button>
        <button type="button" class="solid" :disabled="!svg" @click="onPng(1)">png 1×</button>
        <button type="button" class="solid" :disabled="!svg" @click="onPng(2)">png 2×</button>
        <button type="button" class="solid" :disabled="!svg" @click="onPng(4)">png 4×</button>
      </div>
    </FieldRow>
  </div>
</template>

<style scoped>
.rail {
  padding: 0 calc(var(--u) * 3) calc(var(--u) * 8);
}

.text {
  width: 100%;
  min-height: 92px;
  padding: var(--u);
  background: var(--paper-pure);
  border: 1px solid var(--rule);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
}
.text:focus {
  outline: 0;
  border-color: var(--signal);
}

.slider {
  width: 100%;
  margin-top: var(--u);
  accent-color: var(--signal);
}

.check {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 0;
}
.check input {
  accent-color: var(--signal);
  margin: 0;
}

.colors {
  display: flex;
  gap: calc(var(--u) * 2);
  width: 100%;
  margin-bottom: 4px;
}
.swatch {
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: pointer;
  color: var(--ink-mute);
}
.swatch input {
  width: 28px;
  height: 20px;
  padding: 0;
  border: 1px solid var(--rule);
  background: none;
  cursor: pointer;
}

.out {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  width: 100%;
  background: var(--rule);
  border: 1px solid var(--rule);
}
.solid {
  padding: 9px;
  background: var(--ink);
  color: var(--paper);
  border: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: var(--label-track);
  text-transform: uppercase;
  cursor: pointer;
  transition: background 110ms linear;
}
.solid:hover:not(:disabled) {
  background: var(--signal);
}
.solid:disabled {
  background: var(--ink-faint);
  cursor: not-allowed;
}

.ghost {
  margin-top: var(--u);
  padding: 6px 10px;
  background: none;
  border: 1px solid var(--rule);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: var(--label-track);
  text-transform: uppercase;
  cursor: pointer;
}
.ghost:hover {
  background: var(--ink);
  color: var(--paper);
}

.warn {
  width: 100%;
  margin: var(--u) 0 0;
  padding-left: calc(var(--u) * 1.5);
  border-left: 2px solid var(--signal);
  font-size: 11px;
  line-height: 1.45;
  color: var(--ink);
}
.warn b {
  color: var(--signal);
}
</style>
