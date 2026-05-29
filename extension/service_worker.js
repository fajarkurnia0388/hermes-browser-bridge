/**
 * service_worker.js — Hermes Browser Bridge Extension v0.4.0
 *
 * Arsitektur: Extension ↔ WebSocket ↔ Bridge Server ↔ AI Agent
 *
 * Changelog v0.4.0:
 * - Fix: screenshot yang hilang (fallback CDP + error detail)
 * - Fix: stabilitas koneksi (heartbeat dari bridge, reconnect logic)
 * - New: browser_press_key (keyboard shortcuts via CDP)
 * - New: browser_find_element (cari elemen tanpa snapshot ulang)
 * - New: duration_ms di semua response
 * - Improved: error handling konsisten
 */

import { buildCompactSnapshot } from './ax_tree.js';

// ============ KONFIGURASI ============
const BRIDGE_URL = 'ws://127.0.0.1:8787';
const RECONNECT_BASE_MS = 3000;
const RECONNECT_MAX_MS = 30000;

// ============ STATE ============
let ws = null;
let refMap = {};
let bridgeConnected = false;
let reconnectAttempts = 0;

// ============ COMMAND QUEUE (Sequential Execution) ============
const commandQueue = [];
let isProcessing = false;

function enqueueCommand(message) {
  return new Promise((resolve) => {
    commandQueue.push({ message, resolve });
    drainQueue();
  });
}

async function drainQueue() {
  if (isProcessing || commandQueue.length === 0) return;
  isProcessing = true;

  const { message, resolve } = commandQueue.shift();
  const startTime = Date.now();
  try {
    const result = await executeCommand(message);
    // Tambah duration_ms ke semua response sukses
    if (result.result) {
      result.result.duration_ms = Date.now() - startTime;
    }
    resolve(result);
  } catch (err) {
    resolve(errorResponse(message.id, -32000, err.message, {
      duration_ms: Date.now() - startTime
    }));
  } finally {
    isProcessing = false;
    drainQueue();
  }
}

// ============ WEBSOCKET KE BRIDGE ============
function connectToBridge() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  try {
    ws = new WebSocket(BRIDGE_URL);
  } catch (e) {
    log(`Gagal membuat WebSocket: ${e.message}`);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    bridgeConnected = true;
    reconnectAttempts = 0;
    log('Terhubung ke Bridge Server');
    updateStatus('Terhubung ke Bridge', true);

    // Daftarkan diri sebagai extension
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      method: 'register',
      params: { type: 'extension' }
    }));
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    // Hanya proses jika ini adalah request (punya method dan id)
    if (msg.method && msg.id != null) {
      const response = await enqueueCommand(msg);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response));
      }
    }
  };

  ws.onclose = () => {
    ws = null;
    bridgeConnected = false;
    updateStatus('Terputus', false);
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose akan dipanggil setelah ini
  };
}

function scheduleReconnect() {
  // Exponential backoff: 3s, 6s, 12s, ... max 30s
  const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS);
  reconnectAttempts++;
  const delaySec = (delay / 1000).toFixed(0);

  if (reconnectAttempts <= 3) {
    log(`Reconnect dalam ${delaySec}s...`);
  }

  // Gunakan alarm (lebih reliabel untuk SW lifecycle)
  const delayMinutes = Math.max(delay / 60000, 0.5); // minimum 0.5 menit
  chrome.alarms.create('reconnect-bridge', { delayInMinutes: delayMinutes });
}

// ============ LIFECYCLE ============
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('keep-connected', { periodInMinutes: 0.5 });
  connectToBridge();
});

chrome.runtime.onStartup.addListener(() => {
  connectToBridge();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'reconnect-bridge' || alarm.name === 'keep-connected') {
    connectToBridge();
  }
});

// Side Panel
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Respons permintaan status dan event dinamis dari sidepanel
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'GET_STATUS') {
    updateStatus(
      bridgeConnected ? 'Terhubung ke Bridge' : 'Terputus',
      bridgeConnected
    );
  }
  if (message.type === 'SIDEPANEL_DOM_CHANGED') {
    log('Pemberitahuan: DOM Sidepanel berubah secara dinamis.');
  }
});

// ============ HELPERS ============
function log(msg) {
  chrome.runtime.sendMessage({ type: 'LOG', data: msg }).catch(() => {});
}

