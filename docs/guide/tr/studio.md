---
title: Stüdyo
section: Müzik yapmak
summary: Bir Kayıt Stüdyosu kanalında şarkıları birlikte kaydet, düzenle ve miksle; canlı ya da kendi zamanında.
source: 13ae054b4cd0
---

**Kayıt Stüdyosu** kanalı, sunucunun içindeki bir müzik çalışma alanıdır. Her **proje** bir şarkıdır; kendi çok kanallı düzenleyicisi, çekimleri, yorumları, sürümleri ve sohbeti vardır. Grup üyeleri canlı olarak birlikte kayıt yapabilir ya da vakit buldukça partisyon ekleyebilir.

![Stüdyoda açık bir proje](shot:studio)

## Proje başlatmak

Bir Kayıt Stüdyosu kanalını aç ve **Yeni Proje**'ye tıkla. Bir ad ve tempo ver. **Proje Oluştur** iznine ihtiyacın var.

Bir şarkıya başka bir yerde mi başladın? **İçe aktar**, Bitwig, Studio One, Cubase ve diğerlerinden `.dawproject` dosyalarını ve Parley'nin kendi `.parley-project` dosyalarını açar.

## Kayıt

1. Sesini **Ses** panelinde ayarla: çıkışın ve **Kayıt gecikmesi**. Çekimlerinin ritimle hizalanması için **Ölç**'e tıkla.
2. Bir parça ekle: mikrofon veya enstrüman için **ses** ya da yerleşik bir synth, davul seti veya sampler ile **MIDI**.
3. Parçayı kayda hazırla ve kayda bas. **Grubu çalma imlecinden kaydet** oturumdaki herkesi çalma imlecinden itibaren kaydeder; **Tek başına kaydet** yalnızca seni kaydeder. Bir çekim en fazla 30 dakika olabilir.

MIDI klavyen yok mu? Notaları bilgisayar tuşlarınla çal: <kbd>A</kbd>'dan <kbd>K</kbd>'ye kadar beyaz notalar, <kbd>Z</kbd> ve <kbd>X</kbd> oktavı değiştirir.

## Düzenleme

| Tuşlar | Ne yapar |
|---|---|
| <kbd>Space</kbd> | Çal veya durdur |
| <kbd>Home</kbd> | Başa dön |
| <kbd>L</kbd> | Döngüyü aç veya kapat |
| <kbd>S</kbd> | Klibi çalma imlecinden böl |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Çoğalt |
| <kbd>Q</kbd> | Kuantize et (notaları ızgaraya yapıştır) |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Geri al / yinele |
| <kbd>Tab</kbd> | Düzenleme görünümü ile mikser arasında geçiş yap |

**Piyano rulosunu** açmak için bir MIDI klibine çift tıkla. Ayrıca metronom ve sayım, işaretler, tempo değişiklikleri ve ses düzeyi ile efektler için otomasyon şeritleri de var.

**Mikserde** her parçanın ses düzeyi, pan, solo, susturma, efektler ve gönderimleri vardır.

## Efektler

Her parçanın, bus'ın ve master'ın bir efekt rafı vardır: EQ, filtre, kompresör, gate, limiter, reverb, delay, drive ve chorus. Eklemek için **+ Efekt**'e tıkla. Efektler yukarıdan aşağıya çalar; taşımak veya kaldırmak için birinin üzerine gel.

