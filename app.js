/**
 * VCTM Foundly - Enterprise Campus Lost & Found Client.
 * Tabbed Hub: Feed, Smart Matches, My Reports, Messenger Inbox, and Safe Points.
 */

let items = [];
let matches = [];
let connections = [];
let currentUser = null;
let currentFilter = 'All';
let currentStatusFilter = 'Open';
let currentCategoryFilter = 'All';
let currentTab = 'feed';
let activeChatConnectionId = null;
let reportType = 'Lost';
let authMode = 'login';
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
const connectDialog = document.querySelector('#connectDialog');
const connectForm = document.querySelector('#connectForm');
const authDialog = document.querySelector('#authDialog');
const authForm = document.querySelector('#authForm');
const userProfileDialog = document.querySelector('#userProfileDialog');
const resetPasswordDialog = document.querySelector('#resetPasswordDialog');
const resetPasswordForm = document.querySelector('#resetPasswordForm');
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

// -------------------------------------------------------------
// TAB SWITCHING & ROUTING
// -------------------------------------------------------------
function switchTab(tabId) {
  currentTab = tabId;
  document.querySelectorAll('.nav-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tabId);
  });
  document.querySelectorAll('.tab-panel').forEach((p) => {
    p.classList.toggle('active', p.id === `tab-${tabId}`);
  });

  if (tabId === 'matches') loadSmartMatches();
  if (tabId === 'my-reports') loadMyReports();
  if (tabId === 'messages') loadInbox();
  if (tabId === 'feed') renderItems();
}

document.querySelectorAll('.nav-tab[data-tab]').forEach((b) => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});
document.querySelector('#btnJumpMatches')?.addEventListener('click', () => switchTab('matches'));
document.querySelector('#brandLogo')?.addEventListener('click', (e) => {
  e.preventDefault();
  switchTab('feed');
});

// -------------------------------------------------------------
// PHOTO UPLOAD & CANVAS RESIZE
// -------------------------------------------------------------
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

if (photoDropzone && photoInput) {
  photoDropzone.addEventListener('click', (e) => {
    if (e.target.id === 'removePhotoBtn' || e.target.closest('#removePhotoBtn')) return;
    photoInput.click();
  });
  photoInput.addEventListener('click', (e) => e.stopPropagation());
  photoInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) processImageFile(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    photoDropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      photoDropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    photoDropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      photoDropzone.classList.remove('dragover');
    });
  });
  photoDropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt.files && dt.files[0]) processImageFile(dt.files[0]);
  });
}

if (removePhotoBtn) {
  removePhotoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearPhotoUpload();
  });
}

// -------------------------------------------------------------
// 1. BROWSE FEED & ITEMS RENDERING
// -------------------------------------------------------------
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
        <p style="font-size: 32px; margin-bottom: 8px;">🔍</p>
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
        <div class="card-image">
          ${mediaHtml}
          <span class="card-status-badge ${isResolved ? 'resolved' : 'open'}">
            ${isResolved ? 'RESOLVED' : i.type.toUpperCase()}
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

async function loadItems() {
  try {
    const data = await api('/api/items');
    items = data.items || [];
    renderItems();
  } catch (err) {
    console.error('Failed to load items:', err);
  }
}

