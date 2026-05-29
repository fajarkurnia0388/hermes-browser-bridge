# Hermes Browser Bridge

Jembatan antara AI Agent (LLM) dan browser Chrome yang sudah terbuka & login.
Agent bisa membaca halaman, klik, ketik, navigasi — tanpa membuka browser baru.

## Arsitektur

```
AI Agent (Claude/GPT/Hermes)
    ↕  stdio (MCP) atau WebSocket
Bridge Server (Node.js, ws://127.0.0.1:8787)
    ↕  WebSocket
Chrome Extension (Manifest V3)
    ↕  CDP (chrome.debugger) + chrome.scripting
Tab Aktif (sesi login terjaga)
```

## Cara Kerja Singkat

1. Agent mengirim perintah JSON-RPC → Bridge menerima dan meneruskan ke Extension
2. Extension mengambil **Accessibility Tree** halaman via Chrome DevTools Protocol
3. Setiap elemen interaktif diberi **ref ID** (e.g. `e1`, `e2`, `e3`)
4. Agent membaca snapshot, memilih ref, dan mengirim aksi (`browser_click`, `browser_type`)
5. Extension mengeksekusi aksi via CDP `DOM.resolveNode` → hasilnya + screenshot dikirim balik

## Prasyarat

- **Node.js** v18+
- **Google Chrome** (atau Chromium/Edge) versi 116+

## Instalasi

### 1. Bridge Server

```bash
cd bridge/
npm install
```

### 2. Chrome Extension

1. Buka `chrome://extensions/`
2. Aktifkan **Developer Mode** (toggle kanan atas)
3. Klik **Load unpacked**
4. Pilih folder `extension/`
5. Catat Extension ID yang muncul (untuk referensi)

### 3. Jalankan Bridge

```bash
cd bridge/
node index.js
```

Anda akan melihat:
```
[Bridge] ═══════════════════════════════════════
[Bridge] Hermes Browser Bridge v0.3.1
[Bridge] WebSocket: ws://127.0.0.1:8787
[Bridge] Menunggu koneksi Extension dan Agent...
[Bridge] ═══════════════════════════════════════
```

Extension akan otomatis terhubung dalam beberapa detik. Buka Side Panel ekstensi untuk melihat status koneksi.

## Penggunaan

### Via WebSocket (Agent kustom)

Hubungkan WebSocket client ke `ws://127.0.0.1:8787` dan kirim JSON-RPC:

```json
{"jsonrpc":"2.0","id":"1","method":"browser_snapshot","params":{}}
```

Response berisi accessibility tree:
```
[e1] heading "Gmail - Inbox"
  [e2] button "Compose"
  [e3] link "Inbox (3)"
  [e4] textbox "Search mail"
```

Lalu klik elemen:
```json
{"jsonrpc":"2.0","id":"2","method":"browser_click","params":{"ref":"e2"}}
```

### Via MCP/stdio (Claude Desktop, Cursor, VS Code)

Tambahkan ke konfigurasi MCP client Anda:

```json
{
  "mcpServers": {
    "hermes-bridge": {
      "command": "node",
      "args": ["/path/ke/bridge/index.js"]
    }
  }
}
```

## Daftar Tools

| Tool | Deskripsi | Parameter |
|------|-----------|-----------|
| `browser_snapshot` | Ambil accessibility tree + screenshot | — |
| `browser_click` | Klik elemen | `ref` (wajib) |
| `browser_type` | Ketik teks di input | `ref`, `text` (wajib) |
| `browser_navigate` | Buka URL + auto snapshot | `url` (wajib) |
| `browser_screenshot` | Ambil screenshot saja | — |
| `browser_scroll` | Scroll halaman | `direction`, `amount` |
| `browser_wait` | Tunggu halaman selesai load | `timeout_ms` |
| `browser_tabs` | List semua tab terbuka | — |
| `browser_switch_tab` | Pindah tab | `tabId` (wajib) |

---

## WSL + Windows: Apakah Bisa?

