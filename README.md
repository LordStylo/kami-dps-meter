# Kami DPS Meter (Aion DPS Lab)

Windows için yerel Aion 2 DPS ölçer prototipi. DPS, küp bildirimi ve küçük arayüz kontrol kutusu ya da ayrıntılı tarayıcı arayüzü kullanılabilir; Npcap yakalama arka planda çalışır. Kurulu Questlog 0.1.24'ün statik incelemesinden belgelenen paket yapıları için ayrı bir okuyucu ve hesaplama motoru yazılmıştır. Çalışmak için Questlog uygulamasının açık olması gerekmez.

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

DPS = seçilmiş hasar / `max(1 saniye, son seçilmiş hasar − ilk seçilmiş hasar)`. Oyuncular aynı süreyi paylaşır; hasarsız bekleme ve ölüm olayına kadar geçen süre paydaya eklenmez. Questlog 0.1.24'te incelenen boss ölümü, parti savaş çıkışı, HP sıfırlanması/wipe, scripted despawn ve bölge değişimi kuralları uygulanır. Normal bekleme 15 saniye, boss periyodik kontrolü 90 saniyedir; ayrıntılar [protokol notlarında](research/PROTOCOL.md). Kayıt oynatmada kaynak raporun hedefleri, katılımcıları ve zaman aralığı seçilir; hasar günlükten yeniden hesaplanır. Ölüm ve aynı zaman damgalı olayların sırası korunur.

`dmg` alanı ek vuruş hasarını zaten içerir. Kritik yüzdesi ek vuruş adetleriyle ağırlıklandırılmaz; doğrudan hasar olayları üzerinden hesaplanır. 11.000.000–19.999.999 aralığındaki skill varyantları 10.000'lik taban kimlikte gruplanır.

Kimliği henüz bilinmeyen saldıranların olayları oyuncu toplamına tahminle eklenmez; tanı sayacına yazılır. Pet kaybolduktan sonraki DoT sahibine yazılır; sahibi sonradan değiştiğinde önceki hasar yeniden başka oyuncuya atanmaz. Bölge değişiminde entity önbelleği temizlenir, doğrulanmış parti isim+sunucu/dbid kimliği saklanır. Parti/force HP mesajları kaçırılmış üyeliği toparlayabilir; sıradan HP mesajı üyelik sayılmaz.

Yetenek adları ve ikonları [Questlog'un herkese açık yetenek veritabanından](https://questlog.gg/aion-2/en-nc/db/skills) alınan yerel katalogla eşleştirilir. KR/TW İngilizce kataloğu kullanılır. Katalogda olmayan yeteneklerin kimlik numarası ve genel simgesi görünür; boss isimleri ayrı yerel katalogdan gelir, genel NPC isim kataloğu yoktur. Yetenek DPS'leri oyuncuyla aynı süreyi kullanır ve toplamları oyuncu DPS'sine eşittir. Yalnızca DoT içeren yeteneklerde kritik oranı uygulanmadığı için `—` gösterilir.

rDPS/buff katkısı, raid mekanikleri ve kurulum EXE'si bu sürümde yoktur. Party scan-list dolu varyantı bilinçli olarak desteklenmiyor; hata sayacında belirtilir. Karakter/NPC görünme mesajlarının tamamı değil, gereken başlangıcı doğrulanır. Sürüm sonrası şema değişiklikleri yeniden incelenmelidir.

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
- `overlay/`: Electron ana süreç, kısıtlı preload köprüsü, meter pencereleri ve kontrol kutusu.
- `data/effect-types.json`: kurulu sürümden çıkarılan sayısal effect sınıflandırmaları.
- `data/skills.json`, `src/skills.mjs`, `public/icons/skills/`: ad/ikon kataloğu, eşleştirme ve yerel görseller.
- `scripts/inspect-install.mjs`, `scripts/catalog-protocol.mjs`: tekrar üretilebilir statik inceleme araçları.
- `research/private/`: orijinal uygulamadan araştırma kopyaları; `.gitignore` içinde. Uygulama bunları yüklemez.

Genel format ve API başvuruları [protokol notlarında](research/PROTOCOL.md) listelenmiştir.
