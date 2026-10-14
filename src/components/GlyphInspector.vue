<script setup>
// Seçili harfin varyantları. Birini sabitlemek, çözücüyü o harfe dokunmadan
// kalan satırı yeniden dengelemeye zorlar.
import { computed } from 'vue'
import { variantsOf, defaultVariant } from '../engine/glyphs.js'
import { widthOptions } from '../engine/derive.js'

const props = defineProps({
  pick: { type: Object, default: null }, // { li, gi, char, w, pinned }
  maxGlyphWidth: { type: Number, default: 9 }
})
const emit = defineEmits(['pin', 'close'])

// Çözücünün gördüğü BÜTÜN biçimler — her genişlikte birden çok olabilir.
// Eskiden genişlik başına tek biçim gösteriliyordu; çözücü ise aynı
// genişlikteki biçimler arasından dokuya göre seçtiği için tıklanan biçim
// ile tuvale düşen biçim farklı olabiliyordu.
const variants = computed(() => {
  if (!props.pick) return []
  const all = variantsOf(props.pick.char) ?? []
  const def = defaultVariant(props.pick.char)
  const tall = all.filter((v) => v.h === def.h)
  const map = widthOptions(tall.length ? tall : all, props.maxGlyphWidth)
  const out = []
  for (const [w, list] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
    for (const g of list) out.push({ w, g, on: g.id === props.pick.id })
  }
  return out
})

const S = 7
function pathFor(g) {
  return g.cells
    .map(([x, y]) => `M${x * S} ${y * S}h${S}v${S}h${-S}z`)
    .join('')
}
const box = (g) => `0 0 ${g.w * S} ${g.h * S}`
</script>

<template>
  <aside v-if="pick" class="insp">
    <header>
      <span class="label">harf</span>
      <strong class="char">{{ pick.char }}</strong>
      <span class="mono dim">{{ pick.li + 1 }}. satır · {{ pick.gi + 1 }}. harf</span>
      <button class="x" type="button" aria-label="kapat" @click="emit('close')">×</button>
    </header>

    <div class="strip">
      <button
        v-for="v in variants"
        :key="v.g.id ?? `${v.w}-${v.g.cells.length}`"
        type="button"
        class="v"
        :class="{ on: v.on, derived: !!v.g.derived }"
        :title="v.g.derived ? `${v.w} birim — türetilmiş` : `${v.w} birim — tasarlanmış`"
        @click="emit('pin', { li: pick.li, gi: pick.gi, width: v.w, id: v.g.id })"
      >
        <svg :viewBox="box(v.g)" :style="{ height: '52px' }" aria-hidden="true">
          <path :d="pathFor(v.g)" />
        </svg>
        <span class="mono w">{{ v.w }}</span>
      </button>
    </div>

    <footer>
      <p class="note">
        Nokta ile işaretli varyantlar sütun çoğaltmayla türetildi.
        Bir biçmi sabitlersen tuvale tam o biçim düşer; çözücü kalan
        harfleri yeniden dengeler.
      </p>
      <button
        v-if="pick.pinned"
        type="button"
        class="release"
        @click="emit('pin', { li: pick.li, gi: pick.gi, width: null })"
      >
        sabitlemeyi kaldır
      </button>
    </footer>
  </aside>
</template>

<style scoped>
.insp {
  border-top: 2px solid var(--rule);
  background: var(--paper-pure);
  flex: none;
}
header {
  display: flex;
  align-items: baseline;
  gap: var(--u);
  padding: var(--u) calc(var(--u) * 2);
  border-bottom: 1px solid var(--rule-hair);
}
.char {
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
}
.dim {
  color: var(--ink-mute);
}
.x {
  margin-left: auto;
  background: none;
  border: 0;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0 2px;
}
.x:hover {
  color: var(--signal);
}

.strip {
  display: flex;
  overflow-x: auto;
  background: var(--paper-pure);
}
.v {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  padding: calc(var(--u) * 1.5) var(--u);
  min-width: 58px;
  background: var(--paper-pure);
  border: 0;
  border-right: 1px solid var(--rule-hair);
  border-bottom: 3px solid transparent;
  cursor: pointer;
  position: relative;
  transition: background 110ms linear, border-color 110ms linear;
}
.v svg {
  fill: var(--ink);
  shape-rendering: crispEdges;
}
.v:hover {
  background: var(--paper);
}
.v.on {
  border-bottom-color: var(--signal);
}
.v.on svg {
  fill: var(--signal);
}
.v.derived::after {
  content: '';
  position: absolute;
  top: 6px;
  right: 6px;
  width: 3px;
  height: 3px;
  background: var(--ink-faint);
}
.w {
  color: var(--ink-mute);
}

footer {
  display: flex;
  align-items: flex-start;
  gap: calc(var(--u) * 2);
  padding: var(--u) calc(var(--u) * 2) calc(var(--u) * 1.5);
  border-top: 1px solid var(--rule-hair);
}
.note {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--ink-mute);
  max-width: 54ch;
}
.release {
  margin-left: auto;
  flex: none;
  background: var(--ink);
  color: var(--paper);
  border: 0;
  padding: 6px 12px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: var(--label-track);
  text-transform: uppercase;
  cursor: pointer;
}
.release:hover {
  background: var(--signal);
}
</style>
