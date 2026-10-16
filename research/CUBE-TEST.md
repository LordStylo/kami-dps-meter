# Hidden cube paket inceleme testi

Amaç: oyuncu yakında gerçek, alınabilir bir hidden cube varken gelen bir mesaj veya nesne türünü ayırt edebilmek. İlk kayıttan elde edilen 1200039 türü için deneysel alarm var; tür kapsamı ve mesafe eşiği henüz doğrulanmadı. Harita üzerinde konum gösterimi bu çalışmanın hedefi değil.

## Rekabet varsa hızlı akış

Aramadan **önce** Baslat.cmd ile ölçeri aç. Otomatik alarm için **Sesi aç ve dene** düğmesine bas. Hidden cube test panelinde **Aramayı başlat** seç; mesaj sayacının ilerlediğini ve kısayolların hazır olduğunu kontrol et. Son 60 saniyeye kadar eşzamanlı oyun mesajı bellekte tutulur. Araştırma açık değilken geçmiş paketler geri alınamaz. Otomatik alarm olayları da tampon/kayıtta `cube-alert` olarak saklanır; rapordaki `automaticAlerts` alanı Buldum/Açtım ile karşılaştırılabilir. Bunlar sesin hoparlörden duyulduğunu değil, sunucuda adayın tespit edildiğini gösterir.

- **Ctrl + Shift + F8 — Buldum:** gördüğün anda işaretle; önceki tampon diske alınır, sonraki mesajlar da yazılır.
- Cube'u hemen al. Uzaklaşmak veya sohbetten haber vermek için bekleme.
- **Ctrl + Shift + F9 — Açtım:** açtıktan hemen sonra bas; 30 saniye sonra dosya tamamlanır. Önce F8'e basamadıysan F9 tek başına da önceki tamponu korur.
- Sonra bana kaydın hazır olduğunu söyle. İlk işaretin zamanına göre yaklaşma ve açılma çevresini inceleyebiliriz.

Kısayollar Windows RegisterHotKey ile capture worker thread'inde kaydedilir ve yalnızca araştırma açıkken aktiftir. Başka uygulama aynı kısayolu kullanıyorsa panel uyarır; düğmeler kullanılabilir. Sentetik WM_HOTKEY mesajlarıyla worker kuyruğu test edildi; bu, oyunun odaktayken fiziksel tuşları ilettiği anlamına gelmez. İlk fırsatta “Buldum” işaretinin panelde göründüğünü kontrol et. İşaret anı, uygulamanın tuş mesajını işlediği yerel zamandır; sunucudaki açılma anının kesin zamanı değildir.

## Vakit varsa daha güçlü karşılaştırma

Ek işaretleri yalnızca cube'u kaçırma riski yoksa kullan: yaklaşma, yanında olma, uzaklaşma, uzakta olma, tekrar yanında olma, açmaya başlama, açıldı. Aynı türü ikinci bir cube'da ve cubesuz bir kontrol rotasında tekrarlamak yanlış pozitifleri ayırt etmekte yardımcı olur. Başka oyuncu önce açarsa bunu sohbetten belirt; kaydı kendi açılışın gibi yorumlamayalım.

İşaret öncesi bölüm otomatik olarak “uzaktaydım” sayılmaz: aramayı zaten cube yanında açmış olabilirsin. F9 tek başına kullanılırsa yaklaşma ile açılışı ayrı ayrı kesinleştirmek daha zor olur; yine de kayıt yararlıdır.

## Saklama ve sınırlar

