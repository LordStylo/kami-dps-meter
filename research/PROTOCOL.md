# Aion 2 paket incelemesi — 14 Ekim 2026

## Kanıt ve kapsam

Kaynak, bu bilgisayardaki Questlog Desktop **0.1.24** kurulumudur. `scripts/inspect-install.mjs` ASAR arşivini yalnızca okur ve biçimlendirilmiş araştırma kopyalarını git dışında kalan `research/private/` klasörüne çıkarır. Kaynak kod çalıştırılmaz. Arşivin SHA-256 özeti bu klasördeki manifestte bulunur. Uygulama çalışma sırasında Questlog kodunu yüklemez.

`packet-catalog.json` statik olarak görülen **85 mesajın** adını ve opcode değerini listeler. Bu, oyunun bütün protokolünün çözüldüğü anlamına gelmez. İlk prototipin kapsamı hasar, süreli hasar, iyileştirmeyi ayırma, kimlik/parti eşleştirmesi, pet sahipliği ve TCP yakalamadır. Envanter, ticaret, görevler, görünüm, rDPS katkı modeli ve bütün boss mekanikleri kapsam dışıdır.

Kurulu sürümdeki `combat.cjs` dosyasında işlevsel katmanlar: Windows bağlantı keşfi; Npcap; TCP sıralama; mesaj çerçeveleme; LZ4 açma; alan okuma; oyun olayına dönüştürme; kimlik/parti durumu; karşılaşma ve istatistik; uygulama içi mesajlaşma.

## Ağ akışı

1. `Aion2.exe` süreç kimlikleri `Win32_Process` CIM sorgusuyla bulunur. Bu Windows oturumunda adla `Get-Process` sorgusu oyun açıkken boş sonuç döndürdüğünden kullanılmaz; CIM sorgusu iki gerçek oyun sürecini ve bunlara ait sekiz TCP bağlantısını buldu.
2. Windows `GetExtendedTcpTable` ile bu süreçlerin IPv4 TCP bağlantıları bulunur.
3. Bağlantının yerel adresine karşılık gelen Npcap adaptörü açılır. Yerel proxy için loopback adaptörü kullanılabilir.
4. BPF filtresi oyunun bağlantı portlarına daraltılır; uygulama ayrıca tam kaynak/hedef adres çiftini doğrular.
5. Gelen TCP verisi sıra numarasına göre birleştirilir. Tekrar iletilen baytlar ikinci kez işlenmez. Eksik aralıklar zaman aşımında tanı kaydına dönüşür.
6. Tam mesajlar ayrıştırılır ve normalleştirilmiş olaylar hesaplama motoruna gider.

Prototip IPv4, Ethernet/VLAN, Npcap loopback ve ham IPv4 bağlantı türlerini destekler. IPv6 ve IP parçalarının yeniden birleştirilmesi desteklenmez; tanılama bu sınırlamayı gösterir. Paketler değiştirilmez veya sunucuya gönderilmez.

## Çerçeve ve sıkıştırma

Tel üzerindeki mesaj: `varuint32 uzunluk | uint16 LE opcode | payload`.

**Önemli:** Uzunluk alanı varint biçimine küçülmeden önceki 4 baytlık uzunluk alanını hesaba katar. Varint değeri `L`, kapladığı bayt sayısı `N` ise tel üzerindeki toplam mesaj boyu **L − 4 + N** olur. Payload boyu **L − 6** olur. Örneğin 8 bayt payload için `L=14`, tek bayt varint ve toplam 11 bayt mesaj vardır.

`0xffff` opcode bir sıkıştırılmış demettir. Payload: `uint32 LE açılmış boy | LZ4 raw block`. Açılmış içerik yeniden aynı çerçeve biçiminde mesajlar içerir. Bellek, iç içe demet ve mesaj sayısı sınırları uygulanır. Bozuk demet kısmi hasar üretmemelidir.

TCP akışına ortadan katılındığında rastgele baytlardan sahte hasar çıkarmamak için iki ardışık, tam doğrulanmış mesaj sınırına kilitlenilir. Sadece başlangıç alanları çözülen karakter görünme paketleri tek başlarına bu kilidi oluşturmaz.

