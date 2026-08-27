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

// Photo Upload Elements (Report Item)
const photoDropzone = document.querySelector('#photoDropzone');
const photoInput = document.querySelector('#photoInput');
const dropzonePrompt = document.querySelector('#dropzonePrompt');
const photoPreviewBox = document.querySelector('#photoPreviewBox');
const photoPreviewImg = document.querySelector('#photoPreviewImg');
const removePhotoBtn = document.querySelector('#removePhotoBtn');

// Photo Upload Elements (Connect / Claim Proof)
const connectPhotoDropzone = document.querySelector('#connectPhotoDropzone');
const connectPhotoInput = document.querySelector('#connectPhotoInput');
const connectDropzonePrompt = document.querySelector('#connectDropzonePrompt');
const connectPhotoPreviewBox = document.querySelector('#connectPhotoPreviewBox');
const connectPhotoPreviewImg = document.querySelector('#connectPhotoPreviewImg');
const connectRemovePhotoBtn = document.querySelector('#connectRemovePhotoBtn');
let currentConnectProofImageBase64 = null;

// Helper: Escape HTML
const escapeHtml = (str) =>
  String(str ?? '').replace(/[&<>'"]/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[c]));

// Cross-Tab Broadcast Channel for Instant Session Sync
const authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('foundly_auth') : null;

// -------------------------------------------------------------
// CENTRALIZED IN-FLIGHT DEDUPLICATION & CLIENT READ CACHE
// -------------------------------------------------------------
const inflightGetRequests = new Map();
const clientDataCache = new Map();
const CLIENT_CACHE_TTL_MS = 6000; // 6 seconds memory cache for read endpoints

function invalidateClientCache(pathPrefix = null) {
  if (!pathPrefix) {
    clientDataCache.clear();
  } else {
    for (const key of clientDataCache.keys()) {
      if (key.startsWith(pathPrefix)) clientDataCache.delete(key);
    }
  }
}

// Helper: API Fetcher with Dual Token/Cookie Auth, In-Flight Deduplication & Caching
const api = async (path, options = {}) => {
  const method = (options.method || 'GET').toUpperCase();
  const isGet = method === 'GET';
  const bypassCache = options.bypassCache === true;

  // Invalidate cache on mutations
  if (!isGet) {
    invalidateClientCache();
  }

  // Check client read cache
  if (isGet && !bypassCache) {
    const cached = clientDataCache.get(path);
    if (cached && (Date.now() - cached.timestamp) < CLIENT_CACHE_TTL_MS) {
      return cached.data;
    }
    // Check in-flight promise deduplication
    if (inflightGetRequests.has(path)) {
      return inflightGetRequests.get(path);
    }
  }

  const token = localStorage.getItem('foundly_token');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchPromise = (async () => {
    try {
      const response = await fetch(path, {
        credentials: 'include',
        headers,
        ...options,
      });

      if (response.headers.get('Content-Type')?.includes('text/csv')) {
        return await response.blob();
      }

      let data;
      try {
        data = await response.json();
      } catch (err) {
        data = { error: `Server error (${response.status})` };
      }

      if (response.status === 401 && currentUser && path !== '/api/login' && path !== '/api/register') {
        // Session invalidated on server
        handleRemoteLogout();
      }

      if (!response.ok) {
        const errorMsg = data.detail || data.error || 'Something went wrong. Please try again.';
        throw new Error(errorMsg);
      }

      if (isGet && !bypassCache) {
        clientDataCache.set(path, { data, timestamp: Date.now() });
      }

      return data;
    } finally {
      if (isGet) {
        inflightGetRequests.delete(path);
      }
    }
  })();

  if (isGet && !bypassCache) {
    inflightGetRequests.set(path, fetchPromise);
  }

  return fetchPromise;
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
// PHOTO UPLOAD & RESIZE (Optimized for Fast Uploads)
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
      // High-performance image scaling: 800px max dimension, quality 0.78
      const maxDim = 800;
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

      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      currentUploadedImageBase64 = dataUrl;
      if (photoPreviewImg) photoPreviewImg.src = dataUrl;
      if (dropzonePrompt) dropzonePrompt.classList.add('hidden');
      if (photoPreviewBox) photoPreviewBox.classList.remove('hidden');
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
  const errElem = document.querySelector('#reportFormError');
  if (errElem) {
    errElem.textContent = '';
    errElem.classList.add('hidden');
  }
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
// CONNECT / CLAIM PROOF PHOTO PROCESSING
// -------------------------------------------------------------
function processConnectProofImage(file) {
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
      const maxDim = 800;
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

      const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
      currentConnectProofImageBase64 = dataUrl;
      if (connectPhotoPreviewImg) connectPhotoPreviewImg.src = dataUrl;
      if (connectDropzonePrompt) connectDropzonePrompt.classList.add('hidden');
      if (connectPhotoPreviewBox) connectPhotoPreviewBox.classList.remove('hidden');
    };
    img.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function clearConnectProofPhoto() {
  currentConnectProofImageBase64 = null;
  if (connectPhotoInput) connectPhotoInput.value = '';
  if (connectPhotoPreviewImg) connectPhotoPreviewImg.src = '';
  if (connectDropzonePrompt) connectDropzonePrompt.classList.remove('hidden');
  if (connectPhotoPreviewBox) connectPhotoPreviewBox.classList.add('hidden');
}

if (connectPhotoDropzone && connectPhotoInput) {
  connectPhotoDropzone.addEventListener('click', (e) => {
    if (e.target.id === 'connectRemovePhotoBtn' || e.target.closest('#connectRemovePhotoBtn')) return;
    connectPhotoInput.click();
  });
  connectPhotoInput.addEventListener('click', (e) => e.stopPropagation());
  connectPhotoInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) processConnectProofImage(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach((ev) => {
    connectPhotoDropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      connectPhotoDropzone.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach((ev) => {
    connectPhotoDropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      connectPhotoDropzone.classList.remove('dragover');
    });
  });
  connectPhotoDropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt.files && dt.files[0]) processConnectProofImage(dt.files[0]);
  });
}

if (connectRemovePhotoBtn) {
  connectRemovePhotoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clearConnectProofPhoto();
  });
}

