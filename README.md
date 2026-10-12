# Latin Makili

Latin harfleriyle kare kûfî üreten web uygulaması. Metni birim grid üzerinde
yazıya çevirir, satırları aynı genişliğe hizalar, SVG ve PNG verir.

Sunucu yok; her şey tarayıcıda çalışır.

## Biçim kuralları

Kurallar tahminle değil ölçümle kondu. `sources/hakbir normal.png` hücre
grid'ine çevrildi (`tools/extract-reference.py`) ve 67 blok tek tek incelendi:

| Kural | Kanıt |
|---|---|
| **Köşeden birleşme yasak** — iki dolu kare yalnızca köşeden komşu olamaz | 27 benzersiz blokta 0 ihlal |
| **Açıklık tam 1 birim** — karşılaşan iki kenar arasında ne sıfır ne iki | `l`+`i` çiftinde tek geçerli yerleşim bırakıyor, o da ustanınki |
| **Harf arası tam 1 birim**, kelime arası diye bir şey yok | 4 satırdaki boş sütun koşularının hepsi 1 genişliğinde |
| **Her blok hem üst hem alt çizgiye değer** | 67/67 |
| **Satır arası 1 birim**, bütün satırlar aynı genişlikte | 4 satır da tam 71 hücre |
| Harfler bazen kaynaşır: biri ötekinin sütununa girer | 4 satırda 11 kez |

Bant kuralı **harfe değil bloğa** aittir: kısa bir glif komşusunun iç
boşluğuna yuvalanarak kullanılabilir — birlikte oluşturdukları blok bandı
doldurduğu sürece. `l` + `i` bunun tipik örneği.

Boşluklar sabit olduğu için satırları aynı genişliğe getirmenin tek yolu harf
genişliklerini değiştirmektir — projenin asıl problemi bu.

Kanonik glif hücresi **3 × 9**, ama bant yüksekliği tasarım genelinde
değiştirilebilir. Aksanlar gövdenin üstünde ayrı duran işaretler
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
| `fit.js` | bant/boşluk denetimi, iki harfin yerleşimi, kenetlenme ve yuvalanma arama |
| `sequence.js` | kelimeyi bütün olarak dizen demet araması |
| `align.js` | ustanın bloklarını satır metniyle hizalayan DP |
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

## Çift laboratuvarı — `/lab.html`

İki harf yan yana geldiğinde ne olacağına birlikte karar vermek için.
`pairPlacements(a, b)` kurallara uyan bütün yerleşimleri üretir — sol ve sağ
varyantların her kombinasyonu, her yatay ilerleme, her dikey kayma — ve
puanlar. Hangisinin doğru olduğu insan kararıdır; lab o kararı kaydeder.

Üç eksen açılıp kapanabilir:

- **kenetlenme** — sağ harf solun sütunlarına girer, blok daralır
- **yuvalanma** — kısa harf tabandan kalkıp komşusunun boşluğuna oturur
- **kaynaşma** — harfler birbirine değer; 1 birim kuralını deldiği için
  varsayılan kapalı, istisna olarak açılır

Kararlar `localStorage`'da birikir, JSON olarak dışa aktarılıp
`tools/pair-decisions.json` olarak kaydedilir ve çözücüyü besler.

**Kuyruk.** 29 harfin 841 çiftini gezmeye gerek yok: kuyruk, verilen metinde
fiilen geçen çiftleri sıklık sırasına göre listeler (örnek şiirde 44 çift) ve
"sonraki karar verilmemiş" ile aralarında gezinir.

**Kelime denemesi** artık `sequence.js` kullanıyor — kelime harf harf değil
bütün olarak çözülüyor. Gerekçesi: bir yerleşim tek başına "olmaz" görünse de
sonraki harfin uzantısı boşluğu doldurabilir. Çözücü her yeni harfi o ana
kadar birikmiş bütün mürekkebe karşı sınar, sağa açık boşluğu ara adımlarda
cezalandırmaz (sonraki harf doldurabilir) ve asıl puanı dizi bitince keser.

Sayfada ayrıca ustanın afişinden çıkarılmış gerçek bloklar var — geniş olanlar
kaynaşmış çiftler, asıl öğrenilecek örnekler.

### Kütüphanenin doğruluk kaynağı

`tools/block-labels.json` — ustanın afişindeki 27 benzersiz bloğun elle
etiketlenmiş hali. 20'si tek harf (o harfin gerçek biçimi), 7'si kaynaşma
(`rd lu ad lv ed rg li` — motorun üretebilmesi gereken hedefler).

Harf çiziminden (`letters.svg`) çıkan biçimler bir öneri, afişte fiilen
kullanılan biçim ise kanıttır; `tools/build-glyphs.mjs` çakışmada afişi
yeğler ve varsayılan varyantı oradan seçer.

`node tools/verify-fusions.mjs` motorun bu 7 kaynaşmayı üretip üretemediğini
sınar — kütüphanedeki eksiğin ölçüsü budur.

### Blok etiketleme — kütüphanenin gerçeği

Kütüphane, ustanın afişte kullandığı biçimlerden ayrışıyor: 27 benzersiz
bloğun yalnız 12'sini tutturabiliyor, bu yüzden 11 kaynaşmanın hiçbirini
üretemiyor. `src/engine/align.js` dinamik programlamayla her bloğa bir harf
tahmini atar (kaynaşma sayıları çıkarıcının saydığıyla birebir tutuyor) ama
tahmin kesin değil — aynı biçim iki harfe düşebiliyor, lab bunu kırmızı
gösterir. Doğrusu elle etiketlenir ve kütüphanenin kaynağı olur.

### Referansı yeniden ölçmek

```bash
python3 tools/extract-reference.py    # -> src/data/reference.json
node tools/learn-from-reference.mjs   # hizalama raporu, eksik biçimler
node tools/verify-fusions.mjs         # motor ustanın bloklarını üretebiliyor mu
node tools/decompose.mjs              # blokları harf çiftlerine ayırmayı dene
```

## Geliştirme

```bash
npm install
npm run dev          # http://localhost:5174  (lab: /lab.html)
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

## Geliştirme önizlemesi — Cloudflare Tunnel

Yerel dev sunucusu `makili-test.abdullahog.uk` üzerinden yayınlanıyor.
`alaturka-test` tunnel'ı iki hostname sunuyor:

```yaml
# ~/.cloudflared/config.yml
ingress:
  - hostname: test.alaturkavakitler.com
    service: http://localhost:5173
  - hostname: makili-test.abdullahog.uk
    service: http://localhost:5174
  - service: http_status:404
```

`vite.config.js` içindeki `server.allowedHosts` tunnel'dan gelen Host
başlığına izin verir; yoksa Vite isteği 400 ile reddeder.

Hostname tek seviye olmak zorunda: Cloudflare'in ücretsiz Universal SSL
sertifikası `abdullahog.uk` ve `*.abdullahog.uk` kapsıyor, joker karakter
tek etiket karşıladığı için `makili.test.abdullahog.uk` gibi iki seviye
derin adlar TLS el sıkışmasında kopar.

**Config değişince tunnel'ın yeniden başlatılması gerekir.** cloudflared
SIGHUP'ı yakalamaz; sinyal süreci öldürür.

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