function updateStatus(text, connected) {
  chrome.runtime.sendMessage({ type: 'STATUS', data: text, connected }).catch(() => {});
}

function okResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data && { data }) } };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw Object.assign(new Error('Tidak ada tab aktif'), { code: -32006 });
  return tab;
}

/**
 * Capture screenshot — coba captureVisibleTab dulu, fallback ke CDP.
 * Fix: menangani kasus di mana captureVisibleTab mengembalikan undefined/null.
 */
async function captureScreenshot(tabId) {
  // Metode 1: chrome.tabs.captureVisibleTab (ringan, tanpa debugger)
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'webp', quality: 50 });
    if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
      return dataUrl;
    }
  } catch (e) {
    // captureVisibleTab gagal — lanjut ke fallback
  }

  // Metode 2: CDP Page.captureScreenshot (fallback, lebih andal)
  if (tabId) {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      const { data } = await chrome.debugger.sendCommand(
        { tabId }, 'Page.captureScreenshot',
        { format: 'webp', quality: 50 }
      );
      await chrome.debugger.detach({ tabId }).catch(() => {});
      if (data) {
        return `data:image/webp;base64,${data}`;
      }
    } catch {
      await chrome.debugger.detach({ tabId }).catch(() => {});
    }
  }

  return null;
}

// Muat refMap dari storage session (recovery setelah SW restart)
async function ensureRefMap() {
  if (Object.keys(refMap).length === 0) {
    const data = await chrome.storage.session.get('refMap');
    if (data.refMap) refMap = data.refMap;
  }
}

// ============ KEY MAP untuk browser_press_key ============
const KEY_DEFINITIONS = {
  'Enter':      { key: 'Enter',     code: 'Enter',     keyCode: 13 },
  'Tab':        { key: 'Tab',       code: 'Tab',       keyCode: 9 },
  'Escape':     { key: 'Escape',    code: 'Escape',    keyCode: 27 },
  'Backspace':  { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  'Delete':     { key: 'Delete',    code: 'Delete',    keyCode: 46 },
  'Space':      { key: ' ',         code: 'Space',     keyCode: 32 },
  'ArrowUp':    { key: 'ArrowUp',   code: 'ArrowUp',   keyCode: 38 },
  'ArrowDown':  { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  'ArrowLeft':  { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  'ArrowRight': { key: 'ArrowRight',code: 'ArrowRight',keyCode: 39 },
  'Home':       { key: 'Home',      code: 'Home',      keyCode: 36 },
  'End':        { key: 'End',       code: 'End',       keyCode: 35 },
  'PageUp':     { key: 'PageUp',    code: 'PageUp',    keyCode: 33 },
  'PageDown':   { key: 'PageDown',  code: 'PageDown',  keyCode: 34 },
  'F1':         { key: 'F1',        code: 'F1',        keyCode: 112 },
  'F2':         { key: 'F2',        code: 'F2',        keyCode: 113 },
  'F3':         { key: 'F3',        code: 'F3',        keyCode: 114 },
  'F5':         { key: 'F5',        code: 'F5',        keyCode: 116 },
  'F11':        { key: 'F11',       code: 'F11',       keyCode: 122 },
  'F12':        { key: 'F12',       code: 'F12',       keyCode: 123 },
};

// ============ SIDEPANEL DOM ACCESS & INTERACTION ============
async function handleSnapshotSidepanel(id) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GET_SIDEPANEL_DOM'
    });
    
    if (!response || !response.success) {
      return errorResponse(id, -32000, response?.error || 'Sidepanel tidak aktif. Buka panel samping ekstensi terlebih dahulu.');
    }
    
    log(`← snapshot_sidepanel: sukses mengambil elemen dari sidepanel`);
    
    return okResponse(id, {
      page_url: 'chrome-extension://sidepanel',
      page_title: 'Hermes Bridge Sidepanel',
      snapshot: response.snapshot,
      screenshot_b64: null,
      source: 'sidepanel'
    });
  } catch (err) {
    return errorResponse(id, -32000, `Gagal ambil sidepanel: ${err.message}. Pastikan panel samping ekstensi sudah terbuka.`);
  }
}

