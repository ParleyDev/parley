---
title: Moderasyon ve güvenlik
section: Sunucu yönetmek
summary: AutoMod, zaman aşımları, yasaklar, bildirimler, baskın koruması ve denetim kaydıyla sunucunu dostane tut.
source: cef706ea7d87
---

## Biriyle ilgilenmek

Bu seçenekler için bir kişiye sağ tıkla (veya telefonda basılı tut):

| Seçenek | Ne olur |
|---|---|
| **Zaman Aşımı** | 60 saniyeden bir haftaya kadar okuyabilir ama mesaj yazamaz, tepki veremez veya sesli kanala katılamaz. **Zaman Aşımını Kaldır** onu erken bitirir. |
| **At** | Onu sunucudan çıkarır. Yeni bir davetle geri gelebilir. |
| **Yasakla** | Onu çıkarır ve geri gelmesini engeller. Son birkaç güne (en fazla 7) ait mesajlarını da silebilirsin. |
| **Moderatör Görünümü** | Sunucundaki geçmişi: uyarılar, zaman aşımları ve notlar. Onu **Uyar**abilir ya da bir şeyi araştırırken **Karantina**ya alabilirsin. |

Her zaman bir gerekçe ekle. Denetim kaydında saklanır, böylece ekibin geri kalanı ne olduğunu bilir.

Yasakları **Sunucu Ayarları → Yasaklar** altında kaldır. Sunucu izin veriyorsa yasaklanan üyeler itiraz edebilir. İtirazlar orada kabul etmeni veya reddetmeni bekler.

Bir spam selini temizlemek için son 50 mesajı silmek üzere `/purge 50`, yalnızca bir kişininkileri silmek için `/purge 50 @someone` yaz (bir seferde en fazla 100).

## AutoMod

**Sunucu Ayarları → AutoMod**, ortalıkta hiç moderatör olmasa bile sorunları otomatik olarak yakalar. Kurallar şunları yapabilir:

- **Kelimeleri engelle**: kelime veya ifadelerden oluşan bir liste. Joker karakter olarak `*` kullan.
- **Bahsetme spamını engelle**: aynı anda çok fazla kişiye bildirim gönderen mesajlar.
- **Bağlantıları engelle**: izin verdiklerin dışındaki tüm sitelere giden bağlantılar.
- Kurallarını çiğneyen **Takma adları filtrele**.

Her kural için ne olacağını seç:

- mesajı engelle, istersen gönderene kendi mesajınla
- bir moderatör kanalına uyarı gönder
- kişiye zaman aşımı uygula

Rolleri veya kanalları da muaf tutabilirsin; örneğin moderatörlerin kötü kelimeleri tartıştığı bir kanal. Sunucuyu yönetebilen kişiler asla filtrelenmez.

## Güvenlik kurulumu

**Sunucu Ayarları → Güvenlik kurulumu** büyük anahtarları barındırır:

- **Doğrulama düzeyi**: yeni gelen birinin mesaj yazabilmesi için ne gerektiği. **Düşük** doğrulanmış bir e-posta ister. **Orta** ayrıca 5 dakikadan eski bir Parley hesabı ister. **Yüksek** ayrıca sunucunda 10 dakika geçirmeyi ister. Herhangi bir rolü olan üyeler bunu atlar.
- **Baskın koruması**: ani bir yeni hesap akınını fark eder ve moderatörlerini uyarır.
- **Davetleri duraklat** ve **Üyeler arası DM'leri duraklat**: baskın sırasında acil frenler.
- **Yalnızca yetişkinlere açık sunucu**: **Bu sunucudaki her şey 18+** kutusunu işaretlersen sunucunun herhangi bir yerinde yalnızca 18 yaşında veya daha büyük olduğu onaylanmış üyeler okuyabilir ya da sohbete katılabilir. Yalnızca bazı alanları kısıtlamak için bunun yerine bir kanalda veya kategoride **Yaş sınırlı**'yı kullan. Bkz. [Kanallar ve kategoriler](server-settings#channels-and-categories).
- **Müstehcen görsel filtresi**: sunucuda paylaşılan resimleri tarar. Kontrolü her üyenin uygulaması yapar; yöneticileri bunu kurduysa Parley sunucun da yapar.
- **Moderatörler için iki faktörlü kimlik doğrulama**: moderatörlerin 2FA'yı açmış ya da bir geçiş anahtarı eklemiş olması gerekir; böylece çalınan bir parola sunucuya karşı kullanılamaz. İkisinden biri yeterlidir ve bunu açmak için senin de birine sahip olman gerekir.
- **Yapay zeka özetleri**: Özetler düğmesini aç veya kapat.

## Bildirimler

Üyeler **Mesajı Bildir** veya **Kullanıcıyı Bildir** dediğinde ve bu sunucunun moderatörlerine de haber verme kutusunu işaretlediğinde, bildirim **Sunucu Ayarları → Şikayetler** altına düşer. Bağlamında görmek için **Atla**, sonra **Çöz** ya da **Kapat**.

Bir çocuğun güvenliğiyle veya rıza olmadan paylaşılan mahrem görüntülerle ilgili bildirimler burada asla görünmez. Yalnızca Parley sunucunu yöneten ekibe gider.

## Denetim kaydı

**Denetim Kaydı** kimin neyi değiştirdiğini kaydeder: roller, kanallar, yasaklar, atmalar, zaman aşımları, silinen mesajlar ve ayarlar. Kişiye veya işlem türüne göre filtrele. Bir şey değiştiğinde ve kimse nedenini bilmediğinde ilk bakılacak yer burasıdır.

## Parley'ye bildirmek

Tehditler, yasa dışı içerik veya birçok sunucuya yayılan spam gibi bazı şeyler tek bir sunucuyu aşar. Her bildirim Parley sunucunu yöneten yöneticilere gider. Kutuyu işaretlemek onu o sunucunun moderatörlerine de gönderir.

Bildirmek için bir mesaja sağ tıklayıp **Mesajı Bildir**'i seç ya da bir kişiye sağ tıklayıp **Kullanıcıyı Bildir**'i seç. Neyin yanlış olduğunu seç, yardımcı olabilecek her şeyi ekle ve **Bildirimi Gönder**'i seç.

Bazı nedenlere önce bakılır: **Şiddet tehdidi**, **Biri kendine zarar verebilir**, **Rıza olmadan paylaşılan mahrem görüntüler** ve **Bir çocuk risk altında** altındaki seçeneklerin çoğu. Bir çocuğun güvenliğiyle veya mahrem görüntülerle ilgili bildirimler yalnızca Parley sunucunu yöneten ekibe gider, asla bir sunucunun moderatörlerine gitmez; bu yüzden bunlarda kutu sunulmaz.

Bildirdiğin şey, gönderdiğin anda kopyalanır: mesaj, mesajdaki dosyalar ve bir sunucu kanalındaysa hemen öncesinde ve sonrasında söylenenler. Mesajı sonradan silmek kopyayı kaldırmaz.

> Heads up: Bir çocuğun cinsel içerikli resimlerine veya videosuna rastlarsan, kanıt olarak bile olsa bunları kaydetme, ekran görüntüsünü alma ve kimseye iletme. Mesajı bildir ve olduğu yerde bırak. Bildirimin gerekeni saklar.

> Note: Biri şu anda tehlikedeyse önce yerel acil durum numarasını ara, sonra bildir.

Saatte en fazla 10 bildirim gönderebilirsin. Önce bakılan nedenlerin kendine ait, daha yüksek bir sınırı vardır.
