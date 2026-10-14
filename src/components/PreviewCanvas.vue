<script setup>
// Tuval. Yazının altında gerçek birim grid'i gösterir — kullanıcı sistemi
// görür, sonucu değil yalnızca. Harflere tıklanınca müfettiş açılır.
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  svg: { type: String, default: '' },
  composed: { type: Object, required: true },
  cell: { type: Number, default: 14 },
  padding: { type: Number, default: 2 },
  showGrid: { type: Boolean, default: true },
  paper: { type: String, default: '#f2f1ec' },
  transparent: { type: Boolean, default: false },
  pinsByLine: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['pick'])

// Yakınlık iki kipte: 'fit' sahneye sığdırır ve metin değişince kendini
// günceller; kullanıcı kaydırıcıya dokunduğu an 'manual'a geçer.
const mode = ref('fit')
const manualZoom = ref(1)
const stage = ref(null)
const stageSize = ref({ w: 0, h: 0 })

const dims = computed(() => {
  const c = props.composed
  return {
    w: (c.width ?? 0) + props.padding * 2,
    h: (c.height ?? 0) + props.padding * 2
  }
})

/** Tıklanabilir bölgeler: her glifin tuval üzerindeki kutusu. */
const hits = computed(() => {
  const out = []
  for (const [li, placed] of (props.composed.lines ?? []).entries()) {
    const line = placed.line ?? placed
    const ox = placed.x ?? 0
    const oy = placed.y ?? 0
    for (const [gi, it] of (line.items ?? []).entries()) {
      out.push({
        li,
        gi,
        char: it.char,
        w: it.variant.w,
        id: it.variant.id,
        pinned: props.pinsByLine?.[li]?.[gi] != null,
        derived: !!it.variant.derived,
        x: ox + it.x + props.padding,
        y: oy + it.y + props.padding,
        bw: it.variant.w,
        bh: it.variant.h
      })
    }
  }
  return out
})

const PAD = 32 * 2 // .stage dolgusu

const fitZoom = computed(() => {
  const { w, h } = stageSize.value
  const dw = dims.value.w * props.cell
  const dh = dims.value.h * props.cell
  if (!w || !h || !dw || !dh) return 1
  return Math.min(1.6, Math.max(0.05, Math.min((w - PAD) / dw, (h - PAD) / dh)))
})

const zoom = computed({
  get: () => (mode.value === 'fit' ? fitZoom.value : manualZoom.value),
  set: (v) => {
    manualZoom.value = v
    mode.value = 'manual'
  }
})

const px = (n) => n * props.cell * zoom.value

let ro
onMounted(() => {
  ro = new ResizeObserver(([e]) => {
    stageSize.value = { w: e.contentRect.width, h: e.contentRect.height }
  })
  if (stage.value) ro.observe(stage.value)
})
onBeforeUnmount(() => ro?.disconnect())

// Çizim ölçüsü değiştiğinde sığdırma kipindeysek yeniden hesaplanır (computed
// zaten dims'e bağlı); burada yalnız manuel kipte taşma uyarısı gerekmiyor.
watch(() => [props.composed.width, props.composed.height], () => {})
</script>

<template>
  <div class="canvas">
    <div class="toolbar">
      <span class="label">tuval</span>
      <span class="mono dim">{{ composed.width ?? 0 }} × {{ composed.height ?? 0 }} birim</span>
      <span class="spacer" />
      <label class="zoom">
        <span class="label">yakınlık</span>
        <input v-model.number="zoom" type="range" min="0.05" max="2.5" step="0.05" />
        <span class="mono dim">{{ Math.round(zoom * 100) }}%</span>
      </label>
      <button
        type="button"
        class="fit"
        :class="{ on: mode === 'fit' }"
        @click="mode = 'fit'"
      >
        sığdır
      </button>
    </div>

    <div ref="stage" class="stage">
      <div
        class="sheet"
        :class="{ checker: transparent }"
        :style="{
          width: px(dims.w) + 'px',
          height: px(dims.h) + 'px',
          background: transparent ? undefined : paper
        }"
      >
        <!-- birim grid: aracın mantığını görünür kılar -->
        <div
          v-if="showGrid"
          class="grid"
          :style="{ backgroundSize: `${px(1)}px ${px(1)}px` }"
        />

        <div class="art" v-html="svg" />

        <!-- tıklama bölgeleri -->
        <button
          v-for="h in hits"
          :key="`${h.li}.${h.gi}`"
          type="button"
          class="hit"
          :class="{ pinned: h.pinned, derived: h.derived }"
          :style="{
            left: px(h.x) + 'px',
            top: px(h.y) + 'px',
            width: px(h.bw) + 'px',
            height: px(h.bh) + 'px'
          }"
          :title="`${h.char} — ${h.w} birim${h.pinned ? ' (sabit)' : ''}`"
          @click="emit('pick', h)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.canvas {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: calc(var(--u) * 2);
  padding: var(--u) calc(var(--u) * 2);
  border-bottom: 1px solid var(--rule);
  flex: none;
}
.spacer {
  flex: 1;
}
.dim {
  color: var(--ink-mute);
}
.zoom {
  display: flex;
  align-items: center;
  gap: var(--u);
}
.zoom input {
  width: 110px;
  accent-color: var(--signal);
}
.fit {
  padding: 5px 10px;
  background: none;
  border: 1px solid var(--rule);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: var(--label-track);
  text-transform: uppercase;
  cursor: pointer;
}
.fit:hover {
  color: var(--signal);
  border-color: var(--signal);
}
.fit.on {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}

.stage {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: calc(var(--u) * 4);
  display: grid;
  place-items: center;
  /* Swiss kağıdı: düz zemin, tuval ince bir kuralla ayrılır. */
  background: var(--paper);
}
.sheet {
  position: relative;
  outline: 1px solid var(--rule-hair);
  /* yeniden çizimde sıçrama olmasın */
  transition: width 140ms ease, height 140ms ease;
}
.checker {
  background-image: linear-gradient(45deg, #e6e4dc 25%, transparent 25%),
    linear-gradient(-45deg, #e6e4dc 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e6e4dc 75%),
    linear-gradient(-45deg, transparent 75%, #e6e4dc 75%);
  background-size: 14px 14px;
  background-position: 0 0, 0 7px, 7px -7px, -7px 0;
  background-color: #f6f5f1;
}
.grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: linear-gradient(to right, rgba(17, 17, 16, 0.085) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(17, 17, 16, 0.085) 1px, transparent 1px);
}
.art {
  position: absolute;
  inset: 0;
  line-height: 0;
}
.art :deep(svg) {
  width: 100%;
  height: 100%;
  display: block;
}

.hit {
  position: absolute;
  padding: 0;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: border-color 100ms linear, background 100ms linear;
}
.hit:hover {
  border-color: var(--signal);
  background: rgba(229, 36, 28, 0.08);
}
.hit.pinned {
  border-color: var(--signal);
  border-style: solid;
}
.hit.derived::after {
  content: '';
  position: absolute;
  right: -1px;
  top: -1px;
  width: 3px;
  height: 3px;
  background: var(--signal);
}
</style>