![Şarkı çalarken yan yana açık duran gitar EQ'su, kompresörü ve bas filtresi efekt pencereleri](shot:studio-effects)

Penceresini açmak için bir efekte tıkla. İstediğin kadar pencere açıp istediğin yere sürükleyebilirsin; öne getirmek için bir pencereye tıkla. Her pencere efektin ne yaptığını gösterir:

- **EQ** ve **filtre**: sesin spektrumu üzerindeki frekans eğrisi. Şekil vermek için eğrideki noktaları sürükle. Filtrede daha fazla veya daha az rezonans için yukarı ya da aşağı sürükle veya fare tekerleğini kullan.
- **Compressor**, **gate** ve **limiter**: ne kadar yüksek girdiğine karşılık ne kadar yüksek çıktığı, sesinin şu an nerede olduğunu gösteren bir nokta, son birkaç saniyenin seviyesi ve ne kadar kısıldığı.
- **Reverb**: kuyruğun şekli. **Gecikme**: sönerek kaybolan her yankı. **Sürüş**: öncesi ve sonrasıyla birlikte distorsiyon eğrisi. **Chorus**: tarama.

Şarkı çalarken görünümler ve **Giriş** ile **Çıkış** göstergeleri sesle birlikte hareket eder.

Bir ayarı değiştirmek için:

- Bir düğmeyi yukarı veya aşağı sürükle. İnce ayar için <kbd>Shift</kbd>'e basılı tut.
- Fare tekerleğini veya ok tuşlarını kullan.
- Düğmenin altına `2.5k` veya `25%` gibi bir değer yaz.
- Varsayılanına döndürmek için bir düğmeye çift tıkla.

Pencerenin başlık çubuğundaki güç düğmesi efekti kapatıp açar. Ok tüm ayarlarını sıfırlar.

> Tip: Aynı efekti iki parçada yan yana aç, örneğin gitarın EQ'sunu ve basın filtresini, ve şarkıyı çal. Her birinin nerede durduğunu görüp diğerine yer açabilirsin.

### Örnekler

Bunlar bir efektin varsayılan ayarlarından başlar. Çalışırken şarkıyı çal, tercihen **Döngü** açıkken; böylece pencereler senin sesini gösterir.

**Bir gitarın veya vokalin alt frekanslarını temizle.** Bir **EQ** ekle. Eğrideki **C** noktasını **Alçak kesim** yaklaşık `90 Hz` gösterene kadar sağa sürükle; altındaki uğultu gider ve eğrinin arkasındaki spektrum neyi çıkardığını gösterir. Partisyonu öne çıkarmak için **M** noktasını yaklaşık `2.5k`'ya ve birkaç dB yukarı sürükle.

**Bir vokali dengele.** Bir **Compressor** ekle. **Oran**'ı `4:1` yap, sonra eğrideki noktayı izlerken **Eşik**'i düşür: yüksek sesli kelimeler kıvrımı geçtiğinde **GR** göstergesi ne kadar kısıldıklarını gösterir. En yüksek kelimelerde yaklaşık 3 ila 6 dB hedefle, sonra partisyon eskisi kadar yüksek olsun diye **Telafi kazancı**'nı yaklaşık aynı miktarda artır.

**Bir filtreyi tara.** Bir synth veya davul parçasına bir **Filter** ekle ve **Alçak geçiren**'i seç. Şarkı çalarken eğrideki noktayı yavaşça sağdan sola sürükle: kesim frekansı düştükçe ses koyulaşır. **Rezonans**'ı değiştirmek için noktayı yukarı veya aşağı sürükle ya da üzerinde fare tekerleğini kaydır: daha fazlası kesim noktasında daha keskin, çınlayan bir tepe verir. Taramayı şarkının bir parçası yapmak için onu bir [otomasyon şeridiyle](#arranging-and-editing) kaydet.

**Gürültülü bir parçanın notalar arasında cızırdamasını durdur.** Rafın başına bir **Gate** ekle. Lambayı izle: partisyon çalarken **OPEN**, boşluklarda **CLOSED** yazar. **Eşik**'i boşluklarda kapanana ama korumak istediğin en sessiz notalarda açık kalana kadar yükselt.

**Bir partisyonu bir odaya yerleştir.** Bir **Reverb** ekle ve **Miks**'i yaklaşık `20%` yap. Daha uzun bir **Sönüm** daha büyük bir mekân verir; daha düşük bir **Ton** kuyruğu koyulaştırır, böylece kuru sesin arkasında durur.

**Tüm miksteki tepeleri yakala.** **Master**'a bir **Limiter** ekle ve **Tavan**'ı `-1 dB`'de bırak. Pencere, en yüksek anların ne sıklıkla bastırıldığını gösterir; sürekli çalışıyorsa bunun yerine parçaların sesini kıs.

## Grup olarak çalışmak

- **Grup**: herkes ya **Mühendis** (her şeyi değiştirebilir) ya da **Sanatçı**'dır (kendi partisyonlarını kaydeder). **Bu parçayı koru** başkalarının senin partisyonunu düzenlemesini engeller.
- **Oturumlar**: bir mühendis canlı olarak birlikte çalışmak için **Oturum başlat**'a tıklar. Herkes birinin çaldığını duyar.
- **Çekimler**: her kayıt saklanır. En iyisini **Çekimi burada kullan** ile seç.
- **Yorumlar**: şarkının bir noktasına "davul burada geride kalıyor" gibi notlar bırak ve bitince **Çöz**.
- **Sürümler**: büyük değişikliklerden önce **Sürüm kaydet**, gidişatı beğenmezsen **Geri yükle**.

Grupta olmayan dinleyiciler de şarkıyı çalabilir, takip edebilir ve yorum yapabilir.

Bağlantın mı koptu? Çalışmaya devam et. Değişikliklerin kaydedilir ve tekrar çevrimiçi olduğunda gönderilir.

## Başka bir yerdeyken çalışmak

Bir sohbete veya başka bir kanala geçtiğinde proje çalmaya, çekim de kaydetmeye devam eder. Bu sırada sol altta adının üstündeki bir kart projeyi, **Oynuyor** mu yoksa **Kayıt** mı olduğunu ve süreyi gösterir. Projenin ses odasındayken de görünür. Kanal listesindeki satırı çalarken hareket eden çubuklar, kaydederken kırmızı bir nokta gösterir.

- Projeye geri dönmek için karttaki proje adına tıkla.
- Karttan durdur veya çal. Çalma durduğun yerden devam eder.
- Projede durdurabiliyorsan çekimi karttan durdur.
- İşin bitti mi? Durdur, sonra kartı kapatmak için **✕**'e tıkla.

## Sonucu paylaşmak

**Dışa aktar** paneli şunları yapabilir:

- miksi WAV, FLAC veya MP3 olarak dışa aktarmak
- **stem'leri** dışa aktarmak (her parça ayrı ayrı, zip halinde)
- herkesin dinlemesi için **Miksi bir kanalda paylaş**
- projeyi başka bir müzik uygulamasında açmak üzere `.dawproject` olarak kaydetmek
