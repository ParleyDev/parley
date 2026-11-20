---
title: Moderasyon ve güvenlik
section: Sunucu yönetmek
summary: AutoMod, zaman aşımları, yasaklar, bildirimler, baskın koruması ve denetim kaydıyla sunucunu dostane tut.
source: ede402610205
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
- **Müstehcen görsel filtresi**: sunucuda paylaşılan resimleri tarar.
- **Moderatörler için iki faktörlü kimlik doğrulama**: moderatörlerin 2FA'yı açmış ya da bir geçiş anahtarı eklemiş olması gerekir; böylece çalınan bir parola sunucuya karşı kullanılamaz. İkisinden biri yeterlidir ve bunu açmak için senin de birine sahip olman gerekir.
- **Yapay zeka özetleri**: Özetler düğmesini aç veya kapat.

## Bildirimler

Üyeler **Mesajı Bildir** veya **Kullanıcıyı Bildir** dediğinde ve bu sunucunun moderatörlerine de haber verme kutusunu işaretlediğinde, bildirim **Sunucu Ayarları → Şikayetler** altına düşer. Bağlamında görmek için **Atla**, sonra **Çöz** ya da **Kapat**.

## Denetim kaydı

**Denetim Kaydı** kimin neyi değiştirdiğini kaydeder: roller, kanallar, yasaklar, atmalar, zaman aşımları, silinen mesajlar ve ayarlar. Kişiye veya işlem türüne göre filtrele. Bir şey değiştiğinde ve kimse nedenini bilmediğinde ilk bakılacak yer burasıdır.

## Parley'ye bildirmek

Tehditler, yasa dışı içerik veya birçok sunucuya yayılan spam gibi bazı şeyler tek bir sunucuyu aşar. Her bildirim Parley sunucunu yöneten yöneticilere gider. Kutuyu işaretlemek onu o sunucunun moderatörlerine de gönderir.
