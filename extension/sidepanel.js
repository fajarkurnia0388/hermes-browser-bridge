const logBox = document.getElementById('log-box');
const btnClear = document.getElementById('btn-clear');
const statusText = document.getElementById('status-text');

function getFormattedTime() {
  const now = new Date();
  return now.toTimeString().split(' ')[0];
}

// Tambah log entry ke UI — menggunakan textContent untuk mencegah XSS
function addLogEntry(message, type = 'system') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;

  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-time';
  timeSpan.textContent = `[${getFormattedTime()}]`;

  const textNode = document.createTextNode(` ${message}`);

  entry.appendChild(timeSpan);
  entry.appendChild(textNode);
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

// Bersihkan log — gunakan replaceChildren() bukan innerHTML = ''
btnClear.addEventListener('click', () => {
  logBox.replaceChildren();
  addLogEntry('Log dibersihkan.', 'system');
});

// Mendengarkan pesan log dari Service Worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'LOG') {
    addLogEntry(String(message.data), 'info');
  }
  if (message.type === 'STATUS') {
    statusText.textContent = message.data;
    statusText.className = message.connected
      ? 'status-badge connected'
      : 'status-badge';
  }
});

// Minta status awal dari SW
chrome.runtime.sendMessage({ type: 'GET_STATUS' }).catch(() => {});

// ============ BRIDGE ACCESS & INTERACTION ============

const INTERESTING_TAGS = ['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];

function getElementRole(elem) {
  const tag = elem.tagName;
  const roleAttr = elem.getAttribute('role');
  if (roleAttr) return roleAttr;

  const roles = {
    'BUTTON': 'button',
    'A': 'link',
    'INPUT': elem.type === 'checkbox' ? 'checkbox' : (elem.type === 'radio' ? 'radio' : 'textbox'),
    'TEXTAREA': 'textbox',
    'SELECT': 'combobox',
    'H1': 'heading', 'H2': 'heading', 'H3': 'heading', 'H4': 'heading', 'H5': 'heading', 'H6': 'heading'
  };
  return roles[tag] || 'generic';
}

function getElementName(elem) {
  const ariaLabel = elem.getAttribute('aria-label');
  if (ariaLabel) return ariaLabel.trim();

  const title = elem.getAttribute('title');
  if (title) return title.trim();

  const placeholder = elem.getAttribute('placeholder');
  if (placeholder) return placeholder.trim();

  if (elem.tagName === 'INPUT' && (elem.type === 'submit' || elem.type === 'button')) {
    return elem.value || '';
  }

  if (elem.tagName === 'INPUT' && elem.type !== 'checkbox' && elem.type !== 'radio') {
    return elem.value || '';
  }

  return elem.textContent?.replace(/\s+/g, ' ').trim() || '';
}

function getElementValue(elem) {
  if (elem.tagName === 'INPUT' || elem.tagName === 'TEXTAREA' || elem.tagName === 'SELECT') {
    if (elem.type === 'checkbox' || elem.type === 'radio') {
      return elem.checked ? 'true' : 'false';
    }
    return elem.value || '';
  }
  return null;
}

function getElementStates(elem) {
  const states = [];
  if (elem.disabled) states.push('disabled');
  if (elem.checked) states.push('checked');
  if (elem.required) states.push('required');
  if (elem.readOnly) states.push('readonly');
  return states;
}

// Fungsi rekursif untuk mencari elemen berdasarkan data-bridge-ref menembus Shadow DOM
function findElementByRef(root, ref) {
  if (!root) return null;
  if (root.nodeType === Node.ELEMENT_NODE && root.getAttribute('data-bridge-ref') === ref) {
    return root;
  }

  // Telusuri anak-anak dari node ini
  let child = root.firstChild;
  while (child) {
    const found = findElementByRef(child, ref);
    if (found) return found;
    child = child.nextSibling;
  }

  // Telusuri shadowRoot jika ada
  if (root.shadowRoot) {
    const found = findElementByRef(root.shadowRoot, ref);
    if (found) return found;
  }

  return null;
}

// Rekursif bangun snapshot dari DOM (mendukung Shadow DOM)
function buildDOMSnapshot() {
  const lines = [];
  let refCounter = 0;

  // Hapus semua data-bridge-ref lama terlebih dahulu untuk mencegah duplikasi
  function removeRefs(root) {
    if (!root) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.hasAttribute('data-bridge-ref')) {
      root.removeAttribute('data-bridge-ref');
    }
    let child = root.firstChild;
    while (child) {
      removeRefs(child);
      child = child.nextSibling;
    }
    if (root.shadowRoot) {
      removeRefs(root.shadowRoot);
    }
  }
  removeRefs(document.body);

  // Cari dan beri tag elemen interaktif secara rekursif
  function processNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;

    const tagName = node.tagName;
    const isInteractive = INTERESTING_TAGS.includes(tagName) || 
                         node.getAttribute('role') || 
                         node.hasAttribute('onclick') || 
                         node.style.cursor === 'pointer';

    // Lewati jika tersembunyi secara visual (offsetWidth/offsetHeight = 0)
    // Catatan: beberapa shadow host mungkin memiliki dimensi 0 tetapi anak-anaknya memiliki dimensi.
    // Oleh karena itu, kita tetap memproses anak-anaknya dan shadowRoot-nya.
    const isVisible = node.offsetWidth > 0 || node.offsetHeight > 0 || node.shadowRoot || node.tagName === 'SLOT';

    if (isVisible && isInteractive) {
      const ref = `se${++refCounter}`;
      node.setAttribute('data-bridge-ref', ref);

      const role = getElementRole(node);
      const name = getElementName(node);
      const value = getElementValue(node);
      const states = getElementStates(node);

      const nameStr = name ? ` "${name}"` : '';
      const valueStr = value !== null ? ` value="${value}"` : '';
      const stateStr = states.length ? ` [${states.join(', ')}]` : '';

      lines.push(`[${ref}] ${role}${nameStr}${valueStr}${stateStr}`);
    }

    // Telusuri anak-anak
    let child = node.firstChild;
    while (child) {
      processNode(child);
      child = child.nextSibling;
    }

    // Telusuri shadowRoot jika ada
    if (node.shadowRoot) {
      let shadowChild = node.shadowRoot.firstChild;
      while (shadowChild) {
        processNode(shadowChild);
        shadowChild = shadowChild.nextSibling;
      }
    }
  }

  processNode(document.body);

  return lines.join('\n') || '(sidepanel kosong)';
}

