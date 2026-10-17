# Kami DPS Meter — geliştirme ve devam notları

Son güncelleme: **17.10.2026**. Bu dosya, yapılan geliştirmelerin ve çözülen sorunların devam eden çalışmalarda korunması için tutulur. Kullanım kılavuzu [README.md](README.md), bayt düzeni ve ayrıntılı hesap kuralları [research/PROTOCOL.md](research/PROTOCOL.md) içindedir.

## Proje ve çalışma biçimi

- Windows x64 üzerinde Aion 2 için yerel DPS/HPS ölçer, deneysel hidden cube alarmı ve Electron overlay.
- GitHub: `https://github.com/LordStylo/kami-dps-meter`.
- Git commit yazarı yalnızca **LordStylo <187667270+LordStylo@users.noreply.github.com>** olmalı. Başka yazar veya `Co-authored-by` ekleme.
- Npcap ile oyunun TCP trafiği pasif okunur; oyun sürecine kod enjekte edilmez, oyun belleği değiştirilmez ve oyun adına paket gönderilmez.
- Questlog 0.1.24 statik incelemesi ve yerel kayıt karşılaştırmaları protokolü anlamak için kullanıldı. Uygulamanın okuyucusu ve hesap motoru bağımsızdır; çalışırken Questlog gerekmez.
- Sunucu yalnızca `127.0.0.1` üzerinde çalışır; varsayılan adres `http://127.0.0.1:4317/`.

## Kurulum ve günlük kullanım

Kaynak koddan kurulum: Windows x64, Node.js 22+, pnpm ve ayrıca kurulmuş Npcap gerekir.

```powershell
pnpm install --frozen-lockfile
pnpm run update:skills
pnpm run overlay:install
```

`overlay:install`, sabit sürümlü Electron'u indirir ve native fare yardımcısını derler. Yalnızca yardımcıyı yeniden üretmek için `pnpm run overlay:build-native` kullanılabilir.

| Dosya / işlem | Davranış |
|---|---|
| `Baslat.cmd` | Veri toplamayı ve overlay'i açar; sunucu zaten varsa ikinci sunucu oluşturmaz |
| `Tarayici.cmd` | Ayrıntılı yerel tarayıcı arayüzünü açar |
| `Overlay-Yenile.cmd` | Yalnızca overlay'i yeniler; veri toplama ve kayıt sürer |
| Tepsi → `Overlay’i kapat (veri toplama sürer)` | Yalnızca overlay'i kapatır |
| Tepsi → `Tamamen kapat` / `Kapat.cmd` | Sunucuyu, yakalamayı ve overlay'i kapatır |

Oyun yönetici olarak çalışıyorsa overlay de aynı yetkide açılmalıdır. Bu oturumda otomatik Windows izin penceresi bazen görünmedi; gerektiğinde başlatıcıya veya `Overlay-Yenile.cmd` dosyasına sağ tık → **Yönetici olarak çalıştır** kullanıldı. Npcap yalnızca yöneticilere izin verecek şekilde kurulmuşsa yakalama için de yönetici yetkisi gerekir.

**Canlı kullanım sırasında backend'i gereksiz yere yeniden başlatma.** Backend yeniden başladığında karakterin görünme/kimlik paketi henüz gelmediyse paketler okunsa bile kişisel/parti tablosu boş kalabilir. Bölge değiştirmek veya teleport yapmak kimlik paketlerini yeniden getirir. Yalnızca overlay yenilenince buna gerek yoktur. Kullanıcı kimlik önbelleği geliştirmesini şimdilik erteledi.

## Mimari ve dosyalar