// -------------------------------------------------------------
// 1. RENDER EXPLORE ITEMS FEED
// -------------------------------------------------------------
function isItemOwner(item) {
  if (!currentUser || !item) return false;
  if (currentUser.id != null && item.owner_id != null) {
    return Number(currentUser.id) === Number(item.owner_id);
  }
  if (currentUser.email && item.owner_email) {
    return currentUser.email.trim().toLowerCase() === item.owner_email.trim().toLowerCase();
  }
  return false;
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

    // When viewing "My Posts" tab, show all owned reports (Active + Resolved) unless user explicitly filtered by a specific status
    let matchStatus = true;
    if (currentFilter === 'MyPosts') {
      if (currentStatusFilter === 'Resolved') {
        matchStatus = i.status === 'Resolved';
      } else if (currentStatusFilter === 'Archived') {
        matchStatus = i.status === 'Archived';
      } else {
        matchStatus = true; // Show all user's reports by default
      }
    } else {
      matchStatus =
        currentStatusFilter === 'All'
          ? true
          : currentStatusFilter === 'Open'
          ? i.status === 'Open' || !i.status
          : i.status === currentStatusFilter;
    }

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
// 2. RENDER LIVE SMART MATCHES & DEDICATED HUB
// -------------------------------------------------------------
let currentMatchesList = [];
const matchDetailDialog = document.querySelector('#matchDetailDialog');
const smartMatchesDialog = document.querySelector('#smartMatchesDialog');

function renderMatchCardHtml(m, idx) {
  const l = m.lost_item || {};
  const f = m.found_item || {};
  const lIcon = getItemIcon(l.name, l.category, l.description);
  const fIcon = getItemIcon(f.name, f.category, f.description);
  const lThumb = l.image_data ? `<img src="${l.image_data}" alt="${escapeHtml(l.name)}" />` : lIcon;
  const fThumb = f.image_data ? `<img src="${f.image_data}" alt="${escapeHtml(f.name)}" />` : fIcon;

  const isLostOwner = isItemOwner(l);
  const targetItem = isLostOwner ? f : l;
  const btnLabel = isLostOwner ? 'Contact Finder 💬' : 'Contact Possible Owner 💬';
  const autoMsg = isLostOwner
    ? `Hi, I received a Smart Match for '${f.name || 'this item'}'. I believe this may be my lost '${l.name}'. Can we verify the ownership details?`
    : `Hi, I received a Smart Match for your lost '${l.name}'. I have found an item matching your description. Can we connect to verify?`;

  const score = Number(m.match_score != null ? m.match_score : (m.score != null ? m.score : 0));
  const strength = m.match_strength || (score >= 80 ? 'Strong Match' : score >= 65 ? 'Possible Match' : 'Low Confidence');
  const reasons = m.match_reasons || m.reasons || [];
  const strengthClass = score >= 80 ? 'strength-strong' : score >= 65 ? 'strength-possible' : 'strength-low';
  const fillClass = score >= 80 ? 'fill-strong' : score >= 65 ? 'fill-possible' : 'fill-low';
  const strengthEmoji = score >= 80 ? '⚡' : score >= 65 ? '🟡' : '🔍';

  const lostReporterName = (m.lost_reporter && m.lost_reporter.name) || l.owner_name || 'Campus Member';
  const lostReporterRole = (m.lost_reporter && m.lost_reporter.role) || l.owner_role || 'Student';
  const foundReporterName = (m.found_reporter && m.found_reporter.name) || f.owner_name || 'Campus Finder';
  const foundReporterRole = (m.found_reporter && m.found_reporter.role) || f.owner_role || 'Student';

  const b = m.score_breakdown || {
    category: { score: 15, max: 15 },
    title: { score: 18, max: 20 },
    description: { score: 15, max: 20 },
    color: { score: 10, max: 10 },
    brand: { score: 10, max: 10 },
    visual: { score: 12, max: 15 },
    location: { score: 5, max: 5 },
    date: { score: 4, max: 5 },
    total: { score: score, max: 100 }
  };

  const g = m.gemini_analysis;

  return `
  <article class="match-pair-card" data-match-card-idx="${idx}" data-match-id="${m.id || idx}">
    <!-- Top Header -->
    <div class="match-card-top-header">
      <div class="match-header-left">
        <span class="match-ai-badge">⚡ SMART MATCH #${idx + 1}</span>
        <span class="match-strength-pill ${strengthClass}">${strengthEmoji} ${escapeHtml(strength)}</span>
      </div>
      <div class="match-score-badge-large ${strengthClass}">
        <b>${score}%</b>
        <small>MATCH CONFIDENCE</small>
      </div>
    </div>

    <!-- Items Side-by-Side Comparison -->
    <div class="match-items-comparison">
      <!-- Lost Item Side -->
      <div class="match-item-side">
        <div class="match-thumb">${lThumb}</div>
        <div class="match-item-details">
          <span class="pill-badge" style="background:#fdeee9; color:var(--coral); font-size:10px;">${isLostOwner ? 'YOUR LOST ITEM' : 'LOST ITEM'}</span>
          <h4>${escapeHtml(l.name || 'Lost Item')}</h4>
          <p>⌖ <b>Location:</b> ${escapeHtml(l.location || 'Campus')}</p>
          <p>📁 <b>Category:</b> ${escapeHtml(l.category || 'General')}</p>
          <p>📅 <b>Date:</b> ${l.date || l.item_date || 'Recent'}</p>
        </div>
      </div>

      <!-- Swap Indicator -->
      <div class="match-swap-icon">↔</div>

      <!-- Found Item Side -->
      <div class="match-item-side">
        <div class="match-thumb">${fThumb}</div>
        <div class="match-item-details">
          <span class="pill-badge" style="background:#eaf5ef; color:var(--green); font-size:10px;">${!isLostOwner ? 'YOUR FOUND ITEM' : 'FOUND ITEM'}</span>
          <h4>${escapeHtml(f.name || 'Found Item')}</h4>
          <p>⌖ <b>Location:</b> ${escapeHtml(f.location || 'Campus')}</p>
          <p>📁 <b>Category:</b> ${escapeHtml(f.category || 'General')}</p>
          <p>📅 <b>Date:</b> ${f.date || f.item_date || 'Recent'}</p>
        </div>
      </div>
    </div>

    <!-- Match Confidence Bar -->
    <div class="match-meter-box">
      <div class="match-meter-header">
        <span>MATCH CONFIDENCE</span>
        <span class="match-confidence-pct"><b>${score}%</b> · ${escapeHtml(strength)}</span>
      </div>
      <div class="match-meter-bar">
        <div class="match-meter-fill ${fillClass}" style="width: ${score}%;"></div>
      </div>

      <div class="match-reasons-title">Why This Matched</div>
      <div class="match-reasons-grid">
        ${reasons.map((r) => `<span class="match-reason-pill">✓ ${escapeHtml(r)}</span>`).join('')}
      </div>

      <!-- Score Breakdown Table -->
      <div class="match-score-breakdown">
        <div class="match-breakdown-title">
          <span>Match Score Breakdown</span>
          <b style="color:${score >= 80 ? '#047857' : '#b45309'};">${score} / 100</b>
        </div>
        <div class="match-breakdown-grid">
          <div class="match-breakdown-row"><span>Category</span><b>${b.category.score}/${b.category.max}</b></div>
          <div class="match-breakdown-row"><span>Item Type</span><b>${b.title.score}/${b.title.max}</b></div>
          <div class="match-breakdown-row"><span>Description</span><b>${b.description.score}/${b.description.max}</b></div>
          <div class="match-breakdown-row"><span>Color</span><b>${b.color.score}/${b.color.max}</b></div>
          <div class="match-breakdown-row"><span>Brand</span><b>${b.brand.score}/${b.brand.max}</b></div>
          <div class="match-breakdown-row"><span>Visual Features</span><b>${b.visual.score}/${b.visual.max}</b></div>
          <div class="match-breakdown-row"><span>Location</span><b>${b.location.score}/${b.location.max}</b></div>
          <div class="match-breakdown-row"><span>Date Proximity</span><b>${b.date.score}/${b.date.max}</b></div>
        </div>
      </div>

      <!-- Gemini AI Observations -->
      ${g ? `
        <div class="match-gemini-box">
          <div class="match-gemini-head">🤖 AI Visual Analysis (Gemini Vision)</div>
          <div class="match-gemini-tags">
            ${g.item_type ? `<span class="match-gemini-tag">Item: ${escapeHtml(g.item_type)}</span>` : ''}
            ${g.primary_color ? `<span class="match-gemini-tag">Color: ${escapeHtml(g.primary_color)}</span>` : ''}
            ${g.brand ? `<span class="match-gemini-tag">Brand: ${escapeHtml(g.brand)}</span>` : ''}
            ${g.features && g.features.length ? g.features.slice(0, 3).map(ft => `<span class="match-gemini-tag">Feature: ${escapeHtml(ft)}</span>`).join('') : ''}
          </div>
          ${g.visual_description ? `<p class="match-gemini-desc">"${escapeHtml(g.visual_description)}"</p>` : ''}
        </div>
      ` : (m.ai_visual_description ? `
        <div class="match-ai-desc-box">
          🤖 <b>AI Visual Analysis:</b> ${escapeHtml(m.ai_visual_description)}
        </div>
      ` : '')}
    </div>

    <!-- Reporters Identification Summary Row -->
    <div class="match-reporters-summary-row">
      <div class="match-reporter-box">
        <span class="match-reporter-label">Lost Reported By</span>
        <span class="match-reporter-val">👤 ${escapeHtml(lostReporterName)} (${escapeHtml(lostReporterRole)})</span>
      </div>
      <div class="match-reporter-box">
        <span class="match-reporter-label">Found Reported By</span>
        <span class="match-reporter-val">👤 ${escapeHtml(foundReporterName)} (${escapeHtml(foundReporterRole)})</span>
      </div>
    </div>

    <!-- Actions -->
    <div class="match-card-actions">
      <button type="button" class="button button-secondary button-sm" data-view-match-idx="${idx}">
        🔍 View Details
      </button>
      <button type="button" class="button button-primary button-sm" data-match-connect-item="${targetItem.id}" data-match-msg="${escapeHtml(autoMsg)}">
        ${btnLabel}
      </button>
    </div>
  </article>
  `;
}

async function loadSmartMatches() {
  const container = document.querySelector('#userSmartMatchesContainer');
  const modalGrid = document.querySelector('#smartMatchesModalGrid');
  const modalBadge = document.querySelector('#modalTotalMatchesBadge');

  if (!currentUser || currentUser.role === 'admin') {
    if (container) container.innerHTML = '';
    if (modalGrid) modalGrid.innerHTML = '<p class="empty">Please sign in as a student or campus member to view Smart Matches.</p>';
    if (modalBadge) modalBadge.textContent = 'Total Smart Matches: 0';
    return;
  }

  try {
    const data = await api('/api/smart-matches');
    matches = data.matches || [];
    syncUserMetrics();

    // Show matches strictly relevant to this user's reports
    const relevantMatches = matches.filter((m) => isItemOwner(m.lost_item) || isItemOwner(m.found_item));
    currentMatchesList = relevantMatches;

    const badge = document.querySelector('#navMatchBadge');
    const mobileBadge = document.querySelector('#mobileMatchBadge');
    if (badge) {
      if (relevantMatches.length > 0) {
        badge.textContent = relevantMatches.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }
    if (mobileBadge) {
      if (relevantMatches.length > 0) {
        mobileBadge.textContent = relevantMatches.length;
        mobileBadge.classList.remove('hidden');
      } else {
        mobileBadge.classList.add('hidden');
      }
    }

    if (modalBadge) {
      modalBadge.textContent = `Total Smart Matches: ${relevantMatches.length}`;
    }

    if (relevantMatches.length === 0) {
      const emptyHtml = `
        <div class="empty" style="background:#ffffff; border:1px solid #e2e8f0; border-radius:14px; padding:36px; text-align:center; margin-top:12px;">
          <span style="font-size:36px; display:block; margin-bottom:10px;">⚡</span>
          <b style="font-size:16px; color:var(--ink);">⚡ No Smart Matches Yet</b>
          <p style="color:var(--muted); font-size:13px; margin-top:6px; max-width:400px; margin-left:auto; margin-right:auto;">
            We'll notify you automatically when a potential match is found for your lost or found reports.
          </p>
        </div>
      `;

      if (container) {
        container.innerHTML = `
          <div class="matches-section" id="matches" style="margin-top: 32px;">
            <div class="section-heading">
              <div>
                <p class="eyebrow"><span></span> AI-POWERED CORRELATION</p>
                <h2>⚡ Live Smart Matches</h2>
                <p class="section-subtext">Automated matching between lost reports and found campus items.</p>
              </div>
              <button class="button button-secondary button-sm" id="btnRefreshMatches">↺ Refresh</button>
            </div>
            ${emptyHtml}
          </div>
        `;
        document.querySelector('#btnRefreshMatches')?.addEventListener('click', () => loadSmartMatches());
      }

      if (modalGrid) {
        modalGrid.innerHTML = emptyHtml;
      }
      return;
    }

    const cardsHtml = relevantMatches.map((m, idx) => renderMatchCardHtml(m, idx)).join('');

    if (container) {
      container.innerHTML = `
        <div class="matches-section" id="matches" style="margin-top: 32px;">
          <div class="section-heading">
            <div>
              <p class="eyebrow"><span></span> AI-POWERED CORRELATION</p>
              <h2>⚡ Live Smart Matches</h2>
              <p class="section-subtext">${relevantMatches.length} potential match${relevantMatches.length > 1 ? 'es' : ''} found for your campus reports.</p>
            </div>
            <button class="button button-secondary button-sm" id="btnRefreshMatches">↺ Refresh</button>
          </div>
          <div id="matchesHomeGrid" class="matches-home-grid">
            ${cardsHtml}
          </div>
        </div>
      `;
      document.querySelector('#btnRefreshMatches')?.addEventListener('click', () => loadSmartMatches());
    }

    if (modalGrid) {
      modalGrid.innerHTML = cardsHtml;
    }
  } catch (err) {
    if (container) container.innerHTML = '';
    if (modalGrid) {
      modalGrid.innerHTML = `
        <div class="empty" style="padding:32px; text-align:center;">
          <p style="color:var(--coral); font-weight:600;">We couldn't load Smart Matches right now.</p>
          <button class="button button-secondary button-sm" style="margin-top:8px;" onclick="loadSmartMatches()">Try Again</button>
        </div>
      `;
    }
  }
}

async function handleOpenSmartMatches(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!currentUser) {
    openAuthModal('login');
    notify('Please sign in to view your Smart Match alerts.');
    return;
  }
  if (smartMatchesDialog) {
    document.body.classList.add('modal-open');
    if (!smartMatchesDialog.open) {
      smartMatchesDialog.showModal();
    }
  }
  await loadSmartMatches();
}
const openSmartMatchesModal = handleOpenSmartMatches;
window.handleOpenSmartMatches = handleOpenSmartMatches;
window.openSmartMatchesModal = handleOpenSmartMatches;

function closeSmartMatchesPopup() {
  if (smartMatchesDialog && smartMatchesDialog.open) {
    smartMatchesDialog.close();
    document.body.classList.remove('modal-open');
  }
}

document.querySelector('#closeSmartMatchesModal')?.addEventListener('click', closeSmartMatchesPopup);
document.querySelector('#btnCloseSmartMatchesFooter')?.addEventListener('click', closeSmartMatchesPopup);
document.querySelector('#btnModalRefreshMatches')?.addEventListener('click', () => loadSmartMatches());

smartMatchesDialog?.addEventListener('click', (e) => {
  const rect = smartMatchesDialog.getBoundingClientRect();
  const isInDialog = (
    rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
    rect.left <= e.clientX && e.clientX <= rect.left + rect.width
  );
  if (!isInDialog) {
    closeSmartMatchesPopup();
  }
});
smartMatchesDialog?.addEventListener('close', () => {
  document.body.classList.remove('modal-open');
});

function openMatchDetail(matchIdx) {
  const m = currentMatchesList[matchIdx];
  if (!m || !matchDetailDialog) return;

  const l = m.lost_item || {};
  const f = m.found_item || {};
  const isLostOwner = isItemOwner(l);
  const targetItem = isLostOwner ? f : l;
  const btnLabel = isLostOwner ? 'Contact Finder 💬' : 'Contact Possible Owner 💬';
  const autoMsg = isLostOwner
    ? `Hi, I received a Smart Match for '${f.name || 'this item'}'. I believe this may be my lost '${l.name}'. Can we verify the ownership details?`
    : `Hi, I received a Smart Match for your lost '${l.name}'. I have found an item matching your description. Can we connect to verify?`;

  const score = Number(m.match_score != null ? m.match_score : (m.score != null ? m.score : 0));
  const strength = m.match_strength || (score >= 80 ? 'Strong Match' : score >= 65 ? 'Possible Match' : 'Low Confidence');
  const reasons = m.match_reasons || m.reasons || [];
  const strengthClass = score >= 80 ? 'strength-strong' : score >= 65 ? 'strength-possible' : 'strength-low';
  const fillClass = score >= 80 ? 'fill-strong' : score >= 65 ? 'fill-possible' : 'fill-low';
  const strengthEmoji = score >= 80 ? '⚡' : score >= 65 ? '🟡' : '🔍';

  const lIcon = getItemIcon(l.name, l.category, l.description);
  const fIcon = getItemIcon(f.name, f.category, f.description);
  const lImg = l.image_data ? `<img src="${l.image_data}" alt="${escapeHtml(l.name)}" style="max-height:160px; max-width:100%; border-radius:8px; object-fit:contain;" />` : `<div style="font-size:48px; text-align:center; padding:20px 0;">${lIcon}</div>`;
  const fImg = f.image_data ? `<img src="${f.image_data}" alt="${escapeHtml(f.name)}" style="max-height:160px; max-width:100%; border-radius:8px; object-fit:contain;" />` : `<div style="font-size:48px; text-align:center; padding:20px 0;">${fIcon}</div>`;

  const lostReporterName = (m.lost_reporter && m.lost_reporter.name) || l.owner_name || 'Campus Member';
  const lostReporterRole = (m.lost_reporter && m.lost_reporter.role) || l.owner_role || 'Student';
  const foundReporterName = (m.found_reporter && m.found_reporter.name) || f.owner_name || 'Campus Finder';
  const foundReporterRole = (m.found_reporter && m.found_reporter.role) || f.owner_role || 'Student';

  const b = m.score_breakdown || {
    category: { score: 15, max: 15 },
    title: { score: 18, max: 20 },
    description: { score: 15, max: 20 },
    color: { score: 10, max: 10 },
    brand: { score: 10, max: 10 },
    visual: { score: 12, max: 15 },
    location: { score: 5, max: 5 },
    date: { score: 4, max: 5 },
    total: { score: score, max: 100 }
  };

  const g = m.gemini_analysis;

  const content = document.querySelector('#matchDetailContent');
  if (content) {
    content.innerHTML = `
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin: 16px 0;">
        <!-- Lost Side -->
        <div style="background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px;">
          <span class="pill-badge" style="background:#fdeee9; color:var(--coral);">${isLostOwner ? 'YOUR LOST REPORT' : 'LOST REPORT'}</span>
          <h3 style="margin:8px 0 4px; font-size:16px;">${escapeHtml(l.name || 'Lost Item')}</h3>
          <p style="font-size:12px; color:var(--muted); margin:0 0 8px;">⌖ ${escapeHtml(l.location || 'Campus')} · ${escapeHtml(l.category || 'Item')}</p>
          <div style="background:#f8fafc; border-radius:8px; display:grid; place-items:center; margin-bottom:10px; min-height:110px;">${lImg}</div>
          <p style="font-size:12px; line-height:1.5; color:var(--ink);">${escapeHtml(l.description || 'No description provided.')}</p>
          <small style="color:var(--muted); display:block; margin-top:8px;">👤 Reported by: <b>${escapeHtml(lostReporterName)}</b> (${escapeHtml(lostReporterRole)})</small>
          <small style="color:var(--muted); display:block; margin-top:2px;">📅 Date: ${l.date || l.item_date || 'Recent'}</small>
        </div>

        <!-- Found Side -->
        <div style="background:#fff; border:1px solid var(--line); border-radius:12px; padding:16px;">
          <span class="pill-badge" style="background:#eaf5ef; color:var(--green);">${!isLostOwner ? 'YOUR FOUND REPORT' : 'FOUND REPORT'}</span>
          <h3 style="margin:8px 0 4px; font-size:16px;">${escapeHtml(f.name || 'Found Item')}</h3>
          <p style="font-size:12px; color:var(--muted); margin:0 0 8px;">⌖ ${escapeHtml(f.location || 'Campus')} · ${escapeHtml(f.category || 'Item')}</p>
          <div style="background:#f8fafc; border-radius:8px; display:grid; place-items:center; margin-bottom:10px; min-height:110px;">${fImg}</div>
          <p style="font-size:12px; line-height:1.5; color:var(--ink);">${escapeHtml(f.description || 'No description provided.')}</p>
          <small style="color:var(--muted); display:block; margin-top:8px;">👤 Reported by: <b>${escapeHtml(foundReporterName)}</b> (${escapeHtml(foundReporterRole)})</small>
          <small style="color:var(--muted); display:block; margin-top:2px;">📅 Date: ${f.date || f.item_date || 'Recent'}</small>
        </div>
      </div>

      <div class="match-meter-box" style="margin-bottom:16px;">
        <div class="match-meter-header">
          <span>AI MATCH CONFIDENCE</span>
          <span class="match-confidence-pct"><b>${score}%</b> · ${escapeHtml(strength)}</span>
        </div>
        <div class="match-meter-bar">
          <div class="match-meter-fill ${fillClass}" style="width: ${score}%;"></div>
        </div>

        <div class="match-reasons-title">Why This Matched</div>
        <div class="match-reasons-grid">
          ${reasons.map((r) => `<span class="match-reason-pill">✓ ${escapeHtml(r)}</span>`).join('')}
        </div>

        <!-- Score Breakdown Table -->
        <div class="match-score-breakdown">
          <div class="match-breakdown-title">
            <span>Match Score Breakdown</span>
            <b style="color:${score >= 80 ? '#047857' : '#b45309'};">${score} / 100</b>
          </div>
          <div class="match-breakdown-grid">
            <div class="match-breakdown-row"><span>Category</span><b>${b.category.score}/${b.category.max}</b></div>
            <div class="match-breakdown-row"><span>Item Type</span><b>${b.title.score}/${b.title.max}</b></div>
            <div class="match-breakdown-row"><span>Description</span><b>${b.description.score}/${b.description.max}</b></div>
            <div class="match-breakdown-row"><span>Color</span><b>${b.color.score}/${b.color.max}</b></div>
            <div class="match-breakdown-row"><span>Brand</span><b>${b.brand.score}/${b.brand.max}</b></div>
            <div class="match-breakdown-row"><span>Visual Features</span><b>${b.visual.score}/${b.visual.max}</b></div>
            <div class="match-breakdown-row"><span>Location</span><b>${b.location.score}/${b.location.max}</b></div>
            <div class="match-breakdown-row"><span>Date Proximity</span><b>${b.date.score}/${b.date.max}</b></div>
          </div>
        </div>

        <!-- Gemini AI Observations -->
        ${g ? `
          <div class="match-gemini-box">
            <div class="match-gemini-head">🤖 AI Visual Analysis (Gemini Vision)</div>
            <div class="match-gemini-tags">
              ${g.item_type ? `<span class="match-gemini-tag">Item: ${escapeHtml(g.item_type)}</span>` : ''}
              ${g.primary_color ? `<span class="match-gemini-tag">Color: ${escapeHtml(g.primary_color)}</span>` : ''}
              ${g.brand ? `<span class="match-gemini-tag">Brand: ${escapeHtml(g.brand)}</span>` : ''}
              ${g.features && g.features.length ? g.features.slice(0, 3).map(ft => `<span class="match-gemini-tag">Feature: ${escapeHtml(ft)}</span>`).join('') : ''}
            </div>
            ${g.visual_description ? `<p class="match-gemini-desc">"${escapeHtml(g.visual_description)}"</p>` : ''}
          </div>
        ` : (m.ai_visual_description ? `
          <div class="match-ai-desc-box">
            🤖 <b>AI Visual Analysis:</b> ${escapeHtml(m.ai_visual_description)}
          </div>
        ` : '')}
      </div>

      <div class="modal-footer">
        <button type="button" class="button button-secondary" id="btnCloseMatchDetailModal">Close</button>
        <button type="button" class="button button-primary" id="btnConnectFromMatchDetail" data-match-connect-item="${targetItem.id}" data-match-msg="${escapeHtml(autoMsg)}">
          ${btnLabel} <span>→</span>
        </button>
      </div>
    `;

    document.querySelector('#btnCloseMatchDetailModal')?.addEventListener('click', () => matchDetailDialog.close());
    document.querySelector('#btnConnectFromMatchDetail')?.addEventListener('click', () => {
      matchDetailDialog.close();
      openConnection(targetItem.id, autoMsg);
    });
  }

  matchDetailDialog.showModal();
}

document.querySelector('#closeMatchDetail')?.addEventListener('click', () => matchDetailDialog?.close());

// Global click delegation for match connect & detail buttons & top alert cards
document.addEventListener('click', (e) => {
  const topMatchCard = e.target.closest('#btnMetricMatches, .smart-match-alert-card, [data-open-smart-matches]');
  if (topMatchCard) {
    e.preventDefault();
    handleOpenSmartMatches(e);
    return;
  }

  const connBtn = e.target.closest('[data-match-connect-item]');
  if (connBtn) {
    const itemId = Number(connBtn.dataset.matchConnectItem);
    const autoMsg = connBtn.dataset.matchMsg || '';
    openConnection(itemId, autoMsg);
    return;
  }

  const viewBtn = e.target.closest('[data-view-match-idx]');
  if (viewBtn) {
    openMatchDetail(Number(viewBtn.dataset.viewMatchIdx));
    return;
  }

  const dismissBtn = e.target.closest('[data-dismiss-match-id]');
  if (dismissBtn) {
    const card = dismissBtn.closest('.match-pair-card');
    if (card) {
      card.style.transition = 'opacity 0.3s, transform 0.3s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      setTimeout(() => {
        card.remove();
        notify('Feedback recorded. Thank you for helping refine match accuracy.');
      }, 300);
    }
    return;
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

    const toggleBtn = document.querySelector('#btnToggleStatus');
    toggleBtn?.addEventListener('click', async () => {
      const nextStatus = isResolved ? 'Open' : 'Resolved';
      const origText = toggleBtn.innerHTML;
      toggleBtn.disabled = true;
      toggleBtn.innerHTML = '⏳ Updating...';
      try {
        await api(`/api/items/${item.id}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: nextStatus }),
        });
        const localItem = items.find((x) => x.id === item.id);
        if (localItem) localItem.status = nextStatus;
        renderItems();
        syncUserMetrics();
        itemDetailDialog.close();
        notify(`✓ Report marked as ${nextStatus.toLowerCase()}.`);
        await Promise.all([loadItems(), loadSmartMatches()]);
      } catch (e) {
        notify(`Could not update status: ${e.message}`);
        toggleBtn.disabled = false;
        toggleBtn.innerHTML = origText;
      }
    });

    const deleteBtn = document.querySelector('#btnDeleteItem');
    deleteBtn?.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to permanently delete this report?')) return;
      const origText = deleteBtn.innerHTML;
      deleteBtn.disabled = true;
      deleteBtn.innerHTML = '⏳ Deleting...';

      try {
        await api(`/api/items/${item.id}`, { method: 'DELETE' });
        items = items.filter((x) => x.id !== item.id);
        renderItems();
        syncUserMetrics();
        itemDetailDialog.close();
        notify('✓ Report deleted successfully.');
        await Promise.all([
          loadItems(),
          loadSmartMatches(),
          loadConnections(),
        ]);
        syncUserMetrics();
      } catch (e) {
        notify(`Could not delete report: ${e.message}`);
        deleteBtn.disabled = false;
        deleteBtn.innerHTML = origText;
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
async function loadMyReports() {
  const container = document.querySelector('#myReportsList');
  if (!container) return;
  if (!currentUser) {
    container.innerHTML = '<p class="empty">Please sign in to view your reports.</p>';
    return;
  }
  try {
    const data = await api('/api/user/items');
    const userItems = data.items || [];

    if (!userItems.length) {
      container.innerHTML = '<p class="empty">You have not published any lost or found reports yet.</p>';
    } else {
      container.innerHTML = userItems
        .map((it) => {
          const isResolved = it.status === 'Resolved';
          const itDate = it.date || it.item_date || (it.created_at ? new Date(it.created_at).toLocaleDateString() : '');
          return `
          <article class="my-report-card" data-my-card-id="${it.id}">
            <div class="my-report-info">
              <b>${escapeHtml(it.name)}</b>
              <small>⌖ ${escapeHtml(it.location)} · ${itDate}</small>
              <div style="margin-top:4px;">
                <span class="pill-badge" style="background:${it.type === 'Found' ? '#eaf5ef' : '#fdeee9'}; color:${it.type === 'Found' ? 'var(--green)' : 'var(--coral)'};">${it.type.toUpperCase()}</span>
                <span class="pill-badge ${isResolved ? 'status-resolved' : 'status-open'}">${isResolved ? 'RESOLVED' : 'ACTIVE'}</span>
              </div>
            </div>
            <div class="my-report-actions">
              <button class="button button-secondary button-sm" data-my-toggle-id="${it.id}" data-current-status="${it.status || 'Open'}">
                ${isResolved ? '↺ Reopen' : '✓ Mark Resolved'}
              </button>
              <button class="button button-danger button-sm" data-my-delete-id="${it.id}">
                🗑 Delete
              </button>
            </div>
          </article>
        `;
        })
        .join('');
    }
  } catch (e) {
    container.innerHTML = `<p class="empty" style="color:var(--coral);">Failed to load reports: ${escapeHtml(e.message)}</p>`;
  }
}

async function openMyReports() {
  if (!currentUser) {
    openAuthModal('login');
    notify('Please sign in to view your reports.');
    return;
  }
  myReportsDialog.showModal();
  await loadMyReports();
}

document.querySelector('#openMyReports')?.addEventListener('click', openMyReports);
document.querySelector('#quickMyReports')?.addEventListener('click', openMyReports);
document.querySelector('#closeMyReports')?.addEventListener('click', () => myReportsDialog.close());

document.querySelector('#myReportsList')?.addEventListener('click', async (e) => {
  const toggleBtn = e.target.closest('[data-my-toggle-id]');
  if (toggleBtn) {
    if (toggleBtn.disabled) return;
    const itemId = Number(toggleBtn.dataset.myToggleId);
    const current = toggleBtn.dataset.currentStatus;
    const nextStatus = current === 'Resolved' ? 'Open' : 'Resolved';
    const origText = toggleBtn.innerHTML;
    toggleBtn.disabled = true;
    toggleBtn.innerHTML = '⏳ Updating...';

    try {
      await api(`/api/items/${itemId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus }),
      });
      notify(`✓ Report marked as ${nextStatus.toLowerCase()}.`);
      const localItem = items.find((x) => x.id === itemId);
      if (localItem) localItem.status = nextStatus;
      renderItems();
      syncUserMetrics();
      await Promise.all([loadMyReports(), loadSmartMatches()]);
    } catch (err) {
      notify(`Could not update status: ${err.message}`);
      toggleBtn.disabled = false;
      toggleBtn.innerHTML = origText;
    }
    return;
  }

  const deleteBtn = e.target.closest('[data-my-delete-id]');
  if (deleteBtn) {
    if (deleteBtn.disabled) return;
    const itemId = Number(deleteBtn.dataset.myDeleteId);
    if (!confirm('Are you sure you want to permanently delete this report?')) return;

    const origText = deleteBtn.innerHTML;
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = '⏳ Deleting...';

    try {
      await api(`/api/items/${itemId}`, { method: 'DELETE' });

      // 1. Instantly remove deleted item from local arrays & DOM
      items = items.filter((x) => x.id !== itemId);
      const card = deleteBtn.closest('.my-report-card');
      if (card) card.remove();
      const remainingCards = document.querySelectorAll('#myReportsList .my-report-card');
      if (remainingCards.length === 0) {
        document.querySelector('#myReportsList').innerHTML = '<p class="empty">You have not published any lost or found reports yet.</p>';
      }
      renderItems();
      syncUserMetrics();

      // 2. Authoritative backend refresh in parallel
      await Promise.all([
        loadItems(),
        loadSmartMatches(),
        loadConnections(),
      ]);
      syncUserMetrics();

      // 3. Clear success notification
      notify('✓ Report deleted successfully.');
    } catch (err) {
      notify(`Could not delete report: ${err.message}`);
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = origText;
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
            ${c.proof_image ? `
              <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #e2e8f0;">
                <span style="font-weight: 800; color: var(--coral); font-size: 11px; display: block; margin-bottom: 6px;">📷 Photo Proof of Item Attached:</span>
                <img src="${c.proof_image}" alt="Claim Proof Photo" style="max-height: 180px; max-width: 100%; border-radius: 8px; border: 1px solid var(--line); cursor: pointer; object-fit: contain; background: #faf9f6; display: block;" onclick="window.open('${c.proof_image}', '_blank')" title="Click to open full size photo" />
              </div>
            ` : ''}
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
function openConnection(itemId, defaultMessage = '') {
  if (!currentUser) {
    openAuthModal('login');
    notify('Please sign in to connect with the reporter.');
    return;
  }
  const item = items.find((x) => x.id === itemId);
  if (!item) return;

  connectForm.itemId.value = itemId;
  clearConnectProofPhoto();

  if (connectForm.message) {
    connectForm.message.value = defaultMessage || '';
  }

  const proofPrompt = document.querySelector('#connectProofPrompt');
  if (item.proof_question && item.proof_question.trim()) {
    proofPrompt.classList.remove('hidden');
    document.querySelector('#connectProofQuestionText').textContent = item.proof_question;
  } else {
    proofPrompt.classList.add('hidden');
  }

  connectDialog.showModal();
}

let isSendingClaim = false;
if (connectForm) {
  connectForm.addEventListener('submit', async (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    if (isSendingClaim) return;

    const submitBtn = connectForm.querySelector('button[type="submit"]');
    const origBtnText = submitBtn ? submitBtn.innerHTML : 'Send Claim & Message <span>→</span>';
    isSendingClaim = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '⏳ Sending message...';
    }

    try {
      await api('/api/connections', {
        method: 'POST',
        body: JSON.stringify({
          item_id: Number(connectForm.itemId.value),
          message: connectForm.message.value,
          image_data: currentConnectProofImageBase64,
        }),
      });
      connectDialog.close();
      connectForm.reset();
      clearConnectProofPhoto();
      notify('✓ Claim request sent successfully! View replies in Messages & Notifications.');
      await Promise.all([
        loadConnections(),
        loadItems(),
        loadSmartMatches(),
      ]);
      openConnections();
    } catch (err) {
      notify(`Could not send claim message: ${err.message}`);
    } finally {
      isSendingClaim = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = origBtnText;
      }
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
    const el = document.querySelector('#adminDashboardSection');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    loadAdminDashboard();
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
  const myItems = items.filter((i) => isItemOwner(i));
  const myActiveCount = myItems.filter((i) => i.status === 'Open' || !i.status).length;
  const myMatchesCount = matches.filter((m) => {
    const isOwner = isItemOwner(m.lost_item) || isItemOwner(m.found_item);
    const isActive = m.lost_item?.status !== 'Resolved' && m.found_item?.status !== 'Resolved';
    return isOwner && isActive;
  }).length;
  const myMessagesCount = connections.length;

  const metricReportsEl = document.querySelector('#metricMyReportsCount');
  const metricMatchesEl = document.querySelector('#metricMyMatchesCount');
  const metricMessagesEl = document.querySelector('#metricMyMessagesCount');
  if (metricReportsEl) metricReportsEl.textContent = myActiveCount;
  if (metricMatchesEl) metricMatchesEl.textContent = myMatchesCount;
  if (metricMessagesEl) metricMessagesEl.textContent = myMessagesCount;

  // Show My Posts filter pill in repository
  const myPostsPill = document.querySelector('#myPostsFilterPill');
  const filterMyPostsCount = document.querySelector('#filterMyPostsCount');
  if (myPostsPill) myPostsPill.classList.remove('hidden');
  if (filterMyPostsCount) {
    filterMyPostsCount.textContent = myItems.length;
  }

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
  const isAdmin = signed && currentUser.role === 'admin';
  document.body.classList.toggle('is-authenticated', signed);
  document.body.classList.toggle('is-admin', isAdmin);
  
  // Top Navbar Navigation Toggles
  document.querySelector('#openAuth')?.classList.toggle('hidden', signed);
  document.querySelector('#profileButton')?.classList.toggle('hidden', !signed);
  document.querySelector('#topNavSignOut')?.classList.toggle('hidden', !signed);
  document.querySelector('#openMyReports')?.classList.toggle('hidden', !signed || isAdmin);
  document.querySelector('#openConnections')?.classList.toggle('hidden', !signed);

  // Hero & Informational Section Toggles
  const guestHero = document.querySelector('#discover');
  const userHero = document.querySelector('#userHero');
  const adminHero = document.querySelector('#adminDashboardSection');
  const howItWorks = document.querySelector('#how-it-works');
  const safeZones = document.querySelector('#safe-zones');
  const quickActions = document.querySelector('.quick-actions');
  const itemsSection = document.querySelector('#items');
  const matchesSection = document.querySelector('#matches');

  if (signed) {
    guestHero?.classList.add('hidden');
    howItWorks?.classList.add('hidden');
    safeZones?.classList.add('hidden');
    quickActions?.classList.add('hidden');

    if (isAdmin) {
      userHero?.classList.add('hidden');
      adminHero?.classList.remove('hidden');
      itemsSection?.classList.remove('hidden');
      itemsSection?.style.removeProperty('display');
      loadAdminDashboard();
    } else {
      adminHero?.classList.add('hidden');
      userHero?.classList.remove('hidden');
      itemsSection?.classList.remove('hidden');
      itemsSection?.style.removeProperty('display');
      syncUserMetrics();
    }

    document.querySelectorAll('.guest-nav').forEach((el) => el.classList.add('hidden'));
    document.querySelectorAll('.member-nav').forEach((el) => el.classList.remove('hidden'));

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
    if (profileRoleEl) profileRoleEl.textContent = isAdmin ? '👑 Administrator' : (currentUser.campus_role || 'Student');
    if (avatarInitialsEl) avatarInitialsEl.textContent = isAdmin ? '👑' : initials;

    // Mobile Drawer Profile Card
    const mobileUserNameEl = document.querySelector('#mobileUserName');
    const mobileUserRoleEl = document.querySelector('#mobileUserRole');
    const mobileAvatarInitialsEl = document.querySelector('#mobileAvatarInitials');
    if (mobileUserNameEl) mobileUserNameEl.textContent = currentUser.name;
    if (mobileUserRoleEl) mobileUserRoleEl.textContent = isAdmin ? '👑 Administrator' : (currentUser.campus_role || 'Student');
    if (mobileAvatarInitialsEl) mobileAvatarInitialsEl.textContent = isAdmin ? '👑' : initials;

    if (!isAdmin) {
      // User Dashboard Hero Info
      const heroInitialsEl = document.querySelector('#heroUserInitials');
      const heroNameEl = document.querySelector('#heroUserName');
      const heroRoleEl = document.querySelector('#heroUserRole');
      const heroEmailEl = document.querySelector('#heroUserEmail');
      if (heroInitialsEl) heroInitialsEl.textContent = initials;
      if (heroNameEl) heroNameEl.textContent = currentUser.name;
      if (heroRoleEl) heroRoleEl.textContent = currentUser.campus_role || 'Student';
      if (heroEmailEl) heroEmailEl.textContent = currentUser.email;
    }
  } else {
    guestHero?.classList.remove('hidden');
    userHero?.classList.add('hidden');
    adminHero?.classList.add('hidden');
    howItWorks?.classList.remove('hidden');
    safeZones?.classList.remove('hidden');
    quickActions?.classList.remove('hidden');
    itemsSection?.classList.add('hidden');
    itemsSection?.style.setProperty('display', 'none', 'important');

    document.querySelectorAll('.guest-nav').forEach((el) => el.classList.remove('hidden'));
    document.querySelectorAll('.member-nav').forEach((el) => el.classList.add('hidden'));

    const myPostsPill = document.querySelector('#myPostsFilterPill');
    if (myPostsPill) myPostsPill.classList.add('hidden');
  }

  // Re-render feed items to update owner badges and buttons
  renderItems();
}

document.querySelector('#btnGuestSignIn')?.addEventListener('click', () => openAuthModal('login'));

// User Dashboard Metric Cards Clicks
document.querySelector('#btnMetricReports')?.addEventListener('click', openMyReports);

const btnMetricMatches = document.querySelector('#btnMetricMatches');
if (btnMetricMatches) {
  btnMetricMatches.addEventListener('click', handleOpenSmartMatches);
  btnMetricMatches.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpenSmartMatches(e);
    }
  });
}

document.querySelectorAll('a[href="#matches"]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    closeMobileMenu();
    handleOpenSmartMatches(e);
  });
});
document.querySelector('#mobileNavMatches')?.addEventListener('click', (e) => {
  e.preventDefault();
  closeMobileMenu();
  handleOpenSmartMatches(e);
});
document.querySelector('#btnMetricMessages')?.addEventListener('click', openConnections);
document.querySelector('#btnMetricProfile')?.addEventListener('click', openUserProfile);