async function handleClickSidepanel(id, params) {
  const { ref } = params;
  if (!ref) return errorResponse(id, -32600, "Parameter 'ref' wajib diisi");

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SIDEPANEL_CLICK',
      ref
    });

    if (!response || !response.success) {
      return errorResponse(id, -32001, response?.error || `Ref '${ref}' tidak dapat diklik di sidepanel`);
    }

    log(`← sidepanel_click ${ref} sukses`);
    return okResponse(id, { success: true, ref });
  } catch (err) {
    return errorResponse(id, -32001, `Gagal klik sidepanel: ${err.message}. Pastikan panel samping ekstensi tetap terbuka.`);
  }
}

async function handleTypeSidepanel(id, params) {
  const { ref, text } = params;
  if (!ref) return errorResponse(id, -32600, "Parameter 'ref' wajib diisi");
  if (text == null) return errorResponse(id, -32600, "Parameter 'text' wajib diisi");

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'SIDEPANEL_TYPE',
      ref,
      text
    });

    if (!response || !response.success) {
      return errorResponse(id, -32001, response?.error || `Gagal mengetik di ref '${ref}' di sidepanel`);
    }

    log(`← sidepanel_type ${ref} sukses: "${text.slice(0, 30)}"`);
    return okResponse(id, { success: true, ref });
  } catch (err) {
    return errorResponse(id, -32001, `Gagal mengetik di sidepanel: ${err.message}. Pastikan panel samping ekstensi tetap terbuka.`);
  }
}

// ============ COMMAND DISPATCHER ============
async function executeCommand(msg) {
  const { id, method, params = {} } = msg;

  log(`→ ${method}`);

  switch (method) {
    case 'browser_snapshot':       return handleSnapshot(id);
    case 'browser_snapshot_sidepanel': return handleSnapshotSidepanel(id);
    case 'browser_sidepanel_click': return handleClickSidepanel(id, params);
    case 'browser_sidepanel_type': return handleTypeSidepanel(id, params);
    case 'browser_click':          return handleClick(id, params);
    case 'browser_type':           return handleType(id, params);
    case 'browser_navigate':       return handleNavigate(id, params);
    case 'browser_screenshot':     return handleScreenshot(id);
    case 'browser_scroll':         return handleScroll(id, params);
    case 'browser_wait':           return handleWait(id, params);
    case 'browser_tabs':           return handleListTabs(id);
    case 'browser_switch_tab':     return handleSwitchTab(id, params);
    case 'browser_press_key':      return handlePressKey(id, params);
    case 'browser_find_element':   return handleFindElement(id, params);
    case 'browser_execute_script': return handleExecuteScript(id, params);
    case 'browser_wait_for_selector': return handleWaitForSelector(id, params);
    case 'browser_open_new_tab':   return handleOpenNewTab(id, params);
    default:
      return errorResponse(id, -32601, `Method '${method}' tidak dikenali`);
  }
}

// ============ SNAPSHOT (AX Tree + Screenshot) ============
async function handleSnapshot(id) {
  const tab = await getActiveTab();

  await chrome.debugger.attach({ tabId: tab.id }, '1.3');
  try {
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Accessibility.enable');
    const { nodes } = await chrome.debugger.sendCommand(
      { tabId: tab.id }, 'Accessibility.getFullAXTree'
    );

    const { snapshotText, refMap: newRefMap } = buildCompactSnapshot(nodes);

    // Simpan refMap
    refMap = newRefMap;
    await chrome.storage.session.set({ refMap });

    // Screenshot via CDP (debugger sudah attached)
    let screenshot = null;
    try {
      const { data } = await chrome.debugger.sendCommand(
        { tabId: tab.id }, 'Page.captureScreenshot',
        { format: 'webp', quality: 50 }
      );
      if (data) screenshot = `data:image/webp;base64,${data}`;
    } catch {
      // Fallback ke captureVisibleTab setelah detach
    }

    log(`← snapshot: ${Object.keys(refMap).length} elemen`);

    // Detach sebelum fallback screenshot
    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});

    // Fallback screenshot jika CDP gagal
    if (!screenshot) {
      screenshot = await captureScreenshot(null);
    }

    return okResponse(id, {
      page_url: tab.url,
      page_title: tab.title,
      snapshot: snapshotText,
      screenshot_b64: screenshot
    });
  } catch (err) {
    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    throw err;
  }
}

