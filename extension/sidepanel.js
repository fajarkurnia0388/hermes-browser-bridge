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
