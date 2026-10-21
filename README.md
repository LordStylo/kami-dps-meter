# Kami DPS Meter (Aion DPS Lab)

Windows için yerel Aion 2 DPS ölçer prototipi. Oyun içi DPS/küp overlay'ine ek olarak ayrı Kami uygulamasında savaş ayrıntıları, kalıcı geçmiş, dungeon zamanlayıcısı ve pet koleksiyonu/haritası bulunur; Npcap yakalama arka planda çalışır. Bağımsız okuyucu ve hesap motorunun ilk protokol incelemesi Questlog 0.1.24'e, yeni katkı modeli ve sayısal meta verisi 0.1.35 incelemesine dayanır. Çalışmak için Questlog uygulamasının açık olması gerekmez.

Geliştirmeye devam etmeden önce [instruction.md](instruction.md) dosyasını oku: mevcut özellikler, çözülen sorunlar, korunması gereken fare/odak davranışı, doğrulamalar ve açık kalan işler burada özetlenir.

## Başlat

İlk kurulum (Windows x64, Node.js 22+, pnpm ve Npcap gerekir):

```powershell
git clone https://github.com/LordStylo/kami-dps-meter.git
cd kami-dps-meter
pnpm install --frozen-lockfile
pnpm run update:skills
pnpm run overlay:install
```

İkon görselleri yerel önbellektir ve Git deposuna dahil değildir; `update:skills` komutu bunları indirir. İkonlar olmadan da ölçer genel simgelerle çalışır.

**`Baslat.cmd` dosyasına çift tıkla.** Electron çalışma ortamı kuruluysa overlay ve kontrol kutusunu açar. Ayrıntılı tarayıcı arayüzü için **`Tarayici.cmd`** veya http://127.0.0.1:4317 kullanılabilir. Overlay kurulmamış kaynak klasöründe başlatıcı tarayıcıya döner.

- Başlangıçta canlı yakalama açılır ve `Aion2.exe` beklenir.
- Oyun açıkken bölgeye gir veya teleport yap; ad ve parti paketleri böylece yeniden gelir.
- İlk vuruştan sonra hasar tablosu güncellenir. Bir oyuncuya tıklayınca yetenek dökümü açılır.
- Partim / Yalnızca ben / Tüm oyuncular ve hedef filtresi kullanılabilir.
- **Kayıttan incele** mevcut yerel Questlog savaşını kendi motorumuzla yeniden hesaplar; bu mod canlı yakalamayı kapatır.
- **Örnek savaş** yalnızca açıkça etiketlenmiş sentetik veridir.
- **Durdur** yakalamayı durdurur; **Kapat.cmd** arka plandaki uygulamayı da kapatır. Tarayıcı sekmesini kapatmak sunucuyu kapatmaz.

Başlatıcı önce paketin `runtime/node.exe` dosyasını kullanır; kaynak klasöründe bu dosya yoksa PATH'teki Node'u, ardından mevcut Codex Node çalışma ortamını arar. Npcap yalnızca yöneticilere izin verecek şekilde kurulduysa başlatıcı da yönetici olarak açılmalıdır. Oyun yönetici yetkisiyle çalışıyorsa başlatıcı **yalnızca overlay için** Windows izin penceresi açar: daha düşük yetkili pencereler oyun odaktayken Alt durumuna erişemeyebilir. Oyun sonradan yönetici olarak açılırsa `Baslat.cmd` dosyasını tekrar çalıştır.

## Oyun üzerindeki pencereler

