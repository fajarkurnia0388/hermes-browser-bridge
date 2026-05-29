# Hermes Browser Bridge — Panduan untuk AI Agent

> Dokumen ini adalah referensi untuk AI Agent agar mengerti cara menggunakan
> Browser Bridge untuk mengontrol browser Chrome yang sudah terbuka.

---

## Koneksi

### WebSocket
```
ws://127.0.0.1:8787
```

### stdio (MCP)
```bash
node /home/void/lab/experiments/bridge_browser/hermes-browser-bridge/bridge/index.js
```

---

## Protokol: JSON-RPC 2.0

### Request
```json
{"jsonrpc":"2.0","id":"unique-id","method":"nama_tool","params":{}}
```

### Response sukses
```json
{"jsonrpc":"2.0","id":"unique-id","result":{...,"duration_ms":342}}
```

### Response error
```json
{"jsonrpc":"2.0","id":"unique-id","error":{"code":-32001,"message":"Deskripsi error"}}
```

---

## Tools

### `browser_snapshot`
Ambil accessibility tree + screenshot. **Tool utama untuk "melihat" halaman.**

```json
{"jsonrpc":"2.0","id":"1","method":"browser_snapshot","params":{}}
```

Response:
```json
{
  "result": {
    "page_url": "https://mail.google.com/mail/u/0/#inbox",
    "page_title": "Inbox - Gmail",
    "snapshot": "[e1] heading \"Gmail\"\n  [e2] textbox \"Search mail\"\n  [e3] button \"Compose\"\n  [e4] link \"Inbox (3)\"",
    "screenshot_b64": "data:image/webp;base64,...",
    "duration_ms": 850
  }
}
```

Setiap elemen interaktif memiliki **ref** unik (`e1`, `e2`, `e3`).
Gunakan ref ini untuk `browser_click`, `browser_type`, dll.

---

### `browser_click`
Klik elemen berdasarkan ref.

| Parameter | Tipe | Wajib | Contoh |
|-----------|------|:-----:|--------|
| `ref` | string | ✅ | `"e3"` |

```json
{"jsonrpc":"2.0","id":"2","method":"browser_click","params":{"ref":"e3"}}
```

---

### `browser_type`
Ketik teks ke input/textarea. Menghapus isi lama, lalu mengetik teks baru.

| Parameter | Tipe | Wajib | Contoh |
|-----------|------|:-----:|--------|
| `ref` | string | ✅ | `"e2"` |
| `text` | string | ✅ | `"hello world"` |

```json
{"jsonrpc":"2.0","id":"3","method":"browser_type","params":{"ref":"e2","text":"meeting agenda"}}
```

---

### `browser_press_key`
Tekan key keyboard. Bisa dengan modifier (Ctrl, Shift, Alt, Meta).

| Parameter | Tipe | Wajib | Contoh |
|-----------|------|:-----:|--------|
| `key` | string | ✅ | `"Enter"`, `"Tab"`, `"a"` |
| `modifiers` | string[] | ❌ | `["ctrl","shift"]` |

**Keys yang tersedia:**
`Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Space`,
`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`,
`Home`, `End`, `PageUp`, `PageDown`, `F1`-`F12`,
atau **karakter tunggal** apa saja (`a`, `1`, `/`, dll.)

**Contoh:**
```json
{"jsonrpc":"2.0","id":"4","method":"browser_press_key","params":{"key":"Enter"}}
```
```json
{"jsonrpc":"2.0","id":"5","method":"browser_press_key","params":{"key":"a","modifiers":["ctrl"]}}
```
```json
{"jsonrpc":"2.0","id":"6","method":"browser_press_key","params":{"key":"Tab","modifiers":["shift"]}}
```

---

### `browser_find_element`
Cari elemen di snapshot terakhir berdasarkan teks atau role. **Tidak mengambil snapshot baru — lebih cepat.**

| Parameter | Tipe | Wajib | Contoh |
|-----------|------|:-----:|--------|
| `text` | string | ❌ | `"Submit"` |
| `role` | string | ❌ | `"button"` |

Minimal salah satu harus diisi. Mendukung partial match dan case-insensitive.