async function handleSignOut(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  const token = localStorage.getItem('foundly_token');

  // 1. Clear client storage & memory state immediately
  localStorage.removeItem('foundly_token');
  localStorage.removeItem('foundly_user');
  currentUser = null;
  connections = [];

  document.querySelectorAll('dialog').forEach((d) => {
    try { d.close(); } catch (_) {}
  });
  document.body.classList.remove('is-authenticated', 'modal-open');
  syncUser();
  notify('You have been signed out.');

  // 2. Broadcast generic logout to other open tabs
  if (authChannel) {
    try { authChannel.postMessage({ type: 'foundly_logout' }); } catch (_) {}
  }
  try {
    localStorage.setItem('foundly_logout_event', Date.now().toString());
  } catch (_) {}

  // 3. Server-side session invalidation
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    await fetch('/api/logout', { method: 'POST', headers, credentials: 'include' });
  } catch (_) {}
}

function handleRemoteLogout() {
  if (currentUser || localStorage.getItem('foundly_token')) {
    localStorage.removeItem('foundly_token');
    localStorage.removeItem('foundly_user');
    currentUser = null;
    connections = [];
    document.querySelectorAll('dialog').forEach((d) => {
      try { d.close(); } catch (_) {}
    });
    document.body.classList.remove('is-authenticated', 'modal-open');
    syncUser();
    notify('You have been signed out.');
  }
}

