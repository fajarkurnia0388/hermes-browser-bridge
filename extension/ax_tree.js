/**
 * ax_tree.js — Parser Accessibility Tree dari CDP
 *
 * Mengubah output Accessibility.getFullAXTree menjadi snapshot teks ringkas
 * dengan ref ID unik untuk setiap elemen interaktif.
 */

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
  'menuitem', 'tab', 'switch', 'slider', 'searchbox', 'spinbutton',
  'option', 'listbox', 'menu', 'menubar', 'tree', 'treeitem',
  'gridcell', 'row', 'columnheader', 'rowheader'
]);

const SKIP_ROLES = new Set([
  'none', 'generic', 'StaticText', 'InlineTextBox', 'LineBreak',
  'paragraph', 'Section', 'Abbr'
]);

function isInteractiveRole(role) {
  return INTERACTIVE_ROLES.has(role);
}

/**
 * Mendapatkan property tertentu dari array properties CDP AXNode.
 * CDP mengembalikan properties sebagai array objek { name, value: { type, value } }.
 */
function getProperty(node, propName) {
  const prop = node.properties?.find(p => p.name === propName);
  return prop?.value?.value;
}

/**
 * Membangun snapshot ringkas dari node-node AX Tree.
 * Mengembalikan { snapshotText, refMap }.
 *
 * snapshotText: representasi teks pohon untuk dikirim ke LLM
 * refMap: pemetaan ref ID (e.g. 'e1') ke backendDOMNodeId untuk aksi CDP
 */
export function buildCompactSnapshot(nodes) {
  if (!nodes || nodes.length === 0) {
    return { snapshotText: '(halaman kosong)', refMap: {} };
  }

  // Hitung kedalaman setiap node dari struktur childIds
  const depthOf = new Map();
  for (const node of nodes) {
    if (!depthOf.has(node.nodeId)) {
      depthOf.set(node.nodeId, 0);
    }
    const parentDepth = depthOf.get(node.nodeId);
    if (node.childIds) {
      for (const childId of node.childIds) {
        depthOf.set(childId, parentDepth + 1);
      }
    }
  }

  const refMap = {};
  let refCounter = 0;
  const lines = [];

  for (const node of nodes) {
    // Lewati node yang secara eksplisit diabaikan oleh browser
    if (node.ignored) continue;

    const role = node.role?.value;
    if (!role || SKIP_ROLES.has(role)) continue;

    const name = node.name?.value;
    const description = node.description?.value;

    // Hanya ambil elemen yang interaktif ATAU memiliki nama bermakna
    // (heading, landmark, dll. berguna untuk konteks navigasi LLM)
    if (!name && !description && !isInteractiveRole(role)) continue;

    // Lewati node tanpa backendDOMNodeId (tidak bisa diinteraksi)
    if (node.backendDOMNodeId == null && isInteractiveRole(role)) continue;

    const ref = `e${++refCounter}`;

    // Simpan pemetaan untuk aksi browser_click / browser_type
    refMap[ref] = {
      backendDOMNodeId: node.backendDOMNodeId,
      role: role,
      name: name || null
    };

    // Format output
    const depth = depthOf.get(node.nodeId) || 0;
    const indent = '  '.repeat(Math.min(depth, 8));
    const nameStr = name ? ` "${name.replace(/\n/g, ' ').trim().slice(0, 80)}"` : '';
    const valueStr = node.value?.value
      ? ` value="${String(node.value.value).slice(0, 40)}"`
      : '';

    // Baca state dari properties array CDP
    const states = [];
    if (getProperty(node, 'disabled')) states.push('disabled');
    if (getProperty(node, 'checked') === 'true') states.push('checked');
    if (getProperty(node, 'selected')) states.push('selected');
    if (getProperty(node, 'expanded') === true) states.push('expanded');
    if (getProperty(node, 'expanded') === false) states.push('collapsed');
    if (getProperty(node, 'required')) states.push('required');

    const stateStr = states.length ? ` [${states.join(', ')}]` : '';

    lines.push(`${indent}[${ref}] ${role}${nameStr}${valueStr}${stateStr}`);
  }

  return {
    snapshotText: lines.join('\n'),
    refMap: refMap
  };
}
