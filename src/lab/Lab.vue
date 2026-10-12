<script setup>
// Çift laboratuvarı — iki harfin yan yana nasıl duracağına birlikte karar
// vermek için. Motor bütün geçerli yerleşimleri üretir ve kurallara göre
// puanlar; hangisinin doğru olduğu insan kararıdır, burada kaydedilir.
//
// Kararlar localStorage'da tutulur, JSON olarak dışa aktarılıp
// tools/pair-decisions.json'a kaydedilir ve oradan çözücüyü besler.

import { computed, reactive, ref, watch } from 'vue'
import GridArt from './GridArt.vue'
import { pairPlacements, BAND_HEIGHT } from '../engine/fit.js'
import { layoutWord } from '../engine/sequence.js'
import { CHARSET, variantsOf } from '../engine/glyphs.js'
import { fromAscii } from '../engine/grid.js'
import { alignLine, conflicts, isKnownForm } from '../engine/align.js'
import reference from '../data/reference.json'

const STORE = 'makili.pair-decisions.v1'
const STORE_LABELS = 'makili.block-labels.v1'

const s = reactive({
  left: 'l',
  right: 'i',
  bandHeight: BAND_HEIGHT,
  allowInterlock: true,
  allowNesting: true,
  allowContact: false,
  strict: true,
  maxInterlock: 3,
  onlyUndecided: false,
  word: 'hakbir',
  // Çift kuyruğu bu metinden çıkar: 841 çifti tek tek gezmek yerine
  // gerçekten geçen çiftlere, sıklık sırasına göre bakılır.
  corpus: `hak bir gönül verdi bana
ha demeyen hayran olur
bir dem gelir şad olur
bir dem gelir giryan olur`
})

const decisions = reactive(load())

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}')
  } catch {
    return {}
  }
}
watch(decisions, (d) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(d))
  } catch {
    /* özel pencerede yazılamaz, sorun değil */
  }
}, { deep: true })

const pairKey = computed(() => `${s.left}${s.right}`)

// ---- çift kuyruğu -------------------------------------------------------

