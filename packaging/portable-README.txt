KAMI DPS METER - WINDOWS x64 TASINABILIR PAKET

1. Npcap'i resmi sitesinden indirip kur:
   https://npcap.com/#download
   Bilgisayarinda zaten Npcap varsa yeniden kurman gerekmez.

2. ZIP'e sag tikla > Tumunu ayikla. Baslat.cmd'yi ZIP'in icinden calistirma.
   Klasoru Masaustu veya Belgeler gibi yazilabilir bir yere koy.
   Baslat.cmd, runtime, node_modules ve diger klasorleri birlikte tut.

3. Baslat.cmd'ye cift tikla. DPS ve kup overlay pencereleri acilir.
   Pencereler yalnizca Aion 2 ondeyken gorunur; masaustunde gizlenir.
   Oyun yonetici olarak calisiyorsa overlay icin Windows izin ister.
   Oyun acildiktan sonra etkilesim calismiyorsa Baslat.cmd'yi tekrar ac.
   Alt tusunu basili tutarken ust cubuklarindan surukleyebilirsin.
   Alt'i birakinca fare tiklamalari oyuna gecer.
   DPS'nin sag ustundeki eksi dugmesi sadece ust cubugu birakir;
   arti dugmesiyle tekrar genisletirsin. Konum ve kucultme hali saklanir.
   Pencereli veya kenarliksiz tam ekran oyun modunu kullan.
   Ayrintili tarayici ekrani icin Tarayici.cmd: http://127.0.0.1:4317/
   Aion 2 bu bilgisayarda calisiyor olmali. Oyun acikken bolgeye gir
   veya teleport yap; karakter ve parti bilgileri yeniden alinir.

4. Kup overlay'inde Alt basiliyken "Sesi ac ve dene" dugmesine bas.
   Algilanan cube mevcut kaldigi surece ses 3 saniyede bir tekrarlanir.
   Cube kaybolunca tekrar durur. Overlay'i kapatirsan sesi yeniden ac.
   Tarayicida sesi de acarsan iki yerden duyulur; ses icin tek arayuz kullan.
   Mesafeye gore ses degisimi kapali.

5. Tamamen kapatmak icin Kapat.cmd'ye cift tikla.
   Sistem tepsisindeki Kami simgesinden yalnizca overlay'i gizleyebilir,
   konumlari sifirlayabilir veya overlay'i kapatabilirsin.
   "Masaustunde duzenle" secilirse Alt gerekmeden yerlestirebilirsin;
   secimi kaldirinca yeniden yalnizca oyun uzerinde gorunur.
   Guncelleme sonrasi sadece overlay'i yenilemek icin Overlay-Yenile.cmd
   dosyasina sag tik > Yonetici olarak calistir. Kayit kesilmez.

Node.js, npm, pnpm, Git, Codex veya Questlog kurmana gerek yok.
Node.js, overlay runtime'i ve yerel modul pakete dahildir. Skill ikonlari hazirdir.
Npcap surucusu ayri kurulur; kurulum dosyasi bu ZIP'te bulunmaz.

Notlar:
- Bu paket Windows 10/11 x64 icindir.
- Npcap sadece yoneticilere izin verecek sekilde kurulduysa Baslat.cmd'yi
  sag tik > Yonetici olarak calistir ile acman gerekebilir.
- Olceri cube'a yaklasmadan once ac. Daha once gelmis gorunme bildirimini
  geriye donuk alamaz. "Aramayi baslat" test kaydi icindir; normal alarm
  icin kayit acmak gerekmez.
- Bu bir prototiptir. Algilama her cube turu icin dogrulanmis degildir.
- Normal kullanimda ham paket kaydi tutulmaz. Istege bagli test kayitlari
  bu paketin captures klasorune, baslatma gunlukleri tmp klasorune yazilir.
  Overlay yerlesimi ve tarayici onbellegi settings klasorundedir.
- Paketi daha sonra baska birine aktarirsan kendi captures ve tmp
  ve settings klasorlerini paylasma. Ilk gonderilen temiz ZIP'i kullanabilirsin.
- Bir sorun olursa tmp/server-error.log dosyasini incele.

Bilesen ve lisans bilgileri THIRD-PARTY-NOTICES.txt dosyasindadir.