| Konum | Sorumluluk |
|---|---|
| `src/capture/` | Npcap/Windows FFI, süreç bağlantıları, TCP birleştirme ve yakalama worker'ı |
| `src/protocol/` | Varint çerçeve, raw LZ4, mesaj okuyucuları ve normalleştirilmiş olaylar |
| `src/meter.mjs` | Kimlik/parti/pet eşleştirme, karşılaşmalar, DPS/HPS ve görünürlük durumu |
| `src/bosses.mjs`, `data/bosses.json` | Yerel boss kataloğu ve eşleştirme |
| `src/replay.mjs` | Yerel kayıtların yeniden hesaplanması |
| `src/server.mjs`, `public/` | Yerel HTTP servisi, canlı durum ve ayrıntılı tarayıcı arayüzü |
| `overlay/main.cjs`, `overlay/renderer.js` | Electron yaşam döngüsü, üç pencere, arayüz ve etkileşim |
| `overlay/focus.cjs`, `overlay/interaction.cjs` | Oyun odağı, Alt etkileşimi ve uygulama değiştirme kuralları |
| `overlay/mouse-window.cjs`, `native/mouse-policy.c` | Odak almayan tıklama ve native resize döngüsünün engellenmesi |
| `overlay/cube-alarm.cjs` | Alarmın başlat/durdur/sessiz/gizle durumları ve yeni tespit açılması |
| `overlay/combat-view.mjs` | Hasar/iyileştirme, party/individual görünümü |
| `overlay/layout.cjs` | Boyut, konum, mod, şeffaflık ve görünürlük tercihlerinin saklanması |
| `overlay/diagnostics.cjs`, `overlay/host-state.cjs` | Hata/oturum tanıları ve eski süreç işaretlerinin güvenli temizlenmesi |
| `overlay/shutdown.cjs` | Sunucu kapanışını doğrulayan tam kapatma |
| `scripts/`, `test/`, `research/` | Kurulum/paketleme/doğrulama araçları, testler ve protokol notları |

## Mevcut overlay özellikleri

- Üç pencere var: kompakt DPS/HPS, kare küp paneli ve küçük dört kareli kontrol kutusu.
- Normalde yalnızca oyun öndeyken görünürler. Tepside **Masaüstünde düzenle** seçilirse masaüstünde düzenlenebilirler.
- **Alt basılıyken** başlıktan taşıma, köşeden boyutlandırma ve düğmeler çalışır. Alt bırakıldığında fare oyuna geçer.
- DPS varsayılan **232×210**, en küçük **220×150** mantıksal piksel; sağ alt özel tutamaçla büyütülüp küçültülür. Parti / Ben ve Hasar / İyileştirme tek satırdadır; isim-DPS boşluğu daraltılmıştır. Satırlar gerektiğinde kayar.
- **−/+** yalnızca başlık kalacak biçimde küçültür/açar. Küçük başlıkta DPS sayısı görünmez.
- Dişlide arka plan şeffaflığı ve **Savaş dışında otomatik gizle** bulunur. Yazılar ve ikonlar şeffaflıkla solmaz.
- **Party mode** parti sıralamasını, **Individual mode** yalnızca kendi değerlerini ve skill dökümünü gösterir. Karakter bilinmiyorsa başka oyuncu kendi karakterinmiş gibi seçilmez.
- **Hasar / İyileştirme** aynı pencerede DPS ve HPS görünümünü değiştirir.
- Kontrol kutusu DPS/küp görünürlüğünü yönetir. **DPS’yi göster**, savaş dışında son sonucu geçici açar; **Otomatik gizlemeye dön** bunu iptal eder. Yeni savaş geçici gösterimi temizler.
- Kalıcı otomatik gizleme tercihi, mod, şeffaflık, boyut ve konum `settings/overlay-4317/layout.json` içindedir. Geçici DPS gösterimi kalıcı değildir.
- `compactVersion:1` eski büyük DPS boyutunu bir kez 232×210'a geçirir; konum ve diğer tercihler korunur. Marker geldikten sonra kullanıcının yeni boyutlandırmasını her açılışta sıfırlama.
- Manuel gizleme ve oyun odağı kuralları otomatik göstermeden önceliklidir; küpün yeni tespitte açılması aşağıdaki özel davranıştır.

## Küp alarmı