/** Metinde fiilen geçen harf çiftleri, sıklığa göre. */
const queue = computed(() => {
  const counts = new Map()
  for (const line of s.corpus.toLowerCase().split('\n')) {
    const chars = [...line].filter((c) => CHARSET.includes(c))
    for (let i = 0; i < chars.length - 1; i++) {
      const k = chars[i] + chars[i + 1]
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  return [...counts]
    .map(([k, n]) => ({
      key: k,
      left: [...k][0],
      right: [...k][1],
      n,
      decided: Boolean(decisions[k] && Object.keys(decisions[k]).length),
      preferred: Object.values(decisions[k] ?? {}).some((v) => v.verdict === 'prefer')
    }))
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
})

const queueStats = computed(() => ({
  total: queue.value.length,
  decided: queue.value.filter((q) => q.decided).length
}))

function goto(q) {
  s.left = q.left
  s.right = q.right
}

function nextUndecided() {
  const i = queue.value.findIndex((q) => q.key === pairKey.value)
  const rest = [...queue.value.slice(i + 1), ...queue.value.slice(0, i + 1)]
  const target = rest.find((q) => !q.decided)
  if (target) goto(target)
}

/** Yerleşimin kimliği — hücre kümesinden türetilir, sıralama değişse de sabit. */
const sigOf = (p) => p.cells.map(([x, y]) => `${x},${y}`).sort().join(' ')

const placements = computed(() =>
  pairPlacements(s.left, s.right, {
    bandHeight: s.bandHeight,
    allowInterlock: s.allowInterlock,
    allowNesting: s.allowNesting,
    allowContact: s.allowContact,
    strict: s.strict,
    maxInterlock: s.maxInterlock,
    limit: 120
  })
)

const shown = computed(() => {
  const list = placements.value
  if (!s.onlyUndecided) return list
  return list.filter((p) => !verdictOf(p))
})

const verdictOf = (p) => decisions[pairKey.value]?.[sigOf(p)]?.verdict ?? null

function mark(p, verdict) {
  const k = pairKey.value
  if (!decisions[k]) decisions[k] = {}
  const sig = sigOf(p)
  if (decisions[k][sig]?.verdict === verdict) {
    delete decisions[k][sig]
    if (!Object.keys(decisions[k]).length) delete decisions[k]
    return
  }
  // Tercih tek olabilir: önceki tercihi düşür.
  if (verdict === 'prefer') {
    for (const key of Object.keys(decisions[k])) {
      if (decisions[k][key].verdict === 'prefer') decisions[k][key].verdict = 'ok'
    }
  }
  decisions[k][sig] = {
    verdict,
    left: p.left.id,
    right: p.right.id,
    advance: p.advance,
    leftTop: p.left.top,
    rightTop: p.right.top,
    width: p.width,
    bandHeight: s.bandHeight
  }
}

const counts = computed(() => {
  const d = decisions[pairKey.value] ?? {}
  const v = Object.values(d).map((x) => x.verdict)
  return {
    prefer: v.filter((x) => x === 'prefer').length,
    ok: v.filter((x) => x === 'ok').length,
    no: v.filter((x) => x === 'no').length
  }
})

const totalDecided = computed(() =>
  Object.values(decisions).reduce((n, d) => n + Object.keys(d).length, 0)
)

// ---- ustanın blokları: etiketleme ---------------------------------------
//
// Kütüphane ustanın gerçekte kullandığı biçimlerden ayrışıyor: tek harflik
// blokların çoğunu bile tutturamıyor, bu yüzden kaynaşmaları da üretemiyor.
// Hizalama algoritması bir ilk tahmin veriyor ama kesin değil — aynı biçimi
// iki ayrı harfe düşürebiliyor. Doğrusunu insan söyler, burada.

const labels = reactive(loadLabels())
function loadLabels() {
  try {
    return JSON.parse(localStorage.getItem(STORE_LABELS) ?? '{}')
  } catch {
    return {}
  }
}
watch(labels, (l) => {
  try {
    localStorage.setItem(STORE_LABELS, JSON.stringify(l))
  } catch {
    /* yok sayılır */
  }
}, { deep: true })

const alignments = computed(() => reference.lines.map((l) => alignLine(l)))

const formConflicts = computed(() => {
  const list = conflicts(alignments.value)
  return new Set(list.map((c) => c.art))
})

/** Benzersiz blok biçimleri + hizalamanın onlara verdiği harf tahmini. */
const masterBlocks = computed(() => {
  const byArt = new Map()
  for (const [li, a] of alignments.value.entries()) {
    if (!a) continue
    for (const st of a.steps) {
      const art = st.block.art
      if (!byArt.has(art)) {
        byArt.set(art, {
          art,
          w: st.block.w,
          cells: fromAscii(art),
          guesses: new Set(),
          count: 0,
          fused: false,
          lines: new Set()
        })
      }
      const rec = byArt.get(art)
      rec.guesses.add(st.chars)
      rec.count++
      rec.fused = rec.fused || st.fused
      rec.lines.add(li + 1)
    }
  }
  return [...byArt.values()]
    .map((r) => ({
      ...r,
      guess: [...r.guesses].join('/'),
      conflict: formConflicts.value.has(r.art),
      known: r.guesses.size === 1 && isKnownForm([...r.guesses][0], r.art)
    }))
    .sort((a, b) => Number(b.conflict) - Number(a.conflict) || b.w - a.w || b.count - a.count)
})

const labelOf = (b) => labels[b.art] ?? ''
const setLabel = (b, v) => {
  const t = v.trim()
  if (t) labels[b.art] = t
  else delete labels[b.art]
}

const labelStats = computed(() => ({
  total: masterBlocks.value.length,
  labelled: masterBlocks.value.filter((b) => labelOf(b)).length,
  conflicts: masterBlocks.value.filter((b) => b.conflict).length,
  known: masterBlocks.value.filter((b) => b.known).length
}))

function exportLabels() {
  exported.value = JSON.stringify(
    {
      note: 'Ustanın blok etiketleri — tools/block-labels.json olarak kaydet',
      source: reference.source,
      labels: masterBlocks.value
        .filter((b) => labelOf(b))
        .map((b) => ({ chars: labelOf(b), art: b.art.split('\n') }))
    },
    null,
    2
  )
  navigator.clipboard?.writeText(exported.value).catch(() => {})
}

// ---- kelime denemesi ----------------------------------------------------

/**
 * Kelimeyi BÜTÜN olarak dizer (sequence.js).
 *
 * Çift çift bakmak yetmiyordu: bir yerleşim tek başına kötü görünse de
 * sonraki harfin uzantısı boşluğu doldurabiliyor. Dizi çözücü her yeni harfi
 * birikmiş bütün mürekkebe karşı sınar ve asıl puanı sonda keser.
 */
const wordRun = computed(() =>
  layoutWord(s.word, {
    bandHeight: s.bandHeight,
    allowNesting: s.allowNesting,
    allowContact: s.allowContact,
    maxInterlock: s.maxInterlock
  })
)

const letters = CHARSET
const variantCount = (c) => (variantsOf(c) ?? []).length

// ---- dışa aktarma -------------------------------------------------------

const exported = ref('')
function exportJson() {
  exported.value = JSON.stringify(
    { note: 'Çift kararları — tools/pair-decisions.json olarak kaydet', decisions },
    null,
    2
  )
  navigator.clipboard?.writeText(exported.value).catch(() => {})
}
function clearAll() {
  for (const k of Object.keys(decisions)) delete decisions[k]
}
</script>

<template>
  <div class="lab">
    <header>
      <h1>Çift<br />laboratuvarı</h1>
      <p class="sub">
        İki harf yan yana geldiğinde ne olacağına birlikte karar vermek için.
        Motor kurallara uyan bütün yerleşimleri üretir ve puanlar; hangisinin
        doğru olduğu senin kararın. Kararlar kaydedilir ve çözücüyü besler.
      </p>
      <dl class="facts">
        <div><dt>ölçüm</dt><dd>{{ reference.lines.length }} satır · {{ reference.fusionsTotal }} kaynaşma</dd></div>
        <div><dt>harf arası</dt><dd>{{ reference.metrics.letterGapCells.join(', ') }} hücre</dd></div>
        <div><dt>karar</dt><dd>{{ totalDecided }}</dd></div>
      </dl>
    </header>

    <main>
      <section class="panel">
        <h2>Çift</h2>
        <div class="pair">
          <label>
            <span class="label">sol</span>
            <select v-model="s.left">
              <option v-for="c in letters" :key="'l' + c" :value="c">
                {{ c }} ({{ variantCount(c) }})
              </option>
            </select>
          </label>
          <span class="plus">+</span>
          <label>
            <span class="label">sağ</span>
            <select v-model="s.right">
              <option v-for="c in letters" :key="'r' + c" :value="c">
                {{ c }} ({{ variantCount(c) }})
              </option>
            </select>
          </label>
        </div>

        <div class="opts">
          <label class="row">
            <span class="label">bant yüksekliği</span>
            <input v-model.number="s.bandHeight" type="range" min="5" max="15" step="2" />
            <b class="mono">{{ s.bandHeight }}</b>
          </label>
          <label class="row">
            <span class="label">en çok kenetlenme</span>
            <input v-model.number="s.maxInterlock" type="range" min="0" max="5" step="1" />
            <b class="mono">{{ s.maxInterlock }}</b>
          </label>
          <label class="chk">
            <input v-model="s.allowInterlock" type="checkbox" />
            <span>kenetlenme — sağ harf solun sütunlarına girebilsin</span>
          </label>
          <label class="chk">
            <input v-model="s.allowNesting" type="checkbox" />
            <span>yuvalanma — kısa harf komşusunun boşluğuna otursun</span>
          </label>
          <label class="chk">
            <input v-model="s.strict" type="checkbox" />
            <span>katı açıklık — karşılaşan <em>her</em> kenar tam 1 birim</span>
          </label>
          <label class="chk">
            <input v-model="s.allowContact" type="checkbox" />
            <span>kaynaşma — harfler birbirine değebilsin <em>(1 birim kuralını deler)</em></span>
          </label>
          <label class="chk">
            <input v-model="s.onlyUndecided" type="checkbox" />
            <span>yalnız karar verilmemişler</span>
          </label>
        </div>

        <div class="tally mono">
          <span class="t prefer">★ {{ counts.prefer }}</span>
          <span class="t ok">✓ {{ counts.ok }}</span>
          <span class="t no">✗ {{ counts.no }}</span>
          <span class="t dim">{{ placements.length }} yerleşim</span>
        </div>
      </section>

      <section class="panel queue-panel">
        <h2>
          <span>Kuyruk</span>
          <span class="dim mono">{{ queueStats.decided }}/{{ queueStats.total }}</span>
        </h2>
        <p class="note">
          Bütün harf çiftlerini gezmene gerek yok — aşağıdaki metinde fiilen
          geçen çiftler, sıklık sırasına göre. Metni değiştirince kuyruk da
          değişir.
        </p>
        <textarea v-model="s.corpus" class="corpus mono" rows="4" spellcheck="false" />
        <button class="solid wide" @click="nextUndecided">sonraki karar verilmemiş →</button>
        <div class="chips">
          <button
            v-for="q in queue"
            :key="q.key"
            class="chip mono"
            :class="{ on: q.key === pairKey, done: q.decided, star: q.preferred }"
            :title="`${q.n} kez geçiyor`"
            @click="goto(q)"
          >
            {{ q.key }}<em>{{ q.n }}</em>
          </button>
        </div>
      </section>

      <section class="results">
        <h2>
          <span>{{ s.left }} + {{ s.right }}</span>
          <span class="dim mono">{{ shown.length }} gösteriliyor</span>
        </h2>

        <p v-if="!placements.length" class="empty">
          Bu ayarlarla geçerli yerleşim yok. Kenetlenme veya yuvalanmayı açmayı,
          ya da bant yüksekliğini değiştirmeyi dene.
        </p>

        <div v-else class="cards">
          <article
            v-for="p in shown"
            :key="sigOf(p)"
            class="card"
            :class="verdictOf(p)"
          >
            <GridArt
              :cells="p.cells"
              :band-height="s.bandHeight"
              :cell="13"
              :split="p.leftCount"
            />
            <dl class="meta mono">
              <div><dt>g</dt><dd>{{ p.width }}</dd></div>
              <div><dt>puan</dt><dd>{{ p.score }}</dd></div>
              <div><dt>boşluk</dt><dd>{{ p.openArea }}</dd></div>
            </dl>
            <p class="flags mono">
              <span v-if="p.interlocked" title="sağ harf solun sütunlarına girdi">kenetli</span>
              <span v-if="p.nested" title="harf tabandan kalkıp komşusuna yuvalandı">yuvalı</span>
              <span v-if="p.fused" class="warn" title="harfler birbirine değiyor">kaynak</span>
              <span v-if="p.cleanGap" class="dim" title="arada tam bir birim boş sütun">temiz</span>
              <span v-if="p.facingWorst > 1" class="warn" :title="`karşılıklı kenarda ${p.facingWorst} birim boşluk`">boşluk {{ p.facingWorst }}</span>
            </p>
            <p class="ids mono dim">{{ p.left.id }} · {{ p.right.id }}</p>
            <div class="verdict">
              <button :class="{ on: verdictOf(p) === 'prefer' }" title="tercih" @click="mark(p, 'prefer')">★</button>
              <button :class="{ on: verdictOf(p) === 'ok' }" title="olur" @click="mark(p, 'ok')">✓</button>
              <button :class="{ on: verdictOf(p) === 'no' }" title="olmaz" @click="mark(p, 'no')">✗</button>
            </div>
          </article>
        </div>
      </section>

      <section class="panel wide">
        <h2>Kelime denemesi</h2>
        <input v-model="s.word" class="word" spellcheck="false" placeholder="hakbir" />
        <div v-if="wordRun.ok" class="wordout">
          <GridArt :cells="wordRun.cells" :band-height="s.bandHeight" :cell="14" />
          <dl class="meta mono">
            <div><dt>g</dt><dd>{{ wordRun.width }}</dd></div>
            <div><dt>puan</dt><dd>{{ wordRun.score }}</dd></div>
            <div><dt>doldurulamaz</dt><dd>{{ wordRun.report.openVertical }}</dd></div>
            <div><dt>sağa açık</dt><dd>{{ wordRun.report.openRight }}</dd></div>
            <div><dt>aday</dt><dd>{{ wordRun.alternatives }}</dd></div>
          </dl>
          <p v-if="!wordRun.bandOk" class="warnline">
            Bant dolmuyor — kütüphanede {{ s.bandHeight }} birime yetişen glif yok.
          </p>
        </div>
        <p v-else class="warnline">
          {{ wordRun.reason ?? `${wordRun.failedChar ?? ''} harfinde tıkandı (${wordRun.failedAt}. sıra)` }}
        </p>
        <p class="note">
          Kelime harf harf değil <b>bütün olarak</b> çözülüyor: her yeni harf
          o ana kadar birikmiş bütün mürekkebe göre sınanıyor, böylece bir
          harfin uzantısı iki harf geriye uzanabiliyor. Sağa açık boşluk ara
          adımlarda cezalandırılmıyor — sonraki harf doldurabilir.
        </p>
      </section>

      <section class="panel wide">
        <h2>
          <span>Ustanın blokları — etiketle</span>
          <span class="dim mono">
            {{ labelStats.labelled }}/{{ labelStats.total }} etiketli ·
            {{ labelStats.known }} kütüphanede var ·
            <b v-if="labelStats.conflicts" class="bad">{{ labelStats.conflicts }} çatışma</b>
          </span>
        </h2>
        <p class="note">
          Kütüphane, ustanın gerçekte kullandığı biçimlerden ayrışıyor — tek
          harflik blokların çoğunu bile tutturamıyor, bu yüzden kaynaşmaları da
          üretemiyor. Altındaki harf hizalama algoritmasının <em>tahmini</em>;
          kesin değil. <b class="bad">Kırmızı</b> olanlarda aynı biçim iki ayrı
          harfe düşmüş, yani kesin yanlış. Doğrusunu kutuya yaz — iki harfse
          bitişik yaz (<code>li</code>). Bunlar kütüphanenin gerçeği olacak.
        </p>
        <div class="master">
          <figure
            v-for="(b, i) in masterBlocks"
            :key="i"
            :class="{ bad: b.conflict, done: labelOf(b), fine: b.known }"
          >
            <GridArt :cells="b.cells" :band-height="9" :cell="11" />
            <figcaption class="mono">
              <span :class="{ bad: b.conflict }">{{ b.guess }}</span>
              <span class="dim">{{ b.w }}×9 ·{{ b.count }}</span>
            </figcaption>
            <input
              class="lbl mono"
              :value="labelOf(b)"
              :placeholder="b.guess"
              @input="setLabel(b, $event.target.value)"
            />
          </figure>
        </div>
      </section>

      <section class="panel wide">
        <h2>Kararları dışa aktar</h2>
        <div class="export">
          <button class="solid" @click="exportJson">çift kararları</button>
          <button class="solid" @click="exportLabels">blok etiketleri</button>
          <button class="ghost" @click="clearAll">çift kararlarını sil</button>
        </div>
        <textarea v-if="exported" :value="exported" readonly rows="8" class="out mono" />
        <p class="note">
          Çıkan JSON'u <code>tools/pair-decisions.json</code> olarak kaydet;
          çözücü oradan okuyacak.
        </p>
      </section>
    </main>
  </div>
</template>

<style scoped>
.lab {
  min-height: 100dvh;
  background: var(--paper);
}

header {
  border-bottom: 2px solid var(--rule);
  padding: calc(var(--u) * 4) calc(var(--u) * 4) calc(var(--u) * 3);
}
h1 {
  margin: 0;
  font-size: clamp(36px, 5.5vw, 68px);
  font-weight: 900;
  line-height: 0.85;
  letter-spacing: -0.04em;
  text-transform: uppercase;
}
.sub {
  margin: calc(var(--u) * 2) 0 0;
  max-width: 68ch;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink-mute);
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--u) * 4);
  margin: calc(var(--u) * 2) 0 0;
}
.facts div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.facts dt {
  font-size: var(--label-size);
  font-weight: 700;
  letter-spacing: var(--label-track);
  text-transform: uppercase;
  color: var(--ink-mute);
}
.facts dd {
  margin: 0;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--signal);
}

