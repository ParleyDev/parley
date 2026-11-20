---
title: Uygulamalar, botlar ve yapay zeka asistanları
section: Sunucu yönetmek
summary: Sunucuna bot ekle, komutlarını kullan ve hesabına bir yapay zeka asistanı bağla.
source: a98657c6c333
---

**Uygulamalar** Parley'ye özellikler ekler. **Bot**, bir sunucuya üye gibi katılan bir uygulamadır: insanları karşılayabilir, oyunlar yönetebilir, müzik çalabilir veya güncellemeler paylaşabilir.

## Uygulama bulmak

**Uygulama Dizini**'ni Keşfet'ten (**Uygulama Dizinine Göz At**) ya da **Kullanıcı Ayarları → Yetkili Uygulamalar**'dan aç. Ara ya da kategoriye göre göz at. **Doğrulandı** rozeti, Parley'nin uygulamayı kimin yaptığını kontrol ettiği anlamına gelir.

## Sunucuna bot eklemek

1. Uygulamada **Sunucuya Ekle**'ye tıkla ya da yapımcısının verdiği davet bağlantısını aç.
2. **Sunucuyu Yönet** iznine sahip olduğun bir sunucu seç.
3. İstediği izinleri kontrol et. İhtiyacı olmayanların işaretini kaldır.
4. **Yetkilendir**'e tıkla.

Bot kendine ait bir rol alır. İzinlerini **Sunucu Ayarları → Roller** bölümünden değiştirebilirsin. Bir botu kaldırmak için **Sunucu Ayarları → Entegrasyonlar**'ı kullan ya da herhangi bir üye gibi at.

## Yalnızca senin için uygulamalar

Bazı uygulamalar **Uygulamalarıma Ekle** ile kendi hesabına eklenebilir. Sonra onları her yerde kullanabilirsin: herhangi bir sunucuda veya DM'de. Bir mesaja veya kişiye sağ tıkladığında **Uygulamalar** altında da görünürler.

## Komutları kullanmak

Mesaj kutusunun başına `/` yaz. Önce Parley'nin kendi komutları, sonra orada kullanabileceğin her uygulamanın komutları gelir. Birini seç, seçeneklerini doldur ve <kbd>Enter</kbd>'a bas. Bazı uygulamalar bir form açar ya da yalnızca sana yanıt verir.

## Yapay zeka asistanları

Claude, ChatGPT veya Cursor gibi bir yapay zeka asistanının senin için mesajları okumasına ve göndermesine izin verebilirsin. Ona "neleri kaçırdım?" ya da "Sam'e geç kalacağımı söyle" gibi şeyler sor.

1. **Kullanıcı Ayarları → Yetkili Uygulamalar**'ı aç ve **Yapay zeka asistanları (MCP)** altındaki adresi kopyala.
2. Asistanında bunu özel bir bağlayıcı olarak ekle (adı *uzak MCP sunucusu* olabilir).
3. Parley, asistanın neler yapabileceğini soran bir sayfa açar: **Okuma**, **Bildirimler**, **Mesaj gönder** veya **Sunucuları yönet**. Yalnızca ihtiyacın olanı seç, sonra onayla.

> Heads up: Asistanın gönderdiği her şey senin adınla görünür. **Sunucuları yönet** ile mesajları silebilir veya insanları çıkarabilir, bu yüzden buna yalnızca gerçekten istiyorsan izin ver.

Durdurmak için **Yetkili Uygulamalar**'da asistanın yanındaki **Bağlantıyı Kes**'e tıkla.

## Yöneticiler için araçlar

Profil kozmetikleri yapmak için Profile Studio gibi sunucunda çalışan bazı araçlar da aynı şekilde oturum açar. Araçtan oturum açtığında Parley, ona **Kozmetikleri yönet** izni vermeni isteyen bir sayfa açar: sunucuya kozmetik eklemek ve var olanları değiştirmek. Yalnızca hesabın sunucuyu yönetebiliyorsa çalışır ve araç parolanı asla görmez.

> Heads up: Eklediği veya değiştirdiği her şey herkes için anında görünür. Yalnızca güvendiğin araçlara izin ver.

Durdurmak için **Yetkili Uygulamalar**'da aracın yanındaki **Bağlantıyı Kes**'e tıkla.

## Kendi uygulamanı yapmak

Bir bot mu yapmak istiyorsun? **Kullanıcı Ayarları → Uygulamalar** bölümünde bir uygulama oluştur ve [geliştirici belgelerini](https://app.runparley.com/developers) oku.