- Normal DPS modunda bu kayıt kapalıdır. Arama açıkken sadece bellekte, Buldum/Açtım sonrasında `captures/cube-research/<UUID>.ndjson` dosyasında tutulur.
- Oyun sürecine ait IPv4 TCP bağlantılarının sunucudan gelen tarafı alınır. Yalnızca senkronizasyonu doğrulanmış Aion çerçeveleri kaydedilir; çözülemeyen opcode'lar ve okuyucu hataları korunur. LZ4 demetleri açılır, yeniden iletilmiş TCP verisi tekrar yazılmaz. Dışarı giden istekler yoktur.
- Bilinen oyuncu/hesap kimliği içerikleri çıkarılır; opcode, uzunluk, zaman korunur. Bilinmeyen içerikler anonim kabul edilmez. Dosyalar otomatik yüklenmez, HTTP üzerinden servis edilmez; `captures/` Git dışında kalır.
- Bellek tamponu: 60 saniye, tahmini serileştirilmiş boyutta en fazla 8 MiB. Boyut sınırına gelirse eski mesajlar düşer ve kısalma raporlanır. İşlenmiş JS nesnelerinin gerçek bellek kullanımı farklıdır.
- Dosya: en fazla 64 MiB. Oturum: tampon dahil 20 dakika. Açtım sonrası 30 saniyede otomatik durur; “Testi bitir” de kapanış kaydını ve `.summary.json` dosyasını yazar.
- Araştırmayı bitirmeden demo/replay/sıfırlama engellenir. Durdur/Kapat mevcut dosyayı kapatır. Arama sırasında henüz dosyaya geçilmediyse bitirmek tamponu siler. Program beklenmedik kapanırsa dosyada kapanış kaydı olmayabilir; inceleyici bunu belirtir.
- Kayıt bittikten sonra yeni arama için tekrar Aramayı başlat gerekir. Birden fazla cube tek bir otomatik oturum olarak izlenmez.

## İnceleme

```powershell
node scripts/analyze-cube.mjs latest
# veya:
node scripts/analyze-cube.mjs <kayit-UUID>
```

Rapor, aynı dizine `.analysis.json` uzantısıyla yazılır: zaman işaretleri, aşama başına opcode sayısı/saniye oranı, ilk 16 farklı bilinmeyen içerik için SHA-256 kısaltmaları, NPC görünme/kaybolma ve 0x9101 harita nesnesi gözlemleri. Kayıt sırası yerine mesaj zamanı kullanılır; tekrar edilen yakın/uzak işaretleri ayrı aralıklardır. Aynı milisaniyedeki mesajlar son işarete atanır. Aşamaların süreleri farklıysa ham sayılar yerine oranlar karşılaştırılır.

0x3641 NPC görünme okuyucusu yalnızca başlangıç alanlarını doğrular. 0x9101 WorldMapContentsInfo okuyucusu statik şemaya göre tamamını doğrular; dünyada harita listesinde olmak, oyuncunun yakınında canlı bir cube olmakla aynı değildir. Boşluklar, bozuk satırlar, sınırda duran veya tamamlanmayan oturumlar raporlanır. Bunlar ve çevredeki diğer oyuncular göz önüne alınmadan bir opcode cube sinyali kabul edilmez.

Doğrulama araçları: `node --test test/*.test.mjs`, `node scripts/validate-cube-hotkeys.mjs`. Windows API başvuruları: [RegisterHotKey](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey), [MSG](https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-msg).

## İlk işaretli canlı kaydın bulgusu

İlk kayıt 5.001 mesaj ve 74 opcode içerdi; Buldum öncesi yaklaşık 60 saniye, Buldum–Açtım arası 9,812 saniye, sonrası 30,024 saniye. Aynı nesne anahtarı üzerinden şu zincir görüldü:

| Buldum işaretine göre | Gözlem |
|---|---|
| −11,826 sn | 0x3634: aday nesne görünme başlangıcı; tür alanı 1200039 |
| +2,625 sn | 0x3638: aynı nesne üzerinde etkileşim başlangıcı adayı |
| +2,674 sn | 0x3637: aynı nesne için 0 sonuç kodlu yanıt |
| +6,827 sn | 0x561b: 630900003 eşyası; decreaseReason 54 (statik enum: InteractionRequire) |
| +6,873 sn | 0x363a: aynı nesne ve aynı gerekli eşya numarası |
| +6,929 sn | 0x561e: kaynak nesne anahtarı aynı olan 9 ganimet oluşma mesajı |
| +7,574 sn | 0x3635: aynı nesne kayboluyor; son baytlar 04 03 00 |
| +9,812 sn | Kullanıcının Açtım işareti |

Kullanıcı bu cube'u açarken anahtar/eşya kullandığını ayrıca doğruladı. Açtım işareti gerçek açılma olayından yaklaşık 2,9 saniye sonra geldi; bu normal kullanıcı işaretleme gecikmesidir. Harita listesinde (0x9101) 32 anlık görüntünün hepsinde envObjList boştu; bu oturumda cube sinyali o listeden gelmedi.

