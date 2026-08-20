/**
 * VCTM Foundly - Production Campus Lost & Found Client Application.
 * Full-featured: Dual Auth Token/Cookie, Auto Smart Matching, Direct Contacts, In-App Chat,
 * Photo Canvas Optimizer, Item Lifecycle, and Admin CSV Tools.
 */

let items = [];
let currentUser = null;
let currentFilter = 'All';
let currentStatusFilter = 'Open';
let currentCategoryFilter = 'All';
let reportType = 'Lost';
let authMode = 'login';
let currentDetailItem = null;
let currentUploadedImageBase64 = null;

// DOM Elements
const grid = document.querySelector('#itemsGrid');
const searchInput = document.querySelector('#searchInput');
const clearSearchBtn = document.querySelector('#clearSearch');
const categoryFilter = document.querySelector('#categoryFilter');
const statusFilter = document.querySelector('#statusFilter');
const toast = document.querySelector('#toast');

// Dialog Elements
const reportDialog = document.querySelector('#reportDialog');
const reportForm = document.querySelector('#reportForm');
const itemDetailDialog = document.querySelector('#itemDetailDialog');
const authDialog = document.querySelector('#authDialog');
const authForm = document.querySelector('#authForm');
const resetPasswordDialog = document.querySelector('#resetPasswordDialog');
const resetPasswordForm = document.querySelector('#resetPasswordForm');
const connectDialog = document.querySelector('#connectDialog');
const connectForm = document.querySelector('#connectForm');
const connectionsDialog = document.querySelector('#connectionsDialog');
const myReportsDialog = document.querySelector('#myReportsDialog');
const adminDialog = document.querySelector('#adminDialog');

// Photo Upload Elements
const photoDropzone = document.querySelector('#photoDropzone');
const photoInput = document.querySelector('#photoInput');
const dropzonePrompt = document.querySelector('#dropzonePrompt');
const photoPreviewBox = document.querySelector('#photoPreviewBox');
const photoPreviewImg = document.querySelector('#photoPreviewImg');
const removePhotoBtn = document.querySelector('#removePhotoBtn');

// Helper: Escape HTML strings
const escapeHtml = (str) =>
  String(str ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[c]));

// Helper: Unified API Fetcher with Dual Token/Cookie Auth
const api = async (path, options = {}) => {
  const token = localStorage.getItem('foundly_token');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    credentials: 'include',
    headers,
    ...options,
  });

  if (response.headers.get('Content-Type')?.includes('text/csv')) {
    return response.blob();
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    data = { error: `Server error (${response.status})` };
  }

  if (!response.ok) {
    const errorMsg = data.detail || data.error || 'Something went wrong. Please try again.';
    throw new Error(errorMsg);
  }
  return data;
};

// Helper: Toast Notifications
const notify = (msg) => {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(notify._timer);
  notify._timer = setTimeout(() => toast.classList.remove('show'), 3500);
};

// Helper: Category Emoji Mapping
const categoryEmoji = (cat) =>
  ({
    Electronics: '💻',
    Accessories: '👜',
    Keys: '🔑',
    Documents: '🪪',
    Clothing: '🧥',
    'Books & stationery': '📘',
    Jewellery: '💍',
    'Sports & fitness': '🏏',
    Other: '📦',
  }[cat] || '📦');

// Helper: Category Tone Class
const categoryTone = (cat) =>
  ({
    Electronics: 'tone-b',
    Accessories: 'tone-a',
    Keys: 'tone-c',
    Documents: 'tone-d',
    Clothing: 'tone-d',
    'Books & stationery': 'tone-b',
    Jewellery: 'tone-c',
    'Sports & fitness': 'tone-c',
  }[cat] || 'tone-a');

