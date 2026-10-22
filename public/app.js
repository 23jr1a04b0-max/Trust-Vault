const $ = (id) => document.getElementById(id);
let csrfToken = '';
let activeUser = null;

function notice(message, kind = '') {
  const el = $('notice');
  el.textContent = message;
  el.className = `notice ${kind}`.trim();
  el.hidden = !message;
}
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (csrfToken && options.method && options.method !== 'GET') headers.set('x-csrf-token', csrfToken);
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin' });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(label, action, secondary = true) {
  const node = el('button', secondary ? 'secondary' : '', label);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function showAuthenticated(user, token) {
  activeUser = user;
  csrfToken = token || '';
  $('auth-panel').hidden = true;
  $('app-panel').hidden = false;
  $('session-status').textContent = `Signed in as ${user.name} (${user.role})`;
  $('welcome-title').textContent = `Welcome, ${user.name}`;
  $('welcome-subtitle').textContent = user.email;
  $('upload-panel').hidden = user.role !== 'DocumentOwner';
  $('admin-panel').hidden = user.role !== 'Administrator';
  loadDocuments();
}
function showSignedOut() {
  activeUser = null;
  csrfToken = '';
  $('auth-panel').hidden = false;
  $('app-panel').hidden = true;
  $('session-status').textContent = 'Secure document workspace';
}
async function loadDocuments() {
  const list = $('document-list');
  list.replaceChildren(el('p', 'muted', 'Loading documents…'));
  try {
    const data = await api('/api/documents');
    list.replaceChildren();
    if (!data.documents.length) {
      list.append(el('p', 'muted', 'No documents are available to this account yet.'));
      return;
    }
    for (const doc of data.documents) {
      const card = el('article', 'document-item');
      card.append(el('h3', '', doc.name));
      card.append(el('p', '', `Category: ${doc.category || 'General'}`));
      card.append(el('p', '', `Owner: ${doc.ownerName} · Access: ${doc.accessPermission} · ${Math.ceil(doc.size / 1024)} KB`));
      card.append(el('p', '', `Added: ${new Date(doc.createdAt).toLocaleString()}`));
      const actions = el('div', 'document-actions');
      actions.append(button('Download', async () => {
        try {
          const response = await fetch(`/api/documents/${encodeURIComponent(doc.id)}/download`, { credentials: 'same-origin' });
          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || 'Download was denied.');
          }
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = doc.name;
          document.body.append(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          notice('Download started.', 'success');
        } catch (error) { notice(error.message, 'error'); }
      }, false));
      if (doc.accessPermission === 'Owner') {
        actions.append(button('Share access', async () => {
          const email = window.prompt('Enter the registered email address to share with:');
          if (!email) return;
          const permission = window.prompt('Enter permission: Read or Edit', 'Read');
          if (!permission) return;
          try {
            await api(`/api/documents/${encodeURIComponent(doc.id)}/permissions`, {
              method: 'POST', body: JSON.stringify({ email: email.trim(), permission: permission.trim() })
            });
            notice('Access granted. The recipient can access the document on their next request.', 'success');
            loadDocuments();
          } catch (error) { notice(error.message, 'error'); }
        }));
        actions.append(button('Manage access', async () => {
          try {
            const data = await api(`/api/documents/${encodeURIComponent(doc.id)}/permissions`);
            if (!data.permissions.length) { notice('No access grants exist for this document.'); return; }
            const lines = data.permissions.map(p => `${p.email} | ${p.permission} | ${p.revoked_at ? 'revoked' : 'active'}`).join('\n');
            const email = window.prompt(`Current grants:\n${lines}\n\nEnter the email address to revoke:`);
            if (!email) return;
            const target = data.permissions.find(p => p.email.toLowerCase() === email.trim().toLowerCase() && !p.revoked_at);
            if (!target) { notice('No active grant was found for that email.', 'error'); return; }
            await api(`/api/documents/${encodeURIComponent(doc.id)}/permissions?userId=${encodeURIComponent(target.user_id)}`, { method: 'DELETE' });
            notice('Access revoked.', 'success');
            loadDocuments();
          } catch (error) { notice(error.message, 'error'); }
        }));
      }
      card.append(actions);
      list.append(card);
    }
  } catch (error) {
    list.replaceChildren(el('p', '', error.message));
    notice(error.message, 'error');
  }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  notice('');
  const form = new FormData(event.currentTarget);
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') })
    });
    showAuthenticated(data.user, data.csrfToken);
    notice('Signed in successfully.', 'success');
  } catch (error) { notice(error.message, 'error'); }
});
$('logout-button').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); }
  catch (error) { notice(error.message, 'error'); return; }
  showSignedOut();
  notice('You have signed out.', 'success');
});
$('upload-form').addEventListener('submit', async event => {
  event.preventDefault();
  const file = $('document-file').files[0];
  if (!file) { notice('Choose a file first.', 'error'); return; }
  const data = new FormData();
  data.append('file', file);
  data.append('category', $('document-category').value.trim() || 'General');
  try {
    await api('/api/documents', { method: 'POST', body: data });
    event.currentTarget.reset();
    $('document-category').value = 'General';
    notice('Document uploaded successfully.', 'success');
    loadDocuments();
  } catch (error) { notice(error.message, 'error'); }
});
$('refresh-button').addEventListener('click', loadDocuments);
$('audit-refresh').addEventListener('click', async () => {
  try {
    const data = await api('/api/audit');
    $('audit-output').textContent = JSON.stringify(data.events, null, 2);
  } catch (error) { notice(error.message, 'error'); }
});
$('audit-verify').addEventListener('click', async () => {
  try {
    const data = await api('/api/audit/verify', { method: 'POST', body: '{}' });
    $('audit-output').textContent = JSON.stringify(data, null, 2);
    notice(data.valid ? 'Audit chain verification passed.' : 'Audit chain verification failed.', data.valid ? 'success' : 'error');
  } catch (error) { notice(error.message, 'error'); }
});
$('year').textContent = String(new Date().getFullYear());
(async function restoreSession() {
  try {
    const data = await api('/api/auth/me');
    showAuthenticated(data.user, data.csrfToken);
  } catch { showSignedOut(); }
})();
