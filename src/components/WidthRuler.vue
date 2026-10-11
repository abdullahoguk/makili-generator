<script setup>
// Hizalamanın kalbi. Boşluklar sabit olduğu için her genişlik mümkün değil —
// cetvel yalnızca TÜM satırların ulaşabildiği genişlikleri çentik olarak
// gösterir. Kullanıcı sistemin ne sunduğunu doğrudan görür, bir sayı kutusuna
// yazıp hata mesajı almaz.
import { computed, ref } from 'vue'

const props = defineProps({
  candidates: { type: Array, required: true },
  modelValue: { type: Number, default: null },
  natural: { type: Number, default: null }
})
const emit = defineEmits(['update:modelValue'])

const hover = ref(null)

const span = computed(() => {
  if (!props.candidates.length) return null
  const min = props.candidates[0]
  const max = props.candidates[props.candidates.length - 1]
  return { min, max, range: Math.max(1, max - min) }
})

const pos = (w) => (span.value ? ((w - span.value.min) / span.value.range) * 100 : 0)

// Çok fazla aday varsa hepsini çizmek anlamsız; onluk basamakları etiketle.
const ticks = computed(() =>
  props.candidates.map((w) => ({
    w,
    left: pos(w),
    major: w % 10 === 0,
    on: w === props.modelValue
  }))
)

const readout = computed(() => hover.value ?? props.modelValue)
</script>

<template>
  <div v-if="span" class="ruler">
    <div class="scale" @mouseleave="hover = null">
      <button
        v-for="t in ticks"
        :key="t.w"
        type="button"
        class="tick"
        :class="{ on: t.on, major: t.major }"
        :style="{ left: t.left + '%' }"
        :aria-label="`${t.w} birim`"
        :aria-pressed="t.on"
        @mouseenter="hover = t.w"
        @focus="hover = t.w"
        @click="emit('update:modelValue', t.w)"
      />
      <span
        v-if="natural != null && natural >= span.min && natural <= span.max"
        class="natural"
        :style="{ left: pos(natural) + '%' }"
        :title="`doğal genişlik ${natural}`"
      />
    </div>

    <div class="legend mono">
      <span>{{ span.min }}</span>
      <span class="now">{{ readout }}</span>
      <span>{{ span.max }}</span>
    </div>
  </div>

  <p v-else class="none mono">ortak genişlik yok</p>
</template>

<style scoped>
.ruler {
  width: 100%;
}
.scale {
  position: relative;
  height: 34px;
  border-bottom: 1px solid var(--rule);
}
.tick {
  position: absolute;
  bottom: 0;
  width: 7px;
  height: 11px;
  margin-left: -3px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
/* Çentiğin kendisi ::after; tıklama alanı daha geniş kalsın diye. */
.tick::after {
  content: '';
  position: absolute;
  left: 3px;
  bottom: 0;
  width: 1px;
  height: 8px;
  background: var(--ink-faint);
  transition: height 120ms ease, background 120ms linear;
}
.tick.major::after {
  height: 13px;
  background: var(--ink-mute);
}
.tick:hover::after {
  height: 20px;
  background: var(--ink);
}
.tick.on::after {
  height: 30px;
  width: 3px;
  left: 2px;
  background: var(--signal);
}
/* Doğal genişlik: hizalama olmasaydı satırın olacağı yer. */
.natural {
  position: absolute;
  bottom: 0;
  width: 1px;
  height: 34px;
  background: repeating-linear-gradient(
    to bottom,
    var(--ink-faint) 0 3px,
    transparent 3px 6px
  );
}
.legend {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  color: var(--ink-faint);
}
.now {
  color: var(--signal);
  font-weight: 700;
}
.none {
  margin: 0;
  color: var(--signal);
}
</style>