// Client-side image resizing & compression (max 1000px, <400KB)
function processImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    notify('Please select a valid image file (JPG, PNG, WebP).');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    notify('Image file is too large (maximum 8MB).');
    return;
  }

  const reader = new FileReader();
  reader.onload = (event) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1000;
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      currentUploadedImageBase64 = dataUrl;
      photoPreviewImg.src = dataUrl;
      dropzonePrompt.classList.add('hidden');
      photoPreviewBox.classList.remove('hidden');
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function clearPhotoUpload() {
  currentUploadedImageBase64 = null;
  if (photoInput) photoInput.value = '';
  if (photoPreviewImg) photoPreviewImg.src = '';
  if (dropzonePrompt) dropzonePrompt.classList.remove('hidden');
  if (photoPreviewBox) photoPreviewBox.classList.add('hidden');
}

// Photo dropzone listeners (without dismissing modal)
if (photoDropzone && photoInput) {
  photoDropzone.addEventListener('click', (e) => {
    if (e.target.id === 'removePhotoBtn' || e.target.closest('#removePhotoBtn')) {
      return;
    }
    photoInput.click();
  });

  photoInput.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  photoInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      processImageFile(e.target.files[0]);
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    photoDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      photoDropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    photoDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      photoDropzone.classList.remove('dragover');
    });
  });

  photoDropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt.files && dt.files[0]) {
      processImageFile(dt.files[0]);
    }
  });
}

if (removePhotoBtn) {
  removePhotoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearPhotoUpload();
  });
}

// Render Item Cards
function renderItems() {
  if (!grid) return;
  const q = (searchInput?.value || '').trim().toLowerCase();

  const filtered = items.filter((i) => {
    const matchType = currentFilter === 'All' || i.type === currentFilter;
    const matchCat = currentCategoryFilter === 'All' || i.category === currentCategoryFilter;
    const matchStatus =
      currentStatusFilter === 'All'
        ? true
        : currentStatusFilter === 'Open'
        ? i.status === 'Open' || !i.status
        : i.status === currentStatusFilter;
    const searchTarget = `${i.name} ${i.category} ${i.location} ${i.description || ''}`.toLowerCase();
    const matchSearch = !q || searchTarget.includes(q);
    return matchType && matchCat && matchStatus && matchSearch;
  });

  if (clearSearchBtn) {
    clearSearchBtn.classList.toggle('hidden', !q);
  }

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="empty">
        <p style="font-size: 28px; margin-bottom: 8px;">🔍</p>
        <b>No matching reports found</b>
        <p style="margin-top: 5px;">Try adjusting your search terms or filters, or be the first to report this item.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered
    .map((i) => {
      const isResolved = i.status === 'Resolved';
      const hasImage = !!i.image_data;
      const mediaHtml = hasImage
        ? `<img src="${i.image_data}" alt="${escapeHtml(i.name)}" loading="lazy" />`
        : `<span>${categoryEmoji(i.category)}</span>`;

      return `
      <article class="item-card ${isResolved ? 'is-resolved' : ''}" data-item-id="${i.id}">
        <div class="card-image ${i.type.toLowerCase()} ${categoryTone(i.category)}">
          ${mediaHtml}
          <span class="card-status-badge ${isResolved ? 'resolved' : 'open'}">
            ${isResolved ? 'RESOLVED' : 'ACTIVE'}
          </span>
        </div>
        <div class="card-content">
          <p class="category">${escapeHtml(i.category.toUpperCase())}</p>
          <h3>${escapeHtml(i.name)}</h3>
          <div class="card-meta">
            <span>⌖ ${escapeHtml(i.location)}</span>
            <span>${i.date || ''}</span>
          </div>
        </div>
        <div class="item-action">
          <span>View Details & Connect</span>
          <strong>→</strong>
        </div>
      </article>
    `;
    })
    .join('');
}

// Load items from backend
async function loadItems() {
  try {
    const data = await api('/api/items');
    items = data.items || [];
    renderItems();
  } catch (err) {
    console.error('Failed to load items:', err);
  }
}