## İlkel türler

- Sabit çok baytlı sayılar little endian.
- `vi32`, ZigZag değil: 7 bitlik grupların birleşimi, ardından int32 yorumu.
- `vi64`, aynı yöntemle 64 bit ikiye tümleyen sayı; hassasiyet kaybını önlemek için BigInt ile okunur.
- Metin: varuint32 bayt uzunluğu ve UTF-8; sondaki NUL uzunluğa dahil olabilir.
- Liste: varuint32 eleman sayısı ve elemanlar.
- **Bool alanları bit paketlidir:** ilk bool için ayrılan baytın bitleri LSB'den itibaren tüketilir. Araya normal alanlar girse de sonraki bool aynı baytın sonraki bitini kullanır. Her bool ayrı bayt değildir.
- Bayraklarla koşullu alanlar atlandığında akıştan bayt tüketilmez.

## Doğrudan etki: 0x3804

Alan sırası:

| Alan | Tür / koşul |
|---|---|
| Hedef entity key | vi32 |
| Varlık bayrakları | uint16 |
| Saldıran entity key | vi32 |
| Skill ID | int32 |
| Action UID | uint8 |
| Parts ID | int32; bit 0 |
| Hit type | uint8; 2 normal, 3 kritik |
| Vuruş ayrıntıları | bit 1; 6 bool, restoration HP vi64, 1 bool, angle uint8 |
| Effect ID, effect sequence | int32, int32 |
| Attack speed | vi32 |
| **dmg** | vi64; bit 2 |
| MP damage | int32; bit 3 |
| Sealstone | bool; bit 4 |
| Additional hit damages | vi64 listesi; bit 5 |
| Barrier IDs | int32 listesi; bit 6 |
| Abnormal effect type | uint8; bit 7 |
| Abnormal IDs | int32 listesi; bit 8 |
| Skill process UID | uint16 |
| HP drain | vi64; bit 9 |
| HP recovery | vi64; bit 10 |
| Force kill abnormal ID | int32; bit 11 |
| Barrier attack | bool; bit 12 |
| AP damage | int32; bit 13 |

**Hasar `dmg` değeridir. Additional hit değerleri bu toplama tekrar eklenmez.** Referansın vuruş adedi `1 + additionalHitDmgs.length` olur. Kritik durumu olay için tutulur. İyileştirme ve hasar dışı effect ID'leri ayrılmalıdır. HP drain ve HP recovery saldıranın kendisine iyileştirme olarak yazılır.

## Süreli etki: 0x3805

`target vi32; flags u8; caster vi32; abnormal UID vi32; effect ID i32` ardından:

| Bit | Alan |
|---|---|
| 0 | remainDmg vi64 |
| 1 | dmg vi64 |
| 2 | barrier IDs: i32 listesi |
| 3 | skill ID i32 |
| 4 | immune caster vi32 |
| 5 | immune skill i32 |
| 6 | reflected skill i32 |

Kalkan mesajındaki remaining değerini hasar saymamak gerekir. Süreli iyileştirme effect ID'leri hasardan ayrılır. Skill ID yoksa olay kaybolmaz; buff UID/ID veya bilinmeyen yetenek olarak gösterilir. Yansıma varsa raporlama için yansıtan yetenek kullanılır.

## Kimlikler, petler ve parti

