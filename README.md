# Latin Makili

Latin harfleriyle kare kûfî üreten web uygulaması. Metni birim grid üzerinde
yazıya çevirir, satırları aynı genişliğe hizalar, SVG ve PNG verir.

Sunucu yok; her şey tarayıcıda çalışır.

## Biçim kuralları

Latin Makili, pixel art'a benzer ama iki katı sıkı kuralı var:

- **Köşeden birleşme yasak.** İki dolu kare yalnızca köşeden komşu olamaz;
  her kare bir kenarı paylaşarak birleşir.
- **Harf arası tam 1 birim.** Kelime arası tam 3 birim. İkisi de değişmez.

Boşluklar sabit olduğu için satırları aynı genişliğe getirmenin tek yolu harf
genişliklerini değiştirmektir — projenin asıl problemi bu.

Kanonik glif hücresi **3 × 9**. Aksanlar gövdenin üstünde ayrı duran işaretler
(`ö`, `ü`, `i`) ya da altında boyun + bar (`ç`); ikisi de 2 satır yer kaplar,
gövde 7 satıra sıkışır.

## Nasıl çalışır

```
sources/latin makili letters.svg
  │  tools/extract-glyphs.mjs      rect → grid hücresi → bağlı bileşen → satır/varyant
  ▼
build/glyphs.raw.json  +  build/glyph-sheet.html   ← elle etiketleme sayfası
  │  tools/build-glyphs.mjs        + tools/labels.json + tools/glyphs.extra.json
  ▼
src/data/glyphs.json               29 harf, 78 varyant
  │
  ▼
src/engine/   grid → glyphs → derive → justify → render
```

### Motor

| Modül | İş |
|---|---|
| `grid.js` | hücre işlemleri, bağlı bileşen, **köşe teması değişmezi** |
| `glyphs.js` | kütüphane erişimi, varsayılan varyant |
| `derive.js` | sütun çoğaltmayla genişlik türetme |
| `layout.js` | sabit boşluklu dizgi, taban çizgisi hizası, satır istifi |
| `justify.js` | ulaşılabilir genişlik DP'si + ortak hedef + varyant ataması |
| `render/outline.js` | birleşik sınırın kapalı halkalara çıkarımı |
| `render/weight.js` | alt-hücre çözünürlüğünde glif başına kalınlaştırma |
| `render/svg.js` | paint / corner / weight eksenleri, presetler |
| `export.js` | SVG indirme, canvas üzerinden PNG |

**Hizalama.** Her satırın ulaşabildiği genişlikler alt-küme-toplamı ile bulunur,
kümeler kesiştirilir, hedef için en ucuz varyant ataması geri izlemeyle çözülür.
Maliyet karesel — dört harfi birer birim genişletmek (4×1), tek harfi dört birim
genişletmekten (1×16) ucuz, böylece esneme satıra yayılır. Kesişim boşsa hiçbir
kural esnetilmez; hangi satırın nereye ulaşamadığı raporlanır.

**Genişlik türetmesi.** Bir sütunun kopyası yanına eklendiğinde köşe teması
yapısal olarak oluşamaz (iki özdeş komşu sütun arasında paylaşılan kenar komşusu
zorunlu olarak doludur), bağlılık da korunur. Geriye yalnız estetik denetim
kalır: kendi başına dikey gövde oluşturan sütun çoğaltılmaz, yoksa kontur
kalınlaşır. 26/29 harfte 3'ten 9'a kesintisiz merdiven var; `ı` ve `i` tek
sütunlu gövdeler, `ç` sedillası nedeniyle sabit genişlikte.

**Stil üç dik eksen.** `paint` (dolu / kontur / ikisi / çizgi) × `corner`
(keskin / yuvarlak / pah) × `weight`. Adlandırılmış presetler bu eksenlerin
kombinasyonu; yeni stil eklemek bir eksene yeni değer eklemek demek.

## Geliştirme

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # motor testleri (vitest)
npm run smoke        # tarayıcıda uçtan uca duman testi (playwright + chromium)
npm run build        # dist/
```

### Glif kütüphanesini yeniden üretmek

```bash
npm run glyphs       # extract + build
```

`build/glyph-sheet.html`'i tarayıcıda açıp etiketleri düzeltebilir, sonucu
`tools/labels.json` olarak kaydedebilirsin. Kaynakta olmayan harfler
`tools/glyphs.extra.json` içinde ASCII olarak tanımlanır; derleme sırasında
hücrelere çevrilip biçim değişmezlerine karşı doğrulanırlar.

## Dağıtım — Cloudflare Pages

Git'ten otomatik dağıtım için Pages panelinde:

- build komutu: `npm run build`
- çıktı dizini: `dist`

Doğrudan dağıtım:

```bash
npm run build && npx wrangler pages deploy dist
```

`public/_headers` varlık önbelleklemesini ayarlar.

## Bilinen eksikler

- **`ş`, `ğ`, `v`** kaynak çizimde yok; `tools/glyphs.extra.json` içinde öneri
  olarak tasarlandı ve `proposed` işaretli. Onay bekliyor.
- **Rakamlar** kaynakta var ve çıkarılıyor ama henüz kütüphaneye alınmadı;
  çıkarımda bir satır eksik (9 satır, 10 rakam).
- **Noktalama** yok.
- `letters.20` satırı (alfabetik olarak `u` ile `y` arasında, "u + sağ üst kol"
  biçiminde) tanımlanamadı; kütüphaneye alınmıyor.

## Sonraki fazlar

Ligatür / kenetlenme (boş köşeye nokta, komşu harfin uzantısının geçmesi),
dairesel düzen, uygulama içi glif editörü, kardeş-harf keşif modu.
