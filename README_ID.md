# Hermes Browser Bridge

> **📖 Bahasa Dokumentasi:** [English](README.md) | Bahasa Indonesia

Hermes Browser Bridge menghubungkan AI Agent (LLM) dengan sesi browser Chrome yang sudah terbuka dan login. Agent dapat mengambil snapshot accessibility tree, mengklik, mengetik, menavigasi, dan mengambil screenshot pada tab aktif — tanpa membuka browser baru.

## About

Repository ini menyediakan integrasi **Hermes Agent** dengan browser pengguna. Agent dijalankan melalui sesi browser sehingga memanfaatkan **fingerprint manusia** untuk autentikasi dan interaksi, memungkinkan workflow otomatis yang lebih natural dan sulit dibedakan dari aktivitas manual. Dengan arsitektur berbasis local bridge, Anda mendapatkan kontrol penuh atas browser tanpa eksposur ke jaringan luar.

## Sorotan

- Transport lokal melalui WebSocket (`ws://127.0.0.1:8787`) dan opsi stdio (MCP).
- Chrome Extension (Manifest V3) berperan sebagai executor menggunakan Chrome DevTools Protocol (CDP).
- Dirancang untuk skenario WSL2 (agent di Linux) + Chrome di Windows.

## Arsitektur (ringkas)

AI Agent ⇆ Bridge Server (Node.js) ⇆ Chrome Extension ⇆ Tab Aktif

Bridge bertindak sebagai perantara JSON-RPC/JSON-over-stdio, meneruskan permintaan agent ke extension dan menunggu respons.

## Fitur Utama

- Ambil accessibility tree + screenshot (`browser_snapshot`).
- Interaksi elemen berbasis `ref` (contoh: `browser_click`, `browser_type`).
- Tools tambahan: `browser_find_element`, `browser_press_key`, `browser_execute_script`, `browser_tabs`, dll.
- Keamanan: hanya bind ke `127.0.0.1` (lokal) — tidak mengekspos port ke jaringan.

## Persyaratan

- Node.js v18+
- Google Chrome / Chromium / Edge v116+

## Quickstart

1. Install dependencies dan jalankan Bridge:

```bash
cd bridge/
npm install
npm start
```

2. Load extension di Chrome:

1) Buka `chrome://extensions/`
2) Aktifkan _Developer mode_
3) Klik _Load unpacked_ → pilih folder `extension/`

3. Setelah bridge berjalan, ekstensi akan otomatis mencoba terhubung ke `ws://127.0.0.1:8787`.

## Cara Menggunakan

Contoh JSON-RPC sederhana via WebSocket:

Request snapshot:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "browser_snapshot", "params": {} }
```

Klik elemen berdasarkan `ref`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "browser_click",
  "params": { "ref": "e2" }
}
```

Alternatif: jalankan Bridge sebagai MCP/stdio server untuk integrasi dengan klien seperti Claude Desktop atau Cursor. Contoh konfigurasi ada di dokumentasi MCP client masing-masing.

## Daftar Tools (ringkasan)

- `browser_snapshot`: ambil accessibility tree + screenshot
- `browser_click`: klik elemen berdasarkan `ref`
- `browser_type`: ketik teks ke input berdasarkan `ref`
- `browser_press_key`: kirim keyboard event
- `browser_find_element`: cari elemen di snapshot terakhir
- `browser_navigate`: buka URL dan ambil snapshot
- `browser_screenshot`: ambil screenshot saja
- `browser_scroll`, `browser_wait`, `browser_tabs`, `browser_switch_tab`, `browser_execute_script`, `browser_wait_for_selector`, `browser_open_new_tab`

Untuk definisi schema tiap tool lihat `bridge/index.js` (fungsi `getToolDefinitions`).

## WSL2 (Linux agent) + Chrome di Windows

Arsitektur mendukung agent berjalan di WSL2 dan Chrome di Windows. Bila mengalami masalah koneksi, pertimbangkan opsi `networkingMode=mirrored` di `%USERPROFILE%\.wslconfig` atau jalankan bridge langsung di Windows.

## Keamanan

- Bridge hanya mendengarkan di `127.0.0.1`.
- Extension melakukan attach/detach `chrome.debugger` per operasi.
- Untuk produksi: tambahkan autentikasi token pada koneksi WebSocket.

## Pengembangan

- Entry point server: `bridge/index.js`
- Paket: lihat `bridge/package.json`
- Extension Manifest: `extension/manifest.json`

Jika Anda ingin menambahkan fitur baru pada protokol: tambahkan definisi tool di `getToolDefinitions()` di `bridge/index.js` dan implementasikan handling di sisi extension.

## Contributing

Saran kontribusi:

1. Fork repo dan buat branch fitur.
2. Buka PR dengan deskripsi perubahan dan alasan.
3. Sertakan contoh manual atau skrip kecil untuk verifikasi fitur.

## License

Lisensi projek belum dispesifikasikan dalam repo. Tambahkan file `LICENSE` jika ingin mengatur lisensi publik.

---

Jika Anda mau, saya bisa:

- Menambahkan contoh payload lengkap untuk tiap tool.
- Menambahkan badge status build atau license.
- Menerjemahkan README ini ke Bahasa Inggris.

Silakan beri tahu mana yang ingin Anda tambahkan atau ubah.
