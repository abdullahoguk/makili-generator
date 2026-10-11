<script setup>
// Rail boyunca ritmi kuran tek satırlık alan: solda etiket, sağda değer.
// Her kontrol aynı kalıbı kullanır — Swiss'te tutarlılık süslemenin yerini alır.
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: null }
})
</script>

<template>
  <div class="row">
    <div class="head">
      <span class="label">{{ label }}</span>
      <span v-if="value !== null" class="mono val">{{ value }}</span>
    </div>
    <div class="body"><slot /></div>
  </div>
</template>

<style scoped>
.row {
  padding: calc(var(--u) * 2) 0;
  border-bottom: 1px solid var(--rule-hair);
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--u);
  margin-bottom: var(--u);
}
.val {
  color: var(--signal);
  font-weight: 700;
}
.body {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
}
</style>