- `0x3633`: kendi karakterinin görünmesi. Key, açıklama, isim, sınıf kodu ve HP başlangıç bölümünde bulunur.
- `0x3645`: diğer oyuncunun görünmesi. Key, açıklama, durum, isteğe bağlı server ID.
- `0x3641`: NPC görünmesi. Key, açıklama, durum, abnormal listesi ve flag bit 4 ile parent key. Parent key pet hasarını sahibine bağlar.
- Bu üç büyük mesajın ilk prototipte yalnızca gereken başlangıç bölümü okunur. Tam mesaj şeması doğrulaması olarak sunulmaz.
- `0x9200`: parti tam listesi. `0x920d` / `0x9222`: eklenen/yeniden bağlanan üye.
- Üye içinde key, sunucu kimlikleri, hesap kimliği alanı, dbid, isim, sınıf kodu, HP/MP/AP/DP, harita, konum, bool bayrakları, seviye ve ekipman bilgileri bulunur. Hesap kimliği alanı okunup atlanır; çıktıya taşınmaz.
- Scan listesi bulunan parti varyantı kurulu referansta da tamamlanmamış okuyucuya düşüyor. Prototip bu varyantı açıkça desteklenmiyor olarak sayar.
- Raid/force: `0x9602`, `0x960a`, `0x961b`, `0x9622`; üyeleri parti benzeri key/dbid eşleştirmesiyle takip etmek gerekir.
- Bölge değişiminde entity key'ler yeniden kullanılabilir. Eski sahiplik ve kimlik önbelleğini yeni bölgeye taşımamak gerekir.
- `0x921b` / `0x962b` parti/force HP mesajları yalnızca HP değil, üyelik kanıtı olarak da kullanılır. Bölge değişiminde entity key'ler atılır; doğrulanmış dbid veya isim+sunucu kimliği tutulup yeni görünme mesajıyla bağlanır. Bu, eksik scan-list roster yüzünden yakalanan parti hasarının filtrede kaybolmasını önler. Sıradan HP mesajı üyelik sayılmaz; ayrılma/atılma kimliği temizler.

Sınıf kodu için incelenen dönüşüm: `floor((pcId - 1) / 4)`; 1 Gladiator, 2 Templar, 3 Ranger, 4 Assassin, 5 Elementalist, 6 Sorcerer, 7 Cleric, 8 Chanter, 11 Fighter. Eşleşmeyen değerler isim uydurulmadan gösterilir.

## Zaman ve hesaplama

Referansın seçilmiş hedef/oyuncu kapsamındaki DPS paydası `max(1 saniye, son hasar zamanı − ilk hasar zamanı)` olarak bulunmuştur. Aynı kapsamdaki bütün oyuncular ortak süre kullanır. İlk prototip bu açık tanımı uygular. Canlı ekranın saatine göre sürekli artan payda kullanılmaz.

Karşılaşma kuralları kurulu Questlog 0.1.24'ün statik incelemesindeki davranışa göre uygulanır:

- Kendi karakteri biliniyorsa yeni karşılaşmayı yalnızca kendi/parti hasarı başlatır. Aktif karşılaşmada diğer oyuncular da toplanıp kapsam filtresiyle ayrılabilir. Yakalamaya ortadan katılıp kendi görünme paketini kaçırdığımız durumda kimlik toparlanana kadar hasar toplamaya devam edilir; bu açık bir kurtarma farkıdır.
- Boss kataloğu `data/bosses.json` içindedir; kaynak ve indirme zamanı dosyada bulunur. `0xe005` groggy güncellemesi de NPC'yi boss olarak tanımlar. Görünme paketinin sonundaki groggy alanları henüz okunmadığı için katalogda olmayan ve güncelleme göndermeyen boss tanınmayabilir.
- Parti hedefi boss için **ölüm olayı** hemen `kill` ile bitirir. Yalnızca HP=0 veya zindan ödül bildirimi bitiş sayılmaz. Normal yaratık ölümü: tüm parti hedefleri öldüğünde, parti savaş durumu bilinmiyorsa kapanır; biliniyorsa parti savaş çıkışı beklenir.
- Normal savaşta bilinen katılımcıların hepsi savaş dışındaysa anında kapanır; bilinmeyen durumlar hesaba katılmaz. Boss varken kendi karakterinin savaş çıkışı karşılaşmayı bölmez. Hedeflerin tamamı öldü/savaş dışıysa boss karşılaşması `kill`/`wipe` ile biter.
- Hasar almış boss HP'sinin tam dolması `wipe` sayılır. Boss kaybolması: `died` (3) ölüm olayını bekler; `despawned` (7) ve katalogdaki scripted-exit işareti `despawn`; diğerleri `wipe`. Sıradan yaratığın kaybolması tek başına bitirmez.
- Son parti vuruşundan itibaren normal bekleme sınırı **15 saniye**; periyodik kontrolde parti boss hedefi varsa **90 saniye**. Yeni vuruştan önceki kontrolde 90 saniye yalnızca hayattaki bossun savaşta olduğu açıkça biliniyorsa kullanılır. Yakındaki yabancı oyuncular bu süreyi uzatmaz. Bölge değişimi `zone` ile kapatır.
- Bitiş olayının zamanı/hasarsız bekleme DPS paydasına eklenmez. Seçili kapsamdaki olay sırasının ilk ve son hasarı kullanılır; alt sınır bir saniyedir. Kaybolan petin devam eden DoT'u sahibine yazılır; yeni appearance veya bölge değişimi eski sahipliği değiştirir.