- Pencereler yalnızca Aion 2 öndeyken görünür; masaüstüne veya başka uygulamaya geçince gizlenir.
- **DPS penceresi savaş dışında otomatik gizlenir**, tekrar savaşa girince görünür. Karakterin savaş durumu henüz alınmamışsa aktif karşılaşma kullanılır. Küp ve kontrol kutusu bundan etkilenmez. Küçültme/manuel gizleme tercihin korunur; kontrol kutusunda **Savaş bekliyor** yazar. Savaş dışında DPS ayarlarını değiştirmek için tepsiden **Masaüstünde düzenle** seç; son savaş tarayıcıda da incelenebilir.
- Küçük kontrol kutusundaki **DPS’yi göster**, savaş dışında son sonucu açar ve küçültülmüş pencereyi genişletir. Menüde **Elle açık** yazar; aynı düğmeyle **Otomatik gizlemeye dön** seçilebilir. Yeni savaşa girince geçici gösterme biter, otomatik davranış sürer. DPS anahtarını kapalıdan açığa almak da savaş dışında geçici olarak gösterir. Kalıcı seçenek için DPS dişlisindeki **Savaş dışında otomatik gizle** işaretini kaldır: panel oyun öndeyken açık kalır. Bu tercih yeniden başlatmada korunur; geçici gösterme saklanmaz. Manuel gizleme ve Alt+Tab görünürlük kuralları her zaman önceliklidir.
- Yeni doğrudan kendi vuruşun, kaçırılmış savaş giriş paketi yüzünden eski bir savaş dışı bilgisinin arkasında gizlenmez: son durum bilgisinden yeni vuruş için 3 saniyelik görünürlük kanıtı kullanılır. Sonradan gelen savaş çıkışı anında öncelik alır; DoT, pet veya yakındaki yabancı bu süreyi uzatmaz. Bu yalnızca pencere görünürlüğünü etkiler.
- **Alt basılıyken** başlık çubuğundan sürükle veya düğmelere tıkla. Overlay pencereleri etkileşim sırasında da klavye odağı almaz; Alt bırakıldığında tıklamalar oyuna geçer. **Alt+Tab, Alt+Esc veya Windows tuşuyla uygulama değiştirirken** paneller gizlenir ve o Alt basışı bitene kadar etkileşim kapanır. Odak alma/oyuna odak döndürme işlemi yapılmaz. Electron'un odak almayan pencerede ilk tıklamayı yutması yalnızca kendi pencere mesajlarımızda düzeltilir; oyun penceresine mesaj gönderilmez. Alt tuşu için kısayol ayrılmaz.
- **Küçük dört kareli kutu**, arayüz kontrolünü açar. Alt ile kutuyu sürükleyebilir veya tıklayıp DPS / Küp pencerelerini ayrı ayrı gizleyip gösterebilirsin. İkisi gizliyken de kutu oyunda kalır. Gizleme veri yakalamayı ve etkinleştirilmiş küp sesini durdurmaz. **Küçük kutuya dön** menüyü toplar.
- **DPS** penceresinin sağ üstündeki **−**, içeriği kapatıp yalnızca başlığı bırakır; küçültülmüş başlıkta DPS sayısı gösterilmez. **+** yeniden açar. Oyuncuya tıklayınca ikonlu yetenek dökümü görünür.
- DPS penceresi varsayılan **232×210** boyutunda; **Parti / Ben** ve **Hasar / İyileştirme** kontrolleri tek satırdadır. İsim ve DPS sütunları daha yakındır. **Alt basılıyken sağ alt köşedeki tutamacı sürükleyerek** genişlik ve yüksekliği değiştirebilirsin; en küçük boyut **220×150**. Satırlar sığmazsa liste kaydırılır. Eski büyük kayıtlı boyut bu sürümde bir kez kompakt boyuta geçer; konum ve diğer tercihler korunur. Sonraki özel boyutlandırmalar yeniden başlatmada saklanır. Ölçüler Windows ekran ölçeğinden önceki mantıksal piksellerdir.
- **Party mode** parti sıralamasını gösterir; oyuncuya tıklayarak yeteneklerini açabilirsin. **Individual mode** kendi DPS ve toplam hasarını, doğrudan kendi yeteneklerinin DPS / hasar / pay dökümünü gösterir. Hesap aynı savaş süresini kullanır; karakter tanınmadan başka oyuncunun verisi yerine konmaz. Mod değişimi yakalamayı veya tarayıcı filtrelerini sıfırlamaz.
- **Hasar / İyileştirme** seçimi aynı pencerede DPS ile HPS arasında geçer; parti şifacı sıralaması, toplam iyileştirme ve skill HPS / miktar / pay dökümü gösterilir. Individual mode yalnızca kendi iyileştirmelerini gösterir. HPS ortak parti karşılaşma süresini kullanır; sadece iyileştirme yapan oyuncu da listelenir. İyileştirme tek başına karşılaşma başlatmaz. İyileştirmeler tüm karşılaşma içindir; düşman hedef filtresi uygulanmaz. Fazla iyileştirme (overheal) ayrımı ve iyileştirme kritik oranı henüz yoktur.
- **−/+ yanındaki dişli**, DPS görünüm ayarlarını açar. **Arka plan şeffaflığı** %0 (opak) ile %100 (şeffaf) arasında anında değişir; yazılar ve ikonlar solmaz. Değer otomatik saklanır. Küçültülmüş halde de ayarlar açılır; kapatınca yine yalnızca başlık kalır. **Varsayılana dön**, şeffaflığı %8'e getirir.
- **Küp**, 206×206 boyutunda kare penceredir. **Başlat** alarmı etkinleştirir; **Sesi dene** alarmı başlatmadan/sessiz tercihini değiştirmeden test sesi çalar. **Sessiz** otomatik alarm sesini açıp kapatır; küp tespiti ve pencerenin açılması devam eder. **Durdur** alarmı ve otomatik açılmayı durdurur, ağ yakalaması sürer. **Gizle** pencereyi kapatıp küçük kontrol menüsünü de kapalıya geçirir; çalışan alarm arka planda devam eder. Yeni küp algılanırsa pencere yeniden açılır ve menü açık olarak güncellenir; aynı küpü gizleyince her durum güncellemesinde tekrar açılmaz. Küp mevcut kaldıkça ses 3 saniyede bir tekrarlar. Overlay yeniden başlatıldığında **Başlat** gerekir. Ses için tarayıcı veya overlay'den birini kullan; ikisini etkinleştirmek çift uyarı üretir.
- Konumlar, pencere görünürlükleri, otomatik gizleme tercihi, DPS modu, şeffaflık ve küçültülme durumu `settings/overlay-4317/layout.json` içinde saklanır. Saat yanındaki K simgesinden **Masaüstünde düzenle** seçilirse pencereler masaüstünde Alt gerektirmeden düzenlenebilir; seçimi kaldırınca oyun moduna döner. Aynı menüde tümünü göster/gizle, konumları sıfırla ve kapat bulunur. **Kapat.cmd**, veri yakalamayı ve overlay'i birlikte kapatır.

Overlay kodu güncellendiyse **Overlay-Yenile.cmd → sağ tık → Yönetici olarak çalıştır**, yalnızca overlay'i yeniden açar; devam eden veri yakalamayı durdurmaz. Yeniden açılınca sesi tekrar etkinleştir.

17.10.2026'da Windows, overlay ana sürecinde `0xc0000409` ve önceki oturumda `0xc0000005`/`0xc000041d` yerel çökmelerini kaydetti. Koffi **2.15.2 → 2.16.3** güncellendi; bu seri yeni Node callback ve Windows stack-check çökmelerine ilişkin [üst proje düzeltmelerini](https://koffi.dev/changelog) içerir. Hata imzası bu düzeltmelerle uyumludur; uzun süreli oyun doğrulaması ayrıca gerekir. Çökme sonrası kalan süreç işareti yalnızca süreç artık yoksa temizlenir; başka bir süreç eski PID kullanılarak kapatılmaz. Normal kapanış, renderer hatası, işlenmemiş hata ve temiz kapanmamış oturum `settings/overlay-4317/diagnostics.ndjson` içinde kaydedilir (256 KiB + bir önceki dosya). Günlük oyun/paket verisi içermez.

Kütüphane güncellemesinden sonra oyun içi köşe etkileşiminde çökme tekrarlandığı için pencere mesajlarını JavaScript'e geri çağıran yol kaldırıldı. Fare politikası artık kendi küçük **C DLL'imizde** çalışır; yalnızca kendi sürecimizin ve pencere thread'imizin HWND'lerini kabul eder. Windows'un native resize kenarları ve `SC_SIZE` döngüsü engellenir; Alt ile özel köşe tutamacı ve başlık sürüklemesi devam eder. DLL kaynak kodu [native/mouse-policy.c](native/mouse-policy.c) içinde bulunur. `pnpm run overlay:build-native`, SHA-256 ile doğrulanan sabit Zig derleyicisiyle DLL'i üretir; overlay kurulumu ve paketleme bunu çağırır. Taşınabilir pakette DLL hazır gelir, arkadaşının derleyici kurması gerekmez. Loader DLL hash ve ABI değerini doğrular.

Kullanıcı 17.10.2026'da bu C DLL sürümünde başlıktan taşıma ve köşeden boyutlandırmayı denedi; ikisi de çalıştı ve kapanma olmadı. Bu kısa canlı kontrol, uzun süreli kararlılık garantisi değildir.

