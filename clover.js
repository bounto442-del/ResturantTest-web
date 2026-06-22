/**
 * Clover integration module for the Restaurant Test web app.
 * Handles OAuth connection, device scanning, menu sync, and order push.
 */

const CLOVER_BACKEND = (typeof ENV !== 'undefined' && ENV.cloverBackendUrl) || 'http://localhost:3000';
const CLOVER_MERCHANT_KEY = 'clover_merchant_id';
const CLOVER_DEFAULT_DEVICE_KEY = 'clover_default_device_id';

function getCloverMerchantId() {
  try { return localStorage.getItem(CLOVER_MERCHANT_KEY); } catch { return null; }
}

function setCloverMerchantId(id) {
  try {
    if (id) localStorage.setItem(CLOVER_MERCHANT_KEY, id);
    else localStorage.removeItem(CLOVER_MERCHANT_KEY);
  } catch {}
}

function getCloverDefaultDeviceId() {
  try { return localStorage.getItem(CLOVER_DEFAULT_DEVICE_KEY); } catch { return null; }
}

function setCloverDefaultDeviceId(id) {
  try {
    if (id) localStorage.setItem(CLOVER_DEFAULT_DEVICE_KEY, id);
    else localStorage.removeItem(CLOVER_DEFAULT_DEVICE_KEY);
  } catch {}
}

async function cloverRequest(path, options = {}) {
  const merchantId = getCloverMerchantId();
  const url = `${CLOVER_BACKEND}${path}`;
  const headers = {
    ...(options.headers || {}),
    ...(merchantId ? { 'x-merchant-id': merchantId } : {}),
  };
  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function connectClover() {
  window.location.href = `${CLOVER_BACKEND}/api/auth/clover`;
}

async function connectWithToken(cloverMerchantId, apiToken) {
  const res = await fetch(`${CLOVER_BACKEND}/api/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cloverMerchantId, apiToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Token connection failed');
  setCloverMerchantId(cloverMerchantId);
  return data;
}

async function disconnectClover() {
  const merchantId = getCloverMerchantId();
  if (!merchantId) throw new Error('No Clover merchant connected.');
  const res = await fetch(`${CLOVER_BACKEND}/api/auth/disconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Disconnect failed');
  setCloverMerchantId(null);
  setCloverDefaultDeviceId(null);
  return data;
}

async function scanCloverDevices() {
  return await cloverRequest('/api/devices/scan', { method: 'POST' });
}

async function listCloverDevices() {
  return await cloverRequest('/api/devices', { method: 'GET' });
}

async function pullMenuFromClover() {
  return await cloverRequest('/api/sync/pull', { method: 'POST' });
}

async function pushMenuToClover() {
  return await cloverRequest('/api/sync/push', { method: 'POST' });
}

async function pushOrderToClover(order) {
  const merchantId = getCloverMerchantId();
  if (!merchantId) throw new Error('Clover merchant not connected.');

  const lineItems = (order.items || []).map(item => ({
    name: item.name,
    price: item.price,
    quantity: item.qty || 1,
  }));

  const body = {
    cloverMerchantId: merchantId,
    lineItems,
    note: `Order ${order.order_id || ''} — ${order.mode || ''} — ${order.customer_name || ''} — ${order.notes || ''}`.slice(0, 250),
    orderType: null,
  };

  return await fetch(`${CLOVER_BACKEND}/api/orders/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(async res => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Order push failed: ${res.status}`);
    return data;
  });
}

function parseCloverCallback() {
  const params = new URLSearchParams(window.location.search);
  const merchantId = params.get('merchant_id');
  if (merchantId) {
    setCloverMerchantId(merchantId);
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
    return merchantId;
  }
  return null;
}

function isCloverConnected() {
  return !!getCloverMerchantId();
}

// Expose helpers globally for the inline onclick handlers in index.html.
window.Clover = {
  connect: connectClover,
  connectWithToken,
  disconnect: disconnectClover,
  scanDevices: scanCloverDevices,
  listDevices: listCloverDevices,
  pullMenu: pullMenuFromClover,
  pushMenu: pushMenuToClover,
  pushOrder: pushOrderToClover,
  getMerchantId: getCloverMerchantId,
  getDefaultDeviceId: getCloverDefaultDeviceId,
  setDefaultDeviceId: setCloverDefaultDeviceId,
  isConnected: isCloverConnected,
  parseCallback: parseCloverCallback,
};