Bu zincir, 1200039 türünü açılan cube için güçlü aday yapıyor. Ancak tüm hidden cube türleri için kimlik listesi, görünme paketinin mesafe eşiği, zaten bölgedeyken ölçer açılması ve yeniden giriş davranışı henüz doğrulanmadı. Kullanıcının talebiyle bu tek aday için deneysel canlı alarm eklendi: 0x3634 görünme başlangıcı, 4 başlık değeri ve 34 okunmamış kuyruk baytı kontrol edilir. Görünme mesajı alınmadan, sadece açılma/ganimet mesajından yakınlık alarmı üretilmez.

0x3634 / 35 görünme/kaybolma okuyucuları ayrıca deneysel canlı alarmda kullanılır. 0x3637 / 38 / 3a / 3b ve 0x561e araştırma raporu içindir. Alan adları gözlemlenen düzene verilen çalışma adlarıdır; resmi protokol adları değildir. 0x3634 ve 0x561e başlangıç alanları okunur, kuyruk çözülmüş sayılmaz. 0x561b statik şemaya dayanır; ekipman eki bulunan varyant bu dar okuyucuda desteklenmez. NPC veya DPS okuyucuları değiştirilmemiştir.

Yeni raporlarda `objectChains`, aynı akış ve nesne numarası üzerinde eşya gereksinimli etkileşimleri, yakındaki eşya tüketimini ve sonraki 3 saniyedeki ganimet/kaybolma olaylarını birleştirir. Bu ilişkilendirme algoritması bir cube sınıflandırıcısı değildir. Sonraki kayıtta aynı hızlı iki işaret yeterli; başka cube'da tür alanı ve olay zinciri karşılaştırılacak. Güvenli fırsat varsa cubesuz kontrol rotası ve açmadan uzaklaşıp yaklaşma, görünme/kaybolmanın anlamını sınamaya yardımcı olur.

## Sonraki iki kaydın sınırları

İkinci kayıtta 3.126, üçüncü kayıtta 1.333 mesaj var. Aynı 630900003 eşya gereksinimi, etkileşim sonucu, sırasıyla 11 ve 10 ganimet mesajı ve nesnenin kaybolması doğrulandı. Her ikisinde de ilgili nesnenin ilk 0x3634 görünme mesajı yok; tür numarası bu nedenle `null` bırakıldı. Üçüncü kayıt cube'un yanındayken başlatıldı ve Buldum öncesi yalnızca 2,634 saniye içeriyor; bu kayıtta akış hatası yok. Bunlar açılma zincirini destekler, 1200039 türünün başka cube'larda da geçerli olduğunu veya yaklaşma alarmını doğrulamaz.

Alarm durumu akış başına takip edilir. TCP boşluğu, senkron kaybı, harita değişimi, bağlantı kapanması ve 15 saniye çözümlenmiş mesaj gelmemesi mevcut adayları belirsiz yapar. Aynı nesne görünür kalırken yeni ses yoktur; kaybolup tekrar görünürse yeni olay sayılır. Tarayıcı ilk yüklemede eski olayları çalmaz; yeni ve halen mevcut adaylar için ses etkinse uyarır. 1,8 saniye içindeki toplu bildirimler tek sesle karşılanır. Varsayılan adres 4317'dir; geliştirme sırasında kullanılan 4318 kalıcı ikinci uygulama değildir.

## İlk canlı otomatik alarm eşleşmesi

Dördüncü işaretli kayıt 5.045 mesaj içeriyor ve akış sorunu bildirmiyor. Kullanıcı sesin çaldığını ve “Hidden cube adayı #1”in doğru cube olduğunu doğruladı. Otomatik `appeared` olayı ile 1200039 türündeki nesnenin görünme mesajı aynı akış, nesne numarası ve zaman damgasına sahip. Açılma zincirinde aynı nesne, 630900003 gerekli eşya tüketimi, 8 ganimet oluşma mesajı ve kaybolma var. Otomatik `disappeared` olayı da nesnenin kaybolma mesajıyla birebir eşleşiyor.

