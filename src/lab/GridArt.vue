<script setup>
// Hücre kümesini bant içinde çizer. Bandın üstü ve altı kılavuz çizgiyle
// işaretli — bir bloğun bandı doldurup doldurmadığı bakar bakmaz görünsün.
import { computed } from 'vue'
import { bbox } from '../engine/grid.js'

const props = defineProps({
  cells: { type: Array, required: true },
  bandHeight: { type: Number, default: 9 },
  cell: { type: Number, default: 10 },
  // Sağ glifin hücreleri ayrı renkte gösterilsin diye
  split: { type: Number, default: null },
  // Komşunun doldurması BEKLENEN hücreler: boş ama boş kalmamalı.
  // Mürekkep değil, işaret — çapraz tarama ile çizilir.
  marks: { type: Array, default: () => [] },
  grid: { type: Boolean, default: true }
})

const box = computed(() => bbox(props.cells))
const W = computed(() => box.value.w * props.cell)
const Hpx = computed(() => props.bandHeight * props.cell)

const rects = computed(() =>
  props.cells.map(([x, y], i) => ({
    x: (x - box.value.x) * props.cell,
    y: y * props.cell,
    right: props.split != null && i >= props.split
  }))
)

const markRects = computed(() =>
  props.marks.map(([x, y]) => ({
    x: (x - box.value.x) * props.cell,
    y: y * props.cell
  }))
)
</script>

<template>
  <svg
    :width="W"
    :height="Hpx"
    :viewBox="`0 0 ${W} ${Hpx}`"
    shape-rendering="crispEdges"
    aria-hidden="true"
  >
    <g v-if="grid" class="g">
      <line
        v-for="n in bandHeight + 1"
        :key="'h' + n"
        :x1="0"
        :x2="W"
        :y1="(n - 1) * cell"
        :y2="(n - 1) * cell"
      />
      <line
        v-for="n in box.w + 1"
        :key="'v' + n"
        :y1="0"
        :y2="Hpx"
        :x1="(n - 1) * cell"
        :x2="(n - 1) * cell"
      />
    </g>
    <line class="band" :x1="0" :x2="W" :y1="0.5" :y2="0.5" />
    <line class="band" :x1="0" :x2="W" :y1="Hpx - 0.5" :y2="Hpx - 0.5" />
    <rect
      v-for="(r, i) in rects"
      :key="i"
      :x="r.x"
      :y="r.y"
      :width="cell"
      :height="cell"
      :class="{ right: r.right }"
    />
    <g class="mark">
      <template v-for="(m, i) in markRects" :key="'m' + i">
        <rect :x="m.x" :y="m.y" :width="cell" :height="cell" class="mbox" />
        <line :x1="m.x" :y1="m.y" :x2="m.x + cell" :y2="m.y + cell" />
        <line :x1="m.x + cell" :y1="m.y" :x2="m.x" :y2="m.y + cell" />
      </template>
    </g>
  </svg>
</template>

<style scoped>
svg {
  display: block;
}
rect {
  fill: var(--ink);
}
rect.right {
  fill: var(--signal);
}
.g line {
  stroke: rgba(17, 17, 16, 0.12);
  stroke-width: 1;
}
.band {
  stroke: rgba(17, 17, 16, 0.45);
  stroke-width: 1;
  stroke-dasharray: 3 3;
}
/* Beklenen dolgu: mürekkebin yokluğunu gösterdiği için dolu değil, çizik. */
.mark line {
  stroke: var(--signal);
  stroke-width: 1.5;
}
.mark .mbox {
  fill: none;
  stroke: var(--signal);
  stroke-width: 1;
}
</style>