if (authChannel) {
  authChannel.onmessage = (event) => {
    if (event.data?.type === 'foundly_logout' || event.data === 'foundly_logout') {
      handleRemoteLogout();
    }
  };
}

window.addEventListener('storage', (e) => {
  if (e.key === 'foundly_logout_event' || (e.key === 'foundly_token' && !e.newValue)) {
    handleRemoteLogout();
  }
});

document.querySelector('#profileButton')?.addEventListener('click', openUserProfile);
document.querySelector('#closeUserProfile')?.addEventListener('click', () => userProfileDialog.close());
document.querySelector('#userSignOutBtn')?.addEventListener('click', handleSignOut);
document.querySelector('#signOut')?.addEventListener('click', handleSignOut);
document.querySelector('#topNavSignOut')?.addEventListener('click', handleSignOut);
document.querySelector('#dashboardSignOutBtn')?.addEventListener('click', handleSignOut);

document.querySelector('#profileMyReportsBtn')?.addEventListener('click', () => {
  userProfileDialog.close();
  openMyReports();
});
document.querySelector('#profileConnectionsBtn')?.addEventListener('click', () => {
  userProfileDialog.close();
  openConnections();
});

// Mobile Navigation Drawer Control
function closeMobileNav() {
  document.body.classList.remove('mobile-nav-open');
  const btn = document.querySelector('#mobileMenuBtn');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function openMobileNav() {
  document.body.classList.add('mobile-nav-open');
  const btn = document.querySelector('#mobileMenuBtn');
  if (btn) btn.setAttribute('aria-expanded', 'true');
}

function toggleMobileNav() {
  if (document.body.classList.contains('mobile-nav-open')) {
    closeMobileNav();
  } else {
    openMobileNav();
  }
}

document.querySelector('#mobileMenuBtn')?.addEventListener('click', toggleMobileNav);
document.querySelector('#mobileNavClose')?.addEventListener('click', closeMobileNav);
document.querySelector('#mobileNavOverlay')?.addEventListener('click', closeMobileNav);

document.querySelector('#mobileOpenMyReports')?.addEventListener('click', () => {
  closeMobileNav();
  openMyReports();
});
document.querySelector('#mobileOpenConnections')?.addEventListener('click', () => {
  closeMobileNav();
  openConnections();
});
document.querySelector('#mobileOpenProfile')?.addEventListener('click', () => {
  closeMobileNav();
  openUserProfile();
});
document.querySelector('#mobileOpenAuth')?.addEventListener('click', () => {
  closeMobileNav();
  openAuthModal('login');
});
document.querySelector('#mobileSignOut')?.addEventListener('click', (e) => {
  closeMobileNav();
  handleSignOut(e);
});

document.querySelectorAll('.mobile-nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    closeMobileNav();
  });
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
      if (currentUser.role === 'admin') {
        openAdmin();
      } else {
        await Promise.all([loadItems(), loadSmartMatches(), loadConnections()]);
      }
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
let isSubmittingReport = false;