Alarm, Buldum işaretinden 14,147 saniye, etkileşim başlangıcından 16,198 saniye ve açılma sonucundan 20,396 saniye önce geldi. Açtım işaretinden farkı 22,608 saniye. Bunlar kullanıcı işaretleri veya sunucu mesajları arasındaki sürelerdir; yürüyüş süresi veya metreye çevrilemez.

Bu kayıt ilk örnekteki 1200039 türünü ikinci bir cube'da ve sesli alarmı ilk kez canlı kullanımda doğruluyor. Kesin tespit mesafesi hesaplanamadı: cube koordinatı var, fakat tespit anındaki oyuncu XYZ konumu doğrulanmış değil. İncelenen 0x371a/b/c/d hareket mesajları etkileşimi yapan oyuncu anahtarını taşımıyor; kayıt yalnızca gelen trafik içeriyor. Ham koordinat biriminin metre dönüşümü de kalibre edilmiş değil. Mesafe için aynı andaki oyuncu ve cube koordinatları ile birim doğrulaması gerekir; tahmini hızdan bir mesafe üretilmedi.

## Paket okuma gecikmesi düzeltmesi

Sonraki sessiz kalan uyarıda aynı oturumun ikinci adayı, 1200039 türüyle algılandı; paket zamanı ile uygulamanın işleme zamanı arasında 94,674 saniye vardı. Tarayıcıdaki 15 saniyelik tazelik kontrolü eski bildirimin sesini bastırdı. Aynı sırada kayıt komutu 5 saniyelik süreyi aştı, ardından geç işlenerek arama modunu açtı. Bu olay için işaretli ham kayıt yok; teşhis yerel uygulama durumu üzerinden yapıldı.

Senkron araması, reddedilmiş baytları her TCP parçasında yeniden tarıyor ve geçersiz başlıklarda sürekli istisna üretiyordu. 512 KiB oyun dışı rastgele veri, 1.460 baytlık parçalarla eski kodda yaklaşık 175 saniye sürdü; düzeltilmiş tarama aynı büyüklükteki ayrı bir rastgele örnekte yaklaşık 0,12 saniye sürdü. Yeni tarama yalnızca eksik adayları gereken baytlar geldiğinde tekrar inceler; iki tam doğrulanmış mesajla senkron olma koşulu korunur. Yoğun adaptörler ayrıca küçük okuma grupları arasında komutlara ve durum raporlarına zaman bırakır.

HTTP sunucusu, yakalama işçisinden 5 saniyedir durum alamıyorsa artık canlı görünmez. Paketler 5 saniyeden fazla geriden işleniyorsa gecikme uyarısı gösterilir. Süresi geçmiş kayıt komutları sonradan kendiliğinden uygulanmaz. Eski bildirimlerden yanıltıcı ses üretmemek için sesin tazelik koşulu korunur.

Doğrulama: 50 otomatik test, gerçek Npcap loopback yolu ve tarayıcıdaki ses/bağlantı/duraklama kontrolleri geçti. Yeniden başlatma sonrasında Aramayı başlat yaklaşık 14 ms'de yanıtladı; altı canlı örnekte paket işleme gecikmesi 2,7–22,8 ms ve tampon mesaj sayısı artıyordu.

Düzeltme sonrası kullanıcı yeni bir cube'da sesin çaldığını ve cube'u aldığını bildirdi. Arama açık, kalıcı kayıt henüz başlamamış olduğundan son 60 saniyelik tampon kullanıcı inceleme isteği üzerine dosyaya kaydedildi; Buldum/Açtım işareti eklenmedi ve arama tekrar açıldı. Bu 2.771 mesajlık kayıtta akış sorunu yok. 1200039 türünün otomatik alarmı, aynı nesnenin açılma zinciri, gerekli eşya tüketimi, 8 ganimet mesajı ve kaybolmasıyla eşleşti. İlk görünme mesajı 19,102 ms'de işlendi; etkileşim başlangıcından 7,949 saniye, açılma sonucundan 12,154 saniye önce geldi. Böylece düzeltme sonrası gerçek sesli tespit de doğrulandı.