// ============ MUTATION OBSERVER (DETEKSI PERUBAHAN DINAMIS) ============
const mutationObserver = new MutationObserver((mutations) => {
  let hasRelevantChange = false;

  for (const mutation of mutations) {
    // Abaikan perubahan atribut data-bridge-ref untuk menghindari loop tak terbatas
    if (mutation.type === 'attributes' && mutation.attributeName === 'data-bridge-ref') {
      continue;
    }

    // Periksa apakah ada elemen interaktif yang ditambah atau dihapus
    if (mutation.type === 'childList') {
      const hasInteractiveAdd = Array.from(mutation.addedNodes).some(node => 
        node.nodeType === Node.ELEMENT_NODE && 
        (INTERESTING_TAGS.includes(node.tagName) || node.querySelector?.('button, a, input, textarea, select'))
      );
      
      const hasInteractiveRemove = Array.from(mutation.removedNodes).some(node => 
        node.nodeType === Node.ELEMENT_NODE && 
        (INTERESTING_TAGS.includes(node.tagName) || node.querySelector?.('button, a, input, textarea, select'))
      );

      if (hasInteractiveAdd || hasInteractiveRemove) {
        hasRelevantChange = true;
        break;
      }
    }

    // Periksa perubahan isi teks atau perubahan atribut lainnya
    if (mutation.type === 'characterData' || (mutation.type === 'attributes' && mutation.attributeName !== 'class')) {
      hasRelevantChange = true;
      break;
    }
  }

  if (hasRelevantChange) {
    chrome.runtime.sendMessage({
      type: 'SIDEPANEL_DOM_CHANGED',
      timestamp: Date.now()
    }).catch(() => {});
  }
});

// Mulai mengamati perubahan pada document.body
mutationObserver.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  characterData: true
});

// Mendengarkan permintaan snapshot, klik, dan ketik di sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_SIDEPANEL_DOM') {
    try {
      const snapshotText = buildDOMSnapshot();
      sendResponse({ success: true, snapshot: snapshotText });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }

  if (message.type === 'SIDEPANEL_CLICK') {
    try {
      const el = findElementByRef(document.body, message.ref);
      if (!el) {
        sendResponse({ success: false, error: `Ref ${message.ref} tidak ditemukan di sidepanel` });
        return;
      }
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      el.click();
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }

  if (message.type === 'SIDEPANEL_TYPE') {
    try {
      const el = findElementByRef(document.body, message.ref);
      if (!el) {
        sendResponse({ success: false, error: `Ref ${message.ref} tidak ditemukan di sidepanel` });
        return;
      }
      el.focus();
      if ('value' in el) {
        el.value = message.text;
      } else if (el.isContentEditable) {
        el.textContent = message.text;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      sendResponse({ success: true });
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  }
  return true; // Menjaga channel respons tetap terbuka untuk async
});
