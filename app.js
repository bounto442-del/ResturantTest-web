/**
 * Demo Restaurant — Customer Ordering Web App
 * Supabase REST backend. No WebSockets.
 */

const SUPABASE_URL = ENV.supabaseUrl;
const SUPABASE_KEY = ENV.supabaseKey;
const TABLE_MENU = ENV.tableMenuItems || 'menu_items';
const TABLE_ORDERS = ENV.tableOrders || 'orders';
const TABLE_PROMOS = ENV.tablePromos || 'promos';
const TABLE_SETTINGS = ENV.tableSettings || 'settings';

const TAX_RATE = 0.0825;
const CATEGORY_LIMIT = 6; // show at most 6 items per category; "See all" expands
let menuItems = [];
let cart = [];
let currentPromo = null;
let deliveryFee = 399; // cents
let orderMode = 'delivery';
let currentOrderId = null;
let pollInterval = null;

// ─── Init ───
document.addEventListener('DOMContentLoaded', async () => {
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
  // Load settings and promos in parallel; menu is the critical path
  const menuPromise = loadMenu().then(() => {
    hideLoading();
    setupCategories();
  });
  await Promise.all([
    menuPromise,
    loadSettings(),
    loadPromos(),
  ]);
  updateHoursDisplay();

  // Auto-refresh menu every 30s while on home screen
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
  setTimeout(() => t.classList.remove('show'), 2600);
}

// ─── REST Helpers ───
function _sbHeaders(extra = {}) {
  return {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

async function sbGet(path) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  console.log('GET', url);
  const r = await fetch(url, { headers: _sbHeaders() });
  const text = await r.text();
  console.log('Response', r.status, text.substring(0, 200));
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  // Supabase returns array directly for SELECT
  return JSON.parse(text);
}

async function sbPost(path, body, prefer = 'return=representation') {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: _sbHeaders({
      'Content-Type': 'application/json',
      'Prefer': prefer,
    }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  // When return=representation, response is the inserted row(s)
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

async function sbPatch(path, body) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const r = await fetch(url, {
    method: 'PATCH',
    headers: _sbHeaders({
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    }),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}

// ─── Settings ───
async function loadSettings() {
  try {
    // Supabase returns an array; settings is a singleton (id=1)
    const rows = await sbGet(`${TABLE_SETTINGS}?select=*&limit=1`);
    const doc = rows?.[0];
    if (doc) {
      deliveryFee = doc.delivery_fee ?? 399;
      const el = document.getElementById('sum-delivery');
      if (el) el.textContent = fmtMoney(deliveryFee);
    }
  } catch (e) { console.warn('Settings load failed', e); }
}

function updateHoursDisplay() {
  const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const today = days[new Date().getDay()];
  const el = document.getElementById('hours-today');
  if (el) el.textContent = `${today}: 10:30 AM — 9:00 PM`;
}

// ─── Menu ───
async function loadMenu() {
  const grid = document.getElementById('menu-grid');
  grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">Loading menu...</div>';
  try {
    console.log('Fetching menu from Supabase...');
    // Supabase supports order, limit, and eq filters via query string
    const docs = await sbGet(`${TABLE_MENU}?select=*&order=name.asc&limit=1000`);
    console.log(`Fetched ${docs.length} docs from Supabase`);
    menuItems = docs.map(d => MenuItem.fromDoc(d)).filter(i => i.available);
    console.log(`Loaded ${menuItems.length} menu items`);
    if (menuItems.length === 0) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">Menu is empty. Add items via the Clover sync tool or the owner menu manager.</div>';
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

// Silent re-fetch for the 30s auto-refresh — doesn't show the loading grid.
async function loadMenuSilent() {
  try {
    const docs = await sbGet(`${TABLE_MENU}?select=*&order=name.asc&limit=1000`);
    const fresh = docs.map(d => MenuItem.fromDoc(d)).filter(i => i.available);
    if (fresh.length !== menuItems.length) {
      menuItems = fresh;
      const activeChip = document.querySelector('.chip.chip-active');
      const cat = activeChip ? activeChip.dataset.cat : 'all';
      renderMenu(cat);
    }
  } catch (e) { /* ignore — try again in 30s */ }
}

class MenuItem {
  constructor(data) { Object.assign(this, data); }
  static fromDoc(d) {
    // Supabase row is snake_case. The order/menu screen uses camelCase field names;
    // normalize here so the rest of app.js doesn't need to change.
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

  const body = document.getElementById('customize-body');
  body.innerHTML = `
    ${item.imageUrl ? `<img class="customize-image" src="${item.imageUrl}" alt="" onerror="this.style.display='none'">` : ''}
    <h2 class="customize-title">${esc(item.name)}</h2>
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
              <input type="checkbox" class="addon-check" onchange="toggleAddon('${esc(a.name)}', ${a.price||0}, this.checked)">
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
        <span id="qty-display">1</span>
        <button onclick="changeQty(1)">+</button>
      </div>
    </div>

    <textarea class="instructions-area" placeholder="Special instructions (e.g., extra crispy, no salt...)" oninput="instructions=this.value"></textarea>

    <button class="add-btn" onclick="confirmAddToCart()">
      Add ${qty} to Cart — ${fmtMoney(calcCustomizeTotal())}
    </button>
  `;

  document.getElementById('customize-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeCustomize() {
  document.getElementById('customize-modal').classList.remove('active');
  document.body.style.overflow = '';
}

function pickSauce(s) { selectedSauce = s; openCustomize(customizingItem.id); } // re-render
function toggleAddon(name, price, checked) {
  if (checked) selectedAddons.push({name, price});
  else selectedAddons = selectedAddons.filter(a => a.name !== name);
  openCustomize(customizingItem.id);
}
function changeQty(delta) { qty = Math.max(1, qty+delta); document.getElementById('qty-display').textContent = qty; }
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
      <div class="cart-item-img-fallback" style="display:${c.imageUrl?'none':'flex'};width:56px;height:56px;border-radius:10px;background:var(--surface-2);align-items:center;justify-content:center;font-size:22px;flex-shrink:0;">🍗</div>
      <div class="cart-item-info">
        <div class="cart-item-name">${esc(c.name)}</div>
        <div class="cart-item-meta">${c.qty}x ${c.sauce?esc(c.sauce):''} ${c.selectedAddons.length?'+ '+c.selectedAddons.map(a=>esc(a.name)).join(', '):''}</div>
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
  const total = subtotal + tax + (orderMode === 'delivery' ? deliveryFee : 0) - (currentPromo ? Math.round(subtotal * currentPromo.discountPercent / 100) : 0);

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
}

// ─── Checkout ───
function setMode(mode) {
  orderMode = mode;
  document.getElementById('mode-delivery').classList.toggle('toggle-active', mode === 'delivery');
  document.getElementById('mode-pickup').classList.toggle('toggle-active', mode === 'pickup');
  document.getElementById('address-block').classList.toggle('hidden', mode !== 'delivery');
  renderCheckoutSummary();
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
  const total = subtotal + tax + delivery - disc;

  document.getElementById('sum-subtotal').textContent = fmtMoney(subtotal);
  document.getElementById('sum-delivery').textContent = fmtMoney(delivery);
  document.getElementById('sum-tax').textContent = fmtMoney(tax);
  document.getElementById('sum-discount').textContent = `-${fmtMoney(disc)}`;
  document.getElementById('sum-discount-row').classList.toggle('hidden', !currentPromo);
  document.getElementById('sum-total').textContent = fmtMoney(Math.max(0, total));
}

async function applyPromo() {
  const code = document.getElementById('promo-code').value.trim().toUpperCase();
  const msg = document.getElementById('promo-message');
  if (!code) { msg.textContent = 'Enter a code'; msg.style.color = 'var(--text-muted)'; return; }
  try {
    // Supabase: filter by code (case-insensitive via ilike) and active
    const docs = await sbGet(`${TABLE_PROMOS}?select=*&code=ilike.${encodeURIComponent(code)}&limit=1`);
    const doc = docs?.[0];
    if (!doc) { msg.textContent = 'Invalid code'; msg.style.color = 'var(--primary)'; return; }
    if (!doc.active) { msg.textContent = 'Code expired'; msg.style.color = 'var(--primary)'; return; }
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
  const phone = document.getElementById('c-phone').value.trim();
  const address = document.getElementById('c-address').value.trim();
  const btn = document.getElementById('place-order-btn');

  if (!name || !phone) { showToast('Please enter your name and phone'); return; }
  if (orderMode === 'delivery' && !address) { showToast('Please enter a delivery address'); return; }
  if (cart.length === 0) { showToast('Your cart is empty'); return; }

  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Placing...';

  const subtotal = cart.reduce((s, c) => s + (c.price + c.selectedAddons.reduce((a,b)=>a+b.price,0)) * c.qty, 0);
  const tax = Math.round(subtotal * TAX_RATE);
  const disc = currentPromo ? Math.round(subtotal * currentPromo.discountPercent / 100) : 0;
  const delivery = orderMode === 'delivery' ? deliveryFee : 0;
  const total = subtotal + tax + delivery - disc;
  const oid = generateOrderId();

  const payload = {
    order_id: oid,
    customer_name: name,
    customer_phone: phone,
    address: orderMode === 'delivery' ? address : 'Pickup',
    mode: orderMode,
    items: cart.map(c => ({
      name: c.name,
      qty: c.qty,
      price: c.price,
      sauce: c.sauce,
      selectedAddons: c.selectedAddons,
      specialInstructions: c.specialInstructions,
    })),
    subtotal,
    tax,
    delivery_fee: delivery,
    discount: disc,
    promo_code: currentPromo?.code || '',
    total,
    status: 'placed',
  };

  try {
    // Supabase: POST to orders table. body is the row directly.
    await sbPost(TABLE_ORDERS, payload, 'return=minimal');
    cart = [];
    currentPromo = null;
    currentOrderId = oid;
    document.getElementById('confirm-id').textContent = oid;
    navigateTo('confirmation');
    showToast('Order placed successfully!');
  } catch (e) {
    console.error(e);
    showToast('Order failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-lock"></i> Place Order';
  }
}

function generateOrderId() {
  const d = new Date();
  const date = d.toISOString().slice(0,10).replace(/-/g,'');
  const rand = Math.floor(Math.random()*900)+100;
  return `DEMO-${date}-${rand}`;
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
    // Supabase: filter by order_id, return single row
    const rows = await sbGet(`${TABLE_ORDERS}?select=*&order_id=eq.${encodeURIComponent(id)}&limit=1`);
    const doc = rows?.[0];
    if (!doc) { showToast('Order not found'); return; }
    result.classList.remove('hidden');
    const st = doc.status || 'placed';
    document.getElementById('status-badge').textContent = st.toUpperCase();
    document.getElementById('status-time').textContent = timeAgo(doc.created_at);
    renderTimeline(st);

    const driverEl = document.getElementById('driver-info');
    const distEl = document.getElementById('driver-dist');
    if (st === 'out_for_delivery' && doc.driver_lat && doc.driver_lng) {
      driverEl.classList.remove('hidden');
      distEl.textContent = 'Driver location updated';
    } else {
      driverEl.classList.add('hidden');
    }

    // start polling if active
    if (['placed','preparing','ready','out_for_delivery'].includes(st)) {
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
    const st = doc.status || 'placed';
    document.getElementById('status-badge').textContent = st.toUpperCase();
    renderTimeline(st);
    if (['delivered','cancelled'].includes(st)) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  } catch (e) { /* ignore polling errors */ }
}

const STATUS_STEPS = ['placed','preparing','ready','out_for_delivery','delivered'];
function renderTimeline(status) {
  const idx = STATUS_STEPS.indexOf(status);
  const labels = { placed:'Order Placed', preparing:'Preparing', ready:'Ready for Pickup', out_for_delivery:'Out for Delivery', delivered:'Delivered' };
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

// ─── Owner Auth ───
let ownerToken = null;
let ownerUser = null;
let ownerPollInterval = null;
let ownerSettingsCache = null;

function showOwnerLogin() {
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
  try {
    const r = await fetch(`${ENV.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'apikey': ENV.supabaseKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.message || data.error_description || `Auth error ${r.status}`);
    ownerToken = data.access_token;
    ownerUser = data.user;
    closeOwnerLogin();
    openOwnerShell();
  } catch (e) {
    err.textContent = 'Sign in failed: ' + e.message;
  }
}
function ownerLogout() {
  ownerToken = null;
  ownerUser = null;
  if (ownerPollInterval) { clearInterval(ownerPollInterval); ownerPollInterval = null; }
  document.getElementById('owner-shell').classList.add('hidden');
}
function openOwnerShell() {
  document.getElementById('owner-shell').classList.remove('hidden');
  document.getElementById('owner-build-tag').textContent = window.LC_BUILD || 'dev';
  switchOwnerView('orders');
}
function switchOwnerView(view) {
  document.querySelectorAll('.owner-view').forEach(v => v.classList.remove('active'));
  document.querySelector(`.owner-view#owner-view-${view}`)?.classList.add('active');
  document.querySelectorAll('.owner-nav button[data-owner]').forEach(b => b.classList.toggle('active', b.dataset.owner === view));
  if (view === 'orders') { loadOwnerOrders(); startOwnerPolling(); }
  else if (view === 'menu') { loadOwnerMenu(); stopOwnerPolling(); }
  else if (view === 'combos') { loadOwnerCombos(); stopOwnerPolling(); }
  else if (view === 'promos') { loadOwnerPromos(); stopOwnerPolling(); }
  else if (view === 'settings') { loadOwnerSettings(); stopOwnerPolling(); }
}
function startOwnerPolling() {
  if (ownerPollInterval) clearInterval(ownerPollInterval);
  ownerPollInterval = setInterval(loadOwnerOrders, 5000);
}
function stopOwnerPolling() {
  if (ownerPollInterval) { clearInterval(ownerPollInterval); ownerPollInterval = null; }
}

function _ownerHeaders(extra = {}) {
  return {
    'apikey': ENV.supabaseKey,
    'Authorization': `Bearer ${ownerToken || ENV.supabaseKey}`,
    ...extra,
  };
}
async function ownerGet(path) {
  const r = await fetch(`${ENV.supabaseUrl}/rest/v1/${path}`, { headers: _ownerHeaders() });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return JSON.parse(text);
}
async function ownerPost(path, body, prefer = 'return=representation') {
  const r = await fetch(`${ENV.supabaseUrl}/rest/v1/${path}`, {
    method: 'POST',
    headers: _ownerHeaders({ 'Content-Type': 'application/json', 'Prefer': prefer }),
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
async function ownerPatch(path, body) {
  const r = await fetch(`${ENV.supabaseUrl}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: _ownerHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=representation' }),
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}
async function ownerDelete(path) {
  const r = await fetch(`${ENV.supabaseUrl}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: _ownerHeaders(),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${r.status}: ${text}`);
  return true;
}

// ─── Owner Orders ───
const STATUS_FLOW = ['placed','preparing','ready','out_for_delivery','delivered'];
const STATUS_LABELS = { placed:'Placed', preparing:'Preparing', ready:'Ready', out_for_delivery:'Out', delivered:'Delivered', cancelled:'Cancelled' };
async function loadOwnerOrders() {
  try {
    const rows = await ownerGet(`${ENV.tableOrders}?select=*&status=in.(${['placed','preparing','ready','out_for_delivery'].join(',')})&order=created_at.desc&limit=200`);
    document.getElementById('owner-orders-count').textContent = rows.length ? `(${rows.length})` : '';
    const board = document.getElementById('owner-board');
    if (!rows.length) { board.innerHTML = '<div class="owner-board-empty">No active orders. Finished orders appear in Settings → History.</div>'; return; }
    board.innerHTML = rows.map(o => renderBoardOrder(o)).join('');
  } catch (e) { showToast('Orders load failed: ' + e.message); }
}
function renderBoardOrder(o) {
  const items = (o.items || []).map(i => `${i.qty}× ${esc(i.name)}`).join(', ');
  const idx = STATUS_FLOW.indexOf(o.status);
  const next = STATUS_FLOW[idx + 1];
  const prev = STATUS_FLOW[idx - 1];
  return `
    <div class="board-order" data-id="${esc(o.id)}">
      <div class="board-order-header">
        <span class="board-order-id">${esc(o.order_id)}</span>
        <span class="board-order-time">${timeAgo(o.created_at)}</span>
      </div>
      <div class="board-order-name">${esc(o.customer_name)} • ${esc(o.customer_phone)}</div>
      <div class="board-order-address">${esc(o.address)}</div>
      <div class="board-order-items">${esc(items)}</div>
      <div class="board-order-actions">
        ${prev ? `<button class="btn btn-secondary btn-sm" onclick="moveOrder('${esc(o.id)}','${prev}')">← ${STATUS_LABELS[prev]}</button>` : ''}
        ${next ? `<button class="btn btn-primary btn-sm" onclick="moveOrder('${esc(o.id)}','${next}')">${STATUS_LABELS[next]} →</button>` : ''}
        ${o.status !== 'cancelled' ? `<button class="btn btn-secondary btn-sm" style="color:#991b1b" onclick="moveOrder('${esc(o.id)}','cancelled')">Cancel</button>` : ''}
      </div>
    </div>
  `;
}
async function moveOrder(id, status) {
  try {
    await ownerPatch(`${ENV.tableOrders}?id=eq.${encodeURIComponent(id)}`, { status, updated_at: new Date().toISOString() });
    showToast(`Order moved to ${STATUS_LABELS[status]}`);
    loadOwnerOrders();
  } catch (e) { showToast('Update failed: ' + e.message); }
}

// ─── Owner Menu (read-only stub) ───
function loadOwnerMenu() {
  const table = document.getElementById('owner-menu-table');
  if (!menuItems.length) {
    table.innerHTML = '<div class="owner-menu-row" style="padding:40px;text-align:center;color:var(--text-muted)">Menu is empty. Use the Clover sync tool to populate menu items.</div>';
    return;
  }
  table.innerHTML = `
    <div class="owner-menu-row header"><div></div><div>Item</div><div>Price</div><div>Cat</div><div></div></div>
    ${menuItems.map(i => `
      <div class="owner-menu-row">
        <div class="emoji-cell">${i.emoji || '🍽️'}</div>
        <div class="name-cell">${esc(i.name)}<div class="muted">${esc(i.description || '')}</div></div>
        <div>${fmtMoney(i.price)}</div>
        <div>${esc(i.category || 'Other')}</div>
        <div class="actions"><button class="edit-btn" onclick="openMenuEditor('${esc(i.id)}')">Edit</button></div>
      </div>
    `).join('')}
  `;
}
function openMenuEditor(id) {
  const item = menuItems.find(i => i.id === id);
  showToast(item ? 'Menu editing is disabled while Clover sync is active.' : 'Menu editing is disabled while Clover sync is active.');
}

// ─── Owner Combos ───
let ownerCombos = [];
async function loadOwnerCombos() {
  try {
    ownerCombos = await ownerGet(`${ENV.tableCombos || 'combos'}?select=*&order=display_order.asc`);
  } catch (e) { ownerCombos = []; }
  const table = document.getElementById('owner-combos-table');
  table.innerHTML = `
    <div class="owner-menu-row header"><div></div><div>Combo</div><div>Price</div><div>Items</div><div></div></div>
    ${ownerCombos.map(c => `
      <div class="owner-menu-row">
        <div class="emoji-cell">${c.emoji || '🎁'}</div>
        <div class="name-cell">${esc(c.name || '')}<div class="muted">${esc(c.description || '')}</div></div>
        <div>${fmtMoney(c.combo_price || 0)}</div>
        <div>${(c.item_ids || []).length} items</div>
        <div class="actions"><button class="edit-btn" onclick="openComboEditor('${esc(c.id)}')">Edit</button><button class="delete-btn" onclick="deleteCombo('${esc(c.id)}')">Del</button></div>
      </div>
    `).join('') || '<div class="owner-menu-row" style="padding:40px;text-align:center;color:var(--text-muted)">No combos yet.</div>'}
  `;
}
function openComboEditor(id) { showToast('Combo editor coming in next pass.'); }
function deleteCombo(id) { showToast('Combo delete coming in next pass.'); }

// ─── Owner Promos ───
let ownerPromos = [];
async function loadOwnerPromos() {
  try { ownerPromos = await ownerGet(`${ENV.tablePromos}?select=*&order=created_at.desc`); }
  catch (e) { ownerPromos = currentPromo ? [] : []; }
  const table = document.getElementById('owner-promos-table');
  table.innerHTML = `
    <div class="owner-menu-row header"><div>Code</div><div>Description</div><div>% Off</div><div>Active</div><div></div></div>
    ${ownerPromos.map(p => `
      <div class="owner-menu-row" style="grid-template-columns: 1fr 2fr 80px 80px 100px;">
        <div class="name-cell">${esc(p.code)}</div>
        <div class="muted">${esc(p.description || '')}</div>
        <div>${p.discount_percent}%</div>
        <div><input type="checkbox" ${p.active ? 'checked' : ''} onchange="togglePromo('${esc(p.id)}', this.checked)"></div>
        <div class="actions"><button class="delete-btn" onclick="deletePromo('${esc(p.id)}')">Del</button></div>
      </div>
    `).join('') || '<div class="owner-menu-row" style="padding:40px;text-align:center;color:var(--text-muted)">No promos yet.</div>'}
  `;
}
async function togglePromo(id, active) {
  try { await ownerPatch(`${ENV.tablePromos}?id=eq.${encodeURIComponent(id)}`, { active }); showToast('Promo updated'); loadOwnerPromos(); }
  catch (e) { showToast('Promo update failed: ' + e.message); }
}
async function deletePromo(id) {
  if (!confirm('Delete this promo?')) return;
  try { await ownerDelete(`${ENV.tablePromos}?id=eq.${encodeURIComponent(id)}`); showToast('Promo deleted'); loadOwnerPromos(); }
  catch (e) { showToast('Promo delete failed: ' + e.message); }
}
function openPromoEditor() {
  const code = prompt('Promo code (e.g. SUMMER20):'); if (!code) return;
  const pct = parseInt(prompt('Discount percent (e.g. 20):'), 10);
  if (!pct || pct < 1) return;
  const desc = prompt('Description (optional):') || '';
  ownerPost(ENV.tablePromos, { code: code.toUpperCase(), description: desc, discount_percent: pct, active: true })
    .then(() => { showToast('Promo added'); loadOwnerPromos(); })
    .catch(e => showToast('Promo add failed: ' + e.message));
}

// ─── Owner Settings ───
async function loadOwnerSettings() {
  try {
    const rows = await ownerGet(`${ENV.tableSettings}?select=*&limit=1`);
    ownerSettingsCache = rows?.[0] || {};
  } catch (e) { ownerSettingsCache = {}; }
  const grid = document.getElementById('owner-settings-grid');
  const s = ownerSettingsCache;
  grid.innerHTML = `
    <div class="owner-setting-card">
      <h3>Business Info</h3>
      <div class="form-group"><label>Business Name</label><input class="input" id="s-name" value="${esc(s.business_name || ENV.businessName)}" /></div>
      <div class="form-group"><label>Address</label><input class="input" id="s-address" value="${esc(s.business_address || '')}" /></div>
      <div class="form-group"><label>Phone</label><input class="input" id="s-phone" value="${esc(s.business_phone || '')}" /></div>
    </div>
    <div class="owner-setting-card">
      <h3>Delivery & Tax</h3>
      <div class="form-group"><label>Delivery Fee (cents)</label><input class="input" id="s-delivery" type="number" value="${s.delivery_fee ?? ENV.defaultDeliveryFee}" /></div>
      <div class="form-group"><label>Tax Rate</label><input class="input" id="s-tax" value="${s.tax_rate ?? ENV.taxRate}" /></div>
    </div>
    <div class="owner-setting-card" style="grid-column:1/-1;">
      <h3>Business Hours</h3>
      <div id="owner-hours-rows"></div>
    </div>
    <div class="owner-setting-card" style="grid-column:1/-1;">
      <div class="owner-save-bar"><button class="btn btn-primary" onclick="saveOwnerSettings()">Save Settings</button></div>
    </div>
  `;
  renderOwnerHours(s.business_hours || {});
}
function renderOwnerHours(hours) {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const container = document.getElementById('owner-hours-rows');
  container.innerHTML = days.map(d => {
    const h = hours[d] || { open: true, start: '10:30', end: '21:00' };
    return `
      <div class="hours-row">
        <label>${d.slice(0,3)}</label>
        <input type="time" id="h-start-${d}" value="${h.start || '10:30'}" />
        <input type="time" id="h-end-${d}" value="${h.end || '21:00'}" />
        <label><input type="checkbox" id="h-open-${d}" ${h.open !== false ? 'checked' : ''}> Open</label>
      </div>
    `;
  }).join('');
}
async function saveOwnerSettings() {
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const business_hours = {};
  days.forEach(d => {
    business_hours[d] = {
      open: document.getElementById(`h-open-${d}`).checked,
      start: document.getElementById(`h-start-${d}`).value,
      end: document.getElementById(`h-end-${d}`).value,
    };
  });
  const payload = {
    business_name: document.getElementById('s-name').value,
    business_address: document.getElementById('s-address').value,
    business_phone: document.getElementById('s-phone').value,
    delivery_fee: parseInt(document.getElementById('s-delivery').value, 10) || 0,
    tax_rate: parseFloat(document.getElementById('s-tax').value) || 0,
    business_hours,
  };
  try {
    await ownerPatch(`${ENV.tableSettings}?id=eq.1`, payload);
    showToast('Settings saved');
    await loadSettings();
    updateHoursDisplay();
  } catch (e) { showToast('Settings save failed: ' + e.message); }
}

// ─── Utils ───
function fmtMoney(cents) {
  return '$' + (cents / 100).toFixed(2);
}
function esc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function timeAgo(iso) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 60000);
  if (diff < 1) return 'Just now';
  if (diff < 60) return `${diff} min ago`;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
