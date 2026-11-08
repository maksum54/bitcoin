# BTC Nyicil

PWA untuk persiapan nyicil (DCA) Bitcoin: pantau harga, rencanakan cicilan, catat portofolio, cek blockchain, dan ikuti berita whale & institusi. Bisa di-install di HP (Android/iPhone) dan laptop, tetap bisa dibuka saat offline.

> Bukan saran investasi. Aplikasi ini **tidak** menyimpan private key / seed phrase dan tidak bisa mengirim BTC — semuanya watch-only.

## Fitur

| Tab | Isi |
| --- | --- |
| **Pasar** | Harga BTC (IDR/USD), grafik 24 jam–1 tahun, konverter BTC ↔ IDR ↔ sats, alarm harga |
| **Nyicil** | Rencana cicilan bulanan (default mulai Januari tahun depan), proyeksi 3 skenario, jadwal yang otomatis tercentang, simulasi DCA dengan data historis sejak 2011 |
| **Portofolio** | Catat beli/jual, harga rata-rata, untung/rugi (metode average cost), backup/restore JSON |
| **Explorer** | Cari alamat / txid / blok, biaya jaringan, mempool, hashrate, hitung mundur halving, daftar alamat yang dipantau |
| **Berita** | Berita Institusi & ETF / Whale / Pasar dengan label **beli/inflow** dan **jual/outflow**, plus transaksi besar on-chain (≥ 50–1.000 BTC) dengan label masuk/keluar exchange |

Bahasa Indonesia/English dan tema gelap/terang bisa diganti dari header.

## Sumber data (gratis, tanpa API key)

- Harga & grafik: CoinGecko
- Data historis panjang: blockchain.com charts
- Blockchain: mempool.space
- Berita: RSS CoinDesk, Cointelegraph, Bitcoin Magazine, Decrypt, Google News (diambil lewat `/api/news`)
- Whale: blok terakhir + mempool dari blockchain.com (diambil lewat `/api/whales`)

Label beli/jual berita dibuat otomatis dari kata kunci judul, jadi bisa keliru. Label wallet exchange hanya untuk beberapa alamat publik yang terkenal.

## Menjalankan di komputer

Butuh Node.js 20 atau lebih baru.

```bash
npm install
```

```bash
npm run dev
```

Buka http://localhost:5173. Endpoint `/api/news` dan `/api/whales` ikut jalan di mode dev.

Test & build:

```bash
npm test
```

```bash
npm run build
```

## Deploy ke Vercel

1. Buka https://vercel.com/new dan import repo `maksum54/bitcoin`.
2. Framework otomatis terdeteksi sebagai **Vite**. Tidak perlu environment variable.
3. Klik **Deploy**. Folder `api/` otomatis jadi serverless function.

Setelah itu buka URL-nya di HP → muncul tombol **Pasang** (Android/Chrome) atau tekan **Bagikan → Tambah ke Layar Utama** (iPhone).

## Penyimpanan data

Semua data (transaksi, rencana, alarm, alamat dipantau) tersimpan di `localStorage` perangkat. Belum ada sinkronisasi cloud, jadi gunakan **Portofolio → Cadangkan (JSON)** secara rutin, dan **Pulihkan dari file** untuk memindahkan data ke perangkat lain.

## Batasan saat ini

- Alarm harga hanya dicek saat aplikasi terbuka. Notifikasi ketika aplikasi ditutup butuh server Web Push (VAPID) + database langganan.
- Data aliran dana ETF harian (angka resmi per fund) belum ada; yang ada adalah berita yang dilabeli inflow/outflow.
- Simulasi DCA memakai harga USD historis dikali kurs USD/IDR hari ini (perkiraan).

## Struktur

```
api/            Vercel functions (news, whales)
server/         logika server: parsing RSS, klasifikasi, deteksi whale
src/lib/        API client, perhitungan, i18n, penyimpanan
src/pages/      Market, Plan, Portfolio, Explorer, News
src/components/ UI bersama, install prompt, banner offline/update
scripts/        generator ikon PWA
```