Panel **206×206** boyutunda. Otomatik tespit hâlâ **deneyseldir**; doğrulanan aday nesne türü `1200039`.

| Düğme / durum | Davranış |
|---|---|
| `Başlat` | Alarmı etkinleştirir; mevcut geçerli tespit varsa onu da değerlendirir |
| `Sesi dene` | Test sesi çalar; alarmı başlatmaz veya sessiz tercihini değiştirmez |
| `Sessiz` | Otomatik sesi kapatır; görsel tespit ve yeni küpte panelin açılması sürer |
| `Durdur` | Alarmı ve otomatik açılmayı durdurur; Npcap yakalamasını durdurmaz |
| `Gizle` | Paneli gizler ve kontrol kutusunda kapalı gösterir; etkin alarm arka planda sürer |
| Yeni küp tespiti | Gizlenmiş paneli yeniden açar; kontrol kutusu da açık durumuna geçer |

Küp mevcut ve canlı veri sağlıklı kaldıkça ses **3 saniyede bir** tekrarlar. Kaybolma, durdurma, sessize alma veya veri tazeliğinin kaybı tekrarları durdurur. Aynı küpü gizlemek her durum güncellemesinde yeniden açılmasına neden olmaz. Yeniden bağlantıda eski tespitten çift alarm üretilmez.

Overlay her yeniden açıldığında **Başlat** gerekir. Tarayıcının ses etkinleştirmesi bağımsızdır; ikisini birden açmak çift ses üretebilir. Test sesi tek başına gerçek küp tespitinin kanıtı değildir. DPS'nin çalışması Npcap/çözümleme yolunu doğrular; küp türünün gerçekten görülmesini garanti etmez.

Algılama kaydından önce gelmiş nesne görünme mesajı geriye dönük bulunamaz; ölçeri aramadan önce aç. Kesin algılama mesafesi doğrulanmadı. Karakter konumundan yakınlık araştırıldı, ancak konumlar seyrek ve akış kaybından etkileniyor. **Yaklaştıkça daha sık ötme devrede değildir**; güvenilir olmayan mesafe üretme.

İşaretli test: aramayı başlat → **Buldum** / `Ctrl+Shift+F8` → **Açtım** / `Ctrl+Shift+F9`. Kayıtlar `captures/cube-research/` altında kalır. İnceleme: `node scripts/analyze-cube.mjs latest`. Ayrıntılar [research/CUBE-TEST.md](research/CUBE-TEST.md).

## DPS, parti ve karşılaşma kuralları

Hesap davranışı Questlog 0.1.24 statik incelemesine göre ayarlandı. Sürüm değişince yeniden doğrulanmalıdır.

- **DPS = seçili hasar / max(1 saniye, son uygun hasar zamanı − ilk uygun hasar zamanı).** Parti oyuncuları ve skill satırları aynı paydayı kullanır. Hasarsız bekleme veya ölüm bildirimine kadar geçen süre eklenmez.
- `dmg` ek vuruş hasarını zaten içerir; tekrar ekleme. Kritik oranı doğrudan hasar olaylarından hesaplanır; ek vuruş sayısıyla ağırlıklandırılmaz. DoT için kritik oranı uydurulmaz.
- Bilinen karakterde yeni karşılaşmayı kendi/parti hasarı başlatır; yakındaki yabancıların hasarı başlatmaz. Kimlik eksikken geçici toplama davranışı vardır.
- Boss ölümü karşılaşmayı hemen bitirir. Sonraki boss önceki bossun hasarına eklenmez.
- Normal yaratık ölümünde parti savaş durumu biliniyorsa savaş çıkışı beklenir; durum bilinmiyorsa tüm hedeflerin ölmesi bitiş sağlayabilir.
- Bilinen parti durumlarında herhangi bir üye savaşta kaldıkça normal savaş sürer. Boss savaşında yalnızca kendi savaş dışı bildirimi bossu bölmez.
- HP'nin sıfır görünmesi veya ödül bildirimi tek başına bitiş değildir. Hasar almış bossun tam HP'ye dönmesi wipe sayılır.
- Boss kaldırılmasında neden 3 ölüm mesajını bekler; neden 7 ve katalogdaki scripted-exit bilgisi despawn sayılabilir, diğer uygun durumlar wipe'tır. Normal mob kaldırılması tek başına karşılaşmayı bitirmez.
- Normal bekleme **15 sn**, boss periyodik kontrolü **90 sn**. Yabancıların hasarı parti bekleme süresini uzatmaz. Bölge değişimi karşılaşmayı bitirir.
- Kaybolan petin geç DoT hasarı sahibinde kalır; sonraki sahiplik önceki hasarı yeniden dağıtmaz.
- Parti üyeliği doğrulanmış dbid veya tam ad+sunucu kimliğiyle bölge değişiminden taşınabilir; eski entity ID'leri taşınmaz. Parti/force HP mesajları kaçırılmış üyeliği toparlar, sıradan HP mesajı üyelik sayılmaz.
- Kayıt oynatma kaynak rapordaki katılımcı/hedef/zaman aralığını uygular; olay sırasını korur. Otomatik karşılaşma sınırı doğrulaması ayrıca tam günlükte yapılır.