Mesafeye göre değişen ses için bu kayıt yeterli değil. İncelenen 0x371a/b/c/d hareket grubunda etkileşimi yapan oyuncunun anahtarı bulunmuyor; oyuncuya ait kısa bildirimler de XYZ vermiyor. İlk görünme anından geçen süre veya paket sıklığı yaklaşma mesafesi yerine kullanılmamalı. Bunun için güncel oyuncu konumu akışının ayrıca çözülüp doğrulanması gerekiyor; doğrulanmamış bir yakınlık sesi eklenmedi.

## Karakter konumu araştırması

Kullanıcının ileri–geri yürümesi ve karakter seçimine dönüp girmesi sırasında, ölçerin yakalamasını durdurmadan iki yönlü ek araştırma kaydı alındı. Bu özel kayıtlar `captures/motion-*.ndjson` altında yereldir; ham oyun oturumu verisi içerir ve Git'e eklenmez. Kısa ilk örnek 45 saniye, giriş/bölge değişimi örneği 180 saniyedir. İkinci örnekte 7.177 gelen mesaj, 3.783 giden çerçeve ve üç karakter görünme konumu çözüldü. Akışta boşluklar da vardır; görünmeyen bir mesajın protokolde hiç bulunmadığı iddia edilmez.

`readSelfPosition()` artık 0x3633 `MyCharAppear_NT` başlangıcından karakter anahtarı ve XYZ okur. Şema: entity vi32, u32 görünme bayrakları, kendi karakter açıklaması, u16 durum bayrakları, XYZ float32. Açıklama okuyucusu mevcut protokol okuyucusuyla ortaktır; isim ve hesap alanları konum sonucuna eklenmez. Sonuç yalnızca **giriş/yeniden görünme anının konumudur**. Normal DPS kimlik olaylarına koordinat eklenmez.

Yürüyüş boyunca alınan 0x371a/b/c/d aday hareket mesajları, yeni kendi karakter anahtarını taşımadı. Kendi karakterine ait 0x3746 mesajı anahtar sonrası yalnızca bir float içeriyor; tek başına XYZ değildir. 0x3744/41/22/42 gibi kısa mesajlar da tam konum vermiyor. 0x9101 harita verisi oyuncunun anlık yürüyüş konumu yerine dünya içerik listeleri taşıyor. Becerinin hedef/yön alanı, karakterin dünyadaki konumu olarak kullanılamaz.

