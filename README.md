# Kami DPS Meter (Aion DPS Lab)

Windows için yerel Aion 2 DPS ölçer prototipi. Arayüz tarayıcıda, Npcap yakalama arka planda çalışır. Kurulu Questlog 0.1.24'ün statik incelemesinden belgelenen paket yapıları için ayrı bir okuyucu ve hesaplama motoru yazılmıştır. Çalışmak için Questlog uygulamasının açık olması gerekmez.

## Başlat

İlk kurulum (Windows x64, Node.js 22+, pnpm ve Npcap gerekir):

```powershell
git clone https://github.com/LordStylo/kami-dps-meter.git
cd kami-dps-meter
pnpm install --frozen-lockfile
pnpm run update:skills
```

İkon görselleri yerel önbellektir ve Git deposuna dahil değildir; `update:skills` komutu bunları indirir. İkonlar olmadan da ölçer genel simgelerle çalışır.

**`Baslat.cmd` dosyasına çift tıkla.** Arayüz: http://127.0.0.1:4317

- Başlangıçta canlı yakalama açılır ve `Aion2.exe` beklenir.
- Oyun açıkken bölgeye gir veya teleport yap; ad ve parti paketleri böylece yeniden gelir.
- İlk vuruştan sonra hasar tablosu güncellenir. Bir oyuncuya tıklayınca yetenek dökümü açılır.
- Partim / Yalnızca ben / Tüm oyuncular ve hedef filtresi kullanılabilir.
- **Kayıttan incele** mevcut yerel Questlog savaşını kendi motorumuzla yeniden hesaplar; bu mod canlı yakalamayı kapatır.
- **Örnek savaş** yalnızca açıkça etiketlenmiş sentetik veridir.
- **Durdur** yakalamayı durdurur; **Kapat.cmd** arka plandaki uygulamayı da kapatır. Tarayıcı sekmesini kapatmak sunucuyu kapatmaz.

Başlatıcı Node PATH'te yoksa mevcut Codex Node çalışma ortamını da arar. Yönetici erişimi yalnızca Npcap sürücüsü buna göre kurulmuşsa gerekir; başlatıcı otomatik yetki yükseltmez.

## İlk sürümün kapsamı

- Gerçek Npcap FFI bağlantısı; süreç bazlı IPv4 TCP bağlantı keşfi; daraltılmış BPF filtresi.
- TCP sıra/örtüşme/tekrar iletim yönetimi, boşluk tanılama, akış senkronizasyonu.
- Aion 2 varint çerçeveleme ve raw LZ4 demetleri.
- **27 tam mesaj okuyucu + 4 başlangıç alanı okuyucusu**. Statik katalogda 85 mesaj var; bunların tümü uygulanmış değildir.
- Doğrudan hasar, süreli hasar, iyileştirme/kalkan ayrımı, oyuncu ve parti bilgisi, pet sahipliği.
- Oyuncu/skill bazında hasar, DPS, kritik oranı, DoT ve pet hasarı; zaman grafiği; JSON rapor indirme.
- Yetenek tablosunda gerçek ikon, İngilizce ad, DPS, oyuncunun hasarındaki pay, toplam hasar ve kritik oranı. Yerel katalogda 364 yetenek ve 320 farklı ikon bulunur.
- IPv4 Ethernet, VLAN, loopback ve raw bağlantı türleri; IPv6 ve IP fragman birleştirmesi yok.
- Ağdan veya programdan hiçbir veri dış servise yüklenmez. Sunucu yalnızca `127.0.0.1` dinler. Ham trafik ve hesap bilgileri diske kaydedilmez.

## Hesap tanımı ve sınırlamalar

DPS = seçilmiş hasar / `max(1 saniye, son seçilmiş hasar − ilk seçilmiş hasar)`. Oyuncular aynı süreyi paylaşır. 15 saniye oyuncu hasarı yoksa karşılaşma kapanır; boss veritabanına dayalı özel wipe/evre sistemi henüz yoktur. Kayıt oynatmada kaynak raporun hedefleri ve zaman aralığı seçilir; hasar değerleri günlükten yeniden hesaplanır. Ölüm ve aynı zaman damgalı olayların sırası korunur.

`dmg` alanı ek vuruş hasarını zaten içerir. Kritik yüzdesi ek vuruş adetleriyle ağırlıklandırılmaz; doğrudan hasar olayları üzerinden hesaplanır. 11.000.000–19.999.999 aralığındaki skill varyantları 10.000'lik taban kimlikte gruplanır.

Kimliği henüz bilinmeyen saldıranların olayları oyuncu toplamına tahminle eklenmez; tanı sayacına yazılır. Pet sahibi sonradan değiştiğinde önceki hasar yeniden başka oyuncuya atanmaz. Bölge değişiminde entity önbelleği temizlenir.

