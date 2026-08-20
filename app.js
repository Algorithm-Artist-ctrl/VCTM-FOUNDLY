/**
 * VCTM Foundly - Verified Campus Lost & Found System.
 * Supabase Cloud PostgreSQL Integration & REST Backend.
 */

// Supabase Cloud Client Configuration
const SUPABASE_URL = 'https://utwodwtccrmibmdwtpmc.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_7tppJQ-Kq9xtNaHBcKOetA_kU8p3MSW';
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) : null;

let items = [];
let matches = [];
let connections = [];
let currentUser = null;
let currentFilter = 'All';
let currentCategoryFilter = 'All';
let currentStatusFilter = 'Open';
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
const myReportsDialog = document.querySelector('#myReportsDialog');
const connectionsDialog = document.querySelector('#connectionsDialog');
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

// Helper: Escape HTML
const escapeHtml = (str) =>
  String(str ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[c]));

// Helper: API Fetcher with Dual Token/Cookie Auth
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

// Helper: Toast Notification
const notify = (msg) => {
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(notify._timer);
  notify._timer = setTimeout(() => toast.classList.remove('show'), 3500);
};

// Helper: Smart Item Icon Detector based on name, category, and description
const getItemIcon = (name = '', category = '', desc = '') => {
  const text = `${name} ${category} ${desc}`.toLowerCase();
  
  if (text.includes('watch') || text.includes('titan') || text.includes('casio watch') || text.includes('smartwatch') || text.includes('rolex') || text.includes('fastrack')) return '⌚';
  if (text.includes('glass') || text.includes('spec') || text.includes('sunglass') || text.includes('lens')) return '👓';
  if (text.includes('bottle') || text.includes('sipper') || text.includes('flask') || text.includes('thermos')) return '🍶';
  if (text.includes('earphone') || text.includes('airpod') || text.includes('headphone') || text.includes('earbud') || text.includes('audio') || text.includes('buds')) return '🎧';
  if (text.includes('laptop') || text.includes('macbook') || text.includes('dell') || text.includes('hp') || text.includes('lenovo') || text.includes('asus') || text.includes('thinkpad')) return '💻';
  if (text.includes('phone') || text.includes('iphone') || text.includes('samsung') || text.includes('oneplus') || text.includes('mobile') || text.includes('android')) return '📱';
  if (text.includes('key') || text.includes('bike') || text.includes('car key') || text.includes('keychain') || text.includes('activa') || text.includes('honda')) return '🔑';
  if (text.includes('wallet') || text.includes('purse') || text.includes('money') || text.includes('cash')) return '👛';
  if (text.includes('id') || text.includes('card') || text.includes('admit') || text.includes('license') || text.includes('pan') || text.includes('aadhaar')) return '🪪';
  if (text.includes('book') || text.includes('drawing') || text.includes('notebook') || text.includes('register') || text.includes('file') || text.includes('folder') || text.includes('notes')) return '📚';
  if (text.includes('calculator') || text.includes('scientific') || text.includes('casio')) return '🔢';
  if (text.includes('umbrella') || text.includes('raincoat')) return '☂️';
  if (text.includes('bag') || text.includes('backpack') || text.includes('pouch') || text.includes('sack')) return '🎒';
  if (text.includes('jacket') || text.includes('hoodie') || text.includes('sweater') || text.includes('shirt') || text.includes('coat') || text.includes('cap') || text.includes('hat') || text.includes('scarf')) return '🧥';
  if (text.includes('ring') || text.includes('chain') || text.includes('necklace') || text.includes('jewel') || text.includes('earring') || text.includes('bangle') || text.includes('gold') || text.includes('silver')) return '💍';
  if (text.includes('charger') || text.includes('cable') || text.includes('adapter') || text.includes('powerbank') || text.includes('cord')) return '🔌';
  if (text.includes('mouse') || text.includes('keyboard') || text.includes('pen drive') || text.includes('pendrive') || text.includes('usb') || text.includes('hard disk')) return '🖱️';
  if (text.includes('helmet')) return '🪖';
  if (text.includes('shoe') || text.includes('sneaker') || text.includes('sandal') || text.includes('boots')) return '👟';
  if (text.includes('bat') || text.includes('ball') || text.includes('racket') || text.includes('cricket') || text.includes('football') || text.includes('badminton')) return '🏏';
  if (text.includes('lunch') || text.includes('tiffin') || text.includes('box')) return '🍱';
  if (text.includes('pen') || text.includes('pencil') || text.includes('geometry') || text.includes('compass')) return '✏️';

  return ({
    Electronics: '💻',
    Accessories: '👜',
    Keys: '🔑',
    Documents: '🪪',
    Clothing: '🧥',
    'Books & stationery': '📘',
    Jewellery: '💍',
    'Sports & fitness': '🏏',
    Other: '📦',
  }[category] || '📦');
};