main {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: 0;
  align-items: start;
}
.panel {
  padding: calc(var(--u) * 3);
  border-right: 2px solid var(--rule);
  border-bottom: 1px solid var(--rule-hair);
}
.panel.wide {
  grid-column: 1 / -1;
  border-right: 0;
  border-top: 2px solid var(--rule);
}
h2 {
  margin: 0 0 calc(var(--u) * 2);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: var(--label-track);
  text-transform: uppercase;
  display: flex;
  justify-content: space-between;
  gap: var(--u);
  border-bottom: 1px solid var(--rule);
  padding-bottom: 8px;
}
.dim {
  color: var(--ink-faint);
}

.pair {
  display: flex;
  align-items: flex-end;
  gap: var(--u);
}
.pair label {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.plus {
  font-size: 20px;
  font-weight: 700;
  padding-bottom: 4px;
  color: var(--signal);
}
select,
.word {
  width: 100%;
  padding: 7px 8px;
  background: var(--paper-pure);
  border: 1px solid var(--rule);
  font-family: var(--mono);
  font-size: 14px;
}
select:focus,
.word:focus {
  outline: 0;
  border-color: var(--signal);
}

.opts {
  margin-top: calc(var(--u) * 2);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.row {
  display: grid;
  grid-template-columns: 1fr 90px auto;
  align-items: center;
  gap: var(--u);
}
.row input {
  accent-color: var(--signal);
}
.row b {
  color: var(--signal);
}
.chk {
  display: flex;
  gap: 7px;
  font-size: 12px;
  line-height: 1.35;
  cursor: pointer;
}
.chk input {
  accent-color: var(--signal);
  margin: 2px 0 0;
  flex: none;
}
.chk em {
  font-style: normal;
  color: var(--signal);
}

.tally {
  display: flex;
  gap: var(--u);
  margin-top: calc(var(--u) * 2);
  padding-top: var(--u);
  border-top: 1px solid var(--rule-hair);
}
.t.prefer {
  color: var(--signal);
  font-weight: 700;
}

.results {
  padding: calc(var(--u) * 3);
  border-bottom: 1px solid var(--rule-hair);
  min-width: 0;
}
.empty {
  margin: 0;
  padding: calc(var(--u) * 3);
  border: 1px dashed var(--signal);
  color: var(--ink-mute);
  font-size: 13px;
}
/* Bloklar 1-12 hücre arası genişlikte; sabit sütun yerine akış kullanılıyor
   ki geniş kartlar da yan yana sığsın. */
.cards {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
  background: var(--rule-hair);
  border: 1px solid var(--rule-hair);
}
.card {
  background: var(--paper-pure);
  padding: calc(var(--u) * 1.5);
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
  border-left: 3px solid transparent;
  min-width: 118px;
}
.card.prefer {
  border-left-color: var(--signal);
  background: #fff8f7;
}
.card.ok {
  border-left-color: var(--ink);
}
.card.no {
  opacity: 0.4;
}
.meta {
  display: flex;
  gap: var(--u);
  margin: 0;
  font-size: 10px;
}
.meta div {
  display: flex;
  gap: 3px;
}
.meta dt {
  color: var(--ink-faint);
}
.meta dd {
  margin: 0;
  font-weight: 700;
}
.flags {
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.flags span {
  border: 1px solid var(--rule-hair);
  padding: 1px 4px;
}
.flags .warn {
  border-color: var(--signal);
  color: var(--signal);
}
.ids {
  margin: 0;
  font-size: 9px;
}
.verdict {
  display: flex;
  gap: 1px;
  margin-top: auto;
}
.verdict button {
  width: 30px;
  height: 26px;
  border: 1px solid var(--rule);
  background: var(--paper);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}
.verdict button:hover {
  background: var(--paper-pure);
  color: var(--signal);
}
.verdict button.on {
  background: var(--ink);
  color: var(--paper);
}

.queue-panel {
  grid-column: 1 / -1;
  border-right: 0;
  border-top: 1px solid var(--rule-hair);
}
.corpus {
  width: 100%;
  padding: var(--u);
  border: 1px solid var(--rule);
  background: var(--paper-pure);
  font-size: 11px;
  line-height: 1.5;
  margin-bottom: var(--u);
}
.solid.wide {
  width: 100%;
  margin-bottom: var(--u);
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.chip {
  border: 1px solid var(--rule-hair);
  background: var(--paper-pure);
  padding: 3px 6px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  gap: 4px;
  align-items: baseline;
}
.chip em {
  font-style: normal;
  font-size: 9px;
  color: var(--ink-faint);
}
.chip:hover {
  border-color: var(--signal);
}
.chip.done {
  background: var(--ink);
  color: var(--paper);
  border-color: var(--ink);
}
.chip.star {
  border-color: var(--signal);
  border-width: 2px;
}
.chip.on {
  outline: 2px solid var(--signal);
  outline-offset: 1px;
}
.wordout {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: calc(var(--u) * 3);
  margin-top: var(--u);
}
.warnline {
  margin: var(--u) 0 0;
  padding-left: calc(var(--u) * 1.5);
  border-left: 2px solid var(--signal);
  font-size: 12px;
  color: var(--ink);
}
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--u) * 2);
  margin-top: var(--u);
}
.step {
  border: 1px solid var(--rule-hair);
  padding: var(--u);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.step.pref {
  border-color: var(--signal);
}
.who {
  font-size: 11px;
  font-weight: 700;
}
.who em {
  font-style: normal;
  color: var(--ink-faint);
  font-weight: 400;
}
.none {
  color: var(--signal);
  font-size: 11px;
}

.master {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--u) * 2);
  margin-top: var(--u);
}
.master figure {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
  padding: 6px;
  border: 1px solid var(--rule-hair);
  width: 92px;
}
.master figure.bad {
  border-color: var(--signal);
  background: #fff6f5;
}
.master figure.done {
  border-color: var(--ink);
}
.master figure.fine {
  opacity: 0.55;
}
figcaption {
  font-size: 9px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
}
.bad {
  color: var(--signal);
}
.lbl {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--rule);
  background: transparent;
  text-align: center;
  font-size: 13px;
  padding: 1px 0;
}
.lbl:focus {
  outline: 0;
  border-color: var(--signal);
  background: #fffbe6;
}

.note {
  margin: var(--u) 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--ink-mute);
  max-width: 72ch;
}
.export {
  display: flex;
  gap: var(--u);
}
.solid,
.ghost {
  padding: 9px 16px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: var(--label-track);
  text-transform: uppercase;
  cursor: pointer;
  border: 1px solid var(--rule);
}
.solid {
  background: var(--ink);
  color: var(--paper);
}
.solid:hover {
  background: var(--signal);
  border-color: var(--signal);
}
.ghost {
  background: none;
}
.ghost:hover {
  color: var(--signal);
  border-color: var(--signal);
}
.out {
  width: 100%;
  margin-top: var(--u);
  padding: var(--u);
  border: 1px solid var(--rule);
  font-size: 11px;
  background: var(--paper-pure);
}

@media (max-width: 860px) {
  main {
    grid-template-columns: 1fr;
  }
  .panel {
    border-right: 0;
  }
}
</style>
