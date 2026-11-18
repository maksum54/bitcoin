# BTC Nyicil

PWA untuk persiapan nyicil (DCA) Bitcoin: pantau harga, rencanakan cicilan, catat portofolio, cek blockchain, dan ikuti berita whale & institusi. Bisa di-install di HP (Android/iPhone) dan laptop, tetap bisa dibuka saat offline.

> Bukan saran investasi. Aplikasi ini **tidak** menyimpan private key / seed phrase dan tidak bisa mengirim BTC — semuanya watch-only.

## Fitur

| Tab | Isi |
| --- | --- |
| **Pasar** | Harga BTC (USD/IDR), grafik 24 jam–1 tahun, konverter BTC ↔ USD ↔ IDR ↔ sats, alarm harga (USD atau IDR) |
| **Terminal** | 8 bagian: **Grafik** (candlestick 1m–1d, indikator EMA/Bollinger/Keltner/VWAP/volume profile/RSI/Stoch RSI/MACD, likuidasi di grafik, gambar posisi long/short) · **DOM & tape** (order book penuh, volume terjadi per harga, Pull/Stack, limit order paper dari DOM) · **Profile & footprint** (TPO harian/mingguan dengan POC, value area, single print, poor high/low; footprint delta, bid×ask, volume) · **Likuidasi & flow** (likuidasi Binance/Bybit/OKX, net taker flow spot & perp per exchange) · **Sinyal** (screener three-drive, RSI, golden/death cross untuk 50–200 koin) · **Jurnal** (posisi diselesaikan oleh harga, P&L, win rate, kurva ekuitas, kalender $/R, per arah & strategi) · **Paper trading** (100.000 USDT, perpetual BTC/ETH/SOL) · **Strategy tester** (aturan dari daftar, fee/slippage/funding/likuidasi, laporan vs buy & hold, Monte Carlo, optimizer in/out-of-sample, uji di market lain). Gestur sentuh (cubit untuk zoom) di HP |
| **Nyicil** | Rencana cicilan bulanan (default mulai Januari tahun depan), proyeksi 3 skenario, jadwal yang otomatis tercentang, simulasi DCA dengan data historis sejak 2011 |
| **Portofolio** | Catat beli/jual, harga rata-rata, untung/rugi (metode average cost), grafik nilai vs modal, backup/restore JSON, ekspor/impor CSV |
| **Explorer** | Cari alamat / txid / blok, biaya jaringan, mempool, hashrate, hitung mundur halving, daftar alamat yang dipantau |
| **Berita** | Berita Institusi & ETF / Whale / Pasar dengan label **beli/inflow** dan **jual/outflow**, plus transaksi besar on-chain (≥ 50–1.000 BTC) dengan label masuk/keluar exchange |

Mata uang **USD (default) / IDR**, bahasa Indonesia/English, dan tema terang (default, putih) / gelap bisa diganti dari header. Mata uang menentukan tampilan harga, rencana nyicil, portofolio, dan alarm baru; tiap transaksi & alarm menyimpan mata uangnya sendiri, dan transaksi dalam mata uang lain dikonversi dengan kurs hari ini.

## Sumber data (gratis, tanpa API key)

- Harga & grafik: CoinGecko
- Data historis panjang: blockchain.com charts
- Terminal: Binance public market data (`data-api.binance.vision`, `data-stream.binance.vision`, `fstream.binance.com`), Bybit (`stream.bybit.com`), OKX (`ws.okx.com`), Coinbase (`ws-feed.exchange.coinbase.com`) — semua publik, tanpa API key. Jurnal, paper trading, footprint dan backtest dihitung & disimpan di browser.
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

Lint, test & build:

```bash
npm run lint
```

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

## Impor CSV

Baris pertama harus header. Kolom wajib: `date` (YYYY-MM-DD), `type` (`buy`/`sell`), `btc`, `price`. Opsional: `fee`, `currency` (`USD`/`IDR`, default USD), `note`. Angka memakai titik sebagai desimal. Transaksi yang sudah ada dilewati, jadi aman mengimpor file yang sama dua kali.

## Pengingat cicilan

Kalau rencana nyicil sudah disimpan dan tanggal beli bulan ini sudah lewat tanpa transaksi beli, muncul banner pengingat (dan satu notifikasi per bulan bila izin notifikasi aktif). Seperti alarm harga, ini hanya berjalan saat aplikasi dibuka.

## Batasan saat ini

- Alarm harga hanya dicek saat aplikasi terbuka. Notifikasi ketika aplikasi ditutup butuh server Web Push (VAPID) + database langganan.
- Data aliran dana ETF harian (angka resmi per fund) belum ada; yang ada adalah berita yang dilabeli inflow/outflow.
- Simulasi DCA memakai harga historis USD; kalau mata uang IDR dipilih, hasilnya dikali kurs USD/IDR hari ini (perkiraan).

## Struktur

```
api/            Vercel functions (news, whales)
server/         logika server: parsing RSS, klasifikasi, deteksi whale
src/lib/        API client, perhitungan, i18n, penyimpanan
src/pages/      Market, Plan, Portfolio, Explorer, News
src/components/ UI bersama, install prompt, banner offline/update
scripts/        generator ikon PWA
```