// ============ CLICK via CDP DOM.resolveNode ============
async function handleClick(id, params) {
  const { ref } = params;
  if (!ref) return errorResponse(id, -32600, "Parameter 'ref' wajib diisi");

  await ensureRefMap();
  const nodeInfo = refMap[ref];
  if (!nodeInfo) {
    return errorResponse(id, -32001,
      `Ref '${ref}' tidak ditemukan. Jalankan browser_snapshot terlebih dahulu.`);
  }

  const tab = await getActiveTab();
  await chrome.debugger.attach({ tabId: tab.id }, '1.3');

  try {
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'DOM.enable');

    const { object } = await chrome.debugger.sendCommand(
      { tabId: tab.id }, 'DOM.resolveNode',
      { backendNodeId: nodeInfo.backendDOMNodeId }
    );

    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() {
        this.scrollIntoViewIfNeeded?.();
        this.click();
      }`,
      returnByValue: false
    });

    await new Promise(r => setTimeout(r, 500));

    // Screenshot via CDP (masih attached)
    let screenshot = null;
    try {
      const { data } = await chrome.debugger.sendCommand(
        { tabId: tab.id }, 'Page.captureScreenshot',
        { format: 'webp', quality: 50 }
      );
      if (data) screenshot = `data:image/webp;base64,${data}`;
    } catch { /* fallback nanti */ }

    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});

    if (!screenshot) screenshot = await captureScreenshot(null);

    log(`← click ${ref} (${nodeInfo.role}: "${nodeInfo.name || ''}")`);

    return okResponse(id, { success: true, ref, screenshot_b64: screenshot });
  } catch (err) {
    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    return errorResponse(id, -32001, `Gagal klik ref '${ref}': ${err.message}`);
  }
}

// ============ TYPE via CDP ============
async function handleType(id, params) {
  const { ref, text } = params;
  if (!ref) return errorResponse(id, -32600, "Parameter 'ref' wajib diisi");
  if (text == null) return errorResponse(id, -32600, "Parameter 'text' wajib diisi");

  await ensureRefMap();
  const nodeInfo = refMap[ref];
  if (!nodeInfo) {
    return errorResponse(id, -32001, `Ref '${ref}' tidak ditemukan.`);
  }

  const tab = await getActiveTab();
  await chrome.debugger.attach({ tabId: tab.id }, '1.3');

  try {
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'DOM.enable');

    const { object } = await chrome.debugger.sendCommand(
      { tabId: tab.id }, 'DOM.resolveNode',
      { backendNodeId: nodeInfo.backendDOMNodeId }
    );

    // Focus & clear
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() {
        this.focus();
        if ('value' in this) this.value = '';
        if (this.isContentEditable) this.textContent = '';
      }`,
      returnByValue: false
    });

    // Ketik via CDP Input.insertText
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.insertText', {
      text: text
    });

    // Trigger events untuk framework (React/Vue/Angular)
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.callFunctionOn', {
      objectId: object.objectId,
      functionDeclaration: `function() {
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
      returnByValue: false
    });

    await new Promise(r => setTimeout(r, 300));

    let screenshot = null;
    try {
      const { data } = await chrome.debugger.sendCommand(
        { tabId: tab.id }, 'Page.captureScreenshot',
        { format: 'webp', quality: 50 }
      );
      if (data) screenshot = `data:image/webp;base64,${data}`;
    } catch { /* fallback */ }

    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    if (!screenshot) screenshot = await captureScreenshot(null);

    log(`← type ${ref}: "${text.slice(0, 30)}"`);

    return okResponse(id, { success: true, ref, screenshot_b64: screenshot });
  } catch (err) {
    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    return errorResponse(id, -32001, `Gagal mengetik di ref '${ref}': ${err.message}`);
  }
}

// ============ PRESS KEY via CDP ============
async function handlePressKey(id, params) {
  const { key, modifiers: modParam = [] } = params;
  if (!key) return errorResponse(id, -32600, "Parameter 'key' wajib diisi");

  const tab = await getActiveTab();

  // Hitung bitmask modifier: Alt=1, Ctrl=2, Meta=4, Shift=8
  let modBitmask = 0;
  const modList = Array.isArray(modParam) ? modParam : [modParam];
  for (const m of modList) {
    const ml = String(m).toLowerCase();
    if (ml === 'alt') modBitmask |= 1;
    if (ml === 'ctrl' || ml === 'control') modBitmask |= 2;
    if (ml === 'meta' || ml === 'cmd' || ml === 'command') modBitmask |= 4;
    if (ml === 'shift') modBitmask |= 8;
  }

  // Cari definisi key, atau buat dari karakter tunggal
  let keyDef = KEY_DEFINITIONS[key];
  if (!keyDef) {
    if (key.length === 1) {
      const upper = key.toUpperCase();
      keyDef = {
        key: key,
        code: `Key${upper}`,
        keyCode: upper.charCodeAt(0)
      };
    } else {
      return errorResponse(id, -32600,
        `Key '${key}' tidak dikenali. Gunakan: ${Object.keys(KEY_DEFINITIONS).join(', ')}, atau karakter tunggal.`);
    }
  }

  await chrome.debugger.attach({ tabId: tab.id }, '1.3');
  try {
    // KeyDown
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode,
      modifiers: modBitmask
    });

    // Untuk karakter printable, kirim char event juga
    if (keyDef.key.length === 1 && modBitmask === 0) {
      await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
        type: 'char',
        text: keyDef.key,
        key: keyDef.key,
        code: keyDef.code,
        modifiers: modBitmask
      });
    }

    // KeyUp
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: keyDef.key,
      code: keyDef.code,
      windowsVirtualKeyCode: keyDef.keyCode,
      nativeVirtualKeyCode: keyDef.keyCode,
      modifiers: modBitmask
    });

    await new Promise(r => setTimeout(r, 200));

    let screenshot = null;
    try {
      const { data } = await chrome.debugger.sendCommand(
        { tabId: tab.id }, 'Page.captureScreenshot',
        { format: 'webp', quality: 50 }
      );
      if (data) screenshot = `data:image/webp;base64,${data}`;
    } catch { /* fallback */ }

    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    if (!screenshot) screenshot = await captureScreenshot(null);

    log(`← press_key: ${modList.length ? modList.join('+') + '+' : ''}${key}`);

    return okResponse(id, { success: true, key, screenshot_b64: screenshot });
  } catch (err) {
    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
    return errorResponse(id, -32001, `Gagal tekan key '${key}': ${err.message}`);
  }
}

// ============ FIND ELEMENT (cari di refMap tanpa snapshot ulang) ============
async function handleFindElement(id, params) {
  const { text, role } = params;
  if (!text && !role) {
    return errorResponse(id, -32600, "Minimal 'text' atau 'role' harus diisi");
  }

  await ensureRefMap();

  if (Object.keys(refMap).length === 0) {
    return errorResponse(id, -32001, 'RefMap kosong. Jalankan browser_snapshot terlebih dahulu.');
  }

  const matches = [];
  const searchText = text?.toLowerCase();

  for (const [ref, info] of Object.entries(refMap)) {
    let textMatch = true;
    let roleMatch = true;

    if (searchText) {
      const name = (info.name || '').toLowerCase();
      textMatch = name.includes(searchText);
    }
    if (role) {
      roleMatch = info.role === role;
    }

    if (textMatch && roleMatch) {
      matches.push({ ref, role: info.role, name: info.name });
    }
  }

  log(`← find_element: ${matches.length} hasil`);

  return okResponse(id, {
    count: matches.length,
    matches: matches.slice(0, 20) // Batasi 20 hasil
  });
}

// ============ NAVIGATE ============
async function handleNavigate(id, params) {
  const { url } = params;
  if (!url) return errorResponse(id, -32600, "Parameter 'url' wajib diisi");

  const tab = await getActiveTab();
  log(`→ navigate: ${url}`);

  await chrome.tabs.update(tab.id, { url });

  await new Promise((resolve) => {
    const onUpdated = (tabId, info) => {
      if (tabId === tab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, 15000);
  });

  return handleSnapshot(id);
}

// ============ SCREENSHOT ============
async function handleScreenshot(id) {
  const tab = await getActiveTab();
  const screenshot = await captureScreenshot(tab.id);

  if (!screenshot) {
    return errorResponse(id, -32007, 'Gagal mengambil screenshot. Halaman mungkin chrome:// atau tidak bisa diakses.');
  }

  return okResponse(id, { screenshot_b64: screenshot });
}

// ============ SCROLL ============
async function handleScroll(id, params) {
  const { direction = 'down', amount = 400 } = params;
  const tab = await getActiveTab();

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (dir, amt) => {
      window.scrollBy({ top: dir === 'down' ? amt : -amt, behavior: 'smooth' });
    },
    args: [direction, amount]
  });

  await new Promise(r => setTimeout(r, 600));
  const screenshot = await captureScreenshot(tab.id);

  return okResponse(id, { success: true, screenshot_b64: screenshot });
}

// ============ WAIT ============
async function handleWait(id, params) {
  const { timeout_ms = 5000 } = params;
  const tab = await getActiveTab();
  const startTime = Date.now();
  const pollInterval = 400;

  while (Date.now() - startTime < timeout_ms) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.readyState
    });

    if (result?.result === 'complete') {
      return okResponse(id, { ready: true, elapsed_ms: Date.now() - startTime });
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }

  return okResponse(id, { ready: false, elapsed_ms: timeout_ms });
}

// ============ LIST TABS ============
async function handleListTabs(id) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const tabList = tabs.map(t => ({
    tabId: t.id,
    title: t.title,
    url: t.url,
    active: t.active
  }));
  return okResponse(id, { tabs: tabList });
}

// ============ SWITCH TAB ============
async function handleSwitchTab(id, params) {
  const { tabId } = params;
  if (tabId == null) return errorResponse(id, -32600, "Parameter 'tabId' wajib diisi");

  await chrome.tabs.update(tabId, { active: true });
  await new Promise(r => setTimeout(r, 300));

  return handleSnapshot(id);
}

// ============ EXECUTE SCRIPT via CDP / chrome.scripting ============
async function handleExecuteScript(id, params) {
  const { script } = params;
  if (!script) return errorResponse(id, -32600, "Parameter 'script' wajib diisi");

  const tab = await getActiveTab();
  log(`→ execute_script di tab ${tab.id}`);

  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (code) => {
        try {
          return { success: true, value: window.eval(code) };
        } catch (e) {
          return { success: false, error: e.message };
        }
      },
      args: [script]
    });

    if (res?.result?.success === false) {
      return errorResponse(id, -32001, `Eval error: ${res.result.error}`);
    }

    const screenshot = await captureScreenshot(tab.id);
    return okResponse(id, {
      success: true,
      result: res?.result?.value,
      screenshot_b64: screenshot
    });
  } catch (err) {
    return errorResponse(id, -32001, `Gagal eksekusi script: ${err.message}`);
  }
}

// ============ WAIT FOR SELECTOR ============
async function handleWaitForSelector(id, params) {
  const { selector, timeout_ms = 10000 } = params;
  if (!selector) return errorResponse(id, -32600, "Parameter 'selector' wajib diisi");

  const tab = await getActiveTab();
  log(`→ wait_for_selector: "${selector}" (timeout: ${timeout_ms}ms)`);

  const startTime = Date.now();
  const pollInterval = 400;

  while (Date.now() - startTime < timeout_ms) {
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (sel) => !!document.querySelector(sel),
        args: [selector]
      });

      if (res?.result) {
        const screenshot = await captureScreenshot(tab.id);
        log(`← wait_for_selector: "${selector}" ditemukan dalam ${Date.now() - startTime}ms`);
        return okResponse(id, {
          found: true,
          elapsed_ms: Date.now() - startTime,
          screenshot_b64: screenshot
        });
      }
    } catch (e) {
      // Tab mungkin sedang reload atau navigasi
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }

  const screenshot = await captureScreenshot(tab.id);
  log(`← wait_for_selector: "${selector}" TIMEOUT`);
  return okResponse(id, {
    found: false,
    elapsed_ms: timeout_ms,
    screenshot_b64: screenshot
  });
}

// ============ OPEN NEW TAB ============
async function handleOpenNewTab(id, params) {
  const { url } = params;
  if (!url) return errorResponse(id, -32600, "Parameter 'url' wajib diisi");

  log(`→ open_new_tab: ${url}`);
  try {
    const tab = await chrome.tabs.create({ url, active: true });
    
    // Tunggu tab selesai dimuat
    await new Promise((resolve) => {
      const onUpdated = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }, 15000);
    });

    log(`← tab baru ${tab.id} siap. Mengambil snapshot...`);
    return handleSnapshot(id);
  } catch (err) {
    return errorResponse(id, -32001, `Gagal membuka tab baru: ${err.message}`);
  }
}