Tepsideki **Overlay’i kapat (veri toplama sürer)** yalnızca overlay'i kapatır. Yeniden açmak için **Baslat.cmd** yeterlidir; veri toplama zaten açıksa ikinci bir sunucu başlatmadan arayüzü açar. Pencereler oyun odaktayken görünür; masaüstünde görmek için tepsiden **Masaüstünde düzenle** seç. Her şeyi durdurmak için tepsiden **Tamamen kapat** seç veya **Kapat.cmd** kullan. **Tamamen kapat**, veri toplama uygulamasının kapandığını doğruladıktan sonra overlay'i de kapatır.

Oyun **pencereli veya kenarlıksız tam ekran** modunda olmalı; özel tam ekran üzerinde görünme garantisi yok. Pencereler oyuna kod enjekte etmez; [Electron'un pencere API'sini](https://www.electronjs.org/docs/latest/api/base-window), Windows süreç/pencere metadatasını ve yalnızca Alt/sol fare düğmesinin anlık durumunu kullanır. Bu bilgisayarda oyun içi Alt, sürükleme, düğmeler ve odağın oyuna dönmesi kullanıcı tarafından doğrulandı.

## Taşınabilir Windows x64 paketi

`scripts/package-portable.ps1`, resmi Node.js ve Electron Windows x64 dağıtımlarını SHA-256 ile, kilitlenmiş Koffi paketini lockfile'daki SHA-512 ile doğrular. Node, Electron, Koffi'nin x64 yerel modülü, lisansları, uygulama kodu ve skill ikonlarını `dist/` altında bir ZIP'e koyar. Kişisel kayıtlar, pencere ayarları, geliştirme günlükleri, `.git`, Codex dosyaları ve üçüncü taraf araştırma dosyaları pakete girmez. Npcap sürücüsü ayrı kurulur; pakete kurulumu eklenmez.

Arkadaşına yalnızca ZIP'i gönder. ZIP'i tamamen çıkardıktan sonra Npcap kurulu bir Windows 10/11 x64 bilgisayarda `Baslat.cmd` yeterlidir; Node, npm, pnpm, Git, Codex veya Questlog kurulumu gerekmez. Kullanım yönergesi paketteki `ONCE-OKU.txt` dosyasındadır. Overlay küp alarmı için **Başlat**, ses kontrolü için **Sesi dene** kullanılır. Tarayıcıdaki ses etkinleştirme düğmesi **Sesi aç ve dene** adındadır.

Paketleme ve doğrulama (Windows PowerShell):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-portable.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-portable.ps1 -Zip dist/<paket-adi>.zip
```

Doğrulayıcı ZIP'in içindeki dosya karmalarını denetler; boş kullanıcı profili, Node bulunmayan PATH ve boşluk içeren ayrı klasörle paket başlatıcısını sınar. Npcap erişimi, paketlenmiş ikonlar, tekrar başlatma ve kapatma ayrıca kontrol edilir. Test kendi geçici portunu kullanır; 4317'deki canlı ölçeri kapatmaz. Başlatma ve kapatma betiklerinin `-Port` seçeneği bu ayrık test içindir.

## İlk sürümün kapsamı

Bu bölüm 14–17 Ekim ilk sürümünün kapsamını kaydeder. Güncel ayrıntı ve kalıcı arşiv özellikleri aşağıdaki 19 Ekim bölümündedir; okuyucu sayıları ilk sürümün tarihsel bilgisidir.

- Gerçek Npcap FFI bağlantısı; süreç bazlı IPv4 TCP bağlantı keşfi; daraltılmış BPF filtresi.
- TCP sıra/örtüşme/tekrar iletim yönetimi, boşluk tanılama, akış senkronizasyonu.
- Aion 2 varint çerçeveleme ve raw LZ4 demetleri.
- **27 tam mesaj okuyucu + 4 başlangıç alanı okuyucusu**. Statik katalogda 85 mesaj var; bunların tümü uygulanmış değildir.
- Doğrudan hasar, süreli hasar, iyileştirme/kalkan ayrımı, oyuncu ve parti bilgisi, pet sahipliği.
- Oyuncu/skill bazında hasar, DPS, kritik oranı, DoT ve pet hasarı; zaman grafiği; JSON rapor indirme.
- Yetenek tablosunda gerçek ikon, İngilizce ad, DPS, oyuncunun hasarındaki pay, toplam hasar ve kritik oranı. Yerel katalogda 364 yetenek ve 320 farklı ikon bulunur.
- IPv4 Ethernet, VLAN, loopback ve raw bağlantı türleri; IPv6 ve IP fragman birleştirmesi yok.
- Ağdan veya programdan hiçbir veri dış servise yüklenmez. Sunucu yalnızca `127.0.0.1` dinler. Normal DPS modunda ham trafik kaydedilmez. İsteğe bağlı cube araştırma modu, aşağıda açıklanan sınırlarla oyun mesajı içeriklerini yerelde tutar.

## Hidden cube testine hazırlık

Canlı yakalamada **deneysel otomatik cube uyarısı** var. Şimdilik ilk işaretli kayıtta açılan cube ile ilişkilendirilen **1200039** türünü tanır. Diğer türler ve kesin yakınlık mesafesi doğrulanmadı. Görünme bildirimi gelince “Tespit edilen cubelar” listesine eklenir. Ses açıksa ilk bildirimde uyarır ve en az bir cube mevcut kaldığı sürece **3 saniyede bir aynı uyarıyı tekrarlar**. Yinelenen paketler veya birden fazla cube, ayrı ses döngüleri başlatmaz. Kaybolma paketi geldiğinde geçmişte “Kayboldu” yazar; bu durum cube'un alındığını tek başına kanıtlamaz.

**Sesi aç ve dene** düğmesine bir kez bas: örnek uyarı çalar ve o sekmede sonraki otomatik sesleri etkinleştirir. Ses seviyesi ve sessize alma denetimleri bulunur. Sayfa yenilendiğinde sesi yeniden açmak gerekir. Sekme açık ve tarayıcı sesli olmalıdır; tarayıcının uykuya aldığı/kapattığı sekmede ses garantisi yoktur. Görsel uyarı ses kapalıyken de çalışır.

Tekrarlanan uyarı karakter koordinatı gerektirmez. Cube kaybolunca, yakalama durunca/gecikince veya arayüze 2,5 saniye yeni durum gelmeyince tekrar durur. Sayfa yenilendikten sonra sesi açarsan halen mevcut cube için tekrar başlar; geçmiş cube bildirimleri ses üretmez. **Mesafeye göre ses değişimi şimdilik kapalı:** görünürlükten türetilen konumlar seyrek geliyor ve paket boşluğu sonrasında başlangıç konumu kaybolabiliyor. Konum araştırma kodu sonraki incelemeler için korunuyor.

Alarm, test kaydından bağımsız olarak canlı yakalamada çalışır. **Ölçeri cube'a yaklaşmadan önce aç.** Görünme mesajı ölçer açılmadan önce geldiyse mevcut nesneyi geriye dönük tespit edemez. Aynı anda işaretli kayıt alarak otomatik uyarıyla gördüğün cube'u karşılaştırabilirsin:

1. Arayüzde **Hidden cube · test kaydı → Aramayı başlat**. Ararken son 60 saniyeye kadar veri bellekte tutulur; mesaj sayacının ilerlediğini kontrol et.
2. Cube bulduğunda **Ctrl + Shift + F8**: “Buldum”. Önceki veri dosyaya alınır, kayıt devam eder.
3. Hemen aç ve **Ctrl + Shift + F9**: “Açtım”. 30 saniye sonra kayıt otomatik tamamlanır. Acelede F8'i atlayıp yalnızca F9 kullanabilirsin.

Uzaklaşma zorunlu değil. Global kısayollar arama veya kayıt açıkken ayrılır; çakışma arayüzde görünür. Windows kayıt/mesaj kuyruğu doğrulandı; fiziksel kısayolların oyun odaktayken çalışması ilk canlı denemede kontrol edilecek. Aynı işlemler arayüz düğmelerinden de yapılabilir.

Kayıtlar `captures/cube-research/` altında ve Git dışında kalır. Bilinen hesap/oyuncu kimliği paketlerinin içerikleri atlanır; bilinmeyen mesajlar başka oyun alanları içerebilir, kayıtlar anonimleştirilmiş kabul edilmez. IP adresi ve genel ağ trafiği yazılmaz. Bellek tamponu 8 MiB, dosya 64 MiB, oturum 20 dakika ile sınırlıdır; yoğun trafikte önceki 60 saniye kısalabilir.

`node scripts/analyze-cube.mjs latest` yerel kaydın aşama/opcode oranlarını ve nesne gözlemlerini `.analysis.json` raporuna çıkarır. Otomatik cube teşhisi koymaz. Test adımları ve yorum sınırları: [research/CUBE-TEST.md](research/CUBE-TEST.md).

## Hesap tanımı ve sınırlamalar

PvE DPS = seçilmiş hasar / `max(1 saniye, son seçilmiş hasar − ilk seçilmiş hasar)`. Oyuncular aynı süreyi paylaşır. Korunan boss karşılaşmasında ölmeden önceki ve döndükten sonraki vuruşların arasındaki süre bu aralığa dahildir; geri dönünce DPS'nin düşmesi tek başına hasarın silindiği anlamına gelmez. Normal bekleme 15 saniye, yaşayan boss için hem periyodik kontrolde hem yeni vuruş öncesinde 90 saniyedir. Ölümden dönüş kurtarması ve PvP'nin ortak olay penceresi için aşağıdaki 19 Ekim bölümüne ve [protokol notlarına](research/PROTOCOL.md) bak. Kayıt oynatmada kaynak raporun hedefleri, katılımcıları ve zaman aralığı seçilir; hasar günlükten yeniden hesaplanır. Ölüm ve aynı zaman damgalı olayların sırası korunur.

`dmg` alanı ek vuruş hasarını zaten içerir. Kritik yüzdesi ek vuruş adetleriyle ağırlıklandırılmaz; doğrudan hasar olayları üzerinden hesaplanır. 11.000.000–19.999.999 aralığındaki skill varyantları 10.000'lik taban kimlikte gruplanır.

Kimliği henüz bilinmeyen saldıranların olayları oyuncu toplamına tahminle eklenmez; tanı sayacına yazılır. Pet kaybolduktan sonraki DoT sahibine yazılır; sahibi sonradan değiştiğinde önceki hasar yeniden başka oyuncuya atanmaz. Bölge değişiminde entity önbelleği temizlenir, doğrulanmış parti isim+sunucu/dbid kimliği saklanır. Parti/force HP mesajları kaçırılmış üyeliği toparlayabilir; sıradan HP mesajı üyelik sayılmaz.

Yetenek adları ve ikonları [Questlog'un herkese açık yetenek veritabanından](https://questlog.gg/aion-2/en-nc/db/skills) alınan yerel katalogla eşleştirilir. KR/TW İngilizce kataloğu kullanılır. Katalogda olmayan yeteneklerin kimlik numarası ve genel simgesi görünür; boss isimleri ayrı yerel katalogdan gelir, genel NPC isim kataloğu yoktur. Yetenek DPS'leri oyuncuyla aynı süreyi kullanır ve toplamları oyuncu DPS'sine eşittir. Yalnızca DoT içeren yeteneklerde kritik oranı uygulanmadığı için `—` gösterilir.

Buff/rDPS ayrıntıları 19 Ekim sürümünde eklendi; doğrulama sınırları aşağıdadır. Raid mekaniklerinin tamamı ve kurulum EXE'si yoktur. Party scan-list dolu varyantı bilinçli olarak desteklenmiyor; hata sayacında belirtilir. Karakter/NPC görünme mesajlarının tamamı değil, gereken başlangıcı doğrulanır. Sürüm sonrası şema değişiklikleri yeniden incelenmelidir.

**Canlı oyun bağlantısı bulundu ve gerçek paketler çözüldü; canlı DPS doğruluğu henüz karşılaştırılmadı.** Dummy savaşında hasar ve süre karşılaştırması bekleniyor. Sentetik testler ve önceden ayrıştırılmış gerçek günlükler bu adımın yerine geçmez.

## Doğrulama

| Kontrol | Sonuç |
|---|---|
| Otomatik protokol / TCP / hesap / karşılaşma / parti / iyileştirme / cube / overlay testleri | 141 geçti |
| Yerel C fare politikası yoğunluk testi | Gizli kendi pencerelerinde 20.050 senkron + 4.000 kuyruk mesajı, 1.050 taşıma, 50 pencere kapatma, 30 GC; ayrıca 24 gerçek kenar/köşe hit testi ve native `SC_SIZE` engeli; çökmeden temiz çıkış |
| C DLL sürümünde oyun içi taşıma ve köşeden boyutlandırma | Kullanıcı 17.10.2026'da ikisini de denedi; çalıştı ve kapanma olmadı. Uzun süreli kullanım ayrıca izlenecek |
| Kare cube paneli, Başlat/Durdur/Sessiz, gizliyken yeni tespitte açılma ve kontrol menüsü eşleşmesi | Ayrı Electron oturumunda geçti; test sesleri hoparlöre verilmeden kontrol edildi. Kullanıcı 17.10.2026'da overlay'i yenileyip kontrollerin çalıştığını doğruladı; yeni canlı cube denemesi ayrıca gerekir |
| İyileştirme/HPS, party/individual skill dökümü, tarayıcı ve 390px mobil görünüm | Sentetik olay / gerçek protokol okuyucu testleri ve ayrı arayüz oturumları geçti; canlı iyileştirme kontrolü bekleniyor |
| Üç Electron penceresi, native tıklama geçişi/odak bayrakları, sürükleme, küçültme, yerleşim saklama, ikonlar ve 3 sn ses | Ayrı profilde sentetik test geçti; kullanıcı 17.10.2026'da yeni sürümde hem tıklamadan hem Alt+tıklama sonrasında Alt+Tab'ın fareyi takmadığını ve düğmelerin çalıştığını doğruladı |
| Tarayıcı Web Audio, ses deneme, otomatik ses, tekrar önleme, sessiz mod, mobil görünüm | Geçti; fiziksel hoparlör duyumu kullanıcı tarafından kontrol edilir |
| Cube sesi: konum olmadan 3 sn tekrar; kaybolma, sessize alma ve bağlantı kesilince durma | Gerçek Web Audio ile sentetik tarayıcı testi geçti (3.016 / 3.000 ms aralık) |
| Gerçek Npcap ile sentetik loopback TCP → DPS | 13.000 / 13.000; geçti |
| Gerçek Npcap adaptör açma + süreç TCP tablosu | Geçti |
| Yerel 290 karşılaşmadan boyut sınırına uyan 264 kayıt içinden seçilen 10 kayıt | Toplam, kişi hasarı ve süre 10/10 birebir |
| Altı tam günlükte otomatik karşılaşma sınırları, toplam/oyuncu hasarı ve bitiş nedeni | 27/27 eşleşti; önceden ayrıştırılmış olaylar üzerinde |
| Savaş dışı DPS gizleme, savaşta açma, manuel gizleme ve masaüstü düzenleme önceliği | Otomatik testler ve ayrı Electron profilinde kontrol etiketi geçti; kullanıcı 17.10.2026'da savaşta açılıp savaş dışında gizlendiğini doğruladı |
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

`node scripts/overlay-smoke.mjs`, kurulu Electron ve Playwright ile üç gizli test penceresi açar. Ayrı profil ve sentetik sunucu kullanır; oyuna tuş/fare göndermez. Windows tıklama geçişi ve odak bayraklarını, kendi HWND'lerimizin `WM_MOUSEACTIVATE` yanıtının `MA_NOACTIVATE` olduğunu, Alt+Tab geçişlerinde odak alma çağrısı yapılmadığını, kutu sürükleme/tıklama ayrımını, pencere görünürlüklerini, DPS modlarını, küçültme, şeffaflık, konum saklama, yetenek ikonları ve gizli küp penceresinde gerçek Web Audio tekrarını denetler; test sesi hoparlöre verilmez. Bu test fiziksel oyun içi fare davranışının doğrulaması değildir. `AION_OVERLAY_TEST_ROOT` çıkarılmış taşınabilir paketi sınamak için kullanılabilir. Windows ekran ölçeklemesi nedeniyle native pencere yüksekliği istenenden birkaç piksel farklı olabilir; küçültülmüş pencerede yalnızca başlık görünür.

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
- `src/pet-collection.mjs`, `src/pet-store.mjs`, `src/pet-tracker.mjs`: karaktere bağlı pet koleksiyonu, yerel kayıt ve canlı NPC gözlemleri.
- `data/pets.json`, `data/pet-maps.json`, `public/pets.js`, `public/pets-map.js`: pet kataloğu, yerel pet haritaları ve uygulamadaki Petler menüsü.
- `overlay/`: Electron ana süreç, kısıtlı preload köprüsü, meter pencereleri ve kontrol kutusu.
- `data/effect-types.json`: kurulu sürümden çıkarılan sayısal effect sınıflandırmaları.
- `data/skills.json`, `src/skills.mjs`, `public/icons/skills/`: ad/ikon kataloğu, eşleştirme ve yerel görseller.
- `scripts/inspect-install.mjs`, `scripts/catalog-protocol.mjs`: tekrar üretilebilir statik inceleme araçları.
- `research/private/`: orijinal uygulamadan araştırma kopyaları; `.gitignore` içinde. Uygulama bunları yüklemez.

Genel format ve API başvuruları [protokol notlarında](research/PROTOCOL.md) listelenmiştir.

## 19 Ekim 2026 — Kami uygulaması, kalıcı geçmiş ve devam eden boss

**`Uygulama.cmd` dosyasına çift tıklayarak** ayrı Kami uygulamasını açabilirsin. Overlay DPS penceresindeki **Ayrıntılar** veya tepsi menüsündeki **Kami uygulamasını aç** da aynı, normal odak alabilen pencereyi açar. Aynı yerel arayüz tarayıcıda da kullanılabilir. Oyun içi üç overlay'in Alt/fare/odak kuralları değişmez. Ayrıntı penceresini kapatmak veri toplamayı durdurmaz.

Canlı analiz ve kaydedilmiş savaşlarda **Özet, Hasar, Alınan hasar, İyileştirme, Bufflar, Destek / rDPS, Rotasyon, Boss HP / Stagger** görünümleri vardır. Alınan hasar kaynağı ve DTPS, savunma olayları, yakalanan buff süreleri/uptime ve destek etkileri, skill cast sırası/iptali/kesilmesi, gözlenen boss HP/stagger bilgisi gösterilir. Paketlerde gözlenmeyen rotasyon veya boss bilgisi tamamlanmış gibi üretilmez.

Katkı modeli `src/combat-analytics.mjs` içinde bağımsız uygulanır; yerel `data/combat-analytics.json`, Questlog **0.1.35** modeline göre herkese açık buff etkileri/adları, stat kimlikleri ve boss toleransı meta verisini içerir. Temel tanım **rDPS = (hasar − alınan destek katkısı + verilen destek katkısı) / ortak süre**. Sayısal meta verisi bilinmeyen dış etkide ilgili sonuç **—** olur; eksik katkı sıfır sayılmaz. Yerel **11 savaş / 35 oyuncu satırında** hasar ve alınan hasar eşleşti. NPC `2300207` için eski raporun beş oyuncusundaki destek/rDPS sonuçları `1000` toleransla kayan nokta hassasiyetinde eşleşirken güncel katalog `2250` kullanır; tarihsel katalog farkı böylece ayrıştırıldı. Üretim güncel değeri korur; güncel meta veriyle bütün eski rDPS sayılarının veya kontrollü canlı Questlog eşitliğinin doğrulandığı iddia edilmez. DPS/HPS önceki toplama kurallarını korur; PvP ortak süresi oyuncular arasındaki gelen/giden hasarı ve ilgili ölüm olaylarını kapsar.

**Savaş geçmişi** tamamlanan canlı karşılaşmaların tam analiz snapshot'larını `settings/archive/encounters/` altında atomik JSON dosyalarına kaydeder. Uygulama yeniden açılınca kayıtlar kalır; bellekteki son 30 savaş listesinin sınırı kalıcı arşive uygulanmaz. Kayıt açmak canlı yakalamayı, seçili hedefi veya aktif savaşı değiştirmez. **Veri ve araçlar → Questlog kaydını yeniden hesapla** ise önceki araştırma/replay aracıdır ve canlı yakalamayı durdurur. Arşiv hatası ekranda bildirilir; tek karşılaşma için 32 MiB sınırı veriyi sessizce kırpmak için kullanılmaz.

**Zindanlar / Bölgeler** aynı bölgedeki gözlenen karşılaşmaları, boss öldürmelerini ve wipe'ları birlikte listeler. Gerçek dungeon zamanını ölçmek için girişte **Dungeon turunu başlat**, çıkışta **Tamamlandı** kullan. Tamamlama süresi bu iki kullanıcı işareti arasındadır; **Turu bitir**, kesilen turu clear saymadan kapatır. Yalnızca bölge değişimi veya bir boss ölümü otomatik dungeon clear kanıtı değildir. Gözlenen bölge süresi ile kullanıcı tarafından tamamlanan dungeon süresi ayrı gösterilir. Beklenmedik kapanıştan önce açık kalan tur yeniden açılışta **Kesildi** olur; uygulamanın kapalı olduğu saatler clear'a eklenmez.

**Kişisel rekorlar**, sabit kimliği bilinen kendi karakterinin doğrulanmış boss öldürmelerindeki yerel sonuçlarını ayırır. Paket boşluğu/kırpılma bulunan kayıtlar ve birden çok bossun ayrılmamış toplamı rekor yapılmaz. **PvP** oturumları, yalnızca alınan hasar bulunan savaşlar dahil, ayrı listelenir. Öldürme/ölüm sayısı bilinen olaylara dayanır; bilinmeyen öldüren tahmin edilmez. **JSON indir** ve **Sohbete kopyala**, kullanıcı tarafından paylaşılabilecek yerel çıktılardır. Otomatik yükleme veya çevrimiçi sıralama yoktur; kopyalama oyuna yazı göndermez.

Boss savaşında kendi ölümün veya görüş alanından çıkıp aynı haritaya dönmen hasarı hemen silmez. Kurtarma penceresi varsayılan **5 dakika**dır; aynı karakterin dbid veya tam ad+sunucu eşleşmesi yeni entity'ye bağlanır. Geçmiş vuruş/heal sahipliği, pet hasarı ve aktif buff sahipliği korunur. Gerçek bölge değişimi, hasar almış bossun tam HP'ye dönmesi ve doğrulanmış boss ölümü önceki sınır kurallarını uygular. Boss için normal idle kontrolü hem zamanlayıcıda hem yeni vuruşta **90 saniye**dir. Geri döndükten sonraki vuruş ilk vuruşla aynı zaman penceresini paylaştığı için aradaki boşluk DPS'yi düşürebilir.

Bu sürümün motoru ve kalıcı arşivini etkinleştirmek için uygun bir zamanda backend'i **bir kez normal kapatıp yeniden başlatmak** gerekir; yalnızca `Overlay-Yenile.cmd` hesap motorunu yenilemez. Oyun açıkken gereksiz yeniden başlatma yapma. Yeniden başlatma sonrası kimlik henüz gelmediyse bölge değiştirmek/teleport yapmak önceki geçici çözümdür.

Geliştirme testlerinde `AION_HISTORY_DIR` ayrı arşiv dizini seçer. Yeni ilgili testler `test/history-*.test.mjs`, `test/pvp-continuity.test.mjs`, `test/combat-analytics.test.mjs` ve `test/overlay-combat.test.mjs` içindedir. 17 Ekim test sayıları yukarıda tarihsel kayıt olarak korunmuştur; yeni testleri ve izole UI doğrulamasını güncel çalıştırma sonucu ile raporla. Eski `settings/overlay-4317/layout.json` tercihleri ve cube alarmının davranışı korunur; kişisel arşiv dahil `settings/` paylaşılacak temiz ZIP'e girmez.

### 0.2.1 — Küpe yaklaşma göstergesi

Küp overlay'i ve uygulamadaki Hidden cube ekranı, güncel konum gözlemleri yeterliyken **Yaklaşıyorsun / Uzaklaşıyorsun / Belirgin değişim yok** bilgisini ve yaklaşık **yatay** mesafeyi gösterir. Tahmini konum ayrıca belirtilir. Tek konum gözlemi hareket yönünü kanıtlamaz; yeni ölçüm beklenir. Aynı verinin tekrar gösterilmesi hareket sayılmaz. Küplerin ölçümleri ayrı tutulur; küçük koordinat oynamaları, teleport, veri boşluğu ve konum kaynağındaki değişimler geçerli yön bilgisi gibi sunulmaz.

Konum veya bağlantı bayatlayınca gösterge **Yakınlık bilinmiyor** olur. Gösterge deneysel konum verisine dayanır; kesintisiz yürüyüş takibi ve fiziksel metre kalibrasyonu henüz doğrulanmamıştır. İlk görünme alarmı ve üç saniyelik ses tekrarı bu göstergeden bağımsız çalışır. Uygulamanın ekranda mesafe göstermesi, küp algılama menzilinin değiştirilmesi anlamına gelmez.

### 0.3.0 — Yerel cube haritası ve yürüyüş paketleri

**Uygulama → Hidden cube** sayfasında Poeta, Verteron, Eltnen, Ishalgen, Altgard, Morheim ve Chaotic Lower Reshanta haritaları yereldir. Algılanan cube'lar elmas, karakterin alınan konumu nokta ile gösterilir. Takip, yakınlaştırma, sürükleme ve katman kontrolleri bulunur. Yeni koordinat geldiğinde karakter noktası taşınır; güncelleme kesildiğinde son konum gri ve zaman bilgisiyle kalır. Yalnız aynı bağlantı/harita bağlamındaki koordinatlar eşleştirilir. Bilinmeyen veya desteklenmeyen bölgede yanlış haritaya pin çizilmez. Yeni başlatmada harita ve kendi kimliği henüz alınmadıysa ölçer açıkken bir kez bölge değiştir.

Questlog 0.1.36'nın hareket okuyucusuyla karşılaştırmada `0x371a/b/c` için önceki dar bayrak/uzunluk kontrolünün geçerli hareket biçimlerini atladığı görüldü. Okuyucu artık doğrulanan tam bitmask şemalarını tüketir; yalnız global XYZ konum yapılır. Aynı TCP bağlantısındaki kısa çerçeve kesintisinde bilinen karakter kimliği korunur; eski koordinatlar, cube pinleri ve yaklaşma örnekleri temizlenir. Sonraki geçerli kendi hareketi yeniden takip başlatabilir. Bu sırada bölge son doğrulanan haritadan alınıyorsa ekranda belirtilir. Gerçek bölge değişimi, bağlantı kapanması ve yakalama hatası kimliği temizler.

Harita görselleri NCSOFT'a aittir; herkese açık Questlog CDN kaynakları, koordinat dönüşümü ve SHA-256 değerleri `data/world-maps.json` içinde kayıtlıdır. `node scripts/update-map-catalog.mjs` yedi görseli doğrular; `--refresh` yeniler. Kullanım sırasında dış bağlantı gerekmez. Cube haritası oyunun henüz bildirmediği cube'ları keşfetmez. Petlerin bilinen spawn noktaları 0.5.0'da ayrı Petler menüsündedir; cube haritasına eklenmez.

### 0.3.1 — Questlog ile aynı harita konumu

Önceki harita dönüşümündeki dikey aynalama düzeltildi. Ham oyun koordinatı görselde `px=(x-originX)×tileSize/cellUnits`, `py=(y-originY)×tileSize/cellUnits` ile çizilir. Verteron'da `(0,-204000)` bağımsız kontrol noktası `(4096,2048)` pikselidir; Ishalgen'in alt/üst ham Y sınırları da ayrıca sınanır.

`src/map-position.mjs`, Questlog 0.1.36'nın harita takibini bağımsız uygular: kendi karakterinin görünme, hareket ve warp konumları ile hedefi ve atanı kendi karakteri olan buff'ın sıfır olmayan `rangeBase` koordinatı kullanılır. NPC görünürlük çemberlerinden hesaplanan konum haritaya aktarılmaz. XYZ yuvarlanır; yeni gözlem gelmeden nokta yürütülmez. Konum 60 saniyeden önce güncel, sonra gri son konumdur. Aynı bağlantıdaki kısa framing kesintisi kimliği, bölgeyi ve son harita noktasının gerçek zamanını korur; eski küp pinleri temizlenir. Gerçek bölge değişimi veya bağlantı kapanması harita konumunu sıfırlar.

Bu harita modeli yakınlık göstergesinden ayrıdır. Yaklaşma/uzaklaşma hesabı daha sıkı, üç saniyelik konum ve destekleyici kanıt koşullarını korur; self buff alanı bu hesapta tek başına bağımsız hareket ölçümü sayılmaz. Haritadaki buff kaynaklı nokta **Tahmini** olarak belirtilir. İlk alarm ve üç saniyelik ses tekrarı aynıdır.

### 0.4.0 — Küp haritası overlay

Oyunda **360×360** boyutunda ayrı **Küp haritası** penceresi bulunur. Karakter haritanın merkezinde kalır; yeni koordinatlar geldikçe zemin ve küp işaretleri onun çevresinde kayar. **Alt** basılıyken başlıktan taşıyabilir, **+/−** ile yakınlaştırabilir, **Gizle** ile kapatabilirsin. Küçük **Arayüz** menüsündeki **Küp haritası** anahtarı elle açıp kapatır. Konumu ve açık/gizli tercihi mevcut overlay profiline kaydedilir.

İlk kullanımda harita gizlidir. Canlı yakalamada yeni, mevcut bir küp tespit edilince ses alarmı kapalı veya sessiz olsa da açılır. Gizlediğin aynı küpün yinelenen durum mesajları pencereyi tekrar açmaz; sonraki yeni küp açar. Geçmiş, demo veya sağlıksız yakalama bildirimleri otomatik açılmaz. Pencere oyunun odak kurallarına uyar; Alt+Tab ve genel pencereleri gizleme tercihi geçerlidir. Haritayı gizlemek veri toplamayı veya diğer küp alarmını durdurmaz.

Mini harita, uygulamadaki `public/cube-map.js` bileşenini, aynı yerel görselleri ve 0.3.1'de doğrulanan Questlog konum modelini kullanır. Ayrı konum hesabı veya hareket tahmini yoktur; eski konum gri gösterilir. Harita ses üretmez, mevcut küp alarmı tek ses kaynağı kalır. Yeni dosyalar kurulduktan sonra **Overlay-Yenile.cmd → Yönetici olarak çalıştır** yalnız arayüzü yeniler; canlı veri okuyucusunu yeniden başlatmak gerekmez.

### 0.5.0 — Pet koleksiyonu ve uygulama içi harita

**Kami uygulaması → Petler**, **209 pet / 14.652 bilinen spawn** içerir. **Haritada aç** aynı menüdeki haritayı açar; native mini küp penceresine komut göndermez. İkonlar ve haritalar yereldir; Questlog'un açık olması gerekmez.

- Koleksiyon tam **karakter adı + sunucu** eşleşmesiyle tutulur. Son yerel/Questlog kaydı **Son kaydedilen**, doğru karakterin tam başlangıç paketi **Canlı** gösterilir; güven kaybında kaydedilmiş veriye dönülebilir. Eksik tamlıkta pet yokluğu **Bilinmiyor** kalır. Kişisel dosya `settings/pets/collections.json` içindedir ve temiz pakete girmez.
- **Cogni / Fera / Natura / Varian (Trans) / Özel tür seviyeleri**, karttaki **0–3 pet seviyesinden** ayrıdır. Bilinmeyen tür seviyesi **—** kalır. Ruh maliyetleri artımlı **5/25/75**; oyundan alınan seviye ve ruhlarla ulaşılabilir seviye ayrı etiketlenir. **Auto**, kapsam ve plana dahil petlerin en düşük ulaşılabilir seviyesinin bir üstünü, en çok 3'ü hedefler; bilinmeyende hedef 1 kalır. Plan dışı tercihi yerelde saklanır. **En az ruh gereken** coğrafi yakınlık değildir.
- Arama, sahiplik, pet seviyesi, tür ve sıralama yanında bölge/taraf filtreleri vardır. Normal seçim o bölgede de bulunanları kapsar; **Sadece** başka bölgede bulunanları eler. **Bulunduğum bölge** alınan haritayı kullanır. Irka göre engel yoktur; Spacetime Rift sonrası **Altgard** da seçilebilir. Bilinmeyen dungeon ID'leri yalnız taraf kanıtı sayılmaz.
- **Bilinen konumlar** boş halka, **canlı görülenler** yeşil, kendi konumun mavi noktadır; statik spawn petin şu anda orada olduğunu göstermez. Aynı NPC/bağlantı/harita bağlamı aranır. Yedi ana haritaya **Chaotic Middle Reshanta (22)** dört tile ile eklenir; desteklenmeyen bölge yanlış haritaya çizilmez. Konum gözlemler arasında yürütülmez; eski nokta gri kalır.

21.10.2026'da **261 otomatik test + 41 Petler UI kontrolü** geçti. Gerçek başlangıç koleksiyon paketi, Verteron'da ayrı statik/canlı noktalar ve gap sonrası kaydedilmiş veriye dönüş ayrıca gözlendi. Ayrıntılar ve kanıt sınırları [protokol notlarındadır](research/PROTOCOL.md). Genel katalog araçları `scripts/update-pet-catalog.mjs` ve `scripts/update-pet-map-catalog.mjs` içindedir.

#### Kompakt pet çalışma alanı

Türler ve filtreler sol menüdedir; kompakt pet listesi ile harita masaüstünde yan yana kalır. Liste 3. seviyeye kalan ruha göre sıralanır; tamamlananları gizleme seçeneği vardır. Ruhları yetse de bilinen seviyesi henüz 3 olmayan pet listede kalır. Tür özetinde **sahip olunan / toplam** ve **3. seviye / toplam** ayrı gösterilir; bu sayılar liste filtreleriyle değişmez. Bilinmeyen seviyeler tamamlanmış veya eksik sayılmaz. Gelişmiş filtreler açılır bölümde korunur.
Pet satırları bilinen spawn bölgelerine göre **Elyos / Asmodian / Abyss** etiketlerini birlikte gösterebilir; bunlar karakterin ırkı değildir. Bilinmeyen dungeon kimliğinden taraf türetilmez. Pet haritasında seçili petin bulunduğu bölgeler doğrudan düğmelerle seçilir; etkin düğme ve bilinen konum sayısı görünür. Sol menünün genel bölge filtresi ayrı kalır.
## 0.6.0 — Oyun içi pet haritası

Petler menüsünde seçili haritanın üstündeki **Oyun içinde göster**, ayrı **420×420 Pet haritası** penceresini açar. Yeni pet için tekrar basınca aynı pencere o pete geçer. Kendi konumu merkezde takip edilir; bilinen spawn halkaları ve canlı görülen NPC noktaları ayrı kalır. Bulunduğun bölge bu petin konumları arasındaysa takip o bölgeye geçer; başka bölgenin haritasına karakter noktası taşınmaz. Yeni veri gelmeden hareket üretilmez; eski konum ayrı gösterilir.

**Alt** ile başlıktan taşı, **+/−** ile yakınlaştır, **Gizle** ile kapat. Arayüz kutusu veya tepsi **Pet haritası** seçeneği son seçili peti yeniden açar. Pencere yalnız oyun öndeyken veya masaüstünde düzenleme açıkken görünür. Kalıcı NOACTIVATE / click-through politikası diğer dört pencereyle aynıdır; pet haritası ses üretmez ve küp pencereleri bağımsızdır.

Pet adının yanındaki başlık, bilinen pet seviyesini, ruh bakiyesini ve **bir sonraki seviyeye kalan ruhu** gösterir. Örneğin `Sv. 1 · 14/25 ruh · 11 kaldı`; 3. seviyede **Tamamlandı** yazar. Seviye artışı otomatiktir; yeni oyun verisi geldiğinde başlık güncellenir. Son kayıt kullanılıyorsa bu, başlığın açıklamasında belirtilir; bilinmeyen seviye veya ruh sayısı sıfır sayılmaz.


## 0.7.0 — Windows kurulumu ve güncellemeler

Windows için Kami DPS Meter.exe başlatıcı ve Türkçe Inno Setup kurulum paketi eklenir. Kurulumda masaüstü kısayolu varsayılan seçili, Windows açılışında başlatma isteğe bağlıdır. Otomatik başlangıç ana pencereyi açmaz; tepsi ve oyun üstü pencereleri başlatır. Tepsideki Tamamen kapat okuyucuyu ve overlay'i birlikte kapatır. Windows Ayarlar/Uygulamalar kaldırma girişi bulunur. Npcap ayrı önkoşuldur; eksikse resmi indirme bağlantısı gösterilir.

Kurulum dosyaları kullanıcı verisinden ayrıdır. Kurulu sürümün verisi %LOCALAPPDATA%/Kami DPS Meter/data içinde; portable sürüm eski settings/captures düzenini korur. Kurulumdaki isteğe bağlı portable aktarımı kaynakları silmeden ve mevcut hedef dosyaları ezmeden kopyalar. Normal kaldırma kişisel verileri korur. AION_DATA_DIR ve eski özel dizin değişkenleri ile testler ayrı veri alanlarında çalışır. Başlat/kapat işlemleri portta çalışan uygulamanın kökünü ve veri kimliğini doğrular; başka bir checkout'u sessizce kullanmaz veya kapatmaz.

Hakkında ekranındaki güncelleme kontrolü GitHub Releases'teki kararlı sürümleri ve tam eşleşen Kami-DPS-Meter-Setup-X.Y.Z.exe dosyasını arar. İndir ve kur yalnız kurulu Windows sürümünde kullanılabilir. Dosyanın yayıncı deposu/HTTPS adresi, boyutu, PE başlığı ve GitHub SHA-256 özeti doğrulanır. Uygulama savaş, test kaydı veya açık elle zamanlanan dungeon turu sırasında güncellenmez. Ayrı yardımcı önce tam süreç kapanışını bekler, normal kurulum penceresini açar ve iptalde mevcut sürümü yeniden açar. İnternet/kontrol hatası ölçümü durdurmaz. Kod değişikliği sürümü yayımlamaz; yeni installer ve sürüm etiketi GitHub Releases'e ayrıca yüklenmelidir.

Üretim: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-installer.ps1. Mevcut temiz staging için -PortableStaging kullanılabilir. Derleyici kullanıcı sistemine kurulmadan doğrulanmış resmi Inno dosyasından çalışma klasörüne çıkarılır. Paket üretiminde özel settings/captures/tmp dosyaları dışlanır; her çıktı için SHA-256 ve derleme raporu üretilir.