Giden akışta uzunluk sınırları okunuyor, ancak içerik ve opcode alanları doğrudan çözülemiyor: 3.783 çerçevede 3.657 farklı tel opcode değeri görüldü. Bu, Global istemcisinin giden şifreli trafiğiyle uyumlu; algoritma veya anahtar çözülmüş değildir. Karakter seçimine dönüş mevcut oyun TCP akışını korudu; yeni bir kripto oturumu başlangıcı elde edilmedi. Ayrı bir aracın [Global sürüm notları](https://github.com/Grachy/aion2t-dps-meter#whats-new-in-1133) da giden paketlerin şifreli olduğunu bildiriyor; [harita sınırlamaları](https://github.com/Grachy/aion2t-dps-meter/blob/master/docs/release-notes-1.1.42.md#known-limitations) normal yürüyüşte konumun geride kalabileceğini açıkça belirtiyor. Bu kaynaklar çözülmüş hareket şeması olarak kullanılmadı.

Tekrar analiz: `node scripts/analyze-motion.mjs captures/motion-session-<zaman>.ndjson`. Rapor giriş konumlarını, kendi anahtarıyla eşleşen hareket ailesi mesajlarını, tel çerçeve istatistiklerini ve boşlukları yerel JSON'a yazar. İki konum okuyucu testiyle toplam 52 test geçti. Sürekli yürüyüş konumu henüz doğrulanamadığından mesafeyle hızlanan bip etkinleştirilmedi; mevcut cube görünme alarmı çalışmaya devam eder. Sıradaki eksik teknik parça, giden hareket akışını çözmek veya eşdeğer ve doğrulanabilir güncel konum kaynağı bulmaktır.

## Aion2t incelemesi ve deneysel görünürlük tahmini

16 Ekim 2026: Kullanıcının isteğiyle [aion2t 1.1.42](https://github.com/Grachy/aion2t-dps-meter/blob/master/docs/release-notes-1.1.42.md) incelendi. GitHub ağacında çözücünün Rust kaynakları yok; dağıtım paketi ve belgeler var. Resmi depo bağlantısından alınan kurulum dosyasının SHA-256 değeri sürüm notuyla eşleşti: `b9f313e79bdb46b332cc39673bfeb3a568f7c6b64618d16f12be3c511b61c75a`. Kurulum ve uygulama çalıştırılmadan arşiv açıldı ve native kod statik olarak incelendi. Orijinal dosyalar yalnızca Git dışında `research/private/aion2t/` altında tutuluyor; uygulamamız bunları yüklemiyor.

Bulgular: `own_position` bileşeni doğrudan konum olaylarını `exact`, görünürlük sınırlarından hesaplanan konumu `viewEdge` olarak ayırıyor. Doğrudan olaylar giriş, görünme, hareket ve uygun skill hedef alanlarını içeriyor. İncelenen paket yolunda 0x3623 giriş konumu, 0x371a/b/c, 0x372f, 0x373c hareket biçimleri ve NPC 0x3641/42 göründü. Bu bulgu, Global giden şifrelemenin çözüldüğünü göstermiyor.

Tahmin yolu, NPC görünme/kaybolma olaylarını 55/65 m yarıçaplı çemberler olarak kullanıyor; koordinatları 100'e bölüyor ve son 4 saniyedeki sınır gözlemlerine bir konum uyduruyor. Bunlar referans aracın varsayımlarıdır; oyunun resmi veya bu çalışmada kalibre edilmiş sabitleri değildir. Bölge girişindeki toplu görünme olaylarıyla gerçek yürüyüşte sınır geçişleri birbirine karıştırılmamalıdır. Release notları da normal yürüyüşte konumun geride kalabileceğini belirtiyor.

Bizde çemberlere en küçük kareler uydurması bağımsız olarak uygulandı. Başlangıç için mevcut 0x3633 okuyucusu ve dar doğrulamalı 0x3623 giriş biçimi kullanılıyor. 0x371a/b/c yalnızca bilinen uzunluk/bayrak biçimlerinde okunuyor. Skill hedef/yön alanları oyuncu konumu yapılmıyor. En az dört farklı NPC sınırı, yeterli geometrik dağılım ve düşük uyum artığı gerekiyor; hareket ettiği gözlenen NPC'nin sınır katkısı kaldırılıyor. Yeniden doğma/teleport nedenleri sınır sayılmıyor. Akış boşluğu, harita değişimi veya geçersiz konum mevcut tahmini geçersiz yapıyor. Konumlar HTTP arayüzüne XYZ olarak aktarılmıyor; araştırma açıkken yerel kayıt `player-position` gözlemleri içeriyor.

Önceki 180 saniyelik yürüyüş/giriş kaydında 6 doğrudan konum olayı (3 giriş ve 3 kendi karakter görünmesi) ve bu daha sıkı filtrelerle 3 tahmin üretildi; okuyucu hatası yok. Bunların hiçbiri bağımsız yürüyüş konumu ölçümü değildir. Tahminlerin uyum artığı gerçek konum hatası diye yorumlanamaz. Küp kayıtları başlangıç konumunu içermediğinden eski cube'lara geriye dönük metre mesafesi verilmedi.

Tekrar üretim: `node scripts/analyze-position.mjs captures/motion-session-<zaman>.ndjson`. Rapor `.position-analysis.json` dosyasına yazılır ve Git dışında kalır. Yeni cube kayıtlarındaki `player-position` satırları ayrı raporlanır; bağımsız gerçek konum kabul edilmez.

Yeni yakınlık sesi deneysel ve yataydır: 50 m üstü 3,6 sn, 25–50 m 2,4 sn, 10–25 m 1,4 sn, 10 m ve altı 0,75 sn. Konum 3 saniye eskiyse, cube kaybolmuşsa, yakalama sağlıksızsa veya tarayıcı bağlantısı kesilmişse bip durur. İlk görünme melodisi kayıt modundan ve yakınlık seçeneğinden bağımsızdır. Sentetik geometri/protokol testleri ve tarayıcıdaki gerçek Web Audio sayacıyla hızlanma, bayatlama, kapatma ve bağlantı kesilmesi test edildi; toplam 57 otomatik test geçti. Gerçek cube'a yaklaşma sırasında sesin mesafeyle örtüşmesi henüz doğrulanmadı.

## Yeniden başlatma sonrası canlı yürüyüş kontrolü

Uygulamanın yeniden başlatılmasının ardından canlı yakalama ve yeni konum bileşeni doğrulandı. NPC'lerin olduğu bölgede ileri geri yürürken alınan test kaydı yaklaşık 109 saniye ve 8.794 mesaj içeriyor. Kimlik yükleri gizlendiği için 8.592 mesajın yükü çevrimdışı analiz edilebildi. Kayıtta 2 doğrudan konum açıklaması (giriş ve kendi karakteri) ile 4 görünürlük tahmini var. Çevrimdışı tekrar, giriş konumundan başlayarak aynı 4 tahmini üretti; konum okuyucu hatası yok. Diğer bir akışın kapanması ayrıca kayıtlı.

Tahminler kayıt başlangıcından 47,328 / 55,328 / 76,332 / 88,335 saniye sonra geldi; ardışık tahminlerin arası yaklaşık 8, 21 ve 12 saniye. Böylece görünürlük yönteminin canlı oyunda çalıştığı doğrulandı, fakat sürekli yürüyüş takibi doğrulanmadı. Bu aralıklarda 3 saniyelik tazelik süresi dolunca yakınlık bipi susar. Bu kayıtta cube'a yaklaşma veya bağımsız mesafe ölçümü yok; sesin gerçek mesafeyle uyumu hâlâ doğrulanmayı bekliyor. Test kaydı tamamlandıktan sonra hızlı Buldum/Açtım testi için arama yeniden hazırlandı.

## Konumdan bağımsız, üç saniyelik ses tekrarı

Kullanıcı yaklaşma sesinin çalışmadığını ve cube mevcut kaldığı sürece 3 saniyede bir uyarı istediğini bildirdi. İncelenen canlı durumda üçüncü cube (nesne 27038, akış flow-3) `present` olmasına rağmen aynı akışın konumu ve mesafesi `null` idi. Daha sonraki oturum durumunda 6 akış boşluğu ve 5 senkronizasyon verisi atımı görünüyordu. Konum izleyici bu durumlarda başlangıcını sıfırlar; yeniden görünürlük tahmini için yeni başlangıç konumu gerekir. Önceki yürüyüşteki seyrek güncellemeler de kesintisiz yakınlık sesi için yeterli değildi. Yeni işaretli cube kaydı yok; bu inceleme canlı durum ve önceki yürüyüş kaydına dayanır.

Bu nedenle mesafeye göre ses ve mesafe gösterimi arayüzden kaldırıldı; konum araştırması kodu korunuyor. Ses açılınca en az bir cube mevcut kaldığı sürece aynı uyarı 3 saniyede bir tekrarlanır. Yeni görünme bildirimi ayrıca ilk uyarıyı üretir. Tekrarlanan paketler ve birden fazla cube ek zamanlayıcı başlatmaz. Test melodisi ve diğer uyarılar sonraki tekrarın üç saniyesini yeniden başlatır. Ses kapalıyken, cube kalmayınca, yakalama sağlıksızken veya arayüzde 2,5 saniyelik durum akışı kesilince yeni ses başlamaz. Geçmiş kayıtlar tekrar üretmez; konumun olmaması tekrarı engellemez.

57 otomatik test geçti. `scripts/cube-repeat-ui-smoke.mjs` gerçek Web Audio ile sentetik durum akışında 3.016 ve 3.000 ms tekrar aralıkları ölçtü; konumsuz tekrar, kaybolma, sessize alma, duran yakalama, durum akışının sessizce kesilmesi ve bağlantı kopması kontrolleri geçti. Mevcut ilk alarm, yinelenen bildirim ve mobil arayüz testleri de geçti. Bu doğrulama gerçek bir cube'un oyunda sürekli mevcut kaldığının bağımsız ölçümü değildir; canlı varlık durumunu mevcut görünme/kaybolma algılayıcısı sağlar.