```json
{"jsonrpc":"2.0","id":"7","method":"browser_find_element","params":{"text":"send","role":"button"}}
```

Response:
```json
{
  "result": {
    "count": 1,
    "matches": [
      {"ref": "e15", "role": "button", "name": "Send message"}
    ],
    "duration_ms": 2
  }
}
```

---

### `browser_navigate`
Navigasi ke URL. Otomatis mengembalikan snapshot setelah halaman dimuat.

| Parameter | Tipe | Wajib |
|-----------|------|:-----:|
| `url` | string | ✅ |

```json
{"jsonrpc":"2.0","id":"8","method":"browser_navigate","params":{"url":"https://google.com"}}
```

---

### `browser_screenshot`
Ambil screenshot saja, tanpa accessibility tree. Lebih ringan dari snapshot.

```json
{"jsonrpc":"2.0","id":"9","method":"browser_screenshot","params":{}}
```

---

### `browser_scroll`
Scroll halaman.

| Parameter | Tipe | Default | Contoh |
|-----------|------|---------|--------|
| `direction` | `"up"` \| `"down"` | `"down"` | `"down"` |
| `amount` | number (pixel) | `400` | `600` |

```json
{"jsonrpc":"2.0","id":"10","method":"browser_scroll","params":{"direction":"down","amount":600}}
```

---

### `browser_wait`
Tunggu halaman selesai dimuat.

| Parameter | Tipe | Default |
|-----------|------|---------|
| `timeout_ms` | number | `5000` |

```json
{"jsonrpc":"2.0","id":"11","method":"browser_wait","params":{"timeout_ms":10000}}
```

---

### `browser_tabs`
Daftar semua tab terbuka.

```json
{"jsonrpc":"2.0","id":"12","method":"browser_tabs","params":{}}
```

Response:
```json
{
  "result": {
    "tabs": [
      {"tabId": 123, "title": "Gmail", "url": "https://mail.google.com/...", "active": true},
      {"tabId": 456, "title": "Google", "url": "https://google.com", "active": false}
    ]
  }
}
```

---

### `browser_switch_tab`
Pindah ke tab lain. Otomatis mengembalikan snapshot.

| Parameter | Tipe | Wajib |
|-----------|------|:-----:|
| `tabId` | number | ✅ |

```json
{"jsonrpc":"2.0","id":"13","method":"browser_switch_tab","params":{"tabId":456}}
```

---

### `browser_execute_script`
Jalankan custom JavaScript di context halaman aktif. Sangat berguna untuk manipulasi DOM tingkat lanjut, trigger custom events, atau bypass proteksi.

| Parameter | Tipe | Wajib | Contoh |
|-----------|------|:-----:|--------|
| `script` | string | ✅ | `"document.querySelector('#my-btn').click()"` |

```json
{"jsonrpc":"2.0","id":"14","method":"browser_execute_script","params":{"script":"document.title"}}
```

---

### `browser_wait_for_selector`
Tunggu sampai elemen yang dicocokkan dengan CSS Selector muncul di halaman. Sangat andal untuk menangani Single Page Application (SPA) yang dinamis.

| Parameter | Tipe | Wajib | Default | Contoh |
|-----------|------|:-----:|---------|--------|
| `selector` | string | ✅ | | `"div.chat-reply"` |
| `timeout_ms` | number | ❌ | `10000` | `15000` |

```json
{"jsonrpc":"2.0","id":"15","method":"browser_wait_for_selector","params":{"selector":"button[disabled=false]","timeout_ms":5000}}
```

---

### `browser_open_new_tab`
Buka tab baru yang aktif dengan URL tertentu, dan otomatis mengembalikan snapshot halaman yang baru dibuka setelah selesai dimuat.

| Parameter | Tipe | Wajib | Contoh |
|-----------|------|:-----:|--------|
| `url` | string | ✅ | `"https://google.com"` |

```json
{"jsonrpc":"2.0","id":"16","method":"browser_open_new_tab","params":{"url":"https://github.com"}}
```

---

### `browser_snapshot_sidepanel`
Ambil accessibility tree dari panel samping (sidepanel) ekstensi Hermes Bridge (termasuk kontrol panel dan integrasi Leo AI).