function setType(type) {
  reportType = type;
  document.querySelectorAll('.type-choice').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  document.querySelector('#modalTitle').textContent = `Report a ${type.toLowerCase()} item`;
  const submitBtn = document.querySelector('#submitReport');
  if (submitBtn) {
    submitBtn.innerHTML = `Submit ${type} Report <span>→</span>`;
  }
}

function openReport(type) {
  if (!currentUser) {
    openAuthModal('login');
    notify('Please sign in to publish a report.');
    return;
  }
  setType(type);
  clearPhotoUpload();
  const errElem = document.querySelector('#reportFormError');
  if (errElem) {
    errElem.textContent = '';
    errElem.classList.add('hidden');
  }
  const submitBtn = document.querySelector('#submitReport');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `Submit ${type} Report <span>→</span>`;
  }
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
    if (isSubmittingReport) return;

    const d = new FormData(reportForm);
    const submitBtn = document.querySelector('#submitReport');
    const errElem = document.querySelector('#reportFormError');
    if (errElem) {
      errElem.textContent = '';
      errElem.classList.add('hidden');
    }

    const originalBtnText = `Submit ${reportType} Report <span>→</span>`;
    isSubmittingReport = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `⏳ Submitting report...`;
    }
    const formElements = Array.from(reportForm.elements);
    formElements.forEach((el) => {
      if (el !== submitBtn) el.disabled = true;
    });

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

      // SUCCESS FLOW:
      // 1. Show clear success message
      notify(`✓ Report submitted successfully! ${reportType === 'Lost' ? 'Lost item reported successfully.' : 'Found item reported successfully.'}`);
      
      // 2. Close report modal only AFTER successful response
      reportDialog.close();

      // 3. Reset form and uploaded photo state
      reportForm.reset();
      clearPhotoUpload();

      // 4. Refresh items, smart matches, dashboard counters, and my reports
      await Promise.all([loadItems(), loadSmartMatches(), loadConnections()]);
      if (myReportsDialog && myReportsDialog.open) {
        loadMyReports();
      }
      syncUserMetrics();
    } catch (err) {
      // ERROR FLOW: keep modal open, keep form inputs, display error
      console.error('Report submission failed:', err);
      const safeError = err.message || 'Could not submit the report. Please try again.';
      if (errElem) {
        errElem.textContent = `Could not submit the report. ${safeError}`;
        errElem.classList.remove('hidden');
      }
      notify(`Could not submit the report. ${safeError}`);
    } finally {
      isSubmittingReport = false;
      formElements.forEach((el) => {
        el.disabled = false;
      });
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }
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
// 10. DEDICATED CAMPUS ADMINISTRATOR CONTROL CENTER
// -------------------------------------------------------------
let adminUsersList = [];
let adminReportsList = [];