Pencere görünürlüğü karşılaşma hesabından ayrıdır: kendi karakterinin combat-state değeri varsa DPS overlay buna göre gizlenir/açılır; bilgi yoksa aktif karşılaşmaya döner. Boss arası savaş dışı durumu pencereyi gizleyebilir fakat tek başına boss hasarını silmez. Son savaş tarayıcıda korunur.

Kaçırılmış bir combat-enter paketi sonrası eski `false` bilgisinin yeni vuruşu gizlememesi için, durum olayından sonra kabul edilen doğrudan kendi saldırısı 3 saniyelik görünürlük sağlar. Eşit zaman damgalarında olay işleme sırası kullanılır. Daha sonraki `false`, süre dolmasını beklemeden öncelik alır; pet/DoT/yabancı hasarı bu kanıtı üretmez. Bu, hesaplama veya karşılaşma bitirme kuralı değildir.

İyileştirme miktarları mevcut doğrudan/periyodik heal olaylarından toplanır. Sahiplik ve üyelik olay anında kaydedilir; partinin ortak ilk/son hasar süresi HPS paydasıdır. Sadece iyileştirme yapan katılımcılar ayrı `healers` listesinde görünür, DPS sıralamasını değiştirmez. Düşman hedef filtresi iyileştirmeye uygulanmaz; hedef alanı iyileştirilen dosttur. Paketlerdeki miktar için effective/overheal ayrımı yapılmaz ve kritik yüzdesi üretilmez. İyileştirme tek başına karşılaşma başlatmaz veya bekleme süresini uzatmaz.

`scripts/validate-encounters.mjs`, yerel ayrıştırılmış Questlog günlüklerini baştan sona kendi motorumuzdan geçirir; başlangıç/bitiş zamanlarını kesmeden otomatik sınırları, toplam/oyuncu hasarını ve bitiş nedenini kayıtlarla karşılaştırır. 17 Ekim 2026'da altı günlükteki **27/27** kayıt eşleşti (kill ve wipe dahil). Bu, ham ağ yakalamasındaki tüm paketlerin veya bütün boss mekaniklerinin eşitliğini kanıtlamaz. rDPS katkı modeli ve eksik-yakalama tahminleri uygulanmaz.

Kayıttan inceleme, kaydedilmiş hedef **ve katılımcı** kapsamını uygular; aksi halde açık dünya bossunda yakın yabancıların hasarı kaydın parti/self toplamına eklenir.

`data/effect-types.json` sürüme bağlı sayısal effect sınıflandırma verisidir. Oyun yaması sonrası bunun ve alan şemalarının tekrar doğrulanması gerekir. Bilinmeyen opcode'lar ve ayrıştırma hataları tanı sayaçlarında görünür.

## Doğrulama katmanları

1. Sentetik tel mesajları: çerçeve uzunluğu, bit bool, vi64, direct/DoT/heal, LZ4, parçalanma, tekrar iletim, sıra dışı TCP ve bozuk veri.
2. Kullanıcının yerel Questlog olay günlükleri: bağımsız yeniden toplamayla kişi/skill/target hasar ve süre karşılaştırması. Bunlar **önceden ayrıştırılmış olaylar**, dolayısıyla ham protokolü doğrulamaz.
3. Npcap açma ve adaptör keşfi: gerçek sürücüyle kontrol.
4. Gerçek oyunla paket→DPS karşılaştırması: oyun çalışırken yapılmalı; önceki katmanlar bunun yerini tutmaz.

Genel format/API kaynakları: [LZ4 raw block](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md), [Npcap paket okuma](https://npcap.com/guide/wpcap/pcap_next_ex.html), [Windows TCP tablosu](https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedtcptable).
