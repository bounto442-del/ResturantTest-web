/**
 * Demo Restaurant — Customer + Owner Web App
 * Supabase REST backend. No WebSockets.
 */

const SUPABASE_URL = ENV.supabaseUrl;
const SUPABASE_KEY = ENV.supabaseKey;
const TABLE_MENU = ENV.tableMenuItems || 'menu_items';
const TABLE_ORDERS = ENV.tableOrders || 'orders';
const TABLE_PROMOS = ENV.tablePromos || 'promos';
const TABLE_SETTINGS = ENV.tableSettings || 'settings';
const TABLE_COMBOS = ENV.tableCombos || 'combos';
const TABLE_REWARDS = ENV.tableCustomerRewards || 'customer_rewards';

const TAX_RATE = 0.0825;
const CATEGORY_LIMIT = 6; // show at most 6 items per category; "See all" expands
let menuItems = [];
let allMenuItems = []; // includes unavailable, for owner
let activeCombos = [];
let cart = [];
let currentPromo = null;
let currentReward = null;
let pendingRewardInfo = null;
let deliveryFee = 399; // cents
let orderMode = 'delivery';
let currentOrderId = null;
let pollInterval = null;
let settings = null;
let pendingOrderPayload = null;
let cloverCardElements = null;
let cloverSdkInstance = null;

// ─── Owner Auth ───
let authSession = null;
const SESSION_KEY = 'rt_owner_session';

function restoreOwnerSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (s?.access_token && s.expires_at && s.expires_at > Date.now()) {
      authSession = s;
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
  } catch {}
}
function persistOwnerSession() {
  try {
    if (authSession) localStorage.setItem(SESSION_KEY, JSON.stringify(authSession));
    else localStorage.removeItem(SESSION_KEY);
  } catch {}
}
async function ownerSignIn(email, password) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    const t = await r.text();
    let msg = 'Sign-in failed';
    try { const j = JSON.parse(t); if (j.error_description || j.msg) msg = j.error_description || j.msg; } catch {}
    throw new Error(msg);
  }
  const j = await r.json();
  authSession = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: Date.now() + ((j.expires_in || 3600) * 1000) - 60_000,
    user: j.user,
  };
  persistOwnerSession();
  return authSession;
}
async function ownerSignOut() {
  if (authSession?.access_token) {
    try {
      await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${authSession.access_token}` },
      });
    } catch {}
  }
  authSession = null;
  persistOwnerSession();
  if (ownerPollInterval) { clearInterval(ownerPollInterval); ownerPollInterval = null; }
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', async () => {
  restoreOwnerSession();
  if (window.location.protocol === 'file:') {
    const grid = document.getElementById('menu-grid');
    if (grid) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--primary)">
          <p><strong>Can't load from a local file.</strong></p>
          <p style="font-size:13px;color:var(--text-muted);margin-top:8px">
            Please open this page through a local server:<br>
            <code>python -m http.server 8080</code> then visit <a href="http://localhost:8080" style="color:var(--accent)">http://localhost:8080</a>
          </p>
        </div>`;
    }
    hideLoading();
    return;
  }
  const menuPromise = loadMenu().then(() => {
    hideLoading();
    setupCategories();
  });
  await Promise.all([
    menuPromise,
    loadSettings(),
    loadPromos(),
    loadCustomerCombos(),
  ]);
  updateHoursDisplay();

  const payBtn = document.getElementById('pay-now-btn');
  if (payBtn) payBtn.addEventListener('click', submitOnlinePayment);

  setInterval(() => {
    const homeScreen = document.getElementById('screen-home');
    if (homeScreen && homeScreen.classList.contains('active')) {
      loadMenuSilent();
    }
  }, 30000);
});