async function loadAdminDashboard() {
  if (!currentUser || currentUser.role !== 'admin') return;

  try {
    const data = await api('/api/admin/overview');
    const stats = data.stats || {};
    adminUsersList = data.users || [];
    adminReportsList = data.items || [];

    // Global Metric Counters
    const elUsers = document.querySelector('#adminStatUsers');
    const elReports = document.querySelector('#adminStatReports');
    const elLost = document.querySelector('#adminStatLost');
    const elFound = document.querySelector('#adminStatFound');
    const elResolved = document.querySelector('#adminStatResolved');
    const elConns = document.querySelector('#adminStatConnections');

    if (elUsers) elUsers.textContent = stats.users || 0;
    if (elReports) elReports.textContent = stats.reports || 0;
    if (elLost) elLost.textContent = stats.lost || 0;
    if (elFound) elFound.textContent = stats.found || 0;
    if (elResolved) elResolved.textContent = stats.resolved || 0;
    if (elConns) elConns.textContent = stats.connections || 0;

    // Tab counts
    const tabUsersCount = document.querySelector('#adminTabUsersCount');
    const tabReportsCount = document.querySelector('#adminTabReportsCount');
    if (tabUsersCount) tabUsersCount.textContent = adminUsersList.length;
    if (tabReportsCount) tabReportsCount.textContent = adminReportsList.length;

    renderAdminUsers();
    renderAdminReports();
  } catch (err) {
    console.error('Admin overview failed:', err);
  }
}