**Ya, bisa.** Arsitektur ini memang dirancang untuk skenario tersebut.

### Cara Kerjanya

```
┌─── WSL2 (Linux) ──────────────────────┐
│                                        │
│  AI Agent → node bridge/index.js       │
│             (ws://127.0.0.1:8787)      │
│                                        │
└────────────────┬───────────────────────┘
                 │ localhost forwarding
┌────────────────┴───────────────────────┐
│                                        │
│  ┌─── Windows ──────────────────────┐  │
│  │                                  │  │
│  │  Chrome Extension                │  │
│  │  → WebSocket ke ws://localhost:  │  │
│  │    8787                          │  │
│  │  → Mengontrol tab browser       │  │
│  │                                  │  │
│  └──────────────────────────────────┘  │
│                                        │
└────────────────────────────────────────┘
```

### Langkah Setup WSL

1. **Pastikan WSL2 terbaru** (Windows 11 atau Windows 10 build 19041+)

2. **Aktifkan mirrored networking** (opsional, untuk koneksi paling stabil).
   Buat/edit file `%USERPROFILE%\.wslconfig`:
   ```ini
   [wsl2]
   networkingMode=mirrored
   ```
   Lalu restart WSL: `wsl --shutdown` dari PowerShell.

3. **Jalankan bridge di WSL:**
   ```bash
   cd /path/ke/bridge/
   node index.js
   ```

4. **Buka Chrome di Windows**, pastikan extension sudah di-load.
   Extension akan otomatis terhubung ke `ws://localhost:8787`.

### Catatan Penting WSL

| Aspek | Detail |
|-------|--------|
| **WSL1** | Localhost langsung shared dengan Windows. Pasti bekerja. |
| **WSL2 (default NAT)** | Windows otomatis forward `localhost` ke WSL2 sejak build 18945+. Biasanya bekerja, tapi jika tidak, gunakan `networkingMode=mirrored`. |
| **WSL2 (mirrored)** | Paling stabil. WSL dan Windows berbagi network stack yang sama. |
| **Firewall** | Jika tidak bisa terhubung, pastikan port 8787 tidak diblokir oleh Windows Firewall. |

### Alternatif: Jalankan Bridge di Windows Juga

Jika localhost forwarding bermasalah, Anda juga bisa menjalankan bridge di sisi Windows dan hanya menghubungkan agent dari WSL via WebSocket:

```powershell
# Di Windows PowerShell
cd C:\path\ke\bridge
node index.js
```

Lalu dari WSL, hubungkan agent ke `ws://localhost:8787` (WSL2 bisa mengakses port Windows).

---

## Keamanan

- Bridge server **hanya** listen di `127.0.0.1` — tidak bisa diakses dari jaringan luar
- Extension menggunakan `chrome.debugger` untuk interaksi yang presisi — attach/detach per operasi (tidak persisten)
- Screenshot hanya dikirim via WebSocket, tidak disimpan ke disk
- Side Panel menampilkan log semua aktivitas agar user bisa mengaudit aksi agent

> **TODO(security):** Untuk produksi, tambahkan token autentikasi pada koneksi WebSocket
> antara Extension dan Bridge. Saat ini keamanan mengandalkan binding localhost saja.

## Troubleshooting

| Masalah | Solusi |
|---------|--------|
| Extension tidak terhubung | Pastikan bridge server sudah berjalan (`node index.js`). Cek Side Panel untuk status. |
| `chrome.debugger` error | Tutup Chrome DevTools di tab target. DevTools dan debugger tidak bisa berjalan bersamaan. |
| Screenshot kosong/null | Halaman `chrome://`, `edge://`, atau halaman extension tidak bisa di-screenshot. Coba di halaman web biasa. |
| WSL2 tidak bisa connect | Coba tambahkan `networkingMode=mirrored` di `.wslconfig` dan restart WSL. |
| Ref tidak ditemukan | Ref bersifat sementara. Selalu jalankan `browser_snapshot` sebelum `browser_click`/`browser_type`. |
