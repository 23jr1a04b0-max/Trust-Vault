const $ = (id) => document.getElementById(id);
let csrfToken = '';
let activeUser = null;
let selectedRole = null;
const roleDetails = {
  DocumentOwner: { title: 'Document Owner sign in', description: 'Sign in to upload documents, choose visibility, and manage sharing permissions.' },
  Viewer: { title: 'Viewer sign in', description: 'Sign in to access documents shared with your account.' },
  Administrator: { title: 'Administrator sign in', description: 'Sign in to manage accounts and review security activity.' }
};
function showRoleSelection() {
  selectedRole = null;
  $('role-panel').hidden = false;
  $('login-panel').hidden = true;
  $('signup-panel').hidden = true;
  $('auth-panel').hidden = false;
  $('session-status').textContent = 'Secure document workspace';
}
function showLoginForRole(role) {
  if (!roleDetails[role]) return;
  selectedRole = role;
  $('role-panel').hidden = true;
  $('signup-panel').hidden = true;
  $('login-panel').hidden = false;
  $('login-title').textContent = roleDetails[role].title;
  $('login-role-description').textContent = roleDetails[role].description;
  $('signup-prompt').hidden = role === 'Administrator';
  $('session-status').textContent = roleDetails[role].title;
  $('mfa-code-row').hidden = role !== 'Administrator';
}
function showSignup() {
  if (!['DocumentOwner','Viewer'].includes(selectedRole)) return;
  $('login-panel').hidden = true;
  $('signup-panel').hidden = false;
  $('signup-title').textContent = `Create ${selectedRole === 'DocumentOwner' ? 'Document Owner' : 'Viewer'} account`;
  $('signup-role-description').textContent = selectedRole === 'DocumentOwner' ? 'Owner accounts can upload documents and manage their own sharing permissions after administrator approval.' : 'Viewer accounts can access documents only when their owners grant permission.';
}

function fieldStatus(id, message, kind = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.className = ('field-status ' + kind).trim();
  el.hidden = !message;
}
function clearFieldStatuses(...ids) { ids.forEach(id => fieldStatus(id, '')); }