```json
{"jsonrpc":"2.0","id":"17","method":"browser_snapshot_sidepanel","params":{}}
```

Response:
```json
{
  "result": {
    "page_url": "chrome-extension://sidepanel",
    "page_title": "Hermes Bridge Sidepanel",
    "snapshot": "[se1] button \"Bersihkan Log\"\n[se2] checkbox \"Native Messaging Host\" [checked, disabled]",
    "source": "sidepanel"
  }
}
```

Setiap elemen interaktif di dalam sidepanel memiliki ref unik dengan prefiks `se` (misal `se1`, `se2`). Gunakan ref ini khusus untuk aksi `browser_sidepanel_*`.

---

### `browser_sidepanel_click`
Klik elemen di dalam panel samping (sidepanel) berdasarkan ref ID sidepanel (`se*`).

| Parameter | Tipe | Wajib | Contoh |
|-----------|------|:-----:|--------|
| `ref` | string | ✅ | `"se1"` |

```json
{"jsonrpc":"2.0","id":"18","method":"browser_sidepanel_click","params":{"ref":"se1"}}
```

---

### `browser_sidepanel_type`
Ketik teks ke elemen input/textarea di dalam panel samping (sidepanel) berdasarkan ref ID sidepanel (`se*`).

| Parameter | Tipe | Wajib | Contoh |
|-----------|------|:-----:|--------|
| `ref` | string | ✅ | `"se3"` |
| `text` | string | ✅ | `"hello sidepanel"` |

```json
{"jsonrpc":"2.0","id":"19","method":"browser_sidepanel_type","params":{"ref":"se3","text":"Clear all logs"}}
```

---

## Pola Kerja

### Aturan Utama
1. **SELALU mulai dengan `browser_snapshot`** sebelum aksi apapun.
2. **Ref bersifat sementara** — ref berubah setiap snapshot baru.
3. **Setelah aksi yang mengubah halaman**, snapshot lagi untuk melihat state baru.
4. **Jangan menebak ref** — selalu baca dari snapshot terbaru.
5. **Gunakan `browser_find_element`** untuk mencari elemen tanpa snapshot ulang.
6. **Gunakan `browser_press_key`** untuk Enter, Tab, Escape, shortcut.

### Alur Standar

```
1. browser_snapshot           → Lihat halaman, baca ref
2. browser_click/type/press   → Aksi pada ref yang dipilih
3. browser_snapshot           → Verifikasi hasil
4. Ulangi
```

### Contoh: Kirim Pesan di ChatGPT

```
Langkah 1: Lihat halaman
→ browser_snapshot
← [e8] textbox "Chat with ChatGPT"  [e12] button "Send"

Langkah 2: Klik textbox
→ browser_click {"ref": "e8"}

Langkah 3: Ketik pesan
→ browser_type {"ref": "e8", "text": "Jelaskan quantum computing"}

Langkah 4: Tekan Enter (atau klik Send)
→ browser_press_key {"key": "Enter"}

Langkah 5: Tunggu & verifikasi
→ browser_wait {"timeout_ms": 5000}
→ browser_snapshot
← Lihat response dari ChatGPT
```

### Contoh: Ctrl+A lalu Delete (hapus semua teks)

```
→ browser_press_key {"key": "a", "modifiers": ["ctrl"]}
→ browser_press_key {"key": "Delete"}
```

### Contoh: Cari Tombol tanpa Snapshot Ulang

```
→ browser_find_element {"text": "submit", "role": "button"}
← {"matches": [{"ref": "e15", "role": "button", "name": "Submit Form"}]}
→ browser_click {"ref": "e15"}
```

---

## Membaca Snapshot

Format setiap baris:
```
  [ref] role "nama" value="nilai" [state1, state2]
```

| Bagian | Penjelasan | Contoh |
|--------|-----------|--------|
| `[ref]` | ID unik untuk aksi | `[e5]` |
| `role` | Jenis elemen | `button`, `link`, `textbox` |
| `"nama"` | Label/teks elemen | `"Compose"` |
| `value="..."` | Nilai input saat ini | `value="hello"` |
| `[state]` | Status elemen | `[disabled]`, `[checked]` |

