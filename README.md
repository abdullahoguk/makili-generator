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

**Hizalama yalnız genişliğe bakmaz, dokuya da bakar.** Aynı genişlikte birden
çok biçim var ('a'nın 11 biçiminin hepsi 3 birim) ve hangisinin doğru olduğu
komşusuna bağlı. Çözücü bu yüzden iki şeyi birlikte ölçer:

- `voidCost` — yan yana iki biçimin ÜRETTİĞİ fazladan delik (her ikisinin
  kendi açık ağzı düşülerek; ölçü lab'dekiyle aynı),
- `densityCost` — biçimin kendi boşluğu, yani ne kadar seyrek dokuduğu.

Ağırlıklar düşük tutuldu; genişlik hedefi hâlâ tam tutturulur, yalnız aynı
hedefe götüren atamalar arasından dokusu sık olan seçilir. Varsayılan şiirde
ölçülen etki: satırlardaki geniş delik **327 → 96 hücre**, hedef genişlik
değişmeden (79).

**Genişlik eşitliği mümkün olduğunca sağlanır.** Bütün satırların ulaşabildiği
ortak bir genişlik varsa hepsi tam ona getirilir. Yoksa hedef en geniş satırın
doğal genişliği olur; yetişemeyen satır kendi en büyük ulaşılabilir
genişliğinde kalır ve artan pay `slack` olarak bildirilir. O boşluğu sağa,
sola ya da ortaya yaslamak — veya dekoratif bir blokla doldurmak — sanatçının
kararıdır. Motor boşluğu gizlemez, ölçüp gösterir.

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
| `decisions.js` | elle verilmiş çift kararlarını çözücüye bağlar |
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

### Karar semantiği

```
★ prefer   bu çiftte her zaman bu yerleşim
✓ ok       kullanılabilir; çiftte ok varsa çözücü YALNIZ onlar arasından seçer
  işaretsiz karar verilmemiş; hiç ok yoksa motor kendi puanıyla seçer
✗ no       asla
```

Bu sıra pratik bir gerekçeye dayanıyor: her çiftte "olmaz"lar çoğunluk, tek tek
işaretlemek anlamsız. Birkaç iyiyi işaretlemek yetiyor.

Kararlar `localStorage`'da biriker, JSON olarak dışa aktarılıp
`tools/pair-decisions.json` ve `src/data/pair-decisions.json` olarak kaydedilir.
`node tools/analyze-decisions.mjs` onları denetler: geçersiz kayıt, hiç onay
almamış biçim, çözümsüz çift.

### Glif kimlikleri biçimden türer

`a.e9mkh` gibi. Konuma dayalı kimlik (`a.1`) kırılgandı: kütüphaneden bir biçim
çıkınca sonrakilerin numarası kayıyor ve ona atıfta bulunan kararlar sessizce
yanlış glifi gösteriyordu. Biçim özeti bu bağı sabitler.

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

### Eksikler ve çizim tahtası

`node tools/gaps.mjs` metinde geçen ama çözülemeyen çiftleri ve üçlüleri
çıkarır. Dört durum ayrılır:

| durum | anlamı |
|---|---|
| `yok` | motor hiç geçerli yerleşim üretemiyor |
| `reddedildi` | ürettiklerinin tümü lab'de reddedilmiş |
| `delik` | en iyi yerleşimde bile geniş boşluk kalıyor |
| `bant` | blok bandı doldurmuyor |

Üçlüler ayrı sınanır, çünkü iki çift tek tek iyi olsa da üçü bir arada
tutmayabilir — ya da tersine, tek başına kötü görünen bir çift üçüncü harfin
uzantısı boşluğu doldurunca kabul edilebilir hale gelir.

Lab'deki aynı liste tıklanabilir: bir eksiğe tıklayınca **çizim tahtasına**
düşer ve doğru biçimi elle verebilirsin. Tahta kuralları çizerken denetler —
köşe teması, bant doldurma, geniş delik, parça sayısı.

### Boşluk ölçüsü: bir hücre kural, iki hücre kusur

`wideVoid` yalnız **iki hücre kalınlaşan** boşlukları sayar. Bir hücrelik
açıklık kuralın kendisidir (harfler arası kanal, sayaç yarığı, aksan boşluğu).

Kalınlık cebin sınırlayıcı kutusuyla ölçülemez: L biçiminde bir kanal her
yerinde bir hücre ince olduğu halde kutusu geniş çıkar ve her blok kusurlu
görünür. Ölçü yerel: boş bir hücre, tamamen boş bir 2×2 karenin parçasıysa
kalındır. Harflerin kendi açık ağızları (n'nin altı, u'nun üstü) ayrıca
düşülür — ölçülen, yan yana gelmenin ÜRETTİĞİ fazladan boşluktur.

### "Açıklık tam 1 birim" nasıl okunmalı

İki okuma denendi:

1. **Katı** — karşılaşan *her* kenar çifti tam 1 birim. Fazla katı çıktı:
   harflerin içeri çekilmiş kısımları var (`e`'nin bir satırı geri çekilir) ve
   orada açıklık doğal olarak 1'den büyük. Bu okuma elle çizilmiş blokların
   çoğunu eliyordu; `el`, `ay`, `ba`, `ey`, `kb` gibi çiftler "çözümsüz"
   görünüyordu.
2. **Doğru okuma** — *en yakın* açıklık tam 1 (`clearance`) ve hiçbir yerde
   iki hücre kalınlığında boşluk kalmaması (`wideVoid`). Katı kip hâlâ
   seçenek olarak duruyor ama varsayılan kapalı.

Düzeltmenin etkisi: çözümü olmayan çift 29'dan 0'a, delikli çift 10'dan 0'a,
tutan üçlü 10'dan 61'e.

### Blok kurmakta zorlanan harfler

`node tools/problem-letters.mjs` her harfi ölçer: bandı dolduran en yoğun
varyantının doluluğu, tek başına bıraktığı geniş boşluk, komşularıyla
kurduğu çiftlerde kalan ortalama delik.

En sorunlu altı: **f, t, p, v, s, l** (ardından `j`). Hepsinin uzun ince bir
kuyruğu var ve yanında geniş boşluk bırakıyor; `t` en kötüsü (doluluk 0.39,
kendi deliği 14). Sorun yükseklik değil biçim: 29 harfin hepsinin bandı
baştan sona dolduran bir varyantı var, ama bu altısı bandı doldururken
yanında kapanmamış bir oyuk bırakıyor.

Araç ayrıca bir **çizim kuyruğu** basar: en çok delik bırakan çiftler önce
(`ft fz at tb tç çt dt te…`). Lab'deki kuyruk panelinde bu harflere tek
tıkla odaklanılabilir — harfin bütün komşuları kuyruğa düşer ve sıralama
sıklık yerine kalan deliğe göre olur, en kötüsünden başlanır.

### Elle çizilen bloklar

`tools/drawn-blocks.json` — lab'deki çizim tahtasından gelen üçlüler.
`node tools/learn-from-drawings.mjs` her birini kurallara karşı denetler ve
hangi gliflerden kurulduğunu geri-izlemeyle çözer. Çözülenlerin ardışık
çiftleri onaylı karar olarak `pair-decisions.json`'a eklenir; çözülemeyenler
kütüphanede eksik olan biçimi gösterir.

Aynı kombinasyona birden çok çizim verilebilir — bir çiftin tek doğru biçimi
yok, varyantları var. Yalnız birebir aynı çizim iki kez eklenmez.

### Harf varyantı eklemek

Çift ve üçlü denemeleri bir yere kadar: kütüphanede o harfin uygun biçimi
yoksa hiçbir yerleşim kurtarmaz. Lab'deki **Harf varyantları** panelinde tek
harfin yeni biçimi çizilir.

Tek harfte kural başka şey söyler: harfin kendi açık ağzı (`n`'in altı,
`u`'nun üstü) zorunlu olarak geniş boşluktur, hata değil — o yüzden tahtanın
`glyph` kipinde delik ölçülür ama suç sayılmaz. Zorunlu olan köşeden birleşme
olmaması; bandı doldurmak kural ama mutlak değil — `ö.short`, `ğ.short` gibi
6-7 satırlık biçimler geçerli, üstlerine komşunun noktası ya da uzantısı
gelir. Kısa biçim çizmek için tahtadaki **kısa biçim** kutusu işaretlenir.
Aynı biçim kütüphanede ya da listede varsa kayıt engellenir (biçim imzası
konumdan bağımsız).

Panelden çıkan JSON doğrudan `tools/glyphs.extra.json`'un `ascii` dizisine
girer:

```bash
# lab > harf varyantları > dışa aktar, çıktıyı ascii dizisine ekle
npm run glyphs:build
```

Build ASCII'yi hücrelere çevirir, değişmezlere karşı doğrular ve içerik
hash'inden kimlik üretir (`extra:d.el1` → `d.5nvpv`).

### Kenetlenme

Harf arası mesafe artık sabit değil, `advance` olarak modellendi: varsayılanı
`sol.w + boşluk`, ama lab'de onaylanmış kenetli bir yerleşim varsa daha küçük
olabilir. Ustanın `li` kaynaşmasında `i`, `l`'nin sütunlarına giriyor ve
ilerleme 4 yerine 2 oluyor:

```
hedef 5        hedef 3
#...#          #.#
#....          #..
#...#          #.#
#...#          #.#
#...#          #.#
#.#.#          #.#
#.#.#          #.#
#.#.#          #..
###.#          ###
 l i           li (kenetli)
```

Dikey yer de serbest: kısa bir harf tabana oturabilir ya da üste asılabilir —
`ai` çiftinde `i` üste asılı, çünkü üstünde boşluk kalmamalı.

Üç şey bunu mümkün kıldı:

1. **`layoutLine` birleşim alıyor.** Her ardışık çift için ilerleme ve dikey
   yer verilebiliyor; verilmezse eski davranış.
2. **Çözücünün durumu değişti.** Eskiden genişliklerin toplamıydı ve
   boşluklar dışarıdan sabit ekleniyordu. Artık durum glifin **sol kenarı**:
   kenetli ve normal durum aynı denklemle anlatılıyor, satır genişliği de
   son glifin sol kenarı + genişliği.
3. **Onaylı birleşimin istediği biçim havuza enjekte ediliyor.** Dizgi havuzu
   tam boy gövdelerle sınırlı, oysa kenetlenmenin istediği biçim çoğu zaman
   kısa (`li`deki `i` 1×7). O biçim havuzda olmadığı için onaylı kenetlenme
   hiç ateşlenemiyordu. Havuzu gevşetmek yerine, yalnız onaylı bir
   birleşimin adı geçen biçimler, yalnız geçtiği konuma ekleniyor.

Motor kendi başına kenetlenmeye karar vermiyor — hangi çiftin iç içe
geçebileceği tasarım kararı, lab'de onaylananlarla sınırlı. Şu an 125 onaylı
yerleşimin 9'u özel (3'ü kenetli, kalanı tabandan kalkık).

Varsayılan şiirde ölçülen etki: hedef genişlik 79 → **77**, geniş delik
152 → **123**.

### Türetme neyi genişletebilir

Sütun çoğaltma uzun süre her sütuna uygulanıyordu ve **boşluğu da iki katına
çıkarıyordu**: `a` bir birim genişleyince sayacı 2 hücre oluyordu.

```
###        ####
#.#        #..#
..#   →    ...#
###        ####
```

Değişmez kural, boşluğun BİR YÖNDE tam bir birim kalması. İki yönde birden
değil: ustanın `o` sayacı 1 birim geniş ama 7 birim uzun, `g`'nin alt kanalı
3 birim uzun ama 1 birim kalın. Kesin karşılığı: **boş 2×2 kare olmayacak**.

Tek istisna yanı boydan boya açık biçimler — `r` 4w, `t` 7w, `z` 9w. Orayı
komşu harf ya da uzantısı doldurur, usta da bu biçimleri böyle çizmiş. Ölçü
bu yüzden "cep bir kenara değiyor mu" değil, hücre hücre yatay erişim:
hücrenin satırı kenara kadar boş olmalı. `c`'nin çentikli sayacı tek
satırdan değiyor — doldurulamaz, genişletilemez.

Sonuç: `a b c ç e f h ı i j k n o ö p s ş u ü y` genişlemiyor (sayaçları
kapalı), `d g ğ l m r t v z` genişliyor. Genişlik çeşitliliğinin asıl
kaynağı artık **elle çizilen varyantlar**.

Dikeyde kısıt yok: satır çoğaltma hiçbir boşluğu genişletmez, yalnız uzatır.

`node tools/check-glyphs.mjs` kütüphaneyi ve bütün türetmeleri bu kurala
karşı tarar (225 biçim, 0 kusur). Aynı değişmez `derive.test.js` içinde de
sınanıyor.

### Hatalı biçmi kütüphaneden çıkarmak

Kaynak çizimden (`letters.svg`) gelen her biçim doğru değil: bazıları hatalı,
bazıları yanlış harfe etiketlenmiş. `tools/glyph-rejects.json`'daki biçimler
kütüphaneye hiç girmez. Lab'deki panelden **çıkar** ile işaretlenir, dışa
aktarılır, `npm run glyphs:build` ile uygulanır.

Çıkarma kimliğe göre yapılır (`a.unv33`), kimlik de biçimden türediği için
kütüphane değişse de aynı biçmi tutar. İki güvenlik ağı var:

- panel her biçmin **kaç onaylı kararda** kullanıldığını yazar — çıkarılırsa
  o kararlar sessizce uygulanmaz hale gelir,
- build çıkarılanı `⚠ AFİŞTEN` diye işaretler (afişten gelen biçim ustanın
  fiilen kullandığı form, yani doğruluk kaynağı) ve etkilenen kararları
  tek tek listeler.

Bir harfin bütün biçimleri çıkarılırsa build hata verip durur.

### Komşunun doldurması beklenen hücreler

Bir biçimin içinde kalan boşluk iki türlüdür: harfin **kendi açık ağzı**
(öyle kalacak) ya da cümle akışında **komşusunun kapatması gereken** yer.
İkisi ölçüyle ayırt edilemez — tasarımcı bilir. Lab'de biçim tahtaya alınır,
**komşu doldursun** katmanına geçilir ve o hücreler tek tek işaretlenir.
İşaretli hücre mürekkep değil: boş ama boş kalmamalı, o yüzden çapraz
çizikle gösterilir ve mürekkeple aynı hücreye konamaz.

Kayıt `tools/glyph-fills.json`'a gider, biçim kimliğine bağlıdır.

Faydası çift denemelerinde görünür: `l`'nin sağ boşluğu işaretlenince
`l + i` yerleşim kartları **işaretli 4/5 doldu** diye yazar. Yalnız
kenetlenmiş yerleşimler bunu yapabilir — normal açıklıkta komşu, biçimin
kendi kutusunun içine giremez. İşaretleme bu yüzden aynı zamanda
"burada kenetlenme gerekiyor" demenin yolu.

İşaretler biçim kimliğine bağlı olduğundan türetilmiş (genişletilmiş)
biçimlere taşınmaz: sütun çoğaltma koordinatları kaydırır, taşımak yanlış
yere işaret koymak olur.

### Kararları budamak

Bir biçim kütüphaneden çıkarıldığında ona atıfta bulunan onaylı yerleşimler
sessizce işlemez hale gelir. `node tools/prune-decisions.mjs` bunları bulur,
`--write` ile temizler. Türetilmiş kimlikler (`n.yd6m8^1`) kütüphanede
durmaz, çalışma anında üretilir — araç tabana bakar, yoksa bütün türetilmiş
kararları yok sanıp siler.

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