// -------------------------------------------------------------
// PHOTO UPLOAD & RESIZE
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
// 1. RENDER EXPLORE ITEMS FEED
// -------------------------------------------------------------
function isItemOwner(item) {
  if (!currentUser || !item) return false;
  const matchId = currentUser.id != null && item.owner_id != null && String(currentUser.id) === String(item.owner_id);
  const matchEmail = !!(currentUser.email && item.owner_email && currentUser.email.trim().toLowerCase() === item.owner_email.trim().toLowerCase());
  return matchId || matchEmail;
}

function renderItems() {
  const grid = document.querySelector('#itemsGrid');
  if (!grid) return;
  const q = (searchInput?.value || '').trim().toLowerCase();

  const filtered = items.filter((i) => {
    let matchType = true;
    if (currentFilter === 'MyPosts') {
      matchType = isItemOwner(i);
    } else if (currentFilter !== 'All') {
      matchType = i.type === currentFilter;
    }

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
        <p style="margin-top: 5px;">Try adjusting your search terms or filters, or post a new report.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered
    .map((i) => {
      const isResolved = i.status === 'Resolved';
      const hasImage = !!i.image_data;
      const icon = getItemIcon(i.name, i.category, i.description);
      const mediaHtml = hasImage
        ? `<img src="${i.image_data}" alt="${escapeHtml(i.name)}" loading="lazy" />`
        : `<span class="item-icon-display">${icon}</span>`;

      const badgeClass = isResolved
        ? 'badge-resolved'
        : i.type === 'Found'
        ? 'badge-found'
        : 'badge-lost';

      const badgeText = isResolved
        ? '✓ RESOLVED'
        : i.type === 'Found'
        ? '🟢 FOUND'
        : '🔴 LOST';

      const isOwner = isItemOwner(i);
      let ownerBadgeHtml = '';
      let actionText = '';
      let actionClass = '';

      if (!currentUser) {
        // Guest Visitor (Before Login)
        actionText = '🔒 Sign in to Claim / Connect';
        actionClass = 'action-guest';
      } else if (isOwner) {
        // Owner of this post (After Login)
        ownerBadgeHtml = `<span class="card-owner-badge">⭐ YOUR POST</span>`;
        actionText = '⚙ Manage Your Post';
        actionClass = 'action-owner';
      } else {
        // Authenticated Campus Member (After Login)
        actionText = i.type === 'Found' ? '🟢 Claim & Answer Proof' : '🔴 I Found This / Contact';
        actionClass = 'action-member';
      }

      return `
      <article class="item-card ${isResolved ? 'is-resolved' : ''} ${isOwner ? 'is-my-post' : ''}" data-item-id="${i.id}">
        <div class="card-media">
          ${mediaHtml}
          ${ownerBadgeHtml}
          <span class="card-status-badge ${badgeClass}">
            ${badgeText}
          </span>
        </div>
        <div class="card-body">
          <p class="category">${escapeHtml(i.category.toUpperCase())}</p>
          <h3>${escapeHtml(i.name)}</h3>
          <div class="card-meta">
            <span>⌖ ${escapeHtml(i.location)}</span>
            <span>${i.date || ''}</span>
          </div>
        </div>
        <div class="card-bottom ${actionClass}">
          <span>${actionText}</span>
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
    syncUserMetrics();
  } catch (err) {
    console.error('Failed to load items:', err);
  }
}

async function loadConnections() {
  if (!currentUser) {
    connections = [];
    return;
  }
  try {
    const data = await api('/api/connections');
    connections = data.connections || [];
    syncUserMetrics();
  } catch (err) {
    console.error('Failed to load connections:', err);
  }
}

// -------------------------------------------------------------
// 2. RENDER LIVE SMART MATCHES
// -------------------------------------------------------------
async function loadSmartMatches() {
  const container = document.querySelector('#matchesHomeGrid');
  if (!container) return;

  try {
    const data = await api('/api/matches');
    matches = data.matches || [];
    syncUserMetrics();

    // For logged-in users, show matches relevant to their own reports; for guests, show campus matches
    const relevantMatches = currentUser
      ? matches.filter((m) => isItemOwner(m.lost_item) || isItemOwner(m.found_item))
      : matches;

    const badge = document.querySelector('#navMatchBadge');
    if (badge) {
      if (relevantMatches.length > 0) {
        badge.textContent = relevantMatches.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    if (!relevantMatches.length) {
      container.innerHTML = `
        <div class="empty">
          <p style="font-size: 32px; margin-bottom: 8px;">⚡</p>
          <b>${currentUser ? 'No match alerts for your reports yet' : 'No active match pairs currently detected'}</b>
          <p style="margin-top: 5px;">When you report a lost item and another student reports finding it, Foundly will automatically correlate the reports and alert you here.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = relevantMatches
      .map((m) => {
        const l = m.lost_item;
        const f = m.found_item;
        const lIcon = getItemIcon(l.name, l.category, l.description);
        const fIcon = getItemIcon(f.name, f.category, f.description);
        const lThumb = l.image_data ? `<img src="${l.image_data}" alt="${escapeHtml(l.name)}" />` : lIcon;
        const fThumb = f.image_data ? `<img src="${f.image_data}" alt="${escapeHtml(f.name)}" />` : fIcon;

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
document.querySelector('#matchesHomeGrid')?.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-match-connect-item]');
  if (btn) {
    openConnection(Number(btn.dataset.matchConnectItem));
  }
});

// -------------------------------------------------------------
// 3. ITEM DETAIL MODAL
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
    emojiElem.textContent = getItemIcon(item.name, item.category, item.description);
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
  const isOwner = isItemOwner(item);
  const isAdmin = currentUser && currentUser.role === 'admin';

  if (!currentUser) {
    actionsBox.innerHTML = `
      <button class="button button-primary" id="btnDetailSignIn">
        🔒 Sign in with College ID to Connect & Claim <span>→</span>
      </button>
    `;
    document.querySelector('#btnDetailSignIn')?.addEventListener('click', () => {
      itemDetailDialog.close();
      openAuthModal('login');
    });
  } else {
    let ownerButtons = '';
    if (isOwner || isAdmin) {
      ownerButtons = `
        <div style="display:flex; gap:8px; width:100%; margin-bottom:8px;">
          <button class="button button-secondary button-sm" id="btnToggleStatus" style="flex:1;">
            ${isResolved ? '↺ Reopen Listing' : '✓ Mark Resolved'}
          </button>
          <button class="button button-danger button-sm" id="btnDeleteItem" style="flex:1;">
            🗑 Delete Report
          </button>
        </div>
      `;
    }

    actionsBox.innerHTML = `
      ${ownerButtons}
      <button class="button button-primary" id="btnClaimItem">
        💬 Contact Reporter & ${item.type === 'Found' ? 'Claim Item' : 'Offer Help'} <span>→</span>
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

    document.querySelector('#btnClaimItem')?.addEventListener('click', () => {
      itemDetailDialog.close();
      openConnection(item.id);
    });
  }

  itemDetailDialog.showModal();
}

document.querySelector('#closeItemDetail')?.addEventListener('click', () => itemDetailDialog.close());

// -------------------------------------------------------------
// 4. MY REPORTS MODAL
// -------------------------------------------------------------
async function openMyReports() {
  if (!currentUser) {
    openAuthModal('login');
    notify('Please sign in to view your reports.');
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
          const itDate = it.date || it.item_date || (it.created_at ? new Date(it.created_at).toLocaleDateString() : '');
          return `
          <article class="my-report-card">
            <div class="my-report-info">
              <b>${escapeHtml(it.name)}</b>
              <small>⌖ ${escapeHtml(it.location)} · ${itDate}</small>
              <div style="margin-top:4px;">
                <span class="pill-badge" style="background:${it.type === 'Found' ? '#eaf5ef' : '#fdeee9'}; color:${it.type === 'Found' ? 'var(--green)' : 'var(--coral)'};">${it.type.toUpperCase()}</span>
                <span class="pill-badge ${isResolved ? 'status-resolved' : 'status-open'}">${isResolved ? 'RESOLVED' : 'ACTIVE'}</span>
              </div>
            </div>
            <div class="my-report-actions">
              <button class="button button-secondary button-sm" data-toggle-my-item="${it.id}" data-my-status="${it.status || 'Open'}">
                ${isResolved ? '↺ Reopen' : '✓ Mark Resolved'}
              </button>
              <button class="button button-danger button-sm" data-delete-my-item="${it.id}">
                🗑 Delete
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

document.querySelector('#openMyReports')?.addEventListener('click', openMyReports);
document.querySelector('#quickMyReports')?.addEventListener('click', openMyReports);
document.querySelector('#closeMyReports')?.addEventListener('click', () => myReportsDialog.close());

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

// -------------------------------------------------------------
// 5. MESSAGES & CONNECTIONS MODAL
// -------------------------------------------------------------
async function openConnections() {
  if (!currentUser) {
    authDialog.showModal();
    notify('Please sign in to view messages.');
    return;
  }
  try {
    const data = await api('/api/connections');
    const list = data.connections || [];
    connections = list;

    const isMine = (c) => c.recipient_id === currentUser.id || c.recipient_email === currentUser.email;

    const card = (c, incoming) => {
      const otherName = incoming ? c.sender_name : c.recipient_name;
      const otherRole = incoming ? c.sender_role : c.recipient_role;
      const otherEmail = incoming ? c.sender_email : c.recipient_email;
      const otherPhone = incoming ? c.sender_phone : c.recipient_phone;
      const isMatched = c.status === 'Matched';
      const isAccepted = c.status === 'Accepted' || isMatched;

      return `
        <article class="connection-card">
          <div style="display: flex; justify-content: space-between; align-items: flex-start;">
            <div>
              <h3>${escapeHtml(c.item_name)} (${escapeHtml(c.item_type || 'Report')})</h3>
              <small>⌖ ${escapeHtml(c.item_location || 'Campus')} · ${new Date(c.created_at).toLocaleDateString()}</small>
            </div>
            <span class="pill-badge ${isAccepted ? 'status-open' : ''}">${escapeHtml(c.status)}</span>
          </div>

          <div style="background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 10px; margin: 10px 0; font-size: 11px; line-height: 1.5;">
            <b>${incoming ? 'From' : 'To'}: ${escapeHtml(otherName)} (${escapeHtml(otherRole || 'Campus Member')}):</b><br/>
            ${escapeHtml(c.message).replace(/\n/g, '<br/>')}
          </div>

          ${
            incoming && c.status === 'Pending'
              ? `
            <div class="connection-actions">
              <button class="button button-sm button-primary" data-request-id="${c.id}" data-request-action="Accepted">
                ✓ Accept & Reveal Contact
              </button>
              <button class="button button-sm button-secondary" data-request-id="${c.id}" data-request-action="Declined">
                Decline
              </button>
            </div>
          `
              : `
            ${
              isAccepted
                ? `
              <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <small style="font-weight: 800; color: var(--green); font-size: 11px;">✓ Verified Direct Contact Unlocked:</small>
                  <small style="font-size: 10px; color: var(--muted);">Click below to chat or call directly</small>
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px;">
                  ${
                    otherPhone
                      ? `
                    <a class="btn-contact-action btn-whatsapp" target="_blank" rel="noopener" href="https://wa.me/${(otherPhone.replace(/[^0-9]/g, '').length === 10 ? '91' : '') + otherPhone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hi ${otherName}, I am contacting you regarding '${c.item_name}' on VCTM Foundly.`)}">
                      💬 WhatsApp Message
                    </a>
                    <a class="btn-contact-action btn-call" href="tel:${escapeHtml(otherPhone)}">
                      📞 Call: ${escapeHtml(otherPhone)}
                    </a>
                    <a class="btn-contact-action btn-sms" href="sms:${escapeHtml(otherPhone.replace(/[^0-9]/g, ''))}">
                      📱 SMS Text
                    </a>
                  `
                      : ''
                  }
                  <a class="btn-contact-action btn-email" href="mailto:${escapeHtml(otherEmail)}?subject=VCTM Foundly: ${encodeURIComponent(c.item_name)}">
                    ✉️ Email: ${escapeHtml(otherEmail)}
                  </a>
                </div>
                <div class="connection-reply-box">
                  <input type="text" placeholder="Type a message to reply on the website..." class="reply-msg-input" data-reply-conn-id="${c.id}" />
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
    const container = document.querySelector('#connectionsList');

    container.innerHTML =
      received.length || sent.length
        ? `
      ${
        received.length
          ? `<p class="eyebrow" style="margin-top: 10px;"><span></span> INCOMING CLAIMS & MATCHES (${received.length})</p>${received.map((c) => card(c, true)).join('')}`
          : ''
      }
      ${
        sent.length
          ? `<p class="eyebrow" style="margin-top: 20px;"><span></span> SENT REQUESTS (${sent.length})</p>${sent.map((c) => card(c, false)).join('')}`
          : ''
      }
    `
        : '<p class="empty">No active messages yet. Browse items and click "View Details & Connect" to send a claim message.</p>';

    connectionsDialog.showModal();
    checkPendingUpdates();
  } catch (e) {
    notify(e.message);
  }
}

document.querySelector('#openConnections')?.addEventListener('click', openConnections);
document.querySelector('#notifications')?.addEventListener('click', () => {
  if (currentUser) openConnections();
  else notify('Please sign in to view messages & notifications.');
});
document.querySelector('#closeConnections')?.addEventListener('click', () => connectionsDialog.close());

// Action on Connections List
document.querySelector('#connectionsList')?.addEventListener('click', async (e) => {
  const actionBtn = e.target.closest('[data-request-action]');
  if (actionBtn) {
    try {
      await api(`/api/connections/${actionBtn.dataset.requestId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: actionBtn.dataset.requestAction }),
      });
      notify(`Request ${actionBtn.dataset.requestAction.toLowerCase()}. Contact info revealed!`);
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

document.querySelector('#connectionsList')?.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('reply-msg-input')) {
    e.preventDefault();
    const connId = e.target.dataset.replyConnId;
    const text = e.target.value.trim();
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

// -------------------------------------------------------------
// 6. CONNECT / CLAIM FORM SUBMIT
// -------------------------------------------------------------
function openConnection(itemId) {
  if (!currentUser) {
    openAuthModal('login');
    notify('Please sign in to connect with the reporter.');
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
      notify('Message sent! View replies in Messages & Notifications.');
      openConnections();
    } catch (err) {
      notify(err.message);
    }
  });
}

// -------------------------------------------------------------
// 7. USER PROFILE & AUTHENTICATION
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

function syncUserMetrics() {
  if (!currentUser) return;
  const myReportsCount = items.filter((i) => isItemOwner(i)).length;
  const myMatchesCount = matches.filter((m) => 
    isItemOwner(m.lost_item) || isItemOwner(m.found_item)
  ).length;
  const myMessagesCount = connections.length;

  const metricReportsEl = document.querySelector('#metricMyReportsCount');
  const metricMatchesEl = document.querySelector('#metricMyMatchesCount');
  const metricMessagesEl = document.querySelector('#metricMyMessagesCount');
  if (metricReportsEl) metricReportsEl.textContent = myReportsCount;
  if (metricMatchesEl) metricMatchesEl.textContent = myMatchesCount;
  if (metricMessagesEl) metricMessagesEl.textContent = myMessagesCount;

  // Show My Posts filter pill in repository
  const myPostsPill = document.querySelector('#myPostsFilterPill');
  const filterMyPostsCount = document.querySelector('#filterMyPostsCount');
  if (myPostsPill) myPostsPill.classList.remove('hidden');
  if (filterMyPostsCount) filterMyPostsCount.textContent = myReportsCount;

  // Render Personal Items directly inside Dashboard
  const userGrid = document.querySelector('#userDashboardItemsGrid');
  if (userGrid) {
    const myItems = items.filter((i) => isItemOwner(i));
    if (!myItems.length) {
      userGrid.innerHTML = `
        <div class="user-empty-dashboard">
          <span style="font-size: 36px; display: block; margin-bottom: 8px;">📋</span>
          <b>No items reported by you yet</b>
          <p>Report any lost or found item to automatically track matches, alert the campus, and receive claim requests.</p>
          <div style="display: flex; justify-content: center; gap: 10px;">
            <button class="button button-primary button-sm" data-open-report="Lost">＋ Report Lost Item</button>
            <button class="button button-secondary button-sm" data-open-report="Found">＋ Report Found Item</button>
          </div>
        </div>
      `;
      userGrid.querySelectorAll('[data-open-report]').forEach((b) =>
        b.addEventListener('click', () => openReport(b.dataset.openReport))
      );
    } else {
      userGrid.innerHTML = myItems
        .map((i) => {
          const isResolved = i.status === 'Resolved';
          const hasImage = !!i.image_data;
          const icon = getItemIcon(i.name, i.category, i.description);
          const mediaHtml = hasImage
            ? `<img src="${i.image_data}" alt="${escapeHtml(i.name)}" loading="lazy" />`
            : `<span class="item-icon-display">${icon}</span>`;

          const badgeClass = isResolved
            ? 'badge-resolved'
            : i.type === 'Found'
            ? 'badge-found'
            : 'badge-lost';

          const badgeText = isResolved
            ? '✓ RESOLVED'
            : i.type === 'Found'
            ? '🟢 FOUND'
            : '🔴 LOST';

          return `
          <article class="item-card ${isResolved ? 'is-resolved' : ''} is-my-post" data-item-id="${i.id}">
            <div class="card-media">
              ${mediaHtml}
              <span class="card-owner-badge">⭐ YOUR POST</span>
              <span class="card-status-badge ${badgeClass}">
                ${badgeText}
              </span>
            </div>
            <div class="card-body">
              <p class="category">${escapeHtml(i.category.toUpperCase())}</p>
              <h3>${escapeHtml(i.name)}</h3>
              <div class="card-meta">
                <span>⌖ ${escapeHtml(i.location)}</span>
                <span>${i.date || ''}</span>
              </div>
            </div>
            <div class="card-bottom action-owner">
              <span>⚙ Manage Your Post</span>
              <strong>→</strong>
            </div>
          </article>
        `;
        })
        .join('');
    }
  }
}

function syncUser() {
  const signed = !!currentUser;
  
  // Top Navbar Navigation Toggles
  document.querySelector('#openAuth')?.classList.toggle('hidden', signed);
  document.querySelector('#profileButton')?.classList.toggle('hidden', !signed);
  document.querySelector('#openMyReports')?.classList.toggle('hidden', !signed);
  document.querySelector('#openConnections')?.classList.toggle('hidden', !signed);

  // Hero & Informational Section Toggles
  const guestHero = document.querySelector('#discover');
  const userHero = document.querySelector('#userHero');
  const howItWorks = document.querySelector('#how-it-works');
  const safeZones = document.querySelector('#safe-zones');
  const quickActions = document.querySelector('.quick-actions');
  const navHowItWorks = document.querySelector('a[href="#how-it-works"]');
  const navSafeZones = document.querySelector('a[href="#safe-zones"]');

  if (signed) {
    guestHero?.classList.add('hidden');
    userHero?.classList.remove('hidden');
    howItWorks?.classList.add('hidden');
    safeZones?.classList.add('hidden');
    quickActions?.classList.add('hidden');
    navHowItWorks?.classList.add('hidden');
    navSafeZones?.classList.add('hidden');

    const initials = (currentUser.name || 'User')
      .split(' ')
      .map((x) => x[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();

    // Top Navigation Avatar Pill
    const profileNameEl = document.querySelector('#profileName');
    const profileRoleEl = document.querySelector('#profileRole');
    const avatarInitialsEl = document.querySelector('#avatarInitials');
    if (profileNameEl) profileNameEl.textContent = currentUser.name;
    if (profileRoleEl) profileRoleEl.textContent = currentUser.role === 'admin' ? 'Administrator' : (currentUser.campus_role || 'Student');
    if (avatarInitialsEl) avatarInitialsEl.textContent = initials;

    // User Dashboard Hero Info
    const heroInitialsEl = document.querySelector('#heroUserInitials');
    const heroNameEl = document.querySelector('#heroUserName');
    const heroRoleEl = document.querySelector('#heroUserRole');
    const heroEmailEl = document.querySelector('#heroUserEmail');
    if (heroInitialsEl) heroInitialsEl.textContent = initials;
    if (heroNameEl) heroNameEl.textContent = currentUser.name;
    if (heroRoleEl) heroRoleEl.textContent = currentUser.role === 'admin' ? 'Administrator' : (currentUser.campus_role || 'Student');
    if (heroEmailEl) heroEmailEl.textContent = currentUser.email;

    syncUserMetrics();
  } else {
    guestHero?.classList.remove('hidden');
    userHero?.classList.add('hidden');
    howItWorks?.classList.remove('hidden');
    safeZones?.classList.remove('hidden');
    quickActions?.classList.remove('hidden');
    navHowItWorks?.classList.remove('hidden');
    navSafeZones?.classList.remove('hidden');

    const myPostsPill = document.querySelector('#myPostsFilterPill');
    if (myPostsPill) myPostsPill.classList.add('hidden');
  }

  // Re-render feed items to update owner badges and buttons
  renderItems();
}

// User Dashboard Metric Cards Clicks
document.querySelector('#btnMetricReports')?.addEventListener('click', openMyReports);
document.querySelector('#btnMetricMatches')?.addEventListener('click', () => {
  const matchesSection = document.querySelector('#smartMatchesSection');
  if (matchesSection) {
    matchesSection.scrollIntoView({ behavior: 'smooth' });
  }
});
document.querySelector('#btnMetricMessages')?.addEventListener('click', openConnections);
document.querySelector('#btnMetricProfile')?.addEventListener('click', openUserProfile);

async function handleSignOut() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (_) {}
  localStorage.removeItem('foundly_token');
  localStorage.removeItem('foundly_user');
  currentUser = null;
  userProfileDialog?.close();
  adminDialog?.close();
  syncUser();
  notify('You have been signed out.');
}

document.querySelector('#profileButton')?.addEventListener('click', openUserProfile);
document.querySelector('#closeUserProfile')?.addEventListener('click', () => userProfileDialog.close());
document.querySelector('#userSignOutBtn')?.addEventListener('click', handleSignOut);
document.querySelector('#signOut')?.addEventListener('click', handleSignOut);

document.querySelector('#profileMyReportsBtn')?.addEventListener('click', () => {
  userProfileDialog.close();
  openMyReports();
});
document.querySelector('#profileConnectionsBtn')?.addEventListener('click', () => {
  userProfileDialog.close();
  openConnections();
});

// Auth Form Tabs & Modal Control
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.authMode === mode));
  document.querySelectorAll('.signup-field').forEach((x) => x.classList.toggle('show', mode === 'signup'));
  const submitBtn = document.querySelector('#authForm button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerHTML = `${mode === 'login' ? 'Sign in' : 'Create account'} <span>→</span>`;
  }
  const errElem = document.querySelector('#authError');
  if (errElem) errElem.textContent = '';
}

function openAuthModal(mode = 'login') {
  setAuthMode(mode);
  authForm?.reset();
  const errElem = document.querySelector('#authError');
  if (errElem) errElem.textContent = '';
  authDialog.showModal();
}

document.querySelector('#openAuth')?.addEventListener('click', () => openAuthModal('login'));
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
      const email = (d.get('email') || '').trim().toLowerCase();
      if (authMode === 'signup') {
        if (!email.endsWith('@vctm.in') && !email.endsWith('@vctm.edu')) {
          errElem.textContent = 'Please use your official college email (@vctm.in or @vctm.edu).';
          return;
        }
      }

      const payload =
        authMode === 'signup'
          ? {
              name: d.get('fullName'),
              campus_role: d.get('campusRole'),
              phone: d.get('phone'),
              email: email,
              password: d.get('password'),
            }
          : {
              email: email,
              password: d.get('password'),
            };

      const res = await api(authMode === 'signup' ? '/api/register' : '/api/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (res.token) localStorage.setItem('foundly_token', res.token);
      if (res.user) localStorage.setItem('foundly_user', JSON.stringify(res.user));
      currentUser = res.user;
      authDialog.close();
      authForm.reset();
      syncUser();
      notify(`Welcome back, ${currentUser.name}!`);
      if (currentUser.role === 'admin') openAdmin();
    } catch (err) {
      errElem.textContent = err.message;
    }
  });
}