## İyileştirme / HPS

- Doğrudan iyileştirme, HoT ve pakette görülen lifesteal/HP drain-recovery olayları sayılır. Lifesteal saldıranın kendi iyileştirmesine, ilgili skill altında yazılır.
- Yalnızca iyileştirme yapan parti üyesi HPS sıralamasında görünür. İyileştirme tek başına karşılaşma başlatmaz veya uzatmaz.
- HPS ortak parti karşılaşma hasar süresini kullanır. Düşman hedef filtresi iyileştirmeleri elemez.
- **Overheal ayrıştırılmıyor.** Paketin bildirdiği miktar toplanır; bunun her olayda etkin iyileştirme mi, fazla iyileştirmeyi içeren miktar mı olduğu canlı testle kesinleşmedi. “Tüm overheal sayılıyor” deme.
- İyileştirme kritik oranı gösterilmiyor. Kontrollü canlı HPS karşılaştırması henüz yapılmadı.

## Çözülen sorunlar ve korunacak kararlar

### Alt etkileşimi ve Alt+Tab fare takılması

Başlangıçta overlay masaüstünde tıklanırken oyunda tıklanmıyordu. Oyun/overlay yetki farkı giderildi; odak almayan pencerenin ilk tıklamayı yutması da düzeltildi. Ardından Alt+Tab sonrasında fare ekran ortasına geri çekiliyor, bazen birkaç uygulama değişiminden sonra düzeliyordu.

Kalıcı kural: overlay **her zaman `focusable:false`** kalır. `focus()`, `setFocusable(true)`, `SetForegroundWindow`, oyuna odak döndürme, oyun penceresine mesaj gönderme veya oyun adına fare yakalama bırakma ekleme. Alt+Tab, Alt+Esc veya Windows tuşu görüldüğünde o Alt basışı bitene kadar etkileşim bastırılır. Kullanıcı hem tıklamalı hem tıklamasız Alt+Tab senaryosunun düzeldiğini doğruladı.

### Sürükleme / boyutlandırma sırasında kapanma

Kullanıcı çapraz resize imlecinin takılmasından sonra kapanma gördü. Windows kayıtlarında `0xc0000409`, `0xc0000005`, `0xc000041d` ve sonraki denemede `0x80000003` bulundu. Koffi **2.15.2 → 2.16.3** yükseltmesi tek başına yeterli olmadı.

Son çözüm, Windows pencere callback'inin JavaScript'e girmesini kaldırmak oldu:

- `native/mouse-policy.c` callback'i tamamen C içinde çalıştırır; yalnızca kendi süreç/thread HWND'lerini kabul eder.
- `WM_MOUSEACTIVATE` → `MA_NOACTIVATE` (3): tıklama ulaşır, overlay odak almaz.
- Native resize hit sonuçları `HTCLIENT` olur; `SC_SIZE` engellenir. Özel HTML köşe tutamacı `setBounds` ile çalışır.
- `resizable:true` programatik boyutlandırma ve kesirli ekran ölçeği için korunur; native resize döngüsü açılmaz. Kaydedilen mantıksal boyutu yuvarlanmış `getBounds()` değerleriyle tekrar tekrar büyütme.
- **Koffi `register` / JavaScript WndProc callback yolunu geri ekleme.** JS→C kur/kaldır çağrısı dışında fare subclass'ında JS kullanılmaz.
- DLL süreç ömrü boyunca yüklü kalır. Loader SHA-256 ve ABI 1'i kontrol eder.
- Zig **0.15.2** ve arşiv SHA-256'sı `native/toolchain.json` içinde sabittir. Native kaynak Git'tedir; üretilmiş DLL/build.json, LIB ve PDB Git dışında kalır. Portable pakete yalnızca gerekli DLL/build.json girer.
- Electron'un Common Controls v6 bağlamı gerekir; DLL yükleme/ABI testini düz konsol Node'unda değil Electron'da yap.

Kullanıcı son C DLL sürümünde Alt ile başlıktan taşıma ve köşeden boyutlandırmanın çalıştığını, kapanmadığını doğruladı. Bu kısa canlı kontrol uzun süreli kararlılık garantisi değildir.

### Süreç işareti, tanılama ve tam kapatma

- Çökmeden kalan `host.json` yalnızca süreç gerçekten yoksa temizlenir. Yetki hatası “ölü süreç” sayılmaz; eski PID'ye dayanarak başka süreç kapatılmaz.
- `settings/overlay-4317/diagnostics.ndjson` başlangıç/kapanış, renderer/child hataları, temiz kapanmamış oturum ve taşıma/boyutlandırma olaylarını tutar; 256 KiB + önceki dosya ile sınırlıdır. Paket/oyun içeriği yazılmaz.
- Yerel çökme bir `try/catch` ile gizlenmez. İşlenmemiş hata tanısı varsayılan ölüm davranışını değiştirmez.
- **Tamamen kapat** sunucu kapanışını doğrular. Kapanış sırasında bağlantı sıfırlanması hemen başarı sayılmaz; özgün zaman sınırı içinde yeniden kontrol edilir.

### Parti hasarının görünmemesi

NF, Bzazel, Wazeeralheal ve Hardstyle kayıtlarında hasar vardı, parti filtresi üyeleri tanımadığı için gizliyordu. Parti/force HP mesajlarından doğrulama, görünme bilgilerinde sunucunun korunması, geç üyelik doğrulamasında hasar/iyileştirmenin toparlanması ve savaş içinde üyelik korunması eklendi. Genel HP mesajlarını parti üyesi kabul ederek çözmeye çalışma.

### Savaş dışında gizleme ve eski savaş durumunda takılma

Otomatik gizlemeye kalıcı kapatma seçeneği ve kontrol kutusunda geçici gösterme eklendi. Eski savaş dışı bayrağı yeni doğrudan kendi vuruşunu gizliyorsa **3 sn** görünürlük kanıtı kullanılır; sonradan gelen savaş çıkışı hemen öncelik alır. DoT, pet veya yabancı vuruşları bu süreyi uzatmaz. Bu çözüm yalnızca görünürlüğü değiştirir, karşılaşma hesabını değiştirmez.

Backend yenilenmesinden sonra kimliğin gelmemesi ayrı sorundur; teleport geçici çözümdür ve kalıcı kimlik önbelleği hâlâ ertelenmiştir.

## Doğrulama ve kalan belirsizlikler

17.10.2026 itibarıyla:

