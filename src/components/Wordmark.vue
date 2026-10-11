<script setup>
// Uygulamanın logosu motorun kendi çıktısı — başlık, aracın ürettiği yazıyla
// yazılmış. Swiss başlığın yanında bu, aracın ne yaptığını tek bakışta söyler.
import { computed } from 'vue'
import { compose } from '../engine/justify.js'
import { renderSvg } from '../engine/render/svg.js'

const props = defineProps({
  text: { type: String, default: 'latin makili' },
  cell: { type: Number, default: 7 },
  ink: { type: String, default: 'currentColor' }
})

const svg = computed(() => {
  const c = compose(props.text, { justify: false })
  if (!c.ok || !c.cells.length) return ''
  return renderSvg(c.cells, {
    cell: props.cell,
    padding: 0,
    ink: props.ink,
    transparent: true
  })
})
</script>

<template>
  <div class="wordmark" role="img" :aria-label="text" v-html="svg" />
</template>

<style scoped>
.wordmark {
  display: block;
  line-height: 0;
}
.wordmark :deep(svg) {
  display: block;
  height: auto;
  max-width: 100%;
}
</style>
