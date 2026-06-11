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
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">Menu is empty. Add items in the owner app.</div>';
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