- **141 otomatik test geçti.** Protokol, TCP, DPS/karşılaşma, parti, iyileştirme, cube ve overlay mantığı kapsanır.
- Yerel C yoğunluk testi: 20.050 senkron + 4.000 kuyruk mesajı, 1.050 taşıma, 50 pencere kapatma, 30 GC, 24 gerçek kenar/köşe kontrolü; temiz çıkış.
- Ayrı Electron smoke oturumunda odak bayrakları, native tıklama, boyutlandırma, DPI, küçültme, saklama, kontrol kutusu, DPS/HPS, otomatik/manuel gizleme ve cube alarmı geçti. Oyun penceresine test girdisi gönderilmedi.
- Gerçek Npcap loopback → sentetik hasar testi **13.000/13.000** eşleşti.
- Yerel önceden ayrıştırılmış gerçek kayıtlarda seçilen **10/10** savaşın toplam/oyuncu hasarı ve süresi eşleşti. Altı tam günlükte **27/27** karşılaşma sınırı, hasar ve bitiş nedeni eşleşti.
- Kullanıcı canlı cube alarmının doğru adayla eşleştiğini ve sesin çaldığını gördü. Bu, bütün cube türleri/mesafeleri için doğrulama değildir.
- Kullanıcı son sürümde Alt+Tab, düğmeler, taşıma/boyutlandırma, savaşta açılma/savaş dışında gizlenme ve yeni cube kontrollerini denedi.

Önceden ayrıştırılmış kayıt karşılaştırmasını ham paket/live DPS kesinliği olarak sunma. Kontrollü canlı Questlog DPS/HPS karşılaştırması ve uzun süreli son native sürüm testi ayrıca gerekir. IPv6/IP fragman birleştirme, dolu party scan-list varyantı, güvenilir yakınlık sesi, rDPS/buff katkısı ve tüm NPC isimleri mevcut kapsamda değildir.

Yeni class genel hasarını gösterebilir; katalogda bulunmayan skill için sayı/genel ikon kullanılır. İkon eksikliği genel hasarı hesaplamayı engellemez. Skill ikonları yerel önbellektir, Git'te değildir; `update:skills` ile indirilir.

## Geliştirme / test komutları

```powershell
pnpm test
node scripts/overlay-smoke.mjs
node scripts/overlay-native-stress.mjs
pnpm run validate:npcap
pnpm run validate:recordings
pnpm run validate:encounters
git diff --check
```

Kayıt doğrulaması kişisel yerel kaynak kayıtları gerektirir. UI testleri için ayrı port/profil kullan; çalışan canlı sunucuyu demo/replay moduna geçirme. Overlay smoke ve native stress kendi pencereleriyle çalışır. Playwright gereken testlerde `PLAYWRIGHT_PATH` verilebilir; ayrıntılar README'dedir.

## Paketleme, Git ve mahremiyet

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/package-portable.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/validate-portable.ps1 -Zip dist/<paket-adi>.zip
```

Portable ZIP Node, Electron, Koffi x64, uygulama, ikonlar ve native DLL'i içerir. Arkadaş yalnızca Npcap kurup ZIP'i tamamen çıkararak `Baslat.cmd` çalıştırır. Derleyici gerekmez. Kaynak kodun GitHub'a gönderilmesi daha önce üretilmiş ZIP'i güncellemez; dağıtmadan önce yeni paket üret ve doğrula.

`captures/`, `settings/`, `tmp/`, `dist/`, `runtime/`, `node_modules/`, `.env*`, günlükler, `.pcap*`, `.ndjson` ve `research/private/` depoya girmez. Questlog'dan alınan özel kaynak kopyalarını yayımlama veya çalışma zamanı bağımlılığı yapma. Kişisel kayıtlar anonim sayılmaz; araştırma kayıtlarında bilinmeyen oyun alanları bulunabilir. Public skill/boss kataloglarında kaynak bilgileri korunur.

Göndermeden önce staged dosyaları ve kimliği kontrol et; yalnızca proje kaynakları/testler/belgeler olmalı. Kullanıcı açıkça istediğinde commit/push yap; başka iş için backend veya oyunu kapatma. Yeni hata düzeltmesinde ilgili testi çalıştır, zaten geçmiş ilgisiz geniş testleri gerekçesiz tekrar etme.