### Role umum

| Role | Bisa diklik? | Bisa diketik? |
|------|:---:|:---:|
| `button` | ✅ | ❌ |
| `link` | ✅ | ❌ |
| `textbox` | ✅ | ✅ |
| `searchbox` | ✅ | ✅ |
| `combobox` | ✅ | ✅ |
| `checkbox` | ✅ | ❌ |
| `radio` | ✅ | ❌ |
| `tab` | ✅ | ❌ |
| `menuitem` | ✅ | ❌ |
| `heading` | ❌ | ❌ |

---

## Error Codes

| Code | Arti | Solusi |
|------|------|--------|
| `-32001` | Ref tidak ditemukan / aksi gagal | Ambil snapshot baru, coba lagi |
| `-32002` | Timeout — extension tidak merespons | Cek koneksi extension |
| `-32003` | Extension belum terhubung | Pastikan Chrome terbuka + extension loaded |
| `-32006` | Tidak ada tab aktif | Buka tab di browser |
| `-32007` | Screenshot gagal | Halaman chrome:// tidak bisa di-screenshot |
| `-32600` | Parameter tidak valid | Cek parameter yang dikirim |
| `-32601` | Method tidak dikenali | Cek nama method |

---

## Penanganan Asisten Bawaan Peramban (Brave Leo, dll.)

> [!IMPORTANT]
> **Kebijakan Sandbox Browser & Batasan Keamanan:**
> Ekstensi Chrome/Brave secara ketat diisolasi (sandbox) dan **tidak memiliki izin** untuk mengakses UI asli peramban (*native browser UI shell*). Hal ini mencakup address bar, menu setelan utama, dan panel samping bawaan peramban (seperti *Brave Sidebar* yang menampung Brave Leo, Brave Wallet, Bookmarks, dll.).
> 
> Perintah `browser_snapshot_sidepanel()` hanya dapat mengakses halaman sidepanel milik ekstensi itu sendiri (`sidepanel.html`), dan **tidak akan mendeteksi** Brave Leo bawaan peramban.

### Solusi Terbaik & Rekomendasi Alur Kerja:
Jika Anda perlu berinteraksi dengan asisten bawaan seperti Leo AI, gunakan antarmuka berbasis web publik di tab browser utama alih-alih mencoba mengakses panel samping bawaan:

1. **Gunakan Brave Search Chat (Rekomendasi Utama):**
   * Buka browser tab baru ke Brave Search:
     ```json
     {"jsonrpc":"2.0","id":"101","method":"browser_open_new_tab","params":{"url":"https://search.brave.com"}}
     ```
   * Kirim kueri pencarian, lalu gunakan `browser_snapshot` biasa untuk mendeteksi area chat Leo AI yang terintegrasi di sisi kanan halaman web.
   * Lakukan interaksi penuh (klik textbox, ketik kueri, baca hasil chat) langsung dari DOM halaman tersebut menggunakan `browser_click` dan `browser_type` biasa.

2. **Gunakan Platform Chat AI Berbasis Web Publik Lainnya:**
   * Jika tidak terbatas pada Brave Leo, gunakan situs chat AI publik (misal ChatGPT, Claude, Gemini, dll.) yang dibuka di tab utama.
   * Alur ini didukung 100% oleh protokol Chrome DevTools (CDP) di tab aktif, menjamin deteksi elemen yang akurat dan stabil.

---

## Tips

1. **Snapshot murah** — ambil sering-sering, jangan ragu.
2. **`browser_find_element` lebih cepat** dari snapshot untuk mencari elemen spesifik.
3. **Gunakan `browser_press_key Enter`** setelah mengetik di search box.
4. **Scroll jika elemen tidak terlihat** — `browser_scroll` lalu snapshot lagi.
5. **Indentasi menunjukkan hierarki** — elemen indent adalah anak elemen di atasnya.
6. **`duration_ms`** ada di setiap response — gunakan untuk monitor performa.
7. **Jika ref error**, selalu ambil snapshot baru sebelum retry.