Yetenek adları ve ikonları [Questlog'un herkese açık yetenek veritabanından](https://questlog.gg/aion-2/en-nc/db/skills) alınan yerel katalogla eşleştirilir. KR/TW İngilizce kataloğu kullanılır. Katalogda olmayan yeteneklerin kimlik numarası ve genel simgesi görünür; NPC isim veritabanı henüz yoktur. Yetenek DPS'leri oyuncuyla aynı süreyi kullanır ve toplamları oyuncu DPS'sine eşittir. Yalnızca DoT içeren yeteneklerde kritik oranı uygulanmadığı için `—` gösterilir.

Oyunun üzerine sabitlenen native overlay, HPS tablosu, rDPS/buff katkısı, raid mekanikleri ve kurulum EXE'si bu ilk sürümde yoktur. Party scan-list dolu varyantı bilinçli olarak desteklenmiyor; hata sayacında belirtilir. Karakter/NPC görünme mesajlarının tamamı değil, gereken başlangıcı doğrulanır. Sürüm sonrası şema değişiklikleri yeniden incelenmelidir.

**Canlı oyun bağlantısı bulundu ve gerçek paketler çözüldü; canlı DPS doğruluğu henüz karşılaştırılmadı.** Dummy savaşında hasar ve süre karşılaştırması bekleniyor. Sentetik testler ve önceden ayrıştırılmış gerçek günlükler bu adımın yerine geçmez.

## Doğrulama

| Kontrol | Sonuç |
|---|---|
| Otomatik protokol / TCP / hesap testleri | 27 geçti |
| Gerçek Npcap ile sentetik loopback TCP → DPS | 13.000 / 13.000; geçti |
| Gerçek Npcap adaptör açma + süreç TCP tablosu | Geçti |
| Yerel 119 karşılaşmadan seçilen 10 kayıt | Toplam, kişi hasarı ve süre 10/10 birebir |
| Masaüstü ve dar ekran arayüz; filtre, seçim, replay, ikonlar, yetenek DPS, export | Geçti |
| Canlı Aion 2 bağlantısı ve mesaj çözümleme | Geçti; 2 süreç, 8 bağlantı, 2 adaptör algılandı |
| Canlı Aion 2 DPS karşılaştırması | Kullanıcı dummy testi bekleniyor |

`node scripts/validate-recordings.mjs`, yerel Questlog kayıtları varsa `research/recording-validation.json` dosyasında karşılaştırmanın sayısal sonuçlarını üretir. Bu kayıtlar önceden ayrıştırılmış Questlog olaylarıdır; ham paket doğrulaması olarak sunulmaz. Yerel günlükler projeye kopyalanmaz; kişisel doğrulama raporları Git'e dahil edilmez.

İlk canlı oturumun paket/mesaj sayaçları yerel `research/live-capture-validation.json` dosyasında tutuldu; bu dosya Git'e dahil edilmez. Test edilen Windows oturumunda `Get-Process -Name Aion2` boş sonuç verdiği için süreç keşfi `Win32_Process` CIM sorgusuyla yapılır. Oyunun yeniden başlatılması gerekmez.

## Geliştirme

```powershell
pnpm install
node src/server.mjs
node --test test/*.test.mjs
node scripts/check-npcap.mjs
node scripts/validate-npcap-loopback.mjs
node scripts/validate-recordings.mjs
```

UI smoke testi `scripts/ui-smoke.mjs`, kurulu Microsoft Edge ve Playwright ister. `PLAYWRIGHT_PATH` ile kendi modül yolun verilebilir; bu bilgisayar için Codex çalışma ortamındaki Playwright varsayılandır. UI testi demo/kayıt modlarını değiştirir; çalışan canlı ölçeri etkilememek için `--idle` ile ayrı bir test sunucusu açıp `AION_UI_TEST_URL` ile onun adresini ver.

`node scripts/update-skill-catalog.mjs` herkese açık ad/ikon kataloğunu yeniler; global İngilizce sürümü için sona `en` eklenebilir. Bu komut yalnızca genel oyun verilerini indirir. İkonlar `public/icons/skills/` içinde tutulur; ölçer çalışırken CDN bağlantısı gerekmez. Kaynak ve alınma tarihi `data/skills.json` içindedir.

`AION_METER_PORT` terminalden sunucuya farklı port verir. Çift tıklamalı başlat/kapat dosyaları varsayılan 4317 portu içindir.

## Dosyalar

- `research/PROTOCOL.md`: bayt düzeni, alan sıraları, bayraklar, hesap kuralları ve belirsizlikler.
- `research/packet-catalog.json`: 85 mesajlık statik envanter.
- `src/protocol/`: bağımsız reader, mesaj çözücüler, çerçeve ve LZ4.
- `src/capture/`: Npcap ve Windows FFI, TCP yönetimi, ayrı yakalama worker'ı.
- `src/meter.mjs`: kimlik, sahiplik, hedef ve istatistik.
- `src/replay.mjs`: salt okunur yerel kayıt içe aktarma / karşılaştırma.
- `src/server.mjs`, `public/`: yerel servis ve arayüz.
- `data/effect-types.json`: kurulu sürümden çıkarılan sayısal effect sınıflandırmaları.
- `data/skills.json`, `src/skills.mjs`, `public/icons/skills/`: ad/ikon kataloğu, eşleştirme ve yerel görseller.
- `scripts/inspect-install.mjs`, `scripts/catalog-protocol.mjs`: tekrar üretilebilir statik inceleme araçları.
- `research/private/`: orijinal uygulamadan araştırma kopyaları; `.gitignore` içinde. Uygulama bunları yüklemez.

Genel format ve API başvuruları [protokol notlarında](research/PROTOCOL.md) listelenmiştir.
