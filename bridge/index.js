/**
 * index.js — Hermes Browser Bridge Server v0.4.0
 *
 * Changelog v0.4.0:
 * - Fix: WebSocket ping/pong heartbeat untuk menjaga koneksi stabil
 * - New: tool definitions untuk browser_press_key dan browser_find_element
 * - Improved: logging lebih informatif
 *
 * TODO(security): Untuk produksi, tambahkan token autentikasi pada
 * koneksi WebSocket. Saat ini hanya mengandalkan binding ke 127.0.0.1.
 */

import { createInterface } from 'node:readline';
import { WebSocketServer, WebSocket } from 'ws';

// ============ KONFIGURASI ============
const PORT = parseInt(process.env.BRIDGE_PORT || '8787', 10);
const PING_INTERVAL_MS = 25000; // Ping setiap 25 detik untuk keep-alive

// ============ STATE ============
let extensionSocket = null;
const pendingRequests = new Map();

// ============ WEBSOCKET SERVER ============
const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

wss.on('connection', (socket) => {
  let clientType = 'unknown';

  // Heartbeat: kirim ping secara periodik untuk menjaga koneksi
  const pingTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.ping();
    } else {
      clearInterval(pingTimer);
    }
  }, PING_INTERVAL_MS);

  // Track alive status via pong
  socket.isAlive = true;
  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ---- Registrasi Extension ----
    if (msg.method === 'register' && msg.params?.type === 'extension') {
      clientType = 'extension';
      extensionSocket = socket;
      console.error('[Bridge] ✓ Chrome Extension terhubung');
      return;
    }

    // ---- Response dari Extension ----
    if (clientType === 'extension' && msg.id != null && !msg.method) {
      const pending = pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        pending.respond(msg);
        pendingRequests.delete(msg.id);
      }
      return;
    }

    // ---- Request dari Agent ----
    if (msg.method) {
      if (clientType === 'unknown') {
        clientType = 'agent';
        console.error('[Bridge] ✓ Agent terhubung via WebSocket');
      }
      handleAgentRequest(msg, (response) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(response));
        }
      });
    }
  });

  socket.on('close', () => {
    clearInterval(pingTimer);
    if (clientType === 'extension') {
      extensionSocket = null;
      console.error('[Bridge] ✗ Extension terputus');
    } else if (clientType === 'agent') {
      console.error('[Bridge] ✗ Agent terputus');
    }
  });

  socket.on('error', (err) => {
    console.error(`[Bridge] WebSocket error (${clientType}): ${err.message}`);
  });
});

// Pembersihan koneksi mati secara periodik
const cleanupTimer = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (!socket.isAlive) {
      console.error('[Bridge] Memutuskan koneksi mati');
      return socket.terminate();
    }
    socket.isAlive = false;
  });
}, PING_INTERVAL_MS * 2);

wss.on('close', () => {
  clearInterval(cleanupTimer);
});

// ============ STDIO / MCP HANDLER ============
const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  handleAgentRequest(msg, (response) => {
    process.stdout.write(JSON.stringify(response) + '\n');
  });
});

// ============ ROUTING ============
function handleAgentRequest(msg, respond) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    respond({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'hermes-browser-bridge', version: '0.4.0' }
      }
    });
    return;
  }

  if (method === 'tools/list') {
    respond({ jsonrpc: '2.0', id, result: { tools: getToolDefinitions() } });
    return;
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const toolArgs = params?.arguments || {};
    forwardToExtension(id, toolName, toolArgs, respond);
    return;
  }

  if (method?.startsWith('browser_')) {
    forwardToExtension(id, method, params || {}, respond);
    return;
  }

  respond({
    jsonrpc: '2.0', id,
    error: { code: -32601, message: `Method '${method}' tidak didukung` }
  });
}