// Password Reset
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
// 8. REPORT ITEM FORM
// -------------------------------------------------------------
function setType(type) {
  reportType = type;
  document.querySelectorAll('.type-choice').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  document.querySelector('#modalTitle').textContent = `Report a ${type.toLowerCase()} item`;
  document.querySelector('#submitReport').innerHTML = `Publish ${type.toLowerCase()} report <span>→</span>`;
}

function openReport(type) {
  if (!currentUser) {
    openAuthModal('login');
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
// 9. FILTERS & SEARCH
// -------------------------------------------------------------
document.querySelectorAll('.type-pill[data-filter]').forEach((b) =>
  b.addEventListener('click', () => {
    currentFilter = b.dataset.filter;
    document.querySelectorAll('.type-pill[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
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

document.querySelector('#userDashboardItemsGrid')?.addEventListener('click', (e) => {
  const card = e.target.closest('[data-item-id]');
  if (card) openItemDetail(Number(card.dataset.itemId));
});

// -------------------------------------------------------------
// 10. ADMIN CONSOLE
// -------------------------------------------------------------
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

// Notifications check badge
async function checkPendingUpdates() {
  if (!currentUser) return;
  try {
    const s = await api('/api/session');
    const dot = document.querySelector('#notifDot');
    const badge = document.querySelector('#navConnBadge');
    const count = s.pending_count || 0;
    if (dot) dot.classList.toggle('hidden', count === 0);
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle('hidden', count === 0);
    }
  } catch (_) {}
}

// Dialog backdrop and modal-open class management
const updateModalOpenState = () => {
  const hasOpen = Array.from(document.querySelectorAll('dialog')).some((d) => d.open);
  document.body.classList.toggle('modal-open', hasOpen);
};

document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener('close', updateModalOpenState);
  dlg.addEventListener('cancel', updateModalOpenState);
});

const dialogObserver = new MutationObserver(updateModalOpenState);
document.querySelectorAll('dialog').forEach((dlg) => {
  dialogObserver.observe(dlg, { attributes: true, attributeFilter: ['open'] });
});

// -------------------------------------------------------------
// INITIALIZATION
// -------------------------------------------------------------
// Instant cached session recovery on refresh to prevent login screen flicker
try {
  const cachedUserStr = localStorage.getItem('foundly_user');
  if (cachedUserStr) {
    currentUser = JSON.parse(cachedUserStr);
    syncUser();
  }
} catch (_) {}

(async () => {
  try {
    const sessionData = await api('/api/session');
    if (sessionData && sessionData.user) {
      currentUser = sessionData.user;
      localStorage.setItem('foundly_user', JSON.stringify(currentUser));
    } else {
      currentUser = null;
      localStorage.removeItem('foundly_user');
      localStorage.removeItem('foundly_token');
    }
    syncUser();

    // Fetch items, smart matches, and connections in parallel
    await Promise.all([
      loadItems(),
      loadSmartMatches(),
      loadConnections()
    ]);
    checkPendingUpdates();

    setInterval(async () => {
      await Promise.all([
        loadItems(),
        loadSmartMatches(),
        loadConnections()
      ]);
      checkPendingUpdates();
    }, 8000);
  } catch (e) {
    console.error('Init error:', e);
  }
})();
