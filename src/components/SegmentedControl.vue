<script setup>
// Dikdörtgen, bitişik, yuvarlatmasız seçim grubu. Seçili olan mürekkep dolgulu.
defineProps({
  modelValue: { type: [String, Number], default: null },
  options: { type: Array, required: true } // [{ value, label, title? }]
})
defineEmits(['update:modelValue'])
</script>

<template>
  <div class="seg" role="group">
    <button
      v-for="o in options"
      :key="o.value"
      type="button"
      class="opt"
      :class="{ on: o.value === modelValue }"
      :title="o.title"
      :aria-pressed="o.value === modelValue"
      @click="$emit('update:modelValue', o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
  width: 100%;
}
.opt {
  flex: 1 1 auto;
  min-width: 0;
  padding: 7px 10px;
  background: var(--paper);
  border: 0;
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: lowercase;
  white-space: nowrap;
  transition: background 120ms linear, color 120ms linear;
}
.opt:hover:not(.on) {
  background: var(--paper-pure);
  color: var(--signal);
}
.opt.on {
  background: var(--ink);
  color: var(--paper);
}
</style>