function forwardToExtension(id, method, params, respond) {
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    respond({
      jsonrpc: '2.0', id,
      error: {
        code: -32003,
        message: 'Chrome Extension belum terhubung. Pastikan ekstensi sudah di-load dan browser terbuka.'
      }
    });
    return;
  }

  const timer = setTimeout(() => {
    if (pendingRequests.has(id)) {
      pendingRequests.delete(id);
      respond({
        jsonrpc: '2.0', id,
        error: { code: -32002, message: 'Timeout: Extension tidak merespons dalam 30 detik' }
      });
    }
  }, 30000);

  pendingRequests.set(id, { respond, timer });

  extensionSocket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
}

// ============ MCP TOOL DEFINITIONS ============
function getToolDefinitions() {
  return [
    {
      name: 'browser_snapshot',
      description: 'Ambil accessibility tree dan screenshot halaman aktif. Setiap elemen interaktif memiliki ref unik (e1, e2) untuk aksi.',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_click',
      description: 'Klik elemen berdasarkan ref ID dari snapshot terakhir',
      inputSchema: {
        type: 'object',
        properties: { ref: { type: 'string', description: 'Ref ID elemen (misal "e5")' } },
        required: ['ref']
      }
    },
    {
      name: 'browser_type',
      description: 'Ketik teks ke elemen input/textarea berdasarkan ref ID. Menghapus isi lama.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Ref ID elemen input' },
          text: { type: 'string', description: 'Teks yang akan diketik' }
        },
        required: ['ref', 'text']
      }
    },
    {
      name: 'browser_press_key',
      description: 'Tekan key keyboard. Untuk shortcut gunakan modifiers. Keys: Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp/Down/Left/Right, Home, End, PageUp/PageDown, F1-F12, atau karakter tunggal.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Nama key (misal "Enter", "Tab", "a")' },
          modifiers: {
            type: 'array',
            items: { type: 'string', enum: ['ctrl', 'shift', 'alt', 'meta'] },
            description: 'Modifier keys (misal ["ctrl", "shift"] untuk Ctrl+Shift+key)'
          }
        },
        required: ['key']
      }
    },
    {
      name: 'browser_find_element',
      description: 'Cari elemen di snapshot terakhir berdasarkan teks atau role, tanpa mengambil snapshot baru. Lebih cepat dari browser_snapshot.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Teks yang dicari (case-insensitive, partial match)' },
          role: { type: 'string', description: 'Role elemen (misal "button", "link", "textbox")' }
        }
      }
    },
    {
      name: 'browser_navigate',
      description: 'Navigasi ke URL dan otomatis ambil snapshot hasilnya',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL tujuan' } },
        required: ['url']
      }
    },
    {
      name: 'browser_screenshot',
      description: 'Ambil screenshot halaman saat ini tanpa accessibility tree',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_scroll',
      description: 'Scroll halaman ke atas atau bawah',
      inputSchema: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down'], description: 'Arah scroll' },
          amount: { type: 'number', description: 'Jarak scroll dalam pixel (default 400)' }
        }
      }
    },
    {
      name: 'browser_wait',
      description: 'Tunggu halaman selesai dimuat',
      inputSchema: {
        type: 'object',
        properties: {
          timeout_ms: { type: 'number', description: 'Batas waktu tunggu dalam ms (default 5000)' }
        }
      }
    },
    {
      name: 'browser_tabs',
      description: 'Daftar semua tab yang terbuka di window saat ini',
      inputSchema: { type: 'object', properties: {} }
    },
    {
      name: 'browser_switch_tab',
      description: 'Pindah ke tab tertentu berdasarkan tabId dan ambil snapshot',
      inputSchema: {
        type: 'object',
        properties: { tabId: { type: 'number', description: 'ID tab tujuan' } },
        required: ['tabId']
      }
    }
  ];
}

// ============ STARTUP ============
console.error(`[Bridge] ═══════════════════════════════════════`);
console.error(`[Bridge] Hermes Browser Bridge v0.4.0`);
console.error(`[Bridge] WebSocket: ws://127.0.0.1:${PORT}`);
console.error(`[Bridge] Ping interval: ${PING_INTERVAL_MS / 1000}s`);
console.error(`[Bridge] Menunggu koneksi Extension dan Agent...`);
console.error(`[Bridge] ═══════════════════════════════════════`);
