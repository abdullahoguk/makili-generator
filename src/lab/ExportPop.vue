<script setup>
// Bölümün kendi dışa aktarma düğmesi.
//
// Önce tek bir "Kararları dışa aktar" paneli vardı: yedi düğme yan yana,
// hangisinin hangi bölüme ait olduğu düğme adından okunuyordu. Çıktı da
// sayfanın en altındaki tek kutuya düşüyordu — hangi bölümde çalışıyorsan
// oradan uzakta. Artık her bölüm kendi çıktısını kendi başlığında veriyor.

import { nextTick, ref } from 'vue'

const props = defineProps({
  /** Düğme yazısı — ne aktarılıyor. */
  label: { type: String, default: 'dışa aktar' },
  /** Çıktının kaydedileceği dosya — kullanıcı bunu bilmek zorunda. */
  file: { type: String, default: '' },
  /** Çağrılınca JSON metnini döndürür. Açılışta çağrılır, önceden değil. */
  build: { type: Function, required: true }
})

const open = ref(false)
const text = ref('')
const copied = ref(false)
const box = ref(null)

async function show() {
  text.value = props.build() ?? ''
  open.value = true
  copied.value = false
  await nextTick()
  box.value?.focus()
  box.value?.select()
}

function hide() {
  open.value = false
}

async function copy() {
  try {
    await navigator.clipboard.writeText(text.value)
    copied.value = true
  } catch {
    // Pano yoksa metin zaten seçili duruyor: elle kopyalanabilir.
    box.value?.focus()
    box.value?.select()
    copied.value = false
  }
}
</script>

<template>
  <span class="wrap">
    <button class="ghost tiny" :title="file || label" @click="show">{{ label }}</button>

    <template v-if="open">
      <!-- Dışına tıklayınca kapanması için saydam zemin. -->
      <div class="veil" @click="hide" />
      <div class="pop" role="dialog" @keydown.esc="hide">
        <div class="pophead">
          <span class="label">{{ label }}</span>
          <code v-if="file" class="mono file">{{ file }}</code>
          <button class="ghost tiny" @click="hide">kapat</button>
        </div>
        <textarea ref="box" class="mono out" :value="text" readonly rows="12" spellcheck="false" />
        <div class="popfoot">
          <button class="solid" @click="copy">{{ copied ? 'kopyalandı' : 'kopyala' }}</button>
          <span class="dim mono">{{ text.length.toLocaleString('tr') }} karakter</span>
        </div>
      </div>
    </template>
  </span>
</template>

<style scoped>
.wrap {
  position: relative;
  display: inline-flex;
}

/* Zemin tıklamayı yakalar ama görünmez: perde değil, kapatma alanı. */
.veil {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.pop {
  /* Başlık içinde duruyor: section-head'in uppercase/letter-spacing'i
     miras geliyordu. Dosya adı büyütülünce okunmaz oluyor, üstelik
     Türkçe büyütme 'i'yi 'İ' yapıp yolu bozuyor. */
  text-transform: none;
  letter-spacing: normal;
  font-weight: 400;
  text-align: left;
  position: absolute;
  z-index: 21;
  top: calc(100% + var(--u));
  right: 0;
  width: min(560px, calc(100vw - var(--u) * 4));
  padding: calc(var(--u) * 1.5);
  background: var(--paper-pure);
  border: 1px solid var(--rule);
  /* Yüzey ayrımı için tek bir sert gölge — yumuşak katman yok. */
  box-shadow: calc(var(--u) * 0.5) calc(var(--u) * 0.5) 0 rgb(17 17 16 / 0.12);
}

.pophead {
  display: flex;
  align-items: baseline;
  gap: var(--u);
  margin-bottom: var(--u);
  padding-bottom: calc(var(--u) * 0.75);
  border-bottom: 1px solid var(--rule);
}

.pophead .file {
  color: var(--ink-mute);
}

.pophead button {
  margin-left: auto;
}

/* Odak çerçevesi burada uyarı değil: kutu zaten açıldığında seçili
   geliyor, kırmızı kontur hata izlenimi veriyordu. */
.out:focus-visible {
  outline: 2px solid var(--rule);
  outline-offset: -2px;
}

.out {
  display: block;
  width: 100%;
  padding: var(--u);
  background: var(--paper);
  border: 1px solid var(--rule-hair);
  resize: vertical;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
}

.popfoot {
  display: flex;
  align-items: center;
  gap: var(--u);
  margin-top: var(--u);
}

/* Düğme biçimleri Lab ile aynı dili konuşur; burada kapsamlı olduğu için
   tekrar tanımlanıyor. */
button {
  cursor: pointer;
  font-family: inherit;
}

.ghost {
  background: transparent;
  border: 1px solid var(--rule-hair);
  color: var(--ink-mute);
}

.ghost:hover {
  border-color: var(--rule);
  color: var(--ink);
}

.solid {
  background: var(--ink);
  border: 1px solid var(--ink);
  color: var(--paper-pure);
}

.tiny {
  padding: 2px calc(var(--u) * 0.75);
  font-size: var(--t-label);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
}

.dim {
  color: var(--ink-mute);
}
</style>