// Open Item Details Modal
function openItemDetail(itemId) {
  const item = items.find((x) => x.id === itemId);
  if (!item) return;
  currentDetailItem = item;

  document.querySelector('#detailTypeBadge').textContent = item.type.toUpperCase();
  document.querySelector('#detailTypeBadge').className = `pill-badge ${item.type === 'Found' ? 'found-pill' : ''}`;

  const isResolved = item.status === 'Resolved';
  const statusBadge = document.querySelector('#detailStatusBadge');
  statusBadge.textContent = isResolved ? 'RESOLVED / RETURNED' : 'ACTIVE LISTING';
  statusBadge.className = `pill-badge ${isResolved ? 'status-resolved' : 'status-open'}`;

  document.querySelector('#detailCategoryBadge').textContent = item.category.toUpperCase();
  document.querySelector('#detailTitle').textContent = item.name;
  document.querySelector('#detailLocation').textContent = item.location;
  document.querySelector('#detailDate').textContent = item.date || item.created_at || '';
  document.querySelector('#detailReporter').textContent = item.owner_name || 'Campus Member';
  document.querySelector('#detailRole').textContent = item.owner_role || 'Verified';
  document.querySelector('#detailDescription').textContent = item.description || 'No additional description provided.';

  // Photo Display
  const imgElem = document.querySelector('#detailImg');
  const emojiElem = document.querySelector('#detailEmojiBox');
  if (item.image_data) {
    imgElem.src = item.image_data;
    imgElem.classList.remove('hidden');
    emojiElem.classList.add('hidden');
  } else {
    imgElem.classList.add('hidden');
    emojiElem.classList.remove('hidden');
    emojiElem.textContent = categoryEmoji(item.category);
  }

  // Secret Proof Question Box
  const proofBox = document.querySelector('#detailProofBox');
  if (item.proof_question && item.proof_question.trim()) {
    proofBox.classList.remove('hidden');
    document.querySelector('#detailProofQuestion').textContent = item.proof_question;
  } else {
    proofBox.classList.add('hidden');
  }

  // Action Buttons
  const actionsBox = document.querySelector('#detailActions');
  const isOwner = currentUser && (currentUser.id === item.owner_id || currentUser.email === item.owner_email);
  const isAdmin = currentUser && currentUser.role === 'admin';

  if (isOwner || isAdmin) {
    actionsBox.innerHTML = `
      <button class="button button-secondary button-sm" id="btnToggleStatus">
        ${isResolved ? '↺ Reopen Listing' : '✓ Mark as Resolved / Handed Over'}
      </button>
      <button class="button button-danger button-sm" id="btnDeleteItem">
        🗑 Delete Report
      </button>
    `;

    document.querySelector('#btnToggleStatus')?.addEventListener('click', async () => {
      try {
        const nextStatus = isResolved ? 'Open' : 'Resolved';
        await api(`/api/items/${item.id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: nextStatus }),
        });
        itemDetailDialog.close();
        await loadItems();
        notify(`Item marked as ${nextStatus.toLowerCase()}.`);
      } catch (e) {
        notify(e.message);
      }
    });

    document.querySelector('#btnDeleteItem')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to permanently delete this report?')) {
        try {
          await api(`/api/items/${item.id}`, { method: 'DELETE' });
          itemDetailDialog.close();
          await loadItems();
          notify('Report deleted successfully.');
        } catch (e) {
          notify(e.message);
        }
      }
    });
  } else {
    actionsBox.innerHTML = `
      <button class="button button-primary" id="btnClaimItem">
        💬 Contact Reporter & ${item.type === 'Found' ? 'Claim Item' : 'Offer Help'} <span>→</span>
      </button>
    `;
    document.querySelector('#btnClaimItem')?.addEventListener('click', () => {
      itemDetailDialog.close();
      openConnection(item.id);
    });
  }

  itemDetailDialog.showModal();
}

// User Session Sync
function syncUser() {
  const signed = !!currentUser;
  document.querySelector('#openAuth').classList.toggle('hidden', signed);
  document.querySelector('#profileButton').classList.toggle('hidden', !signed);
  document.querySelector('#openConnections').classList.toggle('hidden', !signed);
  document.querySelector('#openMyReports').classList.toggle('hidden', !signed);

  if (signed) {
    document.querySelector('#profileName').textContent = currentUser.name;
    document.querySelector('#profileRole').textContent =
      currentUser.role === 'admin' ? 'Administrator' : currentUser.campus_role;
    document.querySelector('#avatarInitials').textContent = currentUser.name
      .split(' ')
      .map((x) => x[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }
}

// Update Notification Badge
async function checkPendingUpdates() {
  if (!currentUser) return;
  try {
    const data = await api('/api/session');
    if (data.user) {
      currentUser = data.user;
      syncUser();
    }
    const count = data.pending_count || 0;
    const navBadge = document.querySelector('#navConnBadge');
    const notifDot = document.querySelector('#notifDot');

    if (count > 0) {
      if (navBadge) {
        navBadge.textContent = count;
        navBadge.classList.remove('hidden');
      }
      if (notifDot) notifDot.classList.remove('hidden');
    } else {
      if (navBadge) navBadge.classList.add('hidden');
      if (notifDot) notifDot.classList.add('hidden');
    }
  } catch (e) {
    // Silent fail for polling
  }
}

// Report Form Type Handler
function setType(type) {
  reportType = type;
  document.querySelectorAll('.type-choice').forEach((b) =>
    b.classList.toggle('active', b.dataset.type === type)
  );
  document.querySelector('#modalTitle').textContent = `Report a ${type.toLowerCase()} item`;
  document.querySelector('#submitReport').innerHTML = `Publish ${type.toLowerCase()} report <span>→</span>`;
}

function openReport(type) {
  if (!currentUser) {
    authDialog.showModal();
    notify('Please sign in to publish a report.');
    return;
  }
  setType(type);
  clearPhotoUpload();
  const dateInput = reportForm.querySelector('input[name="date"]');
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }
  reportDialog.showModal();
}

// Auth Tab Switching
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((b) =>
    b.classList.toggle('active', b.dataset.authMode === mode)
  );
  document.querySelectorAll('.signup-field').forEach((x) =>
    x.classList.toggle('show', mode === 'signup')
  );
  document.querySelector('#authForm button[type="submit"]').innerHTML = `${
    mode === 'login' ? 'Sign in' : 'Create account'
  } <span>→</span>`;
  document.querySelector('#authError').textContent = '';
}

// Open Safe Connection Dialog
function openConnection(itemId) {
  if (!currentUser) {
    authDialog.showModal();
    notify('Please sign in to contact the reporter.');
    return;
  }
  const item = items.find((x) => x.id === itemId);
  if (!item) return;

  connectForm.itemId.value = itemId;

  const proofPrompt = document.querySelector('#connectProofPrompt');
  if (item.proof_question && item.proof_question.trim()) {
    proofPrompt.classList.remove('hidden');
    document.querySelector('#connectProofQuestionText').textContent = item.proof_question;
  } else {
    proofPrompt.classList.add('hidden');
  }

  connectDialog.showModal();
}

// Connections & Direct Contact Modal
async function openConnections() {
  if (!currentUser) {
    authDialog.showModal();
    return;
  }
  try {
    const list = (await api('/api/connections')).connections;
    const isMine = (c) => c.recipient_id === currentUser.id || c.recipient_email === currentUser.email;

    const card = (c, incoming) => {
      const isAccepted = c.status === 'Accepted';
      const isMatched = c.status === 'Matched';
      const otherName = incoming ? c.sender_name : c.recipient_name;
      const otherRole = incoming ? c.sender_role : c.recipient_role;
      const otherEmail = incoming ? c.sender_email : c.recipient_email;
      const otherPhone = incoming ? c.sender_phone : c.recipient_phone;

      return `
        <article class="connection-card" data-conn-id="${c.id}">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              ${isMatched ? '<span class="match-tag">⚡ AUTOMATIC MATCH</span>' : ''}
              <h3>${escapeHtml(c.item_name)} (${escapeHtml(c.item_type || 'Report')})</h3>
            </div>
            <small style="color: var(--muted);">${new Date(c.created_at + 'Z').toLocaleDateString()}</small>
          </div>
          <small>${
            incoming
              ? `From: <b>${escapeHtml(otherName)}</b> (${escapeHtml(otherRole || 'Campus Member')})`
              : `To: <b>${escapeHtml(otherName)}</b>`
          }</small>
          <p style="white-space: pre-wrap;">${escapeHtml(c.message)}</p>
          
          ${
            incoming && c.status === 'Pending'
              ? `
            <div class="connection-actions">
              <button class="accept-request" data-request-action="Accepted" data-request-id="${c.id}">✓ Accept & Share Contacts</button>
              <button class="decline-request" data-request-action="Declined" data-request-id="${c.id}">Decline</button>
            </div>
          `
              : `
            <span class="request-status ${isAccepted ? 'accepted' : isMatched ? 'matched' : ''}">
              Status: ${escapeHtml(c.status)}
            </span>
            ${
              isAccepted || isMatched
                ? `
              <div class="contact-revealed">
                🤝 <b>Verified Contacts Revealed:</b>
                <div class="contact-quick-buttons">
                  <a class="btn-contact-action mail" href="mailto:${escapeHtml(otherEmail)}?subject=VCTM Foundly: ${encodeURIComponent(c.item_name)}">
                    ✉️ Email: ${escapeHtml(otherEmail)}
                  </a>
                  ${
                    otherPhone
                      ? `<a class="btn-contact-action tel" href="tel:${escapeHtml(otherPhone)}">📞 Call: ${escapeHtml(otherPhone)}</a>`
                      : ''
                  }
                </div>
                <div class="connection-reply-box">
                  <input type="text" placeholder="Type a quick message..." class="reply-msg-input" data-reply-conn-id="${c.id}" />
                  <button type="button" class="btn-send-reply" data-reply-conn-id="${c.id}">Send 💬</button>
                </div>
              </div>
            `
                : ''
            }
          `
          }
        </article>
      `;
    };

    const received = list.filter(isMine);
    const sent = list.filter((c) => !isMine(c));

    const connectionsList = document.querySelector('#connectionsList');
    connectionsList.innerHTML =
      received.length || sent.length
        ? `
      ${
        received.length
          ? `<p class="eyebrow" style="margin-top: 14px;"><span></span> INCOMING REQUESTS & MATCHES (${received.length})</p>${received.map((c) => card(c, true)).join('')}`
          : ''
      }
      ${
        sent.length
          ? `<p class="eyebrow" style="margin-top: 24px;"><span></span> SENT REQUESTS (${sent.length})</p>${sent.map((c) => card(c, false)).join('')}`
          : ''
      }
    `
        : '<p class="empty">No active connections yet. Browse items and click "View Details & Connect" to send a message.</p>';

    connectionsDialog.showModal();
    checkPendingUpdates();
  } catch (e) {
    notify(e.message);
  }
}

// My Reports Modal
async function openMyReports() {
  if (!currentUser) {
    authDialog.showModal();
    return;
  }
  try {
    const data = await api('/api/user/items');
    const userItems = data.items || [];
    const container = document.querySelector('#myReportsList');

    if (!userItems.length) {
      container.innerHTML = '<p class="empty">You have not published any lost or found reports yet.</p>';
    } else {
      container.innerHTML = userItems
        .map((it) => {
          const isResolved = it.status === 'Resolved';
          const itDate = it.date || it.item_date || (it.created_at ? new Date(it.created_at + 'Z').toLocaleDateString() : 'Recent');
          return `
          <article class="my-report-card">
            <div class="my-report-info">
              <b>${escapeHtml(it.name)} (${escapeHtml(it.type)})</b>
              <small>⌖ ${escapeHtml(it.location)} · ${escapeHtml(itDate)} · 💬 ${it.connections_count || 0} claims/matches</small>
            </div>
            <div class="my-report-actions">
              <button class="button button-sm button-secondary" data-my-toggle-id="${it.id}" data-current-status="${it.status}">
                ${isResolved ? '↺ Reopen' : '✓ Resolve'}
              </button>
              <button class="button button-sm button-danger" data-my-delete-id="${it.id}">
                🗑
              </button>
            </div>
          </article>
        `;
        })
        .join('');
    }

    myReportsDialog.showModal();
  } catch (e) {
    notify(e.message);
  }
}

// Admin Console Modal
async function openAdmin() {
  try {
    const data = await api('/api/admin/overview');
    document.querySelector('#adminItemCount').textContent = data.stats.reports;
    document.querySelector('#adminLostCount').textContent = data.stats.lost;
    document.querySelector('#adminFoundCount').textContent = data.stats.found;
    document.querySelector('#adminResolvedCount').textContent = data.stats.resolved || 0;
    document.querySelector('#adminUserCount').textContent = data.stats.users || 0;
    document.querySelector('#adminConnCount').textContent = data.stats.connections || 0;

    document.querySelector('#adminReports').innerHTML = data.items
      .map(
        (i) => `
        <article class="admin-row">
          <div>
            <b>${escapeHtml(i.name)}</b>
            <small>${escapeHtml(i.category)} · ${escapeHtml(i.location)} · Reported by ${escapeHtml(i.owner_name)}</small>
          </div>
          <em class="${i.type.toLowerCase()}">${i.type.toUpperCase()}</em>
          <span class="pill-badge ${i.status === 'Resolved' ? 'status-resolved' : 'status-open'}">${i.status || 'Open'}</span>
          <button class="text-link danger-link" data-admin-delete="${i.id}">Delete</button>
        </article>
      `
      )
      .join('');

    adminDialog.showModal();
  } catch (e) {
    notify(e.message);
  }
}

// -------------------------------------------------------------
// EVENT LISTENERS
// -------------------------------------------------------------

// Quick and hero report buttons
document.querySelectorAll('[data-open-report]').forEach((b) =>
  b.addEventListener('click', () => openReport(b.dataset.openReport))
);

document.querySelectorAll('.type-choice').forEach((b) =>
  b.addEventListener('click', () => setType(b.dataset.type))
);

// Filters
document.querySelectorAll('.filter[data-filter]').forEach((b) =>
  b.addEventListener('click', () => {
    currentFilter = b.dataset.filter;
    document.querySelectorAll('.filter[data-filter]').forEach((x) =>
      x.classList.toggle('active', x === b)
    );
    renderItems();
  })
);

if (searchInput) searchInput.addEventListener('input', renderItems);
if (clearSearchBtn) {
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    renderItems();
  });
}
if (categoryFilter) {
  categoryFilter.addEventListener('change', (e) => {
    currentCategoryFilter = e.target.value;
    renderItems();
  });
}
if (statusFilter) {
  statusFilter.addEventListener('change', (e) => {
    currentStatusFilter = e.target.value;
    renderItems();
  });
}

// Grid item click -> open detail modal
if (grid) {
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-item-id]');
    if (card) openItemDetail(Number(card.dataset.itemId));
  });
}

// Item detail modal close
document.querySelector('#closeItemDetail')?.addEventListener('click', () => itemDetailDialog.close());

// Report Form Submit
if (reportForm) {
  reportForm.addEventListener('submit', async (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const d = new FormData(reportForm);
    try {
      await api('/api/items', {
        method: 'POST',
        body: JSON.stringify({
          name: d.get('name'),
          category: d.get('category'),
          location: d.get('location'),
          date: d.get('date'),
          description: d.get('description'),
          proof_question: d.get('proof_question'),
          image_data: currentUploadedImageBase64,
          type: reportType,
        }),
      });
      reportDialog.close();
      reportForm.reset();
      clearPhotoUpload();
      await loadItems();
      checkPendingUpdates();
      notify('Your report is live! We will notify you instantly if a match is found.');
    } catch (err) {
      notify(err.message);
    }
  });
}

// Auth Dialog handlers
document.querySelector('#openAuth')?.addEventListener('click', () => authDialog.showModal());
document.querySelector('.auth-close')?.addEventListener('click', () => authDialog.close());
document.querySelector('#closeAuthBtn')?.addEventListener('click', () => authDialog.close());
document.querySelector('#authBackBtn')?.addEventListener('click', () => authDialog.close());
document.querySelectorAll('.auth-tab').forEach((b) =>
  b.addEventListener('click', () => setAuthMode(b.dataset.authMode))
);

// Click-outside (backdrop click) to close dialogs without breaking inner elements
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) {
      dlg.close();
    }
  });
});

if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = new FormData(authForm);
    const errElem = document.querySelector('#authError');
    errElem.textContent = '';
    try {
      const payload =
        authMode === 'signup'
          ? {
              name: d.get('fullName'),
              campus_role: d.get('campusRole'),
              phone: d.get('phone'),
              email: d.get('email'),
              password: d.get('password'),
            }
          : {
              email: d.get('email'),
              password: d.get('password'),
            };

      const res = await api(authMode === 'signup' ? '/api/register' : '/api/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.token) {
        localStorage.setItem('foundly_token', res.token);
      }
      currentUser = res.user;
      authDialog.close();
      authForm.reset();
      syncUser();
      notify(`Welcome, ${currentUser.name}!`);
      checkPendingUpdates();
      if (currentUser.role === 'admin') openAdmin();
    } catch (err) {
      errElem.textContent = err.message;
      if (err.message.includes('Create account')) {
        setTimeout(() => setAuthMode('signup'), 1500);
      }
    }
  });
}

// Password Reset Dialog
document.querySelector('#openForgotPass')?.addEventListener('click', () => {
  authDialog.close();
  resetPasswordDialog.showModal();
});

if (resetPasswordForm) {
  resetPasswordForm.addEventListener('submit', async (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const d = new FormData(resetPasswordForm);
    const errElem = document.querySelector('#resetPassError');
    try {
      const res = await api('/api/password/reset', {
        method: 'POST',
        body: JSON.stringify({
          email: d.get('resetEmail'),
          new_password: d.get('newPassword'),
        }),
      });
      resetPasswordDialog.close();
      resetPasswordForm.reset();
      notify(res.message || 'Password updated. You may now sign in.');
      authDialog.showModal();
    } catch (err) {
      errElem.textContent = err.message;
    }
  });
}

// Connect Form Submit
if (connectForm) {
  connectForm.addEventListener('submit', async (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    try {
      await api('/api/connections', {
        method: 'POST',
        body: JSON.stringify({
          item_id: Number(connectForm.itemId.value),
          message: connectForm.message.value,
        }),
      });
      connectDialog.close();
      connectForm.reset();
      notify('Message & claim request sent to the reporter.');
    } catch (err) {
      notify(err.message);
    }
  });
}

// Navigation buttons
document.querySelector('#openConnections')?.addEventListener('click', openConnections);
document.querySelector('#closeConnections')?.addEventListener('click', () => connectionsDialog.close());

document.querySelector('#openMyReports')?.addEventListener('click', openMyReports);
document.querySelector('#quickMyReports')?.addEventListener('click', openMyReports);
document.querySelector('#closeMyReports')?.addEventListener('click', () => myReportsDialog.close());

// Action on Connections List (Accept / Decline / Send Chat Message)
document.querySelector('#connectionsList')?.addEventListener('click', async (e) => {
  const actionBtn = e.target.closest('[data-request-action]');
  if (actionBtn) {
    try {
      await api(`/api/connections/${actionBtn.dataset.requestId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: actionBtn.dataset.requestAction }),
      });
      notify(`Request ${actionBtn.dataset.requestAction.toLowerCase()}. Contact revealed!`);
      openConnections();
    } catch (err) {
      notify(err.message);
    }
    return;
  }

  const sendReplyBtn = e.target.closest('.btn-send-reply');
  if (sendReplyBtn) {
    const connId = sendReplyBtn.dataset.replyConnId;
    const input = document.querySelector(`.reply-msg-input[data-reply-conn-id="${connId}"]`);
    const text = input?.value.trim();
    if (!text) return;
    try {
      await api(`/api/connections/${connId}/message`, {
        method: 'POST',
        body: JSON.stringify({ message: text }),
      });
      notify('Message sent!');
      openConnections();
    } catch (err) {
      notify(err.message);
    }
  }
});