// -------------------------------------------------------------
// 2. SMART MATCHES HUB
// -------------------------------------------------------------
async function loadSmartMatches() {
  const container = document.querySelector('#matchesContainer');
  if (!container) return;

  try {
    const data = await api('/api/matches');
    matches = data.matches || [];

    const badge = document.querySelector('#matchBadge');
    if (badge) {
      if (matches.length > 0) {
        badge.textContent = matches.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    if (!matches.length) {
      container.innerHTML = `
        <div class="empty">
          <p style="font-size: 32px; margin-bottom: 8px;">⚡</p>
          <b>No active match pairs currently detected</b>
          <p style="margin-top: 5px;">When a lost item and a found item share matching keywords or categories, they will appear here automatically.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = matches
      .map((m) => {
        const l = m.lost_item;
        const f = m.found_item;
        const lThumb = l.image_data ? `<img src="${l.image_data}" alt="${escapeHtml(l.name)}" />` : categoryEmoji(l.category);
        const fThumb = f.image_data ? `<img src="${f.image_data}" alt="${escapeHtml(f.name)}" />` : categoryEmoji(f.category);

        return `
        <article class="match-pair-card">
          <!-- Lost Side -->
          <div class="match-item-side">
            <div class="match-thumb">${lThumb}</div>
            <div class="match-item-details">
              <span class="pill-badge" style="background:#fdeee9; color:var(--coral);">LOST ITEM</span>
              <h4>${escapeHtml(l.name)}</h4>
              <p>⌖ ${escapeHtml(l.location)}</p>
              <small>Reported by ${escapeHtml(l.owner_name)} (${escapeHtml(l.owner_role)})</small>
            </div>
          </div>

          <!-- Center Match Meter -->
          <div class="match-center-meter">
            <span class="match-score-badge">⚡ ${m.score}% MATCH</span>
            <small style="color:var(--muted); font-size:9px;">${escapeHtml(m.reasons.join(' · '))}</small>
            <button class="button button-primary button-sm" data-match-connect-item="${f.id}" data-match-lost-id="${l.id}">
              Connect & Reclaim 💬
            </button>
          </div>

          <!-- Found Side -->
          <div class="match-item-side">
            <div class="match-thumb">${fThumb}</div>
            <div class="match-item-details">
              <span class="pill-badge" style="background:#eaf5ef; color:var(--green);">FOUND ITEM</span>
              <h4>${escapeHtml(f.name)}</h4>
              <p>⌖ ${escapeHtml(f.location)}</p>
              <small>Reported by ${escapeHtml(f.owner_name)} (${escapeHtml(f.owner_role)})</small>
            </div>
          </div>
        </article>
      `;
      })
      .join('');
  } catch (err) {
    container.innerHTML = `<p class="empty">${err.message}</p>`;
  }
}

document.querySelector('#btnRefreshMatches')?.addEventListener('click', loadSmartMatches);

// Connect from Match pair button
document.querySelector('#matchesContainer')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-match-connect-item]');
  if (btn) {
    const foundId = Number(btn.dataset.matchConnectItem);
    openConnection(foundId);
  }
});

// -------------------------------------------------------------
// 3. MY REPORTS DASHBOARD
// -------------------------------------------------------------
async function loadMyReports() {
  const container = document.querySelector('#myReportsContainer');
  if (!container) return;
  if (!currentUser) {
    authDialog.showModal();
    notify('Please sign in to view your reports.');
    return;
  }

  try {
    const data = await api('/api/user/items');
    const userItems = data.items || [];

    if (!userItems.length) {
      container.innerHTML = `
        <div class="empty">
          <p style="font-size: 32px; margin-bottom: 8px;">📋</p>
          <b>You have not posted any reports yet</b>
          <p style="margin-top: 5px;">Report a lost or found item to track claims and match alerts in real time.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = userItems
      .map((it) => {
        const isResolved = it.status === 'Resolved';
        const dateStr = it.date || it.item_date || (it.created_at ? new Date(it.created_at).toLocaleDateString() : '');
        return `
        <article class="my-report-card">
          <div class="my-report-info">
            <b>${escapeHtml(it.name)} (${escapeHtml(it.type)})</b>
            <small>⌖ ${escapeHtml(it.location)} · ${dateStr} · 💬 ${it.connections_count || 0} claims/matches</small>
          </div>
          <div class="my-report-actions">
            <button class="button button-sm button-secondary" data-my-toggle-id="${it.id}" data-current-status="${it.status}">
              ${isResolved ? '↺ Reopen' : '✓ Mark Resolved'}
            </button>
            <button class="button button-sm button-danger" data-my-delete-id="${it.id}">
              🗑 Delete
            </button>
          </div>
        </article>
      `;
      })
      .join('');
  } catch (e) {
    container.innerHTML = `<p class="empty">${e.message}</p>`;
  }
}

// -------------------------------------------------------------
// 4. INBOX & LIVE MESSENGER
// -------------------------------------------------------------
async function loadInbox() {
  const sidebar = document.querySelector('#inboxConversationsList');
  const chatPane = document.querySelector('#inboxChatPane');
  if (!sidebar) return;

  if (!currentUser) {
    authDialog.showModal();
    notify('Please sign in to access your messenger inbox.');
    return;
  }

  try {
    const data = await api('/api/connections');
    connections = data.connections || [];

    const badge = document.querySelector('#msgBadge');
    if (badge) {
      const pending = connections.filter((c) => (c.recipient_id === currentUser.id || c.recipient_email === currentUser.email) && c.status === 'Pending').length;
      if (pending > 0) {
        badge.textContent = pending;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    if (!connections.length) {
      sidebar.innerHTML = '<p style="padding:20px; color:var(--muted); font-size:12px;">No active conversations yet.</p>';
      chatPane.innerHTML = `
        <div class="empty-chat-state">
          <p style="font-size: 32px; margin-bottom: 8px;">💬</p>
          <b>No messages yet</b>
          <p>Browse items on campus and click "View Details & Connect" to start a conversation.</p>
        </div>
      `;
      return;
    }

    // Render Conversation List in Sidebar
    sidebar.innerHTML = connections
      .map((c) => {
        const isIncoming = c.recipient_id === currentUser.id || c.recipient_email === currentUser.email;
        const otherName = isIncoming ? c.sender_name : c.recipient_name;
        const isActive = activeChatConnectionId === c.id;

        return `
        <div class="convo-item ${isActive ? 'active' : ''}" data-chat-id="${c.id}">
          <h4>${escapeHtml(c.item_name)}</h4>
          <p><b>${escapeHtml(otherName)}:</b> ${escapeHtml(c.message.split('\n')[0])}</p>
          <div style="display:flex; justify-content:space-between; margin-top:4px;">
            <span class="pill-badge" style="font-size:8px;">${c.status}</span>
            <small style="font-size:9px; color:var(--muted);">${new Date(c.created_at).toLocaleDateString()}</small>
          </div>
        </div>
      `;
      })
      .join('');

    // If active conversation selected, render it
    if (activeChatConnectionId) {
      renderActiveChat(activeChatConnectionId);
    } else if (connections.length > 0) {
      activeChatConnectionId = connections[0].id;
      renderActiveChat(activeChatConnectionId);
    }
  } catch (err) {
    sidebar.innerHTML = `<p style="padding:20px; color:var(--muted); font-size:12px;">${err.message}</p>`;
  }
}

function renderActiveChat(connId) {
  const chatPane = document.querySelector('#inboxChatPane');
  const c = connections.find((x) => x.id === connId);
  if (!c || !chatPane) return;

  const isIncoming = c.recipient_id === currentUser.id || c.recipient_email === currentUser.email;
  const otherName = isIncoming ? c.sender_name : c.recipient_name;
  const otherRole = isIncoming ? c.sender_role : c.recipient_role;
  const otherEmail = isIncoming ? c.sender_email : c.recipient_email;
  const otherPhone = isIncoming ? c.sender_phone : c.recipient_phone;
  const isAccepted = c.status === 'Accepted' || c.status === 'Matched';

  // Parse conversation message lines
  const lines = c.message.split('\n\n');

  chatPane.innerHTML = `
    <div class="chat-pane-header">
      <div>
        <h3>${escapeHtml(c.item_name)} (${escapeHtml(c.item_type)})</h3>
        <small style="color:var(--muted);">Chatting with <b>${escapeHtml(otherName)}</b> (${escapeHtml(otherRole || 'Member')})</small>
      </div>
      <div style="display:flex; gap:8px;">
        ${
          isIncoming && c.status === 'Pending'
            ? `<button class="button button-sm button-primary" data-chat-accept-id="${c.id}">✓ Accept & Reveal Contacts</button>`
            : ''
        }
        ${
          isAccepted
            ? `
            <a class="button button-sm button-secondary" href="mailto:${escapeHtml(otherEmail)}?subject=VCTM Foundly: ${encodeURIComponent(c.item_name)}">✉️ Email</a>
            ${otherPhone ? `<a class="button button-sm button-secondary" href="tel:${escapeHtml(otherPhone)}">📞 Call</a>` : ''}
          `
            : ''
        }
      </div>
    </div>

    <div class="chat-messages-scroll" id="chatMessagesScroll">
      ${lines
        .map((line) => {
          if (!line.trim()) return '';
          const isMe = line.includes(`[${currentUser.name} `);
          return `<div class="chat-bubble ${isMe ? 'me' : 'them'}">${escapeHtml(line)}</div>`;
        })
        .join('')}
    </div>

    <!-- Suggested Safe Spots Toolbar -->
    <div style="padding:6px 20px; background:#f5f3ee; border-top:1px solid var(--line); display:flex; gap:6px; overflow-x:auto;">
      <small style="font-weight:700; color:var(--muted); font-size:10px; align-self:center;">Safe Spots:</small>
      <button type="button" class="filter-pill btn-quick-spot" data-spot="Let's meet at the Central Library Circulation Counter.">📚 Library Counter</button>
      <button type="button" class="filter-pill btn-quick-spot" data-spot="Let's meet at the Main Gate Security Desk.">🛡️ Security Desk</button>
      <button type="button" class="filter-pill btn-quick-spot" data-spot="Let's meet at the Student Centre Cafeteria.">☕ Cafeteria</button>
    </div>

    <form class="chat-input-bar" id="chatInputForm" data-chat-send-id="${c.id}">
      <input type="text" placeholder="Type a message or verification answer..." id="chatMsgInput" required autocomplete="off" />
      <button type="submit" class="button button-primary">Send 💬</button>
    </form>
  `;

  // Auto scroll to bottom
  const scrollBox = document.querySelector('#chatMessagesScroll');
  if (scrollBox) scrollBox.scrollTop = scrollBox.scrollHeight;
}

// Conversation select listener
document.querySelector('#inboxConversationsList')?.addEventListener('click', (e) => {
  const item = e.target.closest('[data-chat-id]');
  if (item) {
    activeChatConnectionId = Number(item.dataset.chatId);
    document.querySelectorAll('.convo-item').forEach((x) => x.classList.toggle('active', x === item));
    renderActiveChat(activeChatConnectionId);
  }
});

// Chat message send listener
document.querySelector('#inboxChatPane')?.addEventListener('submit', async (e) => {
  if (e.target.id !== 'chatInputForm') return;
  e.preventDefault();
  const input = document.querySelector('#chatMsgInput');
  const text = input?.value.trim();
  if (!text || !activeChatConnectionId) return;

  try {
    await api(`/api/connections/${activeChatConnectionId}/message`, {
      method: 'POST',
      body: JSON.stringify({ message: text }),
    });
    input.value = '';
    await loadInbox();
  } catch (err) {
    notify(err.message);
  }
});

// Quick spot autofill listener
document.querySelector('#inboxChatPane')?.addEventListener('click', async (e) => {
  const spotBtn = e.target.closest('.btn-quick-spot');
  if (spotBtn) {
    const input = document.querySelector('#chatMsgInput');
    if (input) {
      input.value = spotBtn.dataset.spot;
      input.focus();
    }
    return;
  }

  const acceptBtn = e.target.closest('[data-chat-accept-id]');
  if (acceptBtn) {
    try {
      await api(`/api/connections/${acceptBtn.dataset.chatAcceptId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'Accepted' }),
      });
      notify('Connection accepted! Contact information revealed.');
      await loadInbox();
    } catch (err) {
      notify(err.message);
    }
  }
});

// -------------------------------------------------------------
// ITEM DETAIL MODAL & VERIFICATION
// -------------------------------------------------------------
function openItemDetail(itemId) {
  const item = items.find((x) => x.id === itemId);
  if (!item) return;

  document.querySelector('#detailTypeBadge').textContent = item.type.toUpperCase();
  document.querySelector('#detailTypeBadge').className = `pill-badge ${item.type === 'Found' ? 'status-open' : ''}`;

  const isResolved = item.status === 'Resolved';
  const statusBadge = document.querySelector('#detailStatusBadge');
  statusBadge.textContent = isResolved ? 'RESOLVED / RETURNED' : 'ACTIVE LISTING';
  statusBadge.className = `pill-badge ${isResolved ? 'status-resolved' : 'status-open'}`;

  document.querySelector('#detailCategoryBadge').textContent = item.category.toUpperCase();
  document.querySelector('#detailTitle').textContent = item.name;
  document.querySelector('#detailLocation').textContent = item.location;
  document.querySelector('#detailDate').textContent = item.date || item.item_date || '';
  document.querySelector('#detailReporter').textContent = item.owner_name || 'Campus Member';
  document.querySelector('#detailRole').textContent = item.owner_role || 'Verified';
  document.querySelector('#detailDescription').textContent = item.description || 'No additional description provided.';

  // Photo
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

  // Proof Question
  const proofBox = document.querySelector('#detailProofBox');
  if (item.proof_question && item.proof_question.trim()) {
    proofBox.classList.remove('hidden');
    document.querySelector('#detailProofQuestion').textContent = item.proof_question;
  } else {
    proofBox.classList.add('hidden');
  }

  // Actions
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

// -------------------------------------------------------------
// CONNECTION & CLAIM DIALOG
// -------------------------------------------------------------
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
      notify('Message sent! You can track replies in the Messages tab.');
      switchTab('messages');
    } catch (err) {
      notify(err.message);
    }
  });
}

// -------------------------------------------------------------
// USER PROFILE & AUTHENTICATION
// -------------------------------------------------------------
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
  document.querySelector('#modalProfileRole').textContent = currentUser.campus_role || 'Student';
  document.querySelector('#modalProfileEmail').textContent = currentUser.email;
  document.querySelector('#modalProfilePhone').textContent = currentUser.phone ? `📞 ${currentUser.phone}` : 'No phone provided';
  document.querySelector('#modalAvatarInitials').textContent = currentUser.name
    .split(' ')
    .map((x) => x[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  userProfileDialog.showModal();
}

function syncUser() {
  const signed = !!currentUser;
  document.querySelector('#openAuth').classList.toggle('hidden', signed);
  document.querySelector('#profileButton').classList.toggle('hidden', !signed);

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
  switchTab('feed');
}

document.querySelector('#profileButton')?.addEventListener('click', openUserProfile);
document.querySelector('#closeUserProfile')?.addEventListener('click', () => userProfileDialog.close());
document.querySelector('#userSignOutBtn')?.addEventListener('click', handleSignOut);
document.querySelector('#signOut')?.addEventListener('click', handleSignOut);

document.querySelector('#profileMyReportsBtn')?.addEventListener('click', () => {
  userProfileDialog.close();
  switchTab('my-reports');
});
document.querySelector('#profileConnectionsBtn')?.addEventListener('click', () => {
  userProfileDialog.close();
  switchTab('messages');
});

// Auth Form Tab Switching
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.authMode === mode));
  document.querySelectorAll('.signup-field').forEach((x) => x.classList.toggle('show', mode === 'signup'));
  document.querySelector('#authForm button[type="submit"]').innerHTML = `${mode === 'login' ? 'Sign in' : 'Create account'} <span>→</span>`;
  document.querySelector('#authError').textContent = '';
}

document.querySelector('#openAuth')?.addEventListener('click', () => authDialog.showModal());
document.querySelector('.auth-close')?.addEventListener('click', () => authDialog.close());
document.querySelector('#closeAuthBtn')?.addEventListener('click', () => authDialog.close());
document.querySelector('#authBackBtn')?.addEventListener('click', () => authDialog.close());
document.querySelectorAll('.auth-tab').forEach((b) => b.addEventListener('click', () => setAuthMode(b.dataset.authMode)));

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

      if (res.token) localStorage.setItem('foundly_token', res.token);
      currentUser = res.user;
      authDialog.close();
      authForm.reset();
      syncUser();
      notify(`Welcome, ${currentUser.name}!`);
      if (currentUser.role === 'admin') openAdmin();
      else switchTab('feed');
    } catch (err) {
      errElem.textContent = err.message;
      if (err.message.includes('Create account')) {
        setTimeout(() => setAuthMode('signup'), 1200);
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

// -------------------------------------------------------------
// REPORT AN ITEM
// -------------------------------------------------------------
function setType(type) {
  reportType = type;
  document.querySelectorAll('.type-choice').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
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

document.querySelectorAll('[data-open-report]').forEach((b) =>
  b.addEventListener('click', () => openReport(b.dataset.openReport))
);
document.querySelector('#btnQuickReport')?.addEventListener('click', () => openReport('Lost'));
document.querySelectorAll('.type-choice').forEach((b) =>
  b.addEventListener('click', () => setType(b.dataset.type))
);

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
      loadSmartMatches();
      notify('Report live! We will notify you instantly if a match is found.');
    } catch (err) {
      notify(err.message);
    }
  });
}

// -------------------------------------------------------------
// SEARCH, FILTERS & GRID CLICKS
// -------------------------------------------------------------
document.querySelectorAll('.filter-pill[data-filter]').forEach((b) =>
  b.addEventListener('click', () => {
    currentFilter = b.dataset.filter;
    document.querySelectorAll('.filter-pill[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
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

if (grid) {
  grid.addEventListener('click', (e) => {
    const card = e.target.closest('[data-item-id]');
    if (card) openItemDetail(Number(card.dataset.itemId));
  });
}

document.querySelector('#closeItemDetail')?.addEventListener('click', () => itemDetailDialog.close());

// Action on My Reports List (Toggle Status / Delete)
document.querySelector('#myReportsContainer')?.addEventListener('click', async (e) => {
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
      loadMyReports();
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
        loadMyReports();
      } catch (err) {
        notify(err.message);
      }
    }
  }
});

// Admin Console
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

document.querySelector('#closeAdmin')?.addEventListener('click', () => adminDialog.close());

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

// Click-outside backdrop handler
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
});

// -------------------------------------------------------------
// INITIALIZATION
// -------------------------------------------------------------
(async () => {
  try {
    const sessionData = await api('/api/session');
    currentUser = sessionData.user;
    if (!currentUser) {
      localStorage.removeItem('foundly_token');
    }
    syncUser();
    await loadItems();
    loadSmartMatches();

    // Refresh every 10s
    setInterval(async () => {
      await loadItems();
      const s = await api('/api/session');
      if (s.user) currentUser = s.user;
      syncUser();
    }, 10000);
  } catch (e) {
    console.error('Init notice:', e);
  }
})();