function renderAdminUsers(searchQuery = '') {
  const tbody = document.querySelector('#adminUsersTableBody');
  if (!tbody) return;

  const q = searchQuery.toLowerCase().trim();
  const filtered = adminUsersList.filter(
    (u) =>
      !q ||
      (u.name && u.name.toLowerCase().includes(q)) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.phone && u.phone.toLowerCase().includes(q)) ||
      (u.campus_role && u.campus_role.toLowerCase().includes(q))
  );

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 24px; color: var(--muted);">No users found matching "${escapeHtml(searchQuery)}"</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((u) => {
      const isMe = u.id === currentUser.id;
      const isBlocked = u.is_blocked || u.role === 'blocked';
      const statusBadge = isBlocked
        ? `<span class="badge-blocked">🔴 Blocked</span>`
        : `<span class="badge-active">🟢 Active</span>`;

      const actionButtons = isMe
        ? `<span style="font-size: 11px; font-weight: 700; color: var(--coral);">👑 Primary Admin</span>`
        : `
          <button class="admin-btn-action ${isBlocked ? 'admin-btn-unblock' : 'admin-btn-block'}" data-admin-action="toggle-block" data-user-id="${u.id}" data-blocked="${isBlocked}">
            ${isBlocked ? '✅ Unblock' : '🚫 Block'}
          </button>
          <button class="admin-btn-action admin-btn-delete" data-admin-action="delete-user" data-user-id="${u.id}">
            🗑 Delete
          </button>
        `;

      return `
        <tr>
          <td><b>#${u.id}</b></td>
          <td><b>${escapeHtml(u.name)}</b></td>
          <td><code>${escapeHtml(u.email)}</code></td>
          <td><span class="pill-badge">${escapeHtml(u.campus_role || 'Student')}</span></td>
          <td>${u.phone ? escapeHtml(u.phone) : '<small style="color:var(--muted)">None</small>'}</td>
          <td><b>${u.items_count || 0}</b></td>
          <td>${statusBadge}</td>
          <td style="text-align: right;">${actionButtons}</td>
        </tr>
      `;
    })
    .join('');
}

