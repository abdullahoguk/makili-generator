<script setup>
import { ref } from 'vue'
import Wordmark from './components/Wordmark.vue'
import ControlRail from './components/ControlRail.vue'
import PreviewCanvas from './components/PreviewCanvas.vue'
import GlyphInspector from './components/GlyphInspector.vue'
import { useComposition } from './composables/useComposition.js'

const { state, composed, previewSvg, exportSvg, missing, applyPreset, activePreset, pin, clearPins } =
  useComposition()

const picked = ref(null)

function onPick(hit) {
  picked.value =
    picked.value && picked.value.li === hit.li && picked.value.gi === hit.gi ? null : hit
}

function onPin({ li, gi, width, id }) {
  pin(li, gi, width, id)
  if (picked.value) {
    picked.value = {
      ...picked.value,
      w: width ?? picked.value.w,
      id: id ?? picked.value.id,
      pinned: width != null
    }
  }
}
</script>

<template>
  <div class="app">
    <header class="masthead">
      <div class="title">
        <h1>
          <span class="l1">Latin</span>
          <span class="l2">Makili</span>
        </h1>
        <p class="sub">
          Latin harfleriyle kare kûfî. Her kare kenardan birleşir, aralarda tam bir birim
          boşluk kalır, satırlar harf genişlikleriyle aynı hizaya getirilir.
        </p>
      </div>

      <div class="mark">
        <Wordmark text="latin makili" :cell="6" />
        <span class="label caption">yukarıdaki yazı motorun kendi çıktısı</span>
      </div>
    </header>

    <main class="work">
      <aside class="rail">
        <ControlRail
          :state="state"
          :composed="composed"
          :svg="exportSvg"
          :missing="missing"
          :active-preset="activePreset"
          @preset="applyPreset"
          @clear-pins="clearPins(); picked = null"
        />
      </aside>

      <section class="view">
        <PreviewCanvas
          :svg="previewSvg"
          :composed="composed"
          :cell="state.cell"
          :padding="state.padding"
          :show-grid="state.showGrid"
          :paper="state.paper"
          :transparent="state.transparent"
          :pins-by-line="state.pinsByLine"
          @pick="onPick"
        />
        <GlyphInspector :pick="picked" @pin="onPin" @close="picked = null" />
      </section>
    </main>
  </div>
</template>

<style scoped>
/* Swiss: üç metin düzeyi, iki ağırlık, tek sinyal rengi.
   Kabuk viewport'a sabit; başlık, ray ve tuval üç yapısal bölge. */

.app {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  overflow: hidden;
}

/* --- başlık ------------------------------------------------------------- */

.masthead {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: calc(var(--u) * 6);
  padding: calc(var(--u) * 3) calc(var(--u) * 4) calc(var(--u) * 2);
  border-bottom: 2px solid var(--rule);
  flex: none;
}

h1 {
  display: flex;
  align-items: baseline;
  gap: 0.2em;
  margin: 0;
  font-size: var(--t-display);
  font-weight: 700;
  line-height: 0.88;
  letter-spacing: -0.035em;
  text-transform: uppercase;
}
.l2 {
  color: var(--signal);
}

.sub {
  margin: calc(var(--u) * 1.5) 0 0;
  max-width: 64ch;
  color: var(--ink-mute);
}

.mark {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--u);
}
.caption {
  text-align: right;
}

/* --- ızgara ------------------------------------------------------------- */

.work {
  display: grid;
  grid-template-columns: var(--rail) minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}

.rail {
  border-right: 2px solid var(--rule);
  overflow-y: auto;
}

.view {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--paper-pure);
}

@media (max-width: 900px) {
  .app {
    height: auto;
    min-height: 100dvh;
    overflow: visible;
  }
  .masthead {
    grid-template-columns: 1fr;
    align-items: start;
    gap: calc(var(--u) * 3);
    padding: calc(var(--u) * 4) calc(var(--u) * 2) calc(var(--u) * 2);
  }
  .mark {
    align-items: flex-start;
  }
  .caption {
    text-align: left;
  }
  .work {
    grid-template-columns: 1fr;
  }
  .rail {
    border-right: 0;
    border-bottom: 2px solid var(--rule);
    overflow-y: visible;
  }
  .view {
    min-height: 70vh;
  }
}
</style>