function notice(message, kind = '') {
  const el = $('notice');
  el.textContent = message;
  el.className = `notice ${kind}`.trim();
  el.hidden = !message;
}
function fieldFeedback(id, message, kind = '') {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.className = ('field-status ' + kind).trim();
  el.hidden = !message;
}
function clearFeedback(...ids) { ids.forEach(id => fieldFeedback(id, '')); }
function loginErrorTarget(message) {
  if (/authenticator|mfa|one-time|6.?digit|code/i.test(message)) return 'login-mfa-status';
  if (/email|account|user|role|sign.?in|credential|not found|disabled|approved/i.test(message)) return 'email-status';
  return 'password-status';
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
function setNotificationCount(count) {
  const badge=$('notification-count');
  const value=Math.max(0,Number(count)||0);
  badge.textContent=value>99?'99+':String(value);
  badge.hidden=value===0;
  $('notifications-toggle').setAttribute('aria-label',value?('Open notifications, '+value+' unread'):'Open notifications');
}
async function loadNotifications(markViewed=false) {
  const list=$('notification-list');
  try {
    const data=await api('/api/notifications');
    list.replaceChildren();
    if(!data.notifications.length) list.append(el('p','muted','You have no notifications yet.'));
    for(const item of data.notifications) {
      const card=el('article','notification-item'+(item.readAt?' read':' unread'));
      const heading=el('div','notification-heading');
      heading.append(el('h3','',item.title));
      if(!item.readAt) heading.append(el('span','notification-unread-label','Unread'));
      card.append(heading);
      card.append(el('p','',item.message));
      card.append(el('p','muted notification-time',new Date(item.createdAt).toLocaleString()));
      list.append(card);
    }
    if(markViewed && data.unreadCount>0) {
      await api('/api/notifications/read-all',{method:'POST',body:'{}'});
      setNotificationCount(0);
      list.querySelectorAll('.notification-item.unread').forEach(card=>{
        card.classList.remove('unread');card.classList.add('read');
        const label=card.querySelector('.notification-unread-label');
        if(label) label.remove();
      });
    } else setNotificationCount(data.unreadCount);
  } catch(error) {
    if(list) list.replaceChildren(el('p','',error.message));
  }
}
function toggleNotifications(forceOpen) {
  const panel=$('notifications-panel');
  const opening=typeof forceOpen==='boolean'?forceOpen:panel.hidden;
  panel.hidden=!opening;
  $('notifications-toggle').setAttribute('aria-expanded',String(opening));
  if(opening) loadNotifications(true);
}
function showAuthenticated(user, token) {
  activeUser = user;
  csrfToken = token || '';
  $('auth-panel').hidden = true;
  $('app-panel').hidden = false;
  $('session-status').textContent = `Signed in as ${user.role}`;
  $('topbar-user').hidden = false;
  $('profile-name').textContent = user.name;
  $('notifications-panel').hidden = true;
  $('notifications-toggle').setAttribute('aria-expanded','false');
  setNotificationCount(0);
  if (user.role !== 'Administrator' || !user.mfaRequired || user.mfaEnabled) loadNotifications(false);
  $('welcome-title').textContent = `Welcome, ${user.name}`;
  $('welcome-subtitle').textContent = user.email;
  $('upload-panel').hidden = user.role !== 'DocumentOwner';
  $('requests-panel').hidden = user.role !== 'DocumentOwner';
  $('admin-panel').hidden = user.role !== 'Administrator';
  $('admin-mfa-panel').hidden = user.role !== 'Administrator' || !user.mfaRequired || Boolean(user.mfaEnabled);
  $('admin-tools').hidden = user.role === 'Administrator' && user.mfaRequired && !user.mfaEnabled;
  if (user.role !== 'Administrator' || !user.mfaRequired || user.mfaEnabled) loadDocuments();
  else if (user.role === 'Administrator' && user.mfaRequired && !user.mfaEnabled) $('document-list').replaceChildren(el('p','muted','Complete administrator MFA setup to access administrator tools.'));
  if (user.role === 'DocumentOwner') loadAccessRequests();
}
async function loadAccessRequests() {
  const list = $('request-list');
  if (!list) return;
  try {
    const data = await api('/api/access-requests');
    list.replaceChildren();
    if (!data.requests.length) { list.append(el('p','muted','No pending requests.')); return; }
    for (const request of data.requests) {
      const card = el('article','document-item');
      card.append(el('h3','',request.document_name));
      card.append(el('p','',`${request.requester_name} (${request.requester_email}) requests ${request.permission} access`));
      card.append(el('p','muted',`Requested: ${new Date(request.created_at).toLocaleString()}`));
      const actions = el('div','document-actions');
      actions.append(button('Approve', async () => {
        const expiry = window.prompt('Optional expiry date/time in ISO format, for example 2026-12-31T23:59:00Z. Leave blank for no expiry:','');
        if (expiry === null) return;
        try {
          await api(`/api/access-requests/${encodeURIComponent(request.id)}`,{method:'PATCH',body:JSON.stringify({status:'Approved',expiresAt:expiry.trim()||null})});
          notice('Access request approved.','success'); loadAccessRequests(); loadDocuments();
        } catch(error) { notice(error.message,'error'); }
      }));
      actions.append(button('Reject', async () => {
        try {
          await api(`/api/access-requests/${encodeURIComponent(request.id)}`,{method:'PATCH',body:JSON.stringify({status:'Rejected'})});
          notice('Access request rejected.','success'); loadAccessRequests();
        } catch(error) { notice(error.message,'error'); }
      }));
      card.append(actions); list.append(card);
    }
  } catch(error) { list.replaceChildren(el('p','',error.message)); }
}
function showSignedOut() {
  activeUser = null;
  csrfToken = '';
  $('topbar-user').hidden = true;
  $('notifications-panel').hidden = true;
  setNotificationCount(0);
  $('auth-panel').hidden = false;
  $('app-panel').hidden = true;
  showRoleSelection();
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
      card.append(el('p', '', `Owner: ${doc.ownerName} · Visibility: ${doc.visibility || 'Private'} · Access: ${doc.accessPermission} · ${Math.ceil(doc.size / 1024)} KB`));
      card.append(el('p', '', `Added: ${new Date(doc.createdAt).toLocaleString()}`));
      const actions = el('div', 'document-actions');
      if (['Owner','Read','Download','Edit'].includes(doc.accessPermission)) actions.append(button('View', () => {
        window.open(`/api/documents/${encodeURIComponent(doc.id)}/content`, '_blank', 'noopener');
      }));
      if (['Owner','Download','Edit'].includes(doc.accessPermission)) actions.append(button('Download', async () => {
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
      if (doc.visibility === 'Public' && doc.accessPermission === 'Public listing') {
        actions.append(button('Request read access', async () => {
          try {
            await api(`/api/documents/${encodeURIComponent(doc.id)}/requests`, {
              method: 'POST', body: JSON.stringify({ permission: 'Read' })
            });
            notice('Read access request sent to the document owner.', 'success');
          } catch (error) { notice(error.message, 'error'); }
        }));
        actions.append(button('Request download access', async () => {
          try {
            await api(`/api/documents/${encodeURIComponent(doc.id)}/requests`, {
              method: 'POST', body: JSON.stringify({ permission: 'Download' })
            });
            notice('Download access request sent to the document owner.', 'success');
          } catch (error) { notice(error.message, 'error'); }
        }));
      }
      if (['Owner','Edit'].includes(doc.accessPermission)) {
        actions.append(button('Edit details', async () => {
          const name = window.prompt('Document name:', doc.name);
          if (name === null) return;
          const category = window.prompt('Document category:', doc.category || 'General');
          if (category === null) return;
          try {
            await api(`/api/documents/${encodeURIComponent(doc.id)}`, {
              method:'PATCH', body:JSON.stringify({name:name.trim(),category:category.trim()})
            });
            notice('Document details updated.','success');
            loadDocuments();
          } catch(error) { notice(error.message,'error'); }
        }));
      }
      if (doc.accessPermission === 'Owner') {
        actions.append(button('Delete document', async () => {
          if (!window.confirm(`Delete "${doc.name}"? This hides it from normal document listings.`)) return;
          try {
            await api(`/api/documents/${encodeURIComponent(doc.id)}`,{method:'DELETE',body:'{}'});
            notice('Document deleted.','success');
            loadDocuments();
          } catch(error) { notice(error.message,'error'); }
        }));
        actions.append(button('Share access', async () => {
          const email = window.prompt('Enter the registered email address to share with:');
          if (!email) return;
          const permission = window.prompt('Enter permission: Read, Download, or Edit', 'Read');
          if (!permission) return;
          const expiresAt = window.prompt('Optional expiry in ISO format, for example 2026-12-31T23:59:00Z. Leave blank for no expiry:', '');
          if (expiresAt === null) return;
          try {
            await api(`/api/documents/${encodeURIComponent(doc.id)}/permissions`, {
              method: 'POST', body: JSON.stringify({ email: email.trim(), permission: permission.trim(), expiresAt: expiresAt.trim() || null })
            });
            notice('Access granted. The recipient can access the document on their next request.', 'success');
            loadDocuments();
          } catch (error) { notice(error.message, 'error'); }
        }));
        actions.append(button('Manage access', async () => {
          try {
            const data = await api(`/api/documents/${encodeURIComponent(doc.id)}/permissions`);
            if (!data.permissions.length) { notice('No access grants exist for this document.'); return; }
            const lines = data.permissions.map(p => `${p.email} | ${p.permission} | ${p.revoked_at ? 'revoked' : (p.expires_at && Date.parse(p.expires_at) <= Date.now() ? 'expired' : 'active')} | expiry: ${p.expires_at || 'none'}`).join('\n');
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
document.querySelectorAll('[data-role]').forEach(option => option.addEventListener('click', () => showLoginForRole(option.dataset.role)));
$('change-role').addEventListener('click', showRoleSelection);
$('back-button').addEventListener('click', () => {
  if (window.history.length > 1) window.history.back();
  else showRoleSelection();
});

document.querySelectorAll('[data-password-toggle]').forEach(toggle => {
  toggle.addEventListener('click', () => {
    const input = $(toggle.dataset.passwordToggle);
    if (!input) return;
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(reveal));
    toggle.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
    toggle.setAttribute('title', reveal ? 'Hide password' : 'Show password');
  });
});
$('show-signup').addEventListener('click', showSignup);
$('show-login').addEventListener('click', () => showLoginForRole(selectedRole || 'Viewer'));
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  notice('');
  clearFeedback('email-status','password-status','login-mfa-status','login-status');
  if (!selectedRole) { fieldFeedback('login-status','Choose a role before signing in.','error'); return; }
  const form = new FormData(event.currentTarget);
  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password'), role: selectedRole, mfaCode: form.get('mfaCode') })
    });
    showAuthenticated(data.user, data.csrfToken);
  } catch (error) {
    fieldFeedback(loginErrorTarget(error.message), error.message, 'error');
  }
});
$('signup-form').addEventListener('submit', async event => {
  event.preventDefault();
  notice('');
  if (!['DocumentOwner','Viewer'].includes(selectedRole)) { notice('Choose Document Owner or Viewer to create an account.', 'error'); return; }
  const form = new FormData(event.currentTarget);
  try {
    const email = String(form.get('email') || '').trim();
    const data = await api('/api/auth/signup', { method: 'POST', body: JSON.stringify({
      name: String(form.get('name') || '').trim(),
      email,
      password: form.get('password'),
      role: selectedRole
    }) });
    event.currentTarget.reset();
    showLoginForRole(selectedRole);
    $('email').value = email;
    notice(data.approvalStatus === 'Pending' ? 'Owner registration request submitted. You can sign in after an administrator approves your account.' : 'Account created. Sign in with your new email and password.', 'success');
  } catch (error) {
    const target = /email|already|account exists/i.test(error.message) ? 'signup-email-status' :
      /password/i.test(error.message) ? 'signup-password-status' : 'signup-status';
    fieldFeedback(target, error.message, 'error');
  }
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
  fieldFeedback('upload-status','');
  if (!file) { fieldFeedback('upload-status','Choose a file first.','error'); return; }
  const data = new FormData();
  data.append('file', file);
  data.append('category', $('document-category').value.trim() || 'General');
  data.append('visibility', $('document-visibility').value);
  try {
    await api('/api/documents', { method: 'POST', body: data });
    event.currentTarget.reset();
    $('document-category').value = 'General';
    fieldFeedback('upload-status','Document uploaded successfully.','success');
    loadDocuments();
  } catch (error) { fieldFeedback('upload-status',error.message,'error'); }
});
$('refresh-button').addEventListener('click', loadDocuments);
$('notifications-toggle').addEventListener('click',()=>toggleNotifications());
$('notifications-refresh').addEventListener('click',()=>loadNotifications(true));
$('audit-refresh').addEventListener('click', async () => {
  try {
    const data = await api('/api/audit');
    $('audit-output').textContent = JSON.stringify(data.events, null, 2);
  } catch (error) { notice(error.message, 'error'); }
});
$('users-refresh').addEventListener('click', async () => {
  const list=$('user-list');
  list.replaceChildren(el('p','muted','Loading accounts…'));
  try {
    const data=await api('/api/users');
    list.replaceChildren();
    for(const user of data.users){
      const card=el('article','document-item');
      card.append(el('h3','',user.display_name));
      card.append(el('p','',user.email));
      card.append(el('p','muted',`Role: ${user.role} · Account: ${user.disabled?'Disabled':'Active'} · ${user.role==='DocumentOwner'?'Approval: '+(user.approval_status||'Approved')+' · ':''}Created: ${new Date(user.created_at).toLocaleString()}`));
      if(user.role==='DocumentOwner' && user.approval_status==='Pending'){
        const reviewActions=el('div','document-actions');
        reviewActions.append(button('Approve owner request',async()=>{
          if(!window.confirm(`Approve Document Owner account for ${user.email}?`)) return;
          try{await api(`/api/users/${encodeURIComponent(user.id)}`,{method:'PATCH',body:JSON.stringify({approvalStatus:'Approved'})});notice('Document Owner account approved.','success');$('users-refresh').click();}
          catch(error){notice(error.message,'error');}
        }));
        reviewActions.append(button('Reject owner request',async()=>{
          if(!window.confirm(`Reject Document Owner account for ${user.email}?`)) return;
          try{await api(`/api/users/${encodeURIComponent(user.id)}`,{method:'PATCH',body:JSON.stringify({approvalStatus:'Rejected'})});notice('Document Owner request rejected.','success');$('users-refresh').click();}
          catch(error){notice(error.message,'error');}
        }));
        card.append(reviewActions);
      }
      if(user.id!==activeUser.id){
        card.append(button(user.disabled?'Re-enable account':'Disable account',async()=>{
          const action=user.disabled?'re-enable':'disable';
          if(!window.confirm(`${action} ${user.email}?`)) return;
          try{
            await api(`/api/users/${encodeURIComponent(user.id)}`,{method:'PATCH',body:JSON.stringify({disabled:!user.disabled})});
            notice(`Account ${user.disabled?'enabled':'disabled'}.`,'success');
            $('users-refresh').click();
          }catch(error){notice(error.message,'error');}
        }));
      }
      list.append(card);
    }
    if(!data.users.length) list.append(el('p','muted','No accounts found.'));
  }catch(error){list.replaceChildren(el('p','',error.message));notice(error.message,'error');}
});
$('mfa-enroll-button').addEventListener('click', async () => {
  try {
    const data = await api('/api/admin/mfa/enroll',{method:'POST',body:JSON.stringify({password:$('mfa-current-password').value})});
    $('mfa-current-password').value = '';
    $('mfa-secret-value').textContent = data.secret;
    $('mfa-otpauth-uri').textContent = data.otpauthUri;
    $('mfa-enroll-details').hidden = false;
    notice('Add the secret to your authenticator app, then enter the current 6-digit code.','success');
  } catch(error) { notice(error.message,'error'); }
});
$('mfa-verify-form').addEventListener('submit', async event => {
  event.preventDefault();
  fieldStatus('mfa-status','');
  try {
    await api('/api/admin/mfa/verify',{method:'POST',body:JSON.stringify({code:$('mfa-verify-code').value.trim()})});
    const data = await api('/api/auth/me');
    showAuthenticated(data.user,data.csrfToken);
    fieldStatus('mfa-status','Administrator MFA is enabled. Future sign-ins require an authenticator code.','success');
  } catch(error) { fieldStatus('mfa-status',error.message,'error'); }
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

setInterval(() => { if(activeUser) loadNotifications(!$('notifications-panel').hidden); }, 30000);