function hideLoading() {
  const el = document.getElementById('loading-screen');
  if (el) el.classList.remove('active');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ─── REST Helpers ───
function _sbHeaders(extra = {}) {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}
function _sbOwnerHeaders(extra = {}) {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${authSession?.access_token || SUPABASE_KEY}`,
    ...extra,
  };
}

async function sbGet(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, { headers: _sbHeaders() });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return JSON.parse(text);
}
async function sbPost(path, body, prefer = 'return=representation') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: _sbHeaders({ 'Content-Type': 'application/json', 'Prefer': prefer }),
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/**
 * Post an order with retry on duplicate order_id (409/unique-violation).
 * bodyFactory should return a fresh payload each call, including a new order_id.
 */
async function sbPostOrder(path, bodyFactory, prefer = 'return=minimal', maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    const body = bodyFactory();
    try {
      return await sbPost(path, body, prefer);
    } catch (e) {
      lastError = e;
      const msg = e.message || '';
      if (msg.includes('409') || msg.includes('23505') || /duplicate/i.test(msg)) {
        console.warn(`Duplicate order_id detected, retrying (${i + 1}/${maxRetries})...`);
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

async function sbPatch(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: _sbHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
async function sbDelete(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: _sbHeaders(),
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
}

async function sbGetO(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: _sbOwnerHeaders() });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return text ? JSON.parse(text) : [];
}
async function sbPostO(path, body, prefer = 'return=representation') {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: _sbOwnerHeaders({ 'Content-Type': 'application/json', 'Prefer': prefer }),
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
async function sbPatchO(path, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: _sbOwnerHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
async function sbDeleteO(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: _sbOwnerHeaders(),
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
}

// ─── Storage ───
async function uploadImage(file, bucket = ENV.bucketMenuImages) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${fileId}.${ext}`;
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const authHeader = authSession?.access_token || SUPABASE_KEY;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${authHeader}`,
      'Content-Type': file.type || 'image/jpeg',
      'x-upsert': 'false',
    },
    body: file,
  });
  if (!r.ok) {
    const t = await r.text();
    if (r.status === 404 || t.includes('Bucket') || t.includes('not found')) {
      throw new Error(`${bucket} bucket missing — create it in Supabase Storage first`);
    }
    throw new Error(`upload ${r.status}: ${t}`);
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// ─── Settings ───
async function loadSettings() {
  try {
    const rows = await sbGet(`${TABLE_SETTINGS}?select=*&limit=1`);
    settings = rows?.[0] || null;
    if (settings) {
      deliveryFee = settings.delivery_fee ?? ENV.defaultDeliveryFee ?? 399;
      const el = document.getElementById('sum-delivery');
      if (el) el.textContent = fmtMoney(deliveryFee);
      applyBackgroundImage();
    }
  } catch (e) { console.warn('Settings load failed', e); }
}

function updateHoursDisplay() {
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const today = days[new Date().getDay()];
  const el = document.getElementById('hours-today');
  if (!el) return;
  if (settings?.business_hours && Object.keys(settings.business_hours).length > 0) {
    const h = settings.business_hours[today];
    if (h && h.open && h.close) {
      el.textContent = `${cap(today)} ${fmt12(h.open)} – ${fmt12(h.close)}`;
      return;
    }
  }
  el.textContent = 'Mon–Sun 10:30 AM – 9:00 PM';
}
function fmt12(time24) {
  if (!time24) return '';
  const [h, m] = time24.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function applyBackgroundImage() {
  const url = settings?.background_image_url || '';
  if (url) {
    document.body.style.background = `linear-gradient(135deg, rgba(26,26,46,0.92) 0%, rgba(26,26,46,0.85) 100%), url('${url}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundRepeat = 'no-repeat';
  } else {
    document.body.style.background = '';
  }
}

// ─── Menu ───
async function loadMenu() {
  const grid = document.getElementById('menu-grid');
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">Loading menu...</div>';
  try {
    const docs = await sbGet(`${TABLE_MENU}?select=*&order=display_order.asc,name.asc&limit=1000`);
    allMenuItems = docs.map(d => MenuItem.fromDoc(d));
    menuItems = allMenuItems.filter(i => i.available);
    buildMenuCache(allMenuItems);
    if (menuItems.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">Menu is empty. Add items via the owner menu manager.</div>';
      return;
    }
    renderMenu('all');
  } catch (e) {
    console.error('Menu load failed', e);
    const msg = String(e.message || e);
    const isCors = msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('CORS');
    const isCorsFile = isCors && window.location.protocol === 'file:';
    const display = isCorsFile
      ? `Open via a server: <code>python -m http.server 8080</code> then <a href="http://localhost:8080" style="color:var(--accent)">http://localhost:8080</a>`
      : msg.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--primary)">
      <p><strong>${isCors ? 'Connection blocked (CORS)' : 'Failed to load menu.'}</strong></p>
      <p style="font-size:13px;color:var(--text-muted);margin-top:8px">${display}</p>
      <button class="btn btn-primary" onclick="loadMenu()" style="margin-top:12px">Retry</button>
    </div>`;
    showToast(isCors ? 'CORS blocked — use localhost:8080' : 'Failed to load menu');
  }
}

async function loadMenuSilent() {
  try {
    const docs = await sbGet(`${TABLE_MENU}?select=*&order=display_order.asc,name.asc&limit=1000`);
    const freshAll = docs.map(d => MenuItem.fromDoc(d));
    const fresh = freshAll.filter(i => i.available);
    if (fresh.length !== menuItems.length || JSON.stringify(fresh.map(i=>i.id)) !== JSON.stringify(menuItems.map(i=>i.id))) {
      allMenuItems = freshAll;
      menuItems = fresh;
      buildMenuCache(allMenuItems);
      const activeChip = document.querySelector('.chip.chip-active');
      const cat = activeChip ? activeChip.dataset.cat : 'all';
      renderMenu(cat);
    }
  } catch (e) { /* ignore — try again in 30s */ }
}

class MenuItem {
  constructor(data) { Object.assign(this, data); }
  static fromDoc(d) {
    return new MenuItem({
      id: d.id,
      name: d.name || 'Item',
      description: d.description || '',
      price: d.price || 0,
      category: d.category || 'Other',
      available: d.available ?? true,
      imageUrl: d.image_url || '',
      emoji: d.emoji || '🍽️',
      trending: d.is_trending ?? false,
      isNew: d.is_new ?? false,
      sauces: Array.isArray(d.sauces) ? d.sauces : parseJSON(d.sauces) || [],
      addons: Array.isArray(d.addons) ? d.addons : parseJSON(d.addons) || [],
      display_order: d.display_order ?? 0,
    });
  }
}

function parseJSON(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v); } catch { return []; }
}

function setupCategories() {
  document.querySelectorAll('.chip').forEach(c => {
    c.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(x => x.classList.remove('chip-active'));
      c.classList.add('chip-active');
      renderMenu(c.dataset.cat);
    });
  });
}

function renderMenu(category) {
  const grid = document.getElementById('menu-grid');
  const items = category === 'all' ? menuItems : menuItems.filter(i => i.category === category);
  const expanded = category !== 'all' && expandedCats.has(category);
  const visible = expanded || category === 'all' ? items : items.slice(0, CATEGORY_LIMIT);
  const overflow = items.length - visible.length;
  const cards = visible.map(item => `
    <div class="menu-card" onclick="openCustomize('${item.id}')">
      <div class="menu-card-image">
        <div style="position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:48px;background:var(--surface-2);z-index:0;">${item.emoji || '🍽️'}</div>
        ${item.imageUrl ? `<img src="${item.imageUrl}" alt="${esc(item.name)}" loading="lazy" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;z-index:1;" onerror="this.style.display='none'">` : ''}
        ${item.trending ? `<span class="menu-card-badge">Trending</span>` : ''}
        ${item.isNew ? `<span class="menu-card-badge" style="left:auto;right:12px;background:var(--gold);color:var(--dark);">New</span>` : ''}
      </div>
      <div class="menu-card-body">
        <h3 class="menu-card-title">${esc(item.name)}</h3>
        <p class="menu-card-desc">${esc(item.description)}</p>
        <div class="menu-card-footer">
          <span class="menu-card-price">${fmtMoney(item.price)}</span>
          <button class="menu-card-btn" onclick="event.stopPropagation(); openCustomize('${item.id}')"><i class="fas fa-plus"></i></button>
        </div>
      </div>
    </div>
  `).join('');
  const seeAll = (category !== 'all' && overflow > 0)
    ? `<div class="see-all-row" onclick="toggleSeeAll('${category}')">${expanded ? 'Show less' : `See all (${items.length})`}</div>`
    : '';
  grid.innerHTML = cards + seeAll;
}

const expandedCats = new Set();
function toggleSeeAll(category) {
  if (expandedCats.has(category)) expandedCats.delete(category);
  else expandedCats.add(category);
  renderMenu(category);
}

function scrollToMenu() {
  const el = document.getElementById('menu-section');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

// ─── Combos (customer) ───
async function loadCustomerCombos() {
  try {
    activeCombos = await sbGet(`${TABLE_COMBOS}?select=*&active=eq.true&order=display_order.asc&limit=50`) || [];
  } catch (e) {
    if (/PGRST205/i.test(e.message)) {
      console.warn('Combos table missing — run setup_combos.sql in Supabase SQL editor.');
    }
    activeCombos = [];
  }
  renderCombosStrip();
}
function renderCombosStrip() {
  const el = document.getElementById('combos-strip');
  if (!el) return;
  if (!activeCombos.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.innerHTML = activeCombos.map(c => `
    <div class="combo-card" onclick="openComboCart('${c.id}')">
      <div class="combo-image">${c.image_url ? `<img src="${esc(c.image_url)}" alt="" onerror="this.style.display='none'">` : (c.emoji || '🎁')}</div>
      <div class="combo-name">${esc(c.name)}</div>
      <div class="combo-meta">${esc(c.description || '')}</div>
      <div class="combo-price">${fmtMoney(c.combo_price)}</div>
    </div>
  `).join('');
}
function openComboCart(comboId) {
  const combo = activeCombos.find(c => c.id === comboId);
  if (!combo) return;
  cart.push({
    id: `combo:${combo.id}`,
    name: combo.name + ' (combo)',
    price: combo.combo_price,
    qty: 1,
    emoji: combo.emoji || '🎁',
    imageUrl: combo.image_url || '',
    isCombo: true,
    comboItems: combo.item_ids || [],
    selectedAddons: [],
    sauce: '',
    specialInstructions: '',
  });
  updateCartUI();
  showToast(`Added ${combo.name} combo to cart`);
  toggleCart();
}

// ─── Customize / Add to Cart ───
let customizingItem = null;
let selectedSauce = '';
let selectedAddons = [];
let qty = 1;
let instructions = '';

function openCustomize(id) {
  const item = menuItems.find(i => i.id === id);
  if (!item) return;
  customizingItem = item;
  selectedSauce = item.sauces[0] || '';
  selectedAddons = [];
  qty = 1;
  instructions = '';
  document.getElementById('customize-modal-title').textContent = item.name;
  renderCustomize();
  document.getElementById('customize-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeCustomize() {
  document.getElementById('customize-modal').classList.remove('active');
  document.body.style.overflow = '';
}
function renderCustomize() {
  const item = customizingItem;
  const body = document.getElementById('customize-body');
  body.innerHTML = `
    ${item.imageUrl ? `<img class="customize-image" src="${item.imageUrl}" alt="" onerror="this.style.display='none'">` : ''}
    <div class="customize-price">${fmtMoney(item.price)}</div>
    <p class="customize-desc">${esc(item.description)}</p>

    ${item.sauces.length ? `
      <div class="option-group">
        <div class="option-label">Choose Sauce</div>
        ${item.sauces.map(s => `<span class="option-chip ${s===selectedSauce?'selected':''}" onclick="pickSauce('${esc(s)}')">${esc(s)}</span>`).join('')}
      </div>
    ` : ''}

    ${item.addons.length ? `
      <div class="option-group">
        <div class="option-label">Add Ons</div>
        ${item.addons.map(a => `
          <div class="addon-row">
            <label class="addon-info">
              <input type="checkbox" class="addon-check" ${selectedAddons.some(sa => sa.name === a.name) ? 'checked' : ''} onchange="toggleAddon('${esc(a.name)}', ${a.price||0}, this.checked)">
              <span class="addon-checkmark"></span>
              <span class="addon-name">${esc(a.name)}</span>
            </label>
            <span class="addon-price">+${fmtMoney(a.price||0)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="quantity-row">
      <span class="option-label">Quantity</span>
      <div class="qty-big">
        <button onclick="changeQty(-1)">−</button>
        <span id="qty-display">${qty}</span>
        <button onclick="changeQty(1)">+</button>
      </div>
    </div>

    <textarea class="instructions-area" placeholder="Special instructions (e.g., extra crispy, no salt...)" oninput="instructions=this.value"></textarea>

    <button class="add-btn" onclick="confirmAddToCart()">
      Add ${qty} to Cart — ${fmtMoney(calcCustomizeTotal())}
    </button>
  `;
}
function pickSauce(s) { selectedSauce = s; renderCustomize(); }
function toggleAddon(name, price, checked) {
  if (checked) selectedAddons.push({name, price});
  else selectedAddons = selectedAddons.filter(a => a.name !== name);
  renderCustomize();
}
function changeQty(delta) {
  qty = Math.max(1, qty + delta);
  const el = document.getElementById('qty-display');
  if (el) el.textContent = qty;
  const btn = document.querySelector('.add-btn');
  if (btn) btn.textContent = `Add ${qty} to Cart — ${fmtMoney(calcCustomizeTotal())}`;
}
function calcCustomizeTotal() {
  let t = customizingItem.price * qty;
  selectedAddons.forEach(a => t += a.price * qty);
  return t;
}
function confirmAddToCart() {
  const ci = {
    id: customizingItem.id,
    name: customizingItem.name,
    price: customizingItem.price,
    qty,
    sauce: selectedSauce,
    selectedAddons: [...selectedAddons],
    specialInstructions: instructions,
    imageUrl: customizingItem.imageUrl,
  };
  cart.push(ci);
  closeCustomize();
  updateCartUI();
  showToast(`Added ${qty}x ${customizingItem.name} to cart`);
}

// ─── Cart ───
function toggleCart() {
  const d = document.getElementById('cart-drawer');
  d.classList.toggle('open');
}

function updateCartUI() {
  const badge = document.getElementById('cart-badge');
  const itemsEl = document.getElementById('cart-items');
  const emptyEl = document.getElementById('cart-empty');
  const footer = document.getElementById('cart-footer');

  const totalQty = cart.reduce((s, c) => s + c.qty, 0);
  badge.textContent = totalQty;
  badge.classList.toggle('hidden', totalQty === 0);

  if (cart.length === 0) {
    itemsEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    footer.classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  footer.classList.remove('hidden');

  itemsEl.innerHTML = cart.map((c, idx) => `
    <div class="cart-item">
      <img class="cart-item-img" src="${c.imageUrl || ''}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'" style="${c.imageUrl?'':'display:none'}">
      <div class="cart-item-img-fallback" style="display:${c.imageUrl?'none':'flex'};width:56px;height:56px;border-radius:10px;background:var(--surface-2);align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">${c.emoji || '🍗'}</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${esc(c.name)}</div>
        <div class="cart-item-meta">${c.qty}x ${c.sauce?esc(c.sauce):''} ${c.selectedAddons.length?'+ '+c.selectedAddons.map(a=>esc(a.name)).join(', '):''}${c.specialInstructions?` · "${esc(c.specialInstructions)}"`:''}</div>
        <div class="cart-item-qty">
          <button class="qty-btn" onclick="cartQty(${idx}, -1)">−</button>
          <span>${c.qty}</span>
          <button class="qty-btn" onclick="cartQty(${idx}, 1)">+</button>
          <button class="qty-btn" onclick="cartRemove(${idx})" style="margin-left:auto;color:var(--primary);"><i class="fas fa-trash-alt" style="font-size:12px;"></i></button>
        </div>
      </div>
      <div class="cart-item-price">${fmtMoney((c.price + c.selectedAddons.reduce((s,a)=>s+a.price,0)) * c.qty)}</div>
    </div>
  `).join('');

  const subtotal = cart.reduce((s, c) => s + (c.price + c.selectedAddons.reduce((a,b)=>a+b.price,0)) * c.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const total = subtotal + tax + (orderMode === 'delivery' ? deliveryFee : 0) - (currentPromo ? Math.round(subtotal * currentPromo.discountPercent / 100) : 0) - (currentReward ? currentReward.discountCents : 0);

  document.getElementById('cart-subtotal').textContent = fmtMoney(subtotal);
  document.getElementById('cart-tax').textContent = fmtMoney(tax);
  document.getElementById('cart-total').textContent = fmtMoney(Math.max(0, total));
}

function cartQty(idx, delta) {
  cart[idx].qty = Math.max(1, cart[idx].qty + delta);
  updateCartUI();
}
function cartRemove(idx) {
  cart.splice(idx, 1);
  updateCartUI();
}
function goToCheckout() {
  toggleCart();
  navigateTo('checkout');
  renderCheckoutSummary();
  setPaymentMethod(paymentMethod);
}

// ─── Checkout ───
function setMode(mode) {
  orderMode = mode;
  document.getElementById('mode-delivery').classList.toggle('toggle-active', mode === 'delivery');
  document.getElementById('mode-pickup').classList.toggle('toggle-active', mode === 'pickup');
  document.getElementById('address-block').classList.toggle('hidden', mode !== 'delivery');
  renderCheckoutSummary();
}

function normalizePhone(input) {
  const digits = (input.value || '').replace(/\D/g, '');
  if (digits.length === 10) input.value = `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  else if (digits.length === 11 && digits[0] === '1') input.value = `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
}

function renderCheckoutSummary() {
  const container = document.getElementById('checkout-items');
  container.innerHTML = cart.map(c => `
    <div class="summary-item">
      <span class="summary-item-name">${c.qty}x ${esc(c.name)} ${c.selectedAddons.length?'+ '+c.selectedAddons.map(a=>esc(a.name)).join(', '):''}</span>
      <span class="summary-item-price">${fmtMoney((c.price + c.selectedAddons.reduce((s,a)=>s+a.price,0))*c.qty)}</span>
    </div>
  `).join('');

  const subtotal = cart.reduce((s, c) => s + (c.price + c.selectedAddons.reduce((a,b)=>a+b.price,0)) * c.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const disc = currentPromo ? Math.round(subtotal * currentPromo.discountPercent / 100) : 0;
  const delivery = orderMode === 'delivery' ? deliveryFee : 0;
  const loyaltyDisc = currentReward ? currentReward.discountCents : 0;
  const total = subtotal + tax + delivery - disc - loyaltyDisc;

  document.getElementById('sum-subtotal').textContent = fmtMoney(subtotal);
  document.getElementById('sum-delivery').textContent = fmtMoney(delivery);
  document.getElementById('sum-tax').textContent = fmtMoney(tax);
  document.getElementById('sum-discount').textContent = `-${fmtMoney(disc)}`;
  document.getElementById('sum-discount-row').classList.toggle('hidden', !currentPromo);
  document.getElementById('sum-loyalty-row')?.classList.toggle('hidden', !currentReward);
  const loyEl = document.getElementById('sum-loyalty');
  if (loyEl) loyEl.textContent = `-${fmtMoney(loyaltyDisc)}`;
  document.getElementById('sum-total').textContent = fmtMoney(Math.max(0, total));
}

async function applyPromo() {
  const code = document.getElementById('promo-code').value.trim().toUpperCase();
  const msg = document.getElementById('promo-message');
  if (!code) { msg.textContent = 'Enter a code'; msg.style.color = 'var(--text-muted)'; return; }
  try {
    const docs = await sbGet(`${TABLE_PROMOS}?select=*&code=ilike.${encodeURIComponent(code)}&active=eq.true&limit=1`);
    const doc = docs?.[0];
    if (!doc) { msg.textContent = 'Invalid code'; msg.style.color = 'var(--primary)'; return; }
    currentPromo = { code: doc.code, discountPercent: doc.discount_percent || 10 };
    msg.textContent = `✓ ${currentPromo.discountPercent}% off applied`;
    msg.style.color = '#22c55e';
    renderCheckoutSummary();
  } catch (e) { msg.textContent = 'Error checking code'; msg.style.color = 'var(--primary)'; }
}

function getGPS() {
  const status = document.getElementById('gps-status');
  if (!navigator.geolocation) { status.textContent = 'Geolocation not supported'; return; }
  status.textContent = 'Getting location...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      const addr = document.getElementById('c-address');
      addr.value = `[GPS] ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      status.textContent = 'Location captured ✓';
      status.style.color = '#22c55e';
    },
    err => { status.textContent = 'Location failed: ' + err.message; status.style.color = 'var(--primary)'; },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

async function placeOrder() {
  const name = document.getElementById('c-name').value.trim();
  const phoneRaw = document.getElementById('c-phone').value.trim();
  const phoneDigits = phoneRaw.replace(/\D/g, '');
  const address = document.getElementById('c-address').value.trim();
  const btn = document.getElementById('place-order-btn');
  const notes = document.getElementById('c-notes')?.value?.trim() || '';

  if (!name || !phoneRaw) { showToast('Please enter your name and phone'); return; }
  if (orderMode === 'delivery' && !address) { showToast('Please enter a delivery address'); return; }
  if (cart.length === 0) { showToast('Your cart is empty'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Placing...';

  const subtotal = cart.reduce((s, c) => s + (c.price + c.selectedAddons.reduce((a,b)=>a+b.price,0)) * c.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const disc = currentPromo ? Math.round(subtotal * currentPromo.discountPercent / 100) : 0;
  const delivery = orderMode === 'delivery' ? deliveryFee : 0;
  const loyaltyDisc = currentReward ? currentReward.discountCents : 0;
  const total = subtotal + tax + delivery - disc - loyaltyDisc;
  const basePayload = {
    customer_name: name,
    customer_phone: phoneDigits || phoneRaw,
    address: orderMode === 'delivery' ? address : 'Pickup',
    mode: orderMode,
    items: cart.map(c => ({
      name: c.name,
      qty: c.qty,
      price: c.price,
      sauce: c.sauce,
      selectedAddons: c.selectedAddons,
      specialInstructions: c.specialInstructions,
      is_combo: !!c.isCombo,
      combo_items: c.comboItems || null,
    })),
    subtotal,
    tax,
    delivery_fee: delivery,
    discount: disc,
    loyalty_discount: loyaltyDisc,
    loyalty_reward_name: currentReward?.name || '',
    promo_code: currentPromo?.code || '',
    total,
    status: 'received',
    notes,
  };

  let oid = generateOrderId();

  if (paymentMethod === 'online') {
    pendingOrderPayload = { ...basePayload, order_id: oid };
    showPaymentScreen(pendingOrderPayload);
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-lock"></i> Place Order';
    return;
  }

  try {
    let finalOid = null;
    await sbPostOrder(TABLE_ORDERS, () => {
      finalOid = generateOrderId();
      return { ...basePayload, order_id: finalOid };
    }, 'return=minimal');
    oid = finalOid || oid;
    const savedPayload = { ...basePayload, order_id: oid };
    if (phoneDigits.length >= 10 && document.getElementById('c-rewards-optin')?.checked) {
      try { await ensureCustomerReward(phoneDigits, true); } catch (loyErr) { console.error('rewards opt-in failed', loyErr); }
    }
    let cloverOrderId = null;
    if (paymentMethod === 'in_person' && window.Clover && Clover.isConnected()) {
      try {
        const cloverOrder = await Clover.pushOrder(savedPayload);
        cloverOrderId = cloverOrder?.id || null;
        showToast('Order sent to Clover POS');
      } catch (cloverErr) {
        console.error('Clover order push failed', cloverErr);
        showToast('Clover push failed: ' + cloverErr.message);
      }
    }
    finishOrderConfirmation(oid, cloverOrderId);
  } catch (e) {
    console.error(e);
    showToast('Order failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-lock"></i> Place Order';
  }
}

function finishOrderConfirmation(oid, cloverOrderId) {
  cart = [];
  currentPromo = null;
  currentReward = null;
  pendingRewardInfo = null;
  currentOrderId = oid;
  pendingOrderPayload = null;
  updateCartUI();
  closeCart();
  document.getElementById('confirm-id').textContent = oid;

  const cloverWrap = document.getElementById('confirm-clover-wrap');
  const cloverIdEl = document.getElementById('confirm-clover-id');
  if (cloverWrap && cloverIdEl) {
    if (cloverOrderId) {
      cloverIdEl.textContent = cloverOrderId;
      cloverWrap.classList.remove('hidden');
    } else {
      cloverWrap.classList.add('hidden');
    }
  }

  navigateTo('confirmation');
  showToast('Order placed successfully!');
}

function closeCart() {
  const d = document.getElementById('cart-drawer');
  if (d) d.classList.remove('open');
}

// ─── Clover Online Payment ───
function showPaymentScreen(payload) {
  navigateTo('payment');
  renderPaymentSummary(payload);
  const errEl = document.getElementById('payment-error');
  errEl.textContent = '';
  loadCloverSdk()
    .then(() => mountCloverCardElements())
    .then(() => { console.log('Clover payment form mounted'); })
    .catch(err => {
      console.error('Clover SDK/mount failed', err);
      errEl.textContent = 'Payment form error: ' + (err?.message || String(err)) + '. Please try pay-in-person or refresh.';
    });
}

function renderPaymentSummary(payload) {
  const items = document.getElementById('payment-items');
  items.innerHTML = payload.items.map(it => `
    <div class="summary-item">
      <span class="summary-item-name">${it.qty}× ${it.name}</span>
      <span class="summary-item-price">${fmtMoney((it.price + it.selectedAddons.reduce((a,b)=>a+b.price,0)) * it.qty)}</span>
    </div>
  `).join('');
  document.getElementById('pay-subtotal').textContent = fmtMoney(payload.subtotal);
  document.getElementById('pay-tax').textContent = fmtMoney(payload.tax);
  document.getElementById('pay-total').textContent = fmtMoney(payload.total);
  document.getElementById('payment-amount').textContent = fmtMoney(payload.total);
}

async function loadCloverSdk() {
  if (window.CloverSdk) return window.CloverSdk;
  return new Promise((resolve, reject) => {
    const existingClover = window.Clover;
    const s = document.createElement('script');
    s.src = 'https://checkout.sandbox.dev.clover.com/sdk.js';
    s.async = true;
    s.onload = () => {
      const sdkClass = window.Clover;
      window.CloverSdk = sdkClass;
      window.Clover = existingClover;
      resolve(sdkClass);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function mountCloverCardElements() {
  const publicKey = ENV.cloverPublicAccessKey;
  if (!publicKey) {
    throw new Error('Missing Clover public access key in config.js');
  }

  // Clear old iframes so re-entry works if the user comes back.
  ['#card-number','#card-date','#card-cvv','#card-postal-code'].forEach(sel => {
    const node = document.querySelector(sel);
    if (node) node.innerHTML = '';
  });
  cloverCardElements = null;

  try {
    cloverSdkInstance = new window.CloverSdk(publicKey);
  } catch (ctorErr) {
    throw new Error('Clover SDK rejected the public key: ' + (ctorErr?.message || String(ctorErr)));
  }

  const elements = cloverSdkInstance.elements();
  cloverCardElements = {
    cardNumber: elements.create('CARD_NUMBER'),
    cardDate: elements.create('CARD_DATE'),
    cardCvv: elements.create('CARD_CVV'),
    cardPostalCode: elements.create('CARD_POSTAL_CODE'),
  };
  cloverCardElements.cardNumber.mount('#card-number');
  cloverCardElements.cardDate.mount('#card-date');
  cloverCardElements.cardCvv.mount('#card-cvv');
  cloverCardElements.cardPostalCode.mount('#card-postal-code');
}

async function submitOnlinePayment() {
  const btn = document.getElementById('pay-now-btn');
  const errEl = document.getElementById('payment-error');
  errEl.textContent = '';
  if (!pendingOrderPayload) { showToast('No pending order'); return; }
  if (!cloverSdkInstance) { errEl.textContent = 'Payment form not ready'; return; }

  const payNormal = btn.querySelector('.pay-normal');
  const paySpinner = btn.querySelector('.pay-spinner');
  payNormal.classList.add('hidden');
  paySpinner.classList.remove('hidden');
  btn.disabled = true;

  let token;
  try {
    const tokenResult = await cloverSdkInstance.createToken();
    if (tokenResult.errors) throw new Error(Object.values(tokenResult.errors).join(', '));
    token = tokenResult.token;
  } catch (tokErr) {
    btn.disabled = false;
    payNormal.classList.remove('hidden');
    paySpinner.classList.add('hidden');
    errEl.textContent = 'Card error: ' + tokErr.message;
    return;
  }

  try {
    const chargeResp = await fetch(`${ENV.cloverBackendUrl}/api/payments/charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        amount: pendingOrderPayload.total,
        currency: 'usd',
        cloverMerchantId: ENV.cloverMerchantId,
      }),
    });
    const chargeText = await chargeResp.text();
    if (!chargeResp.ok) throw new Error(chargeText || `Payment failed (${chargeResp.status})`);
    const chargeData = JSON.parse(chargeText);

    let orderWithPayment = {
      ...pendingOrderPayload,
      payment_status: 'paid',
      payment_method: 'online',
      clover_charge_id: chargeData.charge?.id || chargeData.chargeId || null,
    };
    let finalOid = null;
    await sbPostOrder(TABLE_ORDERS, () => {
      finalOid = generateOrderId();
      orderWithPayment = { ...orderWithPayment, order_id: finalOid };
      return orderWithPayment;
    }, 'return=minimal');
    if (!finalOid) {
      throw new Error('Failed to generate a unique order ID');
    }
    pendingOrderPayload.order_id = finalOid;
    console.log('[online payment] saved order id:', finalOid);

    let cloverOrderId = null;
    if (ENV.cloverMerchantId) {
      try {
        const pushBody = {
          cloverMerchantId: ENV.cloverMerchantId,
          lineItems: orderWithPayment.items.map(it => ({
            name: it.name,
            price: it.price + (it.selectedAddons || []).reduce((a,b)=>a+b.price,0),
            quantity: it.qty,
          })),
          note: orderWithPayment.order_id,
          linkItems: false,
        };
        console.log('[online payment] clover push note:', pushBody.note);
        const pushResp = await fetch(`${ENV.cloverBackendUrl}/api/orders/push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pushBody),
        });
        const pushText = await pushResp.text();
        if (pushResp.ok) {
          const pushData = JSON.parse(pushText);
          cloverOrderId = pushData.order?.id || null;
        } else {
          console.warn('Clover POS push failed after charge:', pushText);
        }
      } catch (pushErr) {
        console.error('Clover POS push error after charge:', pushErr);
      }
    }
    orderWithPayment.clover_order_id = cloverOrderId;

    const phoneDigits = orderWithPayment.customer_phone.replace(/\D/g, '');
    if (phoneDigits.length >= 10 && document.getElementById('c-rewards-optin')?.checked) {
      try { await ensureCustomerReward(phoneDigits, true); } catch (loyErr) { console.error('rewards opt-in failed', loyErr); }
    }

    finishOrderConfirmation(orderWithPayment.order_id, cloverOrderId);
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    payNormal.classList.remove('hidden');
    paySpinner.classList.add('hidden');
    errEl.textContent = 'Payment failed: ' + e.message;
  }
}

function switchToInPersonFromPayment() {
  if (!pendingOrderPayload) { showToast('No pending order'); return; }
  paymentMethod = 'in_person';
  const payload = { ...pendingOrderPayload };
  pendingOrderPayload = null;
  placeSavedOrder(payload);
}

async function placeSavedOrder(payload) {
  try {
    let savedPayload = { ...payload };
    let finalOid = null;
    await sbPostOrder(TABLE_ORDERS, () => {
      finalOid = generateOrderId();
      savedPayload = { ...savedPayload, order_id: finalOid };
      return savedPayload;
    }, 'return=minimal');
    let cloverOrderId = null;
    if (paymentMethod === 'in_person' && window.Clover && Clover.isConnected()) {
      try {
        const cloverOrder = await Clover.pushOrder(savedPayload);
        cloverOrderId = cloverOrder?.id || null;
        showToast('Order sent to Clover POS');
      } catch (cloverErr) {
        console.error('Clover order push failed', cloverErr);
        showToast('Clover push failed: ' + cloverErr.message);
      }
    }
    finishOrderConfirmation(savedPayload.order_id, cloverOrderId);
  } catch (e) {
    console.error(e);
    showToast('Order failed: ' + e.message);
  }
}

function generateOrderId() {
  const d = new Date();
  const date = d.toISOString().slice(0,10).replace(/-/g,'');
  const time = d.toISOString().slice(11,19).replace(/:/g,'');
  const rand = Math.floor(Math.random()*9000)+1000;
  return `DEMO-${date}-${time}-${rand}`;
}

function startTrackingFromConfirm() {
  document.getElementById('track-input').value = currentOrderId || '';
  navigateTo('track');
  if (currentOrderId) trackOrder();
}

// ─── Tracking ───
async function trackOrder() {
  const id = document.getElementById('track-input').value.trim();
  const result = document.getElementById('track-result');
  if (!id) { showToast('Enter an order ID'); return; }
  result.classList.add('hidden');
  try {
    const rows = await sbGet(`${TABLE_ORDERS}?select=*&order_id=eq.${encodeURIComponent(id)}&limit=1`);
    const doc = rows?.[0];
    if (!doc) { showToast('Order not found'); return; }
    result.classList.remove('hidden');
    const st = doc.status || 'received';
    document.getElementById('status-badge').textContent = st.replace(/_/g,' ').toUpperCase();
    document.getElementById('status-time').textContent = timeAgo(doc.created_at);
    renderTimeline(st);

    const driverEl = document.getElementById('driver-info');
    if (st === 'out_for_delivery' && doc.driver_lat && doc.driver_lng) {
      driverEl.classList.remove('hidden');
      document.getElementById('driver-dist').textContent = 'Driver location updated';
    } else {
      driverEl.classList.add('hidden');
    }

    if (['received','preparing','out_for_delivery'].includes(st)) {
      currentOrderId = id;
      if (pollInterval) clearInterval(pollInterval);
      pollInterval = setInterval(() => pollOrder(id), 5000);
    }
  } catch (e) {
    showToast('Order not found');
  }
}

async function pollOrder(id) {
  try {
    const rows = await sbGet(`${TABLE_ORDERS}?select=*&order_id=eq.${encodeURIComponent(id)}&limit=1`);
    const doc = rows?.[0];
    if (!doc) return;
    const st = doc.status || 'received';
    document.getElementById('status-badge').textContent = st.replace(/_/g,' ').toUpperCase();
    renderTimeline(st);
    if (['delivered','cancelled'].includes(st)) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  } catch (e) { /* ignore polling errors */ }
}

const STATUS_STEPS = ['received','preparing','out_for_delivery','delivered'];
function renderTimeline(status) {
  const idx = STATUS_STEPS.indexOf(status);
  const labels = { received:'Order Received', preparing:'Preparing', out_for_delivery:'Out for Delivery', delivered:'Delivered' };
  const container = document.getElementById('timeline');
  container.innerHTML = STATUS_STEPS.map((s, i) => {
    const active = i === idx;
    const done = i < idx;
    return `
      <div class="timeline-step ${active?'active':''} ${done?'done':''}">
        <div class="timeline-dot">${done?'✓':(i+1)}</div>
        <div class="timeline-label">${labels[s]}</div>
      </div>
    `;
  }).join('');
}

// ─── Promos ───
async function loadPromos() {
  try {
    const docs = await sbGet(`${TABLE_PROMOS}?select=*&active=eq.true&limit=100`);
    const banner = document.getElementById('promo-banner');
    const text = document.getElementById('promo-text');
    if (docs.length) {
      banner.classList.remove('hidden');
      text.textContent = `Use code ${docs[0].code} for ${docs[0].discount_percent || 10}% off!`;
    }
  } catch (e) { console.warn('Promo load failed', e); }
}

// ─── Navigation ───
function navigateTo(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${screen}`);
  if (target) target.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const link = document.querySelector(`.nav-link[data-screen="${screen}"]`);
  if (link) link.classList.add('active');
}

// ─── Owner Shell ───
let ownerPollInterval = null;

function showOwnerLogin() {
  if (authSession) {
    document.getElementById('owner-shell').classList.remove('hidden');
    document.getElementById('owner-build-tag').textContent = window.LC_BUILD || 'dev';
    switchOwnerView('orders');
    return;
  }
  document.getElementById('owner-login-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeOwnerLogin() {
  document.getElementById('owner-login-modal').classList.remove('active');
  document.body.style.overflow = '';
}
async function ownerLogin() {
  const email = document.getElementById('owner-email').value.trim();
  const password = document.getElementById('owner-password').value;
  const err = document.getElementById('owner-login-error');
  err.textContent = '';
  if (!email || !password) { err.textContent = 'Enter email and password'; return; }
  const btn = document.querySelector('#owner-login-modal .add-btn');
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = 'Signing in...';
  try {
    await ownerSignIn(email, password);
    closeOwnerLogin();
    document.getElementById('owner-shell').classList.remove('hidden');
    document.getElementById('owner-build-tag').textContent = window.LC_BUILD || 'dev';
    switchOwnerView('orders');
  } catch (e) {
    err.textContent = e.message || 'Sign-in failed';
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}
async function ownerLogout() {
  await ownerSignOut();
  document.getElementById('owner-shell').classList.add('hidden');
  document.getElementById('owner-email').value = '';
  document.getElementById('owner-password').value = '';
}
function toggleOwnerSidebar() {
  document.getElementById('owner-side').classList.toggle('open');
}
function closeOwnerSidebarMobile() {
  document.getElementById('owner-side').classList.remove('open');
}
function switchOwnerView(view) {
  document.querySelectorAll('.owner-view').forEach(v => v.classList.remove('active'));
  document.querySelector(`.owner-view#owner-view-${view}`)?.classList.add('active');
  document.querySelectorAll('.owner-nav button[data-owner]').forEach(b => b.classList.toggle('active', b.dataset.owner === view));
  if (view === 'orders') { renderOwnerOrders(); startOwnerPolling(); }
  else if (view === 'menu') { renderOwnerMenu(); stopOwnerPolling(); }
  else if (view === 'combos') { renderOwnerCombos(); stopOwnerPolling(); }
  else if (view === 'promos') { renderOwnerPromos(); stopOwnerPolling(); }
  else if (view === 'settings') { renderOwnerSettings(); stopOwnerPolling(); }
  else if (view === 'rewards') { renderOwnerRewards(); stopOwnerPolling(); }
}
function startOwnerPolling() {
  if (ownerPollInterval) clearInterval(ownerPollInterval);
  ownerPollInterval = setInterval(renderOwnerOrders, 5000);
}
function stopOwnerPolling() {
  if (ownerPollInterval) { clearInterval(ownerPollInterval); ownerPollInterval = null; }
}

// ─── Owner Orders ───
const STATUS_FLOW = ['received','preparing','out_for_delivery','delivered'];
const NEXT_STATUS = { received: 'preparing', preparing: 'out_for_delivery', out_for_delivery: 'delivered', delivered: null };
async function renderOwnerOrders() {
  if (document.getElementById('owner-shell').classList.contains('hidden')) return;
  try {
    const rows = await sbGetO(`${TABLE_ORDERS}?select=*&archived=eq.false&order=created_at.desc&limit=200`);
    const grouped = { received: [], preparing: [], out_for_delivery: [], delivered: [] };
    (rows || []).forEach(o => { if (grouped[o.status]) grouped[o.status].push(o); });
    Object.keys(grouped).forEach(status => {
      const col = document.getElementById('col-' + status);
      const count = document.getElementById('count-' + (status === 'out_for_delivery' ? 'out' : status));
      count.textContent = grouped[status].length;
      if (!grouped[status].length) {
        col.innerHTML = '<div class="board-empty">—</div>';
        return;
      }
      col.innerHTML = grouped[status].map(o => renderBoardOrder(o, status)).join('');
    });
  } catch (e) { console.error('orders fetch', e); }
}
function renderBoardOrder(o, status) {
  const nextStatus = NEXT_STATUS[status];
  const items = renderOrderItemsForBoard(o.items);
  const addr = formatOrderAddress(o);
  const mapHref = mapUrlFromOrder(o);
  const phone = esc(o.customer_phone || '');
  const orderIdSafe = esc(o.order_id);
  return `
    <div class="board-order">
      <div class="board-order-header">
        <div class="board-order-id">${orderIdSafe}</div>
        <div class="board-order-time">${timeAgo(o.created_at)}</div>
      </div>
      <div class="board-order-name">${esc(o.customer_name || '')}</div>
      <div class="board-order-phone">
        ${phone ? `<a href="tel:${phone}" title="Call">📞</a><a href="sms:${phone}" title="Text">💬</a><span class="phone-digits">${phone}</span>` : '—'}
      </div>
      <div class="board-order-section">
        <div class="board-section-label">Items (${o.items?.length || 0})</div>
        <div class="board-order-items">${items || '<div class="board-item muted">No item details</div>'}</div>
      </div>
      ${addr ? `<div class="board-order-section"><div class="board-section-label">${o.address === 'Pickup' ? '🏃 Pickup' : '📍 Delivery address'}</div><div class="board-order-address">${addr}</div></div>` : ''}
      ${o.notes ? `<div class="board-order-section"><div class="board-section-label">📝 Notes</div><div class="board-order-notes">${esc(o.notes)}</div></div>` : ''}
      <div class="board-order-total">${fmtMoney(o.total || 0)}</div>
      <div class="board-order-actions">
        ${nextStatus ? `<button class="btn-move" onclick="moveOrder('${orderIdSafe}','${nextStatus}')">${labelFor(nextStatus)}</button>` : ''}
        ${status !== 'cancelled' ? `<button class="btn-cancel" onclick="moveOrder('${orderIdSafe}','cancelled')">Cancel</button>` : ''}
        ${mapHref ? `<a class="map-btn" href="${mapHref}" target="_blank" rel="noopener">🗺️ Map</a>` : ''}
      </div>
    </div>
  `;
}
function renderOrderItemsForBoard(items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items.map(it => {
    const qty = it.qty || 1;
    const mods = (it.selectedAddons || []).map(a => `<div class="board-item-mod">• ${esc(a.name)}${a.price ? ` (+${fmtMoney(a.price)})` : ''}</div>`).join('');
    const instr = it.specialInstructions ? `<div class="board-item-instr">"${esc(it.specialInstructions)}"</div>` : '';
    const combo = it.is_combo && Array.isArray(it.combo_items)
      ? `<div class="board-item-combo">Combo: ${it.combo_items.map(ci => typeof ci === 'string' ? esc(ci) : esc(ci.name || '')).filter(Boolean).join(' + ')}</div>`
      : '';
    return `
      <div class="board-item">
        <div class="board-item-main"><span class="board-item-qty">${qty}×</span> ${esc(it.name || '')}</div>
        ${mods}${combo}${instr}
      </div>
    `;
  }).join('');
}
function formatOrderAddress(o) {
  if (!o.address) return '';
  if (o.address === 'Pickup') return 'Pickup';
  return esc(o.address);
}
function mapUrlFromOrder(o) {
  if (!o.address || o.address === 'Pickup') return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(o.address)}`;
}
function labelFor(s) {
  return s === 'preparing' ? 'PREP' : s === 'out_for_delivery' ? 'OUT' : s === 'delivered' ? 'DONE' : s.toUpperCase();
}
async function moveOrder(orderId, status) {
  try {
    const [order] = await sbGetO(`${TABLE_ORDERS}?select=*&order_id=eq.${encodeURIComponent(orderId)}&limit=1`) || [];
    const prevStatus = order?.status || 'received';
    await sbPatchO(`${TABLE_ORDERS}?order_id=eq.${encodeURIComponent(orderId)}`, { status });
    const cfg = getLoyaltyConfig();
    if (cfg && order?.customer_phone) {
      const field = getLoyaltyProgressField(cfg);
      const threshold = Math.max(1, parseInt(cfg.threshold || 1, 10) || 1);
      const hadReward = (order.loyalty_discount || 0) > 0 && order.loyalty_reward_name;
      if (prevStatus !== 'delivered' && status === 'delivered') {
        await adjustLoyaltyProgress(order.customer_phone, field, +1, { optInOnly: true });
        if (hadReward) await adjustLoyaltyProgress(order.customer_phone, field, -threshold, { optInOnly: true });
      }
      if (prevStatus === 'delivered' && status === 'cancelled') {
        await adjustLoyaltyProgress(order.customer_phone, field, -1, { optInOnly: true });
        if (hadReward) await adjustLoyaltyProgress(order.customer_phone, field, +threshold, { optInOnly: true });
      }
    }
    showToast(`Moved ${orderId} → ${status.replace(/_/g,' ')}`);
    renderOwnerOrders();
  } catch (e) { showToast('Update failed: ' + e.message); }
}

// ─── Owner Menu ───
async function renderOwnerMenu() {
  const docs = await sbGetO(`${TABLE_MENU}?select=*&order=display_order.asc,name.asc&limit=200`);
  const items = (docs || []).map(MenuItem.fromDoc);
  allMenuItems = items;
  menuItems = items.filter(i => i.available);
  buildMenuCache(allMenuItems);
  const table = document.getElementById('owner-menu-table');
  table.innerHTML = `
    <div class="owner-menu-row h">
      <div></div>
      <div>Item</div>
      <div>Price</div>
      <div>Available</div>
      <div>Trending</div>
      <div></div>
    </div>
    ${items.map(it => `
      <div class="owner-menu-row">
        <div class="menu-card-image-uploader">
          ${it.imageUrl
            ? `<img src="${esc(it.imageUrl)}" style="width:32px;height:32px;border-radius:6px;object-fit:cover" onerror="this.style.display='none'" />`
            : `<div style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:20px;background:var(--surface-2);border-radius:6px">${it.emoji}</div>`}
          <button class="upload-btn" onclick="document.getElementById('up-${it.id}').click()" title="Upload image">📷</button>
          <input type="file" id="up-${it.id}" accept="image/*" style="display:none" onchange="handleImageUpload('${it.id}', this)" />
        </div>
        <div style="cursor:pointer" onclick="openMenuEditor('${it.id}')" title="Click to edit">
          <strong>${esc(it.name)}</strong><br><span style="color:var(--text-muted);font-size:12px">${esc(it.category)}</span>
        </div>
        <div style="cursor:pointer" onclick="openMenuEditor('${it.id}')" title="Click to edit">${fmtMoney(it.price)}</div>
        <div><label class="toggle"><input type="checkbox" ${it.available ? 'checked' : ''} onchange="toggleMenu('${it.id}','available',this.checked)"><span class="toggle-slider"></span></label></div>
        <div><label class="toggle"><input type="checkbox" ${it.trending ? 'checked' : ''} onchange="toggleMenu('${it.id}','is_trending',this.checked)"><span class="toggle-slider"></span></label></div>
        <div style="display:flex;gap:4px;justify-content:flex-end">
          <button class="edit-btn" onclick="openMenuEditor('${it.id}')" title="Edit item">Edit</button>
          <button class="delete-btn" onclick="deleteMenu('${it.id}','${esc(it.name)}')">Delete</button>
        </div>
      </div>
    `).join('')}
  `;
}
async function handleImageUpload(itemId, input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image too large (max 5 MB)'); input.value = ''; return; }
  const btn = input.previousElementSibling;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳';
  try {
    const url = await uploadImage(file);
    await sbPatchO(`${TABLE_MENU}?id=eq.${itemId}`, { image_url: url });
    showToast('Image uploaded');
    await loadMenu();
    renderOwnerMenu();
  } catch (e) {
    showToast('Upload failed: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = orig;
    input.value = '';
  }
}
async function toggleMenu(id, field, value) {
  const payload = field === 'available' ? { available: value } : { is_trending: value };
  try {
    await sbPatchO(`${TABLE_MENU}?id=eq.${id}`, payload);
    showToast('Saved');
    await loadMenu();
  } catch (e) { showToast('Save failed: ' + e.message); }
}
async function deleteMenu(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    await sbDeleteO(`${TABLE_MENU}?id=eq.${id}`);
    showToast('Deleted');
    await loadMenu();
    renderOwnerMenu();
  } catch (e) { showToast('Delete failed: ' + e.message); }
}

// Menu editor uses the shared customize modal
let allMenuCache = new Map();
function buildMenuCache(items) { allMenuCache = new Map(items.map(i => [i.id, i])); }
async function refreshMenuCache() {
  const rows = await sbGetO(`${TABLE_MENU}?select=*&limit=200`) || [];
  buildMenuCache(rows.map(MenuItem.fromDoc));
  return allMenuCache;
}
function openMenuEditor(id) {
  const item = id ? allMenuCache.get(id) : null;
  const isEdit = !!item;
  if (id && !item) { showToast('Item not found — re-open the menu tab'); return; }
  const categories = ['Wings','Burgers','Sandwiches','Appetizers','Fish & Tacos','Plates','Salads','Kids Meals','Desserts','Drinks','Other'];
  const body = document.getElementById('customize-body');
  document.getElementById('customize-modal-title').textContent = isEdit ? 'Edit menu item' : 'New menu item';
  body.innerHTML = `
    <div class="form-row">
      <div class="form-group"><label>Name</label><input class="input" id="m-edit-name" value="${esc(item?.name || '')}" placeholder="Buffalo Wings" /></div>
      <div class="form-group"><label>Emoji</label><input class="input" id="m-edit-emoji" value="${esc(item?.emoji || '🍽️')}" maxlength="2" /></div>
    </div>
    <div class="form-group"><label>Description</label><input class="input" id="m-edit-desc" value="${esc(item?.description || '')}" placeholder="Crispy wings tossed in buffalo sauce" /></div>
    <div class="form-row">
      <div class="form-group"><label>Price (cents)</label><input class="input" id="m-edit-price" type="number" value="${item?.price ?? 999}" /><p class="muted" style="font-size:11px;margin-top:2px">In cents (e.g. 999 = $9.99)</p></div>
      <div class="form-group"><label>Category</label><select class="input" id="m-edit-category">${categories.map(c => `<option value="${c}" ${(item?.category || 'Wings') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    </div>
    <div class="form-group"><label>Sauces (comma separated)</label><input class="input" id="m-edit-sauces" value="${esc((item?.sauces || []).join(', '))}" placeholder="Buffalo, BBQ, Garlic Parmesan" /></div>
    <div class="form-group"><label>Add Ons (Name:PriceCents, comma separated)</label><input class="input" id="m-edit-addons" value="${esc((item?.addons || []).map(a => `${a.name}:${a.price}`).join(', '))}" placeholder="Extra sauce:50, Celery:100" /><p class="muted" style="font-size:11px;margin-top:2px">Example: Extra sauce:50, Celery:100</p></div>
    <div class="form-group">
      <label>Image (optional)</label>
      <div style="display:flex;gap:8px;align-items:center">
        ${item?.imageUrl ? `<img src="${esc(item.imageUrl)}" style="width:48px;height:48px;border-radius:8px;object-fit:cover" />` : ''}
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('m-img-input').click()">📷 Upload</button>
        <input type="file" id="m-img-input" accept="image/*" style="display:none" onchange="handleMenuImage(this)" />
        <input type="hidden" id="m-edit-image" value="${esc(item?.imageUrl || '')}" />
        ${item?.imageUrl ? `<button class="btn btn-secondary btn-sm" onclick="document.getElementById('m-edit-image').value='';this.parentElement.querySelector('img')?.remove()">Remove</button>` : ''}
      </div>
    </div>
    <div class="form-row" style="align-items:center">
      <div class="form-group"><label>Display order</label><input class="input" id="m-edit-order" type="number" value="${item?.display_order ?? 0}" /></div>
      <div class="form-group" style="display:flex;gap:16px;flex-wrap:wrap;padding-top:20px">
        <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="m-edit-available" ${item?.available ?? true ? 'checked' : ''} /> Available</label>
        <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="m-edit-trending" ${item?.trending ? 'checked' : ''} /> Trending</label>
        <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="m-edit-new" ${item?.isNew ? 'checked' : ''} /> New</label>
      </div>
    </div>
    <button class="add-btn" onclick="saveMenu('${isEdit ? item.id : ''}')">${isEdit ? 'Save changes' : 'Create item'}</button>
  `;
  document.getElementById('customize-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}
async function handleMenuImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image too large (max 5 MB)'); input.value = ''; return; }
  const btn = input.previousElementSibling;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳';
  try {
    const url = await uploadImage(file);
    document.getElementById('m-edit-image').value = url;
    showToast('Image ready');
  } catch (e) {
    showToast('Upload failed: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = orig;
    input.value = '';
  }
}
function parseAddons(str) {
  if (!str.trim()) return [];
  return str.split(',').map(s => {
    const [name, price] = s.split(':');
    return { name: name.trim(), price: parseInt((price || '0').trim(), 10) || 0 };
  }).filter(a => a.name);
}
async function saveMenu(id) {
  const name = document.getElementById('m-edit-name').value.trim();
  const priceCents = parseInt(document.getElementById('m-edit-price').value, 10);
  const category = document.getElementById('m-edit-category').value;
  if (!name) { showToast('Name is required'); return; }
  if (isNaN(priceCents) || priceCents < 0) { showToast('Price must be a non-negative number (in cents)'); return; }
  const payload = {
    name,
    description: document.getElementById('m-edit-desc').value.trim() || null,
    price: priceCents,
    category,
    emoji: document.getElementById('m-edit-emoji').value.trim() || '🍽️',
    image_url: document.getElementById('m-edit-image').value || null,
    available: document.getElementById('m-edit-available').checked,
    is_trending: document.getElementById('m-edit-trending').checked,
    is_new: document.getElementById('m-edit-new').checked,
    display_order: parseInt(document.getElementById('m-edit-order').value, 10) || 0,
    sauces: document.getElementById('m-edit-sauces').value.split(',').map(s => s.trim()).filter(Boolean),
    addons: parseAddons(document.getElementById('m-edit-addons').value),
  };
  try {
    if (id) {
      await sbPatchO(`${TABLE_MENU}?id=eq.${id}`, payload);
      showToast('Saved');
    } else {
      await sbPostO(`${TABLE_MENU}`, payload);
      showToast('Created');
    }
    closeCustomize();
    await loadMenu();
    await refreshMenuCache();
    renderOwnerMenu();
  } catch (e) {
    if (/PGRST205/i.test(e.message)) showToast('Run the menu_items table SQL in Supabase first');
    else showToast('Save failed: ' + e.message);
  }
}

// ─── Owner Combos ───
let allCombosCache = new Map();
async function loadAllCombos() {
  const rows = await sbGetO(`${TABLE_COMBOS}?select=*&order=display_order.asc,created_at.desc&limit=200`) || [];
  allCombosCache = new Map(rows.map(c => [c.id, c]));
  return rows;
}
async function renderOwnerCombos() {
  const [combos, items] = await Promise.all([loadAllCombos(), sbGetO(`${TABLE_MENU}?select=*&limit=200`).then(rows => (rows || []).map(MenuItem.fromDoc))]);
  const byId = new Map(items.map(i => [i.id, i]));
  const table = document.getElementById('owner-combos-table');
  table.innerHTML = `
    <div class="owner-menu-row h combos"><div></div><div>Combo</div><div>Includes</div><div>Price</div><div>Active</div><div></div></div>
    ${combos.length === 0
      ? '<div class="owner-menu-row empty-row">No combos yet. Click + Add Combo to bundle items together.</div>'
      : combos.map(c => {
        const included = (c.item_ids || []).map(id => byId.get(id)).filter(Boolean);
        return `
        <div class="owner-menu-row combos">
          <div style="font-size:24px;display:flex;align-items:center;justify-content:center;width:40px;height:40px;background:var(--surface-2);border-radius:8px">${c.emoji || '🎁'}</div>
          <div><strong>${esc(c.name)}</strong>${c.description ? `<br><span style="color:var(--text-muted);font-size:12px">${esc(c.description)}</span>` : ''}</div>
          <div class="combo-items-mini">${included.map(i => `<span class="combo-chip">${esc(i.name)}</span>`).join('') || '<span style="color:var(--primary)">(no items)</span>'}</div>
          <div><strong>${fmtMoney(c.combo_price)}</strong></div>
          <div><label class="toggle"><input type="checkbox" ${c.active ? 'checked' : ''} onchange="toggleCombo('${c.id}', this.checked)"><span class="toggle-slider"></span></label></div>
          <div style="display:flex;gap:6px"><button class="edit-btn" onclick="openComboEditor('${c.id}')">Edit</button><button class="delete-btn" onclick="deleteCombo('${c.id}','${esc(c.name)}')">×</button></div>
        </div>
      `;}).join('')}
  `;
}
async function toggleCombo(id, active) {
  try { await sbPatchO(`${TABLE_COMBOS}?id=eq.${id}`, { active }); showToast('Saved'); }
  catch (e) { showToast('Save failed: ' + e.message); }
}
async function deleteCombo(id, name) {
  if (!confirm(`Delete combo "${name}"?`)) return;
  try { await sbDeleteO(`${TABLE_COMBOS}?id=eq.${id}`); showToast('Deleted'); renderOwnerCombos(); }
  catch (e) { showToast('Delete failed: ' + e.message); }
}
function openComboEditor(arg) {
  const combo = (typeof arg === 'string') ? allCombosCache.get(arg) : arg;
  const isEdit = !!combo;
  const selectedIds = new Set(combo?.item_ids || []);
  const picker = allMenuItems.filter(i => i.available).map(it => `
    <div class="picker-chip ${selectedIds.has(it.id) ? 'selected' : ''}" data-id="${it.id}" onclick="togglePickerChip(this, '${it.id}')">
      <div style="font-size:18px">${it.emoji || '🍽️'}</div>
      <div>${esc(it.name)}</div>
      <div style="color:var(--text-muted);font-size:11px">${fmtMoney(it.price)}</div>
    </div>
  `).join('');
  const body = document.getElementById('customize-body');
  document.getElementById('customize-modal-title').textContent = isEdit ? 'Edit combo' : 'New combo';
  body.innerHTML = `
    <div class="form-group"><label>Name</label><input class="input" id="combo-edit-name" value="${esc(combo?.name || '')}" placeholder="Wings + Fries Combo" /></div>
    <div class="form-group"><label>Description</label><input class="input" id="combo-edit-desc" value="${esc(combo?.description || '')}" placeholder="A wing basket with fries and a drink" /></div>
    <div class="form-row">
      <div class="form-group"><label>Combo price (cents)</label><input class="input" id="combo-edit-price" type="number" value="${combo?.combo_price ?? 1299}" /></div>
      <div class="form-group"><label>Emoji</label><input class="input" id="combo-edit-emoji" value="${esc(combo?.emoji || '🎁')}" maxlength="2" /></div>
    </div>
    <div class="form-group">
      <label>Bundle items (pick 2+)</label>
      <div class="picker-grid" id="combo-picker">${picker}</div>
      <p class="muted" style="font-size:11px;margin-top:4px">Selected: <span id="combo-count">${selectedIds.size}</span></p>
    </div>
    <div class="form-group">
      <label>Image (optional)</label>
      <div style="display:flex;gap:8px;align-items:center">
        ${combo?.image_url ? `<img src="${esc(combo.image_url)}" style="width:48px;height:48px;border-radius:8px;object-fit:cover" />` : ''}
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('combo-img-input').click()">📷 Upload</button>
        <input type="file" id="combo-img-input" accept="image/*" style="display:none" onchange="handleComboImage(this)" />
        <input type="hidden" id="combo-edit-image" value="${esc(combo?.image_url || '')}" />
      </div>
    </div>
    <div class="form-row" style="align-items:center">
      <div class="form-group"><label>Display order</label><input class="input" id="combo-edit-order" type="number" value="${combo?.display_order ?? 0}" /></div>
      <div class="form-group" style="padding-top:20px"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="combo-edit-active" ${combo?.active ?? true ? 'checked' : ''} /> Active</label></div>
    </div>
    <button class="add-btn" onclick="saveCombo('${isEdit ? combo.id : ''}')">${isEdit ? 'Save changes' : 'Create combo'}</button>
  `;
  body._comboSelected = selectedIds;
  document.getElementById('customize-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function togglePickerChip(el, id) {
  el.classList.toggle('selected');
  const body = document.getElementById('customize-body');
  if (el.classList.contains('selected')) body._comboSelected.add(id);
  else body._comboSelected.delete(id);
  document.getElementById('combo-count').textContent = body._comboSelected.size;
}
async function handleComboImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image too large (max 5 MB)'); input.value = ''; return; }
  const btn = input.previousElementSibling;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳';
  try {
    const url = await uploadImage(file);
    document.getElementById('combo-edit-image').value = url;
    showToast('Image ready');
  } catch (e) {
    showToast('Upload failed: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = orig;
    input.value = '';
  }
}
async function saveCombo(id) {
  const body = document.getElementById('customize-body');
  let selectedIds = body._comboSelected ? Array.from(body._comboSelected) : null;
  if (!selectedIds) {
    selectedIds = Array.from(document.querySelectorAll('#combo-picker .picker-chip.selected')).map(el => el.dataset.id);
  }
  if (selectedIds.length < 2) { showToast('Pick at least 2 items to bundle'); return; }
  const name = (document.getElementById('combo-edit-name').value || '').trim();
  if (!name) { showToast('Name is required'); return; }
  const payload = {
    name,
    description: (document.getElementById('combo-edit-desc').value || '').trim(),
    combo_price: Math.max(0, parseInt(document.getElementById('combo-edit-price').value, 10) || 0),
    emoji: (document.getElementById('combo-edit-emoji').value || '🎁').slice(0, 2),
    item_ids: selectedIds,
    image_url: document.getElementById('combo-edit-image').value || null,
    display_order: parseInt(document.getElementById('combo-edit-order').value, 10) || 0,
    active: document.getElementById('combo-edit-active').checked,
  };
  try {
    if (id) await sbPatchO(`${TABLE_COMBOS}?id=eq.${id}`, payload);
    else await sbPostO(TABLE_COMBOS, payload, 'return=representation');
    showToast('Combo saved');
    closeCustomize();
    await loadCustomerCombos();
    renderOwnerCombos();
  } catch (e) {
    const msg = String(e.message || '');
    if (msg.includes('PGRST205') || (msg.includes('combos') && msg.includes('not found'))) {
      showToast('Combos table missing — run setup_combos.sql in Supabase first', 5000);
    } else showToast('Save failed: ' + e.message);
  }
}

// ─── Owner Promos ───
async function loadAllPromos() {
  return await sbGetO(`${TABLE_PROMOS}?select=*&order=created_at.desc&limit=200`) || [];
}
async function renderOwnerPromos() {
  const promos = await loadAllPromos();
  const table = document.getElementById('owner-promos-table');
  table.innerHTML = `
    <div class="owner-menu-row h promos"><div>Code</div><div>Description</div><div>Discount</div><div>Active</div><div></div></div>
    ${promos.length === 0
      ? '<div class="owner-menu-row empty-row">No promo codes yet. Click + Add Promo to add one.</div>'
      : promos.map(p => `
      <div class="owner-menu-row promos">
        <div><strong>${esc(p.code)}</strong></div>
        <div style="color:var(--text-muted);font-size:12px">${esc(p.description || '')}</div>
        <div>${p.discount_percent ?? 10}%</div>
        <div><label class="toggle"><input type="checkbox" ${p.active ? 'checked' : ''} onchange="togglePromo('${p.id}', this.checked)"><span class="toggle-slider"></span></label></div>
        <div><button class="delete-btn" onclick="deletePromo('${p.id}','${esc(p.code)}')">Delete</button></div>
      </div>
    `).join('')}
  `;
}
async function togglePromo(id, active) {
  try { await sbPatchO(`${TABLE_PROMOS}?id=eq.${id}`, { active }); showToast('Saved'); }
  catch (e) { showToast('Save failed: ' + e.message); }
}
async function deletePromo(id, code) {
  if (!confirm(`Delete promo "${code}"?`)) return;
  try { await sbDeleteO(`${TABLE_PROMOS}?id=eq.${id}`); showToast('Deleted'); renderOwnerPromos(); }
  catch (e) { showToast('Delete failed: ' + e.message); }
}
function openPromoEditor(promo) {
  const isEdit = !!promo;
  const body = document.getElementById('customize-body');
  document.getElementById('customize-modal-title').textContent = isEdit ? 'Edit promo' : 'New promo code';
  body.innerHTML = `
    <div class="form-group"><label>Code (uppercase, no spaces)</label><input class="input" id="promo-edit-code" value="${esc(promo?.code || '')}" placeholder="WINGS10" maxlength="32" style="text-transform:uppercase" /></div>
    <div class="form-group"><label>Description (shown to customers)</label><input class="input" id="promo-edit-desc" value="${esc(promo?.description || '')}" placeholder="10% off your first order" /></div>
    <div class="form-group"><label>Discount percent (0-100)</label><input class="input" id="promo-edit-pct" type="number" min="0" max="100" value="${promo?.discount_percent ?? 10}" /></div>
    <div class="form-group"><label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="promo-edit-active" ${promo?.active ?? true ? 'checked' : ''} /> Active</label></div>
    <button class="add-btn" onclick="savePromo('${isEdit ? promo.id : ''}')">${isEdit ? 'Save changes' : 'Create promo'}</button>
  `;
  document.getElementById('customize-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}
async function savePromo(id) {
  const code = (document.getElementById('promo-edit-code').value || '').trim().toUpperCase();
  const description = (document.getElementById('promo-edit-desc').value || '').trim();
  const discount_percent = Math.max(0, Math.min(100, parseInt(document.getElementById('promo-edit-pct').value, 10) || 0));
  const active = document.getElementById('promo-edit-active').checked;
  if (!code) { showToast('Code is required'); return; }
  if (!/^[A-Z0-9_-]+$/.test(code)) { showToast('Code must be A-Z, 0-9, _ or -'); return; }
  const payload = { code, description, discount_percent, active };
  try {
    if (id) await sbPatchO(`${TABLE_PROMOS}?id=eq.${id}`, payload);
    else await sbPostO(TABLE_PROMOS, payload, 'return=representation');
    showToast('Promo saved');
    closeCustomize();
    renderOwnerPromos();
  } catch (e) {
    if (e.message.includes('duplicate') || e.message.includes('unique')) showToast('Code already exists — pick another');
    else showToast('Save failed: ' + e.message);
  }
}

// ─── Owner Settings ───
function renderOwnerSettings() {
  const s = settings || {};
  const grid = document.getElementById('owner-settings-grid');
  grid.innerHTML = `
    <div class="owner-setting-card">
      <h3>Business Info</h3>
      <div class="form-group"><label>Business Name</label><input class="input" id="set-name" value="${esc(s.business_name || ENV.businessName)}" /></div>
      <div class="form-group"><label>Address</label><input class="input" id="set-address" value="${esc(s.business_address || '')}" /></div>
      <div class="form-group"><label>Phone</label><input class="input" id="set-phone" value="${esc(s.business_phone || '')}" /></div>
    </div>
    <div class="owner-setting-card">
      <h3>Delivery & Tax</h3>
      <div class="form-group"><label>Delivery Fee (cents)</label><input class="input" id="set-fee" type="number" value="${s.delivery_fee ?? ENV.defaultDeliveryFee}" /></div>
      <div class="form-group"><label>Tax Rate</label><input class="input" id="set-tax" value="${s.tax_rate ?? ENV.taxRate}" /></div>
    </div>
    <div class="owner-setting-card" style="grid-column:1/-1;">
      <h3>Background Image</h3>
      <div id="bg-preview" style="margin-bottom:10px;"></div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('set-bg-input').click()">📷 Upload image</button>
        <input type="file" id="set-bg-input" accept="image/*" style="display:none" onchange="handleBackgroundImage(this)" />
        <input type="hidden" id="set-bg-url" value="${esc(s.background_image_url || '')}" />
        <span class="muted" style="font-size:12px">Landscape image, max 5 MB. Dark overlay keeps text readable.</span>
      </div>
    </div>
    <div class="owner-setting-card" style="grid-column:1/-1;">
      <h3>Business Hours</h3>
      <div class="hours-grid" id="hours-grid"></div>
    </div>
    <div class="owner-setting-card" style="grid-column:1/-1;">
      <div class="owner-save-bar"><button class="btn btn-primary" onclick="saveOwnerSettings()">Save Settings</button></div>
    </div>
  `;
  renderHoursGrid();
  renderBackgroundPreview();
}
function renderHoursGrid() {
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const grid = document.getElementById('hours-grid');
  const h = settings?.business_hours || {};
  grid.innerHTML = `
    <div></div><div><strong>Open</strong></div><div><strong>Close</strong></div>
    ${days.map(d => {
      const day = h[d] || {};
      return `
        <label>${cap(d)}</label>
        <input type="time" id="hour-${d}-open" value="${day.open || '10:30'}" />
        <input type="time" id="hour-${d}-close" value="${day.close || '21:00'}" />
      `;
    }).join('')}
  `;
}
function renderBackgroundPreview() {
  const url = document.getElementById('set-bg-url')?.value || settings?.background_image_url || '';
  const preview = document.getElementById('bg-preview');
  if (!preview) return;
  if (url) {
    preview.innerHTML = `<img src="${esc(url)}" style="width:120px;height:80px;object-fit:cover;border-radius:var(--radius-sm);border:2px solid var(--primary);" onerror="this.parentElement.innerHTML='<div class=\'muted\' style=\'font-size:12px\'>Broken image URL</div>'" />
      <button class="btn btn-secondary btn-sm" onclick="document.getElementById('set-bg-url').value='';renderBackgroundPreview();" style="margin-left:10px;">Remove</button>`;
  } else {
    preview.innerHTML = '<span class="muted" style="font-size:12px;">No custom background</span>';
  }
}
async function handleBackgroundImage(input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Image too large (max 5 MB)'); input.value = ''; return; }
  const btn = input.previousElementSibling;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳';
  try {
    const url = await uploadImage(file);
    document.getElementById('set-bg-url').value = url;
    renderBackgroundPreview();
    showToast('Background uploaded');
  } catch (e) {
    showToast('Upload failed: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = orig;
    input.value = '';
  }
}
async function saveOwnerSettings() {
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const business_hours = {};
  days.forEach(d => {
    business_hours[d] = {
      open: document.getElementById(`hour-${d}-open`).value,
      close: document.getElementById(`hour-${d}-close`).value,
    };
  });
  const payload = {
    id: 1,
    business_name: document.getElementById('set-name').value,
    business_address: document.getElementById('set-address').value,
    business_phone: document.getElementById('set-phone').value,
    delivery_fee: parseInt(document.getElementById('set-fee').value, 10) || 0,
    tax_rate: parseFloat(document.getElementById('set-tax').value) || 0,
    business_hours,
    background_image_url: document.getElementById('set-bg-url')?.value || null,
  };
  try {
    await sbPostO(TABLE_SETTINGS, payload, 'resolution=merge-duplicates,return=representation');
    settings = { ...(settings || {}), ...payload };
    showToast('Settings saved');
    updateHoursDisplay();
    applyBackgroundImage();
  } catch (e) {
    showToast('Settings save failed: ' + e.message);
    console.error(e);
  }
}

// ─── Owner Rewards ───
function getLoyaltyConfig() {
  const cfg = settings?.loyalty_config;
  if (!cfg || typeof cfg !== 'object') return null;
  return cfg.active ? cfg : null;
}
function getLoyaltyProgressField(cfg) {
  return cfg?.type === 'purchase_qty' ? 'purchase_count' : 'stamps';
}
function digitsOnly(phone) { return (phone || '').replace(/\D/g, ''); }
function loyaltyQualifiesCart(cfg, cart) {
  if (!cfg || !cart || cart.length === 0) return false;
  const scope = cfg.target?.scope || 'any';
  const value = String(cfg.target?.value || '').toLowerCase().trim();
  if (scope === 'any') return true;
  return cart.some(c => {
    if (scope === 'category') return String(c.category || '').toLowerCase() === value;
    if (scope === 'item') return String(c.name || '').toLowerCase() === value || String(c.id || '').toLowerCase() === value;
    return false;
  });
}
function loyaltyDiscountFor(cfg, subtotal) {
  if (!cfg) return 0;
  if (cfg.reward?.type === 'discount_percent') {
    const pct = Math.max(0, Math.min(100, parseFloat(cfg.reward.value) || 0));
    return Math.round(subtotal * pct / 100);
  }
  return Math.max(0, parseInt(cfg.reward?.value || 0, 10) || 0);
}
async function fetchCustomerReward(phone) {
  const digits = digitsOnly(phone);
  if (!digits || digits.length < 10) return null;
  try {
    const rows = await sbGet(`${TABLE_REWARDS}?select=*&phone=eq.${encodeURIComponent(digits)}&limit=1`);
    return rows?.[0] || null;
  } catch (e) {
    if (/PGRST205/i.test(e.message)) console.warn('customer_rewards table missing — run setup_rewards.sql');
    return null;
  }
}
async function ensureCustomerReward(phone, optIn) {
  const digits = digitsOnly(phone);
  if (!digits || digits.length < 10) return null;
  try {
    const existing = await fetchCustomerReward(digits);
    if (existing) {
      if (optIn && !existing.opt_in) await sbPatch(`${TABLE_REWARDS}?id=eq.${existing.id}`, { opt_in: true });
      return existing;
    }
    const payload = { phone: digits, stamps: 0, purchase_count: 0, lifetime_orders: 0, opt_in: !!optIn };
    const rows = await sbPost(TABLE_REWARDS, payload, 'return=representation');
    return rows?.[0] || null;
  } catch (e) {
    if (/PGRST205/i.test(e.message)) console.warn('customer_rewards table missing — run setup_rewards.sql');
    return null;
  }
}
async function adjustLoyaltyProgress(phone, field, delta, { optInOnly = true } = {}) {
  const digits = digitsOnly(phone);
  if (!digits || digits.length < 10) return;
  try {
    const row = await fetchCustomerReward(digits);
    if (!row) return;
    if (optInOnly && !row.opt_in) return;
    const current = parseInt(row[field] || 0, 10) || 0;
    const next = Math.max(0, current + delta);
    const payload = { [field]: next };
    if (delta > 0) payload.lifetime_orders = (parseInt(row.lifetime_orders || 0, 10) || 0) + delta;
    await sbPatchO(`${TABLE_REWARDS}?id=eq.${row.id}`, payload);
  } catch (e) {
    if (/PGRST205/i.test(e.message)) console.warn('customer_rewards table missing — run setup_rewards.sql');
  }
}
async function refreshPendingReward() {
  const cfg = getLoyaltyConfig();
  const box = document.getElementById('loyalty-reward-box');
  const msg = document.getElementById('loyalty-active-message');
  const nameEl = document.getElementById('loyalty-reward-name');
  if (!cfg || cart.length === 0) {
    box?.classList.add('hidden');
    msg?.classList.add('hidden');
    pendingRewardInfo = null;
    return;
  }
  const phone = digitsOnly(document.getElementById('c-phone').value);
  if (phone.length < 10 || !loyaltyQualifiesCart(cfg, cart)) {
    box?.classList.add('hidden');
    pendingRewardInfo = null;
    return;
  }
  const row = await fetchCustomerReward(phone);
  const field = getLoyaltyProgressField(cfg);
  const progress = row?.[field] || 0;
  const threshold = Math.max(1, parseInt(cfg.threshold || 1, 10) || 1);
  if (progress >= threshold) {
    pendingRewardInfo = {
      name: cfg.name,
      discountCents: loyaltyDiscountFor(cfg, cart.reduce((s, c) => s + (c.price + c.selectedAddons.reduce((a,b)=>a+b.price,0)) * c.qty, 0)),
      type: cfg.type,
      progressField: field,
      threshold,
      cfg,
    };
    if (nameEl) nameEl.textContent = `${cfg.name} — ${fmtMoney(pendingRewardInfo.discountCents)} off`;
    box?.classList.remove('hidden');
  } else {
    box?.classList.add('hidden');
    pendingRewardInfo = null;
  }
  msg?.classList.toggle('hidden', !currentReward);
}
function applyLoyaltyReward() {
  if (!pendingRewardInfo) return;
  currentReward = pendingRewardInfo;
  document.getElementById('loyalty-reward-box')?.classList.add('hidden');
  document.getElementById('loyalty-active-message')?.classList.remove('hidden');
  renderCheckoutSummary();
}
function clearLoyaltyReward() {
  currentReward = null;
  pendingRewardInfo = null;
  document.getElementById('loyalty-reward-box')?.classList.add('hidden');
  document.getElementById('loyalty-active-message')?.classList.add('hidden');
  renderCheckoutSummary();
}
function onRewardTypeChange() {
  const type = document.getElementById('rw-type').value;
  const targetBlock = document.getElementById('rw-target-block');
  targetBlock.classList.toggle('hidden', type !== 'purchase_qty');
  onRewardTargetChange();
}
function onRewardTargetChange() {
  const scope = document.getElementById('rw-target-scope').value;
  const input = document.getElementById('rw-target-value');
  input.style.display = scope === 'any' ? 'none' : 'block';
  input.placeholder = scope === 'category' ? 'Wings, Burgers, Drinks' : 'Item name or id';
}
function onRewardRewardTypeChange() {
  const type = document.getElementById('rw-reward-type').value;
  document.getElementById('rw-value-label').textContent = type === 'discount_percent' ? 'Value (%)' : 'Value (cents)';
}
async function renderOwnerRewards() {
  const cfg = getLoyaltyConfig();
  document.getElementById('rw-active').checked = !!cfg?.active;
  document.getElementById('rw-name').value = cfg?.name || '';
  document.getElementById('rw-type').value = cfg?.type || 'stamps';
  document.getElementById('rw-threshold').value = cfg?.threshold || 10;
  document.getElementById('rw-target-scope').value = cfg?.target?.scope || 'any';
  document.getElementById('rw-target-value').value = cfg?.target?.value || '';
  document.getElementById('rw-reward-type').value = cfg?.reward?.type || 'discount_fixed';
  document.getElementById('rw-reward-value').value = cfg?.reward?.value || 0;
  onRewardTypeChange();
  onRewardRewardTypeChange();
  await loadCustomerRewardsList();
}
async function saveLoyaltyConfig() {
  const type = document.getElementById('rw-type').value;
  const targetScope = document.getElementById('rw-target-scope').value;
  const targetValue = (document.getElementById('rw-target-value').value || '').trim().toLowerCase();
  const rewardType = document.getElementById('rw-reward-type').value;
  const rewardValue = rewardType === 'discount_percent'
    ? Math.max(0, Math.min(100, parseFloat(document.getElementById('rw-reward-value').value) || 0))
    : Math.max(0, parseInt(document.getElementById('rw-reward-value').value, 10) || 0);
  const payload = {
    id: 1,
    loyalty_config: {
      active: document.getElementById('rw-active').checked,
      name: (document.getElementById('rw-name').value || '').trim(),
      type,
      threshold: Math.max(1, parseInt(document.getElementById('rw-threshold').value, 10) || 1),
      target: type === 'purchase_qty' ? { scope: targetScope, value: targetScope === 'any' ? '' : targetValue } : { scope: 'any', value: '' },
      reward: { type: rewardType, value: rewardValue },
    },
  };
  if (!payload.loyalty_config.name) { showToast('Reward name is required'); return; }
  try {
    await sbPostO(TABLE_SETTINGS, payload, 'resolution=merge-duplicates,return=representation');
    settings = { ...(settings || {}), ...payload };
    showToast('Reward rule saved');
  } catch (e) {
    showToast('Save failed: ' + e.message);
  }
}
async function loadCustomerRewardsList() {
  const list = document.getElementById('owner-rewards-list');
  list.innerHTML = '<div class="empty-state" style="padding:12px">Loading...</div>';
  try {
    const rows = await sbGetO(`${TABLE_REWARDS}?select=*&order=updated_at.desc&limit=200`) || [];
    const cfg = getLoyaltyConfig();
    const field = cfg ? getLoyaltyProgressField(cfg) : 'stamps';
    const search = (document.getElementById('rw-search').value || '').replace(/\D/g, '');
    const filtered = search ? rows.filter(r => r.phone.includes(search)) : rows;
    if (filtered.length === 0) {
      list.innerHTML = '<div class="empty-state" style="padding:12px">No customers found.</div>';
      return;
    }
    list.innerHTML = filtered.map(r => {
      const progress = r[field] || 0;
      const opt = r.opt_in ? '<span style="color:#22c55e">opted in</span>' : '<span class="muted">not opted in</span>';
      return `
        <div class="owner-reward-row">
          <div class="owner-reward-phone">${fmtPhone(r.phone)}</div>
          <div class="owner-reward-stats">${field === 'stamps' ? 'Stamps' : 'Purchases'}: <strong>${progress}</strong> · Lifetime: ${r.lifetime_orders || 0} · ${opt}</div>
          <div class="owner-reward-actions">
            <button class="edit-btn" onclick="adjustCustomerReward('${esc(r.phone)}', '${field}', 1)">+1</button>
            <button class="delete-btn" onclick="adjustCustomerReward('${esc(r.phone)}', '${field}', -1)">−1</button>
            <button class="delete-btn" onclick="toggleCustomerOptIn('${esc(r.phone)}', ${!r.opt_in})">${r.opt_in ? 'Opt out' : 'Opt in'}</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    if (/PGRST205/i.test(e.message)) list.innerHTML = '<div class="empty-state" style="color:var(--primary);padding:12px">Rewards table missing. Run setup_rewards.sql in Supabase.</div>';
    else list.innerHTML = '<div class="empty-state" style="padding:12px">Failed to load customers.</div>';
  }
}
async function adjustCustomerReward(phone, field, delta) {
  await adjustLoyaltyProgress(phone, field, delta, { optInOnly: false });
  showToast('Updated');
  loadCustomerRewardsList();
}
async function toggleCustomerOptIn(phone, optIn) {
  const row = await fetchCustomerReward(phone);
  if (!row) { showToast('Customer not found'); return; }
  try {
    await sbPatchO(`${TABLE_REWARDS}?id=eq.${row.id}`, { opt_in: !!optIn });
    showToast(optIn ? 'Opted in' : 'Opted out');
    loadCustomerRewardsList();
  } catch (e) { showToast('Update failed: ' + e.message); }
}
function fmtPhone(digits) {
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return digits;
}

function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

// ─── Utils ───
function fmtMoney(cents) {
  return '$' + (cents / 100).toFixed(2);
}
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

// ─── Payment Method ───
let paymentMethod = 'online';
function setPaymentMethod(mode) {
  paymentMethod = mode;
  const btn = document.getElementById('place-order-btn');
  if (btn) {
    btn.innerHTML = mode === 'online'
      ? '<i class="fas fa-lock"></i> Continue to Payment'
      : '<i class="fas fa-store"></i> Place Order (Pay in Person)';
  }
}

// ─── Clover Integration UI ───
function updateCloverConnectionStatus() {
  const el = document.getElementById('clover-connection-status');
  if (!el) return;
  const merchantId = (window.Clover && Clover.getMerchantId()) || null;
  if (merchantId) {
    el.innerHTML = `Connected: <code>${esc(merchantId)}</code>`;
    el.style.color = '#22c55e';
  } else {
    el.textContent = 'Not connected. Click Connect Clover to authorize.';
    el.style.color = 'var(--text-muted)';
  }
}

async function onPullCloverMenu() {
  const status = document.getElementById('clover-sync-status');
  status.textContent = 'Pulling menu…';
  try {
    const result = await Clover.pullMenu();
    status.textContent = `Pulled ${result.pulled || 0} items, skipped ${result.skippedPull || 0}.`;
    status.style.color = '#22c55e';
    await loadMenu();
  } catch (e) {
    status.textContent = 'Pull failed: ' + e.message;
    status.style.color = 'var(--primary)';
  }
}


async function onPushCloverMenu() {
  const status = document.getElementById('clover-sync-status');
  status.textContent = 'Checking Clover menu…';
  status.style.color = 'var(--text-muted)';
  try {
    const report = await Clover.checkPushMenu();
    if (report.safeToPush) {
      status.textContent = 'Pushing menu…';
      const result = await Clover.pushMenu(false);
      status.textContent = `Created ${result.created || 0}, updated ${result.updated || 0}, skipped ${result.skipped || 0}.`;
      status.style.color = '#22c55e';
    } else {
      status.textContent = 'Clover menu check found issues. Review below.';
      status.style.color = 'var(--primary)';
      showCloverPushReport(report);
    }
  } catch (e) {
    status.textContent = 'Push check failed: ' + e.message;
    status.style.color = 'var(--primary)';
  }
}

async function doForcePushCloverMenu() {
  const status = document.getElementById('clover-sync-status');
  closeCloverPushReport();
  status.textContent = 'Pushing menu (force)…';
  try {
    const result = await Clover.pushMenu(true);
    status.textContent = `Force pushed: created ${result.created || 0}, updated ${result.updated || 0}, skipped ${result.skipped || 0}.`;
    status.style.color = '#22c55e';
  } catch (e) {
    status.textContent = 'Force push failed: ' + e.message;
    status.style.color = 'var(--primary)';
  }
}

async function doPullThenPushCloverMenu() {
  const status = document.getElementById('clover-sync-status');
  closeCloverPushReport();
  status.textContent = 'Pulling from Clover to match…';
  try {
    const pullResult = await Clover.pullMenu();
    status.textContent = `Pulled ${pullResult.pulled || 0} items. Now pushing…`;
    await loadMenu();
    const pushResult = await Clover.pushMenu(false);
    status.textContent = `Synced: pulled ${pullResult.pulled || 0}, pushed created ${pushResult.created || 0}, updated ${pushResult.updated || 0}.`;
    status.style.color = '#22c55e';
  } catch (e) {
    status.textContent = 'Pull-then-push failed: ' + e.message;
    status.style.color = 'var(--primary)';
  }
}

function showCloverPushReport(report) {
  const modal = document.getElementById('clover-push-report-modal');
  const body = document.getElementById('clover-push-report-body');
  if (!modal || !body) return;

  const warnings = (report.warnings || [])
    .map(w => `<div class="clover-report-warning">⚠️ ${esc(w)}</div>`)
    .join('');

  const onlyClover = (report.onlyInClover || [])
    .map(i => `<div class="clover-report-row"><span>${esc(i.name)}</span><span class="muted">only in Clover</span></div>`)
    .join('') || '<div class="muted">None</div>';

  const mismatches = (report.nameMismatches || [])
    .map(m => `<div class="clover-report-row"><span>${esc(m.supabaseName)}</span><span class="muted">linked to “${esc(m.cloverName)}”</span></div>`)
    .join('') || '<div class="muted">None</div>';

  body.innerHTML = `
    ${warnings}
    <div class="clover-report-section">
      <h4>Items only in Clover (${report.onlyInClover?.length || 0})</h4>
      ${onlyClover}
    </div>
    <div class="clover-report-section">
      <h4>Name mismatches (${report.nameMismatches?.length || 0})</h4>
      ${mismatches}
    </div>
    <p class="muted">Matched: ${report.matched?.length || 0} · Only in Supabase: ${report.onlyInSupabase?.length || 0}</p>
  `;
  modal.classList.add('active');
}

function closeCloverPushReport() {
  const modal = document.getElementById('clover-push-report-modal');
  if (modal) modal.classList.remove('active');
}

function openMenuManagerForClover() {
  closeCloverPushReport();
  switchOwnerView('menu');
  showToast('Review and organize your menu, then push again.');
}

async function onScanCloverDevices() {
  const list = document.getElementById('clover-devices-list');
  list.innerHTML = '<div class="muted">Scanning…</div>';
  try {
    const data = await Clover.scanDevices();
    await renderCloverDevices();
    list.innerHTML += `<div style="color:#22c55e;margin-top:8px">Found ${data.scanned || 0} device(s).</div>`;
  } catch (e) {
    list.innerHTML = `<div style="color:var(--primary)">Scan failed: ${esc(e.message)}</div>`;
  }
}

async function onConnectWithToken() {
  const merchantId = document.getElementById('clover-merchant-id').value.trim();
  const token = document.getElementById('clover-api-token').value.trim();
  const ecommerceToken = document.getElementById('clover-ecommerce-private-token')?.value?.trim() || '';
  const status = document.getElementById('clover-token-status');
  if (!merchantId || !token) {
    status.textContent = 'Enter both Merchant ID and API token.';
    status.style.color = 'var(--primary)';
    return;
  }
  status.textContent = 'Connecting…';
  try {
    await Clover.connectWithToken(merchantId, token, ecommerceToken);
    status.textContent = 'Connected with token.';
    status.style.color = '#22c55e';
    updateCloverConnectionStatus();
    renderCloverDevices();
  } catch (e) {
    status.textContent = 'Failed: ' + e.message;
    status.style.color = 'var(--primary)';
  }
}

async function onSaveEcommerceToken() {
  const merchantId = Clover.getMerchantId() || document.getElementById('clover-merchant-id')?.value?.trim();
  const token = document.getElementById('clover-ecommerce-private-token').value.trim();
  const status = document.getElementById('clover-ecommerce-token-status');
  if (!merchantId) {
    status.textContent = 'Enter or connect a Clover Merchant ID first.';
    status.style.color = 'var(--primary)';
    return;
  }
  if (!token) {
    status.textContent = 'Paste the Ecommerce private token.';
    status.style.color = 'var(--primary)';
    return;
  }
  status.textContent = 'Saving…';
  try {
    const res = await fetch(`${ENV.cloverBackendUrl}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloverMerchantId: merchantId, ecommercePrivateToken: token }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);
    status.textContent = 'Ecommerce token saved.';
    status.style.color = '#22c55e';
  } catch (e) {
    status.textContent = 'Failed: ' + e.message;
    status.style.color = 'var(--primary)';
  }
}

async function onDisconnectClover() {
  const status = document.getElementById('clover-token-status');
  if (!confirm('Disconnect Clover for this merchant? This clears the stored token.')) return;
  try {
    await Clover.disconnect();
    status.textContent = 'Disconnected.';
    status.style.color = '#22c55e';
    updateCloverConnectionStatus();
    renderCloverDevices();
  } catch (e) {
    status.textContent = 'Disconnect failed: ' + e.message;
    status.style.color = 'var(--primary)';
  }
}

async function renderCloverDevices() {
  const list = document.getElementById('clover-devices-list');
  if (!list) return;
  try {
    const data = await Clover.listDevices();
    const devices = data.devices || [];
    if (devices.length === 0) {
      list.innerHTML = '<div class="muted">No devices found. Click Scan Devices.</div>';
      return;
    }
    const defaultId = Clover.getDefaultDeviceId();
    list.innerHTML = devices.map(d => `
      <div class="owner-reward-row" style="align-items:center">
        <div>
          <strong>${esc(d.name || d.model || d.clover_device_id)}</strong>
          <div class="muted">${esc(d.device_type_name || '')} · ${esc(d.serial || '')}</div>
        </div>
        <label style="display:flex;align-items:center;gap:6px;white-space:nowrap">
          <input type="radio" name="clover-default-device" value="${esc(d.clover_device_id)}"
            ${d.clover_device_id === defaultId || d.is_default ? 'checked' : ''}
            onchange="Clover.setDefaultDeviceId('${esc(d.clover_device_id)}')" />
          Default
        </label>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = `<div style="color:var(--primary)">Failed to load devices: ${esc(e.message)}</div>`;
  }
}

// Hook into owner view switcher to refresh Clover UI when selected.
const _origSwitchOwnerView = switchOwnerView;
switchOwnerView = function(view) {
  _origSwitchOwnerView(view);
  if (view === 'clover') {
    updateCloverConnectionStatus();
    renderCloverDevices();
  }
};

// ─── Clover OAuth Callback Handler ───
(function handleCloverCallback() {
  if (window.Clover && Clover.parseCallback) {
    const merchantId = Clover.parseCallback();
    if (merchantId) {
      showToast('Clover connected: ' + merchantId);
    }
  }
})();