// Action on My Reports List (Toggle Status / Delete)
document.querySelector('#myReportsList')?.addEventListener('click', async (e) => {
  const toggleBtn = e.target.closest('[data-my-toggle-id]');
  if (toggleBtn) {
    const itemId = toggleBtn.dataset.myToggleId;
    const current = toggleBtn.dataset.currentStatus;
    const nextStatus = current === 'Resolved' ? 'Open' : 'Resolved';
    try {
      await api(`/api/items/${itemId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });
      notify(`Report marked as ${nextStatus.toLowerCase()}.`);
      await loadItems();
      openMyReports();
    } catch (err) {
      notify(err.message);
    }
    return;
  }

  const deleteBtn = e.target.closest('[data-my-delete-id]');
  if (deleteBtn) {
    if (confirm('Permanently delete this report?')) {
      try {
        await api(`/api/items/${deleteBtn.dataset.myDeleteId}`, { method: 'DELETE' });
        notify('Report deleted.');
        await loadItems();
        openMyReports();
      } catch (err) {
        notify(err.message);
      }
    }
  }
});

// User Profile & Account Dialog
const userProfileDialog = document.querySelector('#userProfileDialog');

function openUserProfile() {
  if (!currentUser) {
    authDialog.showModal();
    return;
  }
  if (currentUser.role === 'admin') {
    openAdmin();
    return;
  }

  document.querySelector('#modalProfileName').textContent = currentUser.name;
  document.querySelector('#modalProfileRole').textContent = currentUser.campus_role || 'Member';
  document.querySelector('#modalProfileEmail').textContent = currentUser.email;
  document.querySelector('#modalProfilePhone').textContent = currentUser.phone ? `📞 ${currentUser.phone}` : 'No phone number provided';
  document.querySelector('#modalAvatarInitials').textContent = currentUser.name
    .split(' ')
    .map((x) => x[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  userProfileDialog.showModal();
}

document.querySelector('#profileButton')?.addEventListener('click', openUserProfile);
document.querySelector('#closeUserProfile')?.addEventListener('click', () => userProfileDialog.close());

document.querySelector('#profileMyReportsBtn')?.addEventListener('click', () => {
  userProfileDialog.close();
  openMyReports();
});

document.querySelector('#profileConnectionsBtn')?.addEventListener('click', () => {
  userProfileDialog.close();
  openConnections();
});

async function handleSignOut() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (_) {}
  localStorage.removeItem('foundly_token');
  currentUser = null;
  userProfileDialog?.close();
  adminDialog?.close();
  syncUser();
  notify('You have been signed out.');
}

document.querySelector('#userSignOutBtn')?.addEventListener('click', handleSignOut);
document.querySelector('#signOut')?.addEventListener('click', handleSignOut);
document.querySelector('#closeAdmin')?.addEventListener('click', () => adminDialog.close());

document.querySelector('#notifications')?.addEventListener('click', () => {
  if (currentUser) openConnections();
  else notify('Please sign in to view notifications & messages.');
});

// Admin Export CSV
document.querySelector('#exportCsvBtn')?.addEventListener('click', async () => {
  try {
    const blob = await api('/api/admin/export');
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vctm-foundly-reports-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    notify('Reports exported to CSV successfully.');
  } catch (err) {
    notify(err.message);
  }
});

// Admin report deletion
document.querySelector('#adminReports')?.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-admin-delete]');
  if (!b) return;
  if (confirm('Admin: Delete this report permanently?')) {
    try {
      await api(`/api/items/${b.dataset.adminDelete}`, { method: 'DELETE' });
      notify('Report removed by administrator.');
      await loadItems();
      openAdmin();
    } catch (err) {
      notify(err.message);
    }
  }
});

// -------------------------------------------------------------
// INITIALIZATION & REAL-TIME REFRESH
// -------------------------------------------------------------
(async () => {
  try {
    const sessionData = await api('/api/session');
    currentUser = sessionData.user;
    if (!currentUser) {
      localStorage.removeItem('foundly_token');
    }
    syncUser();
    checkPendingUpdates();
    await loadItems();

    setInterval(async () => {
      await loadItems();
      checkPendingUpdates();
    }, 8000);
  } catch (e) {
    console.error('Initialization error:', e);
  }
})();