function renderAdminReports(searchQuery = '') {
  const tbody = document.querySelector('#adminReportsTableBody');
  if (!tbody) return;

  const q = searchQuery.toLowerCase().trim();
  const filtered = adminReportsList.filter(
    (it) =>
      !q ||
      (it.name && it.name.toLowerCase().includes(q)) ||
      (it.category && it.category.toLowerCase().includes(q)) ||
      (it.location && it.location.toLowerCase().includes(q)) ||
      (it.owner_name && it.owner_name.toLowerCase().includes(q))
  );

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 24px; color: var(--muted);">No reports found matching "${escapeHtml(searchQuery)}"</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((it) => {
      const typeBadge =
        it.type === 'Lost'
          ? `<span class="pill-badge status-lost" style="background:#fee2e2;color:#991b1b;">🔴 LOST</span>`
          : `<span class="pill-badge status-found" style="background:#dcfce7;color:#166534;">🟢 FOUND</span>`;
      const isResolved = it.status === 'Resolved';
      const statusBadge = isResolved
        ? `<span class="badge-active">Resolved</span>`
        : `<span class="pill-badge status-open">Active</span>`;

      return `
        <tr>
          <td><b>#${it.id}</b></td>
          <td><b>${escapeHtml(it.name)}</b></td>
          <td>${typeBadge}</td>
          <td><span class="category-pill">${escapeHtml(it.category)}</span></td>
          <td>⌖ ${escapeHtml(it.location)}</td>
          <td>${escapeHtml(it.owner_name || 'Member')}</td>
          <td>${statusBadge}</td>
          <td style="text-align: right;">
            ${!isResolved ? `<button class="admin-btn-action admin-btn-unblock" data-admin-action="resolve-item" data-item-id="${it.id}">✓ Resolve</button>` : ''}
            <button class="admin-btn-action admin-btn-delete" data-admin-action="delete-item" data-item-id="${it.id}">🗑 Delete</button>
          </td>
        </tr>
      `;
    })
    .join('');
}

// Admin Tab Switching
document.querySelector('#adminTabUsersBtn')?.addEventListener('click', () => {
  document.querySelector('#adminTabUsersBtn').classList.add('active');
  document.querySelector('#adminTabReportsBtn').classList.remove('active');
  document.querySelector('#adminUsersPanel').classList.remove('hidden');
  document.querySelector('#adminReportsPanel').classList.add('hidden');
});

document.querySelector('#adminTabReportsBtn')?.addEventListener('click', () => {
  document.querySelector('#adminTabReportsBtn').classList.add('active');
  document.querySelector('#adminTabUsersBtn').classList.remove('active');
  document.querySelector('#adminReportsPanel').classList.remove('hidden');
  document.querySelector('#adminUsersPanel').classList.add('hidden');
});

// Admin Live Filtering
document.querySelector('#adminUserSearchInput')?.addEventListener('input', (e) => {
  renderAdminUsers(e.target.value);
});

document.querySelector('#adminReportSearchInput')?.addEventListener('input', (e) => {
  renderAdminReports(e.target.value);
});

// Admin Users Table Actions (Block / Unblock / Delete User)
document.querySelector('#adminUsersTableBody')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-admin-action]');
  if (!btn) return;
  const action = btn.dataset.adminAction;
  const userId = Number(btn.dataset.userId);

  if (action === 'toggle-block') {
    const isCurrentlyBlocked = btn.dataset.blocked === 'true';
    const confirmMsg = isCurrentlyBlocked
      ? 'Unblock this user and restore their login access?'
      : 'Block this user? Their active sessions will be terminated and they will not be able to log in.';
    if (!confirm(confirmMsg)) return;

    try {
      await api('/api/admin/users/toggle-block', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, block: !isCurrentlyBlocked }),
      });
      notify(isCurrentlyBlocked ? 'User unblocked.' : 'User blocked and access revoked.');
      await loadAdminDashboard();
    } catch (err) {
      notify(err.message);
    }
  } else if (action === 'delete-user') {
    if (!confirm('Permanently delete this user account, their reports, and all connections? This cannot be undone.')) return;
    try {
      await api('/api/admin/users/delete', {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
      });
      notify('User account deleted.');
      await loadAdminDashboard();
      await loadItems();
    } catch (err) {
      notify(err.message);
    }
  }
});

// Admin Reports Table Actions (Resolve / Delete Item)
document.querySelector('#adminReportsTableBody')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-admin-action]');
  if (!btn) return;
  const action = btn.dataset.adminAction;
  const itemId = Number(btn.dataset.itemId);

  if (action === 'resolve-item') {
    try {
      await api(`/api/items/${itemId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: 'Resolved' }),
      });
      notify('Report marked as Resolved.');
      await loadAdminDashboard();
      await loadItems();
    } catch (err) {
      notify(err.message);
    }
  } else if (action === 'delete-item') {
    if (!confirm('Admin: Delete this report permanently?')) return;
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '⏳ Deleting...';
    try {
      await api(`/api/items/${itemId}`, { method: 'DELETE' });
      items = items.filter((x) => x.id !== itemId);
      renderItems();
      syncUserMetrics();
      notify('✓ Report removed by administrator.');
      await Promise.all([loadAdminDashboard(), loadItems(), loadSmartMatches()]);
    } catch (err) {
      notify(`Could not remove report: ${err.message}`);
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }
});

// Admin Header Actions
document.querySelector('#btnAdminExportCsv')?.addEventListener('click', async () => {
  window.open('/api/admin/export', '_blank');
});

document.querySelector('#btnAdminRefresh')?.addEventListener('click', async () => {
  await loadAdminDashboard();
  notify('Admin metrics and users refreshed.');
});

document.querySelector('#adminHeaderSignOut')?.addEventListener('click', handleSignOut);

// Centralized notifications & badges updater (DOM only, zero extra API calls)
function updateNotificationBadges(pendingCount = 0, matchesCount = null) {
  const dot = document.querySelector('#notifDot');
  const badge = document.querySelector('#navConnBadge');
  const mobileBadge = document.querySelector('#mobileConnBadge');
  if (dot) dot.classList.toggle('hidden', pendingCount === 0);
  if (badge) {
    badge.textContent = pendingCount;
    badge.classList.toggle('hidden', pendingCount === 0);
  }
  if (mobileBadge) {
    mobileBadge.textContent = pendingCount;
    mobileBadge.classList.toggle('hidden', pendingCount === 0);
  }

  if (matchesCount !== null) {
    const matchBadge = document.querySelector('#navMatchBadge');
    const mobileMatchBadge = document.querySelector('#mobileMatchBadge');
    if (matchBadge) {
      matchBadge.textContent = matchesCount;
      matchBadge.classList.toggle('hidden', matchesCount === 0);
    }
    if (mobileMatchBadge) {
      mobileMatchBadge.textContent = matchesCount;
      mobileMatchBadge.classList.toggle('hidden', matchesCount === 0);
    }
  }
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
// CENTRALIZED APP INITIALIZATION (ONE DATA FETCH LIFECYCLE)
// -------------------------------------------------------------
try {
  const cachedUserStr = localStorage.getItem('foundly_user');
  if (cachedUserStr && localStorage.getItem('foundly_token')) {
    currentUser = JSON.parse(cachedUserStr);
    syncUser();
  }
} catch (_) {}

(async () => {
  try {
    // 1. Single authoritative session call
    const sessionData = await api('/api/session');
    if (sessionData && sessionData.user) {
      currentUser = sessionData.user;
      localStorage.setItem('foundly_user', JSON.stringify(currentUser));
      updateNotificationBadges(sessionData.pending_count || 0, sessionData.matches_count || 0);
    } else {
      currentUser = null;
      localStorage.removeItem('foundly_user');
      localStorage.removeItem('foundly_token');
    }
    syncUser();

    // 2. Fetch data once in parallel
    if (currentUser) {
      await Promise.all([
        loadItems(),
        loadSmartMatches(),
        loadConnections()
      ]);
    } else {
      await loadItems();
    }

    // 3. Gentle background validation (30 seconds, pauses when tab is hidden)
    setInterval(async () => {
      if (document.hidden || !currentUser) return;
      try {
        const s = await api('/api/session', { bypassCache: true });
        if (!s || !s.user) {
          handleRemoteLogout();
          return;
        }
        updateNotificationBadges(s.pending_count || 0, s.matches_count || 0);
      } catch (_) {}
    }, 30000);

    // 4. Instant session sync when returning to the tab
    document.addEventListener('visibilitychange', async () => {
      if (!document.hidden && currentUser) {
        try {
          const s = await api('/api/session', { bypassCache: true });
          if (s && s.user) {
            updateNotificationBadges(s.pending_count || 0, s.matches_count || 0);
          } else {
            handleRemoteLogout();
          }
        } catch (_) {}
      }
    });

  } catch (e) {
    console.error('Init error:', e);
  }
})();
