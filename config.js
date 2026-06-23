/**
 * Demo Restaurant — Web App Config
 * Supabase REST backend (migrated from Appwrite).
 */

const ENV = {
  // Supabase (migrated from Appwrite on 2026-06-11)
  supabaseUrl: 'https://wkohvggqwxowijbgdrbt.supabase.co',
  supabaseKey: 'sb_publishable_Y4faC-tH-48XvzwPJ6ZWNQ_QZMMg6QS', // publishable/browser-safe

  // Tables (snake_case to match Postgres columns)
  tableMenuItems: 'menu_items',
  tableOrders: 'orders',
  tablePromos: 'promos',
  tableSettings: 'settings',
  tableCombos: 'combos',
  tableCustomerRewards: 'customer_rewards',

  // Storage bucket (create in Supabase: public, name = "menu-images")
  bucketMenuImages: 'menu-images',

  // Business (demo values — swap for real client info)
  businessName: "Demo Restaurant",
  businessAddress: '123 Main Street, City, ST 00000',
  businessPhone: '(555) 123-4567',

  // Clover integration backend (Next.js app)
  cloverBackendUrl: 'https://clover-restaurant-backend.vercel.app',

  // Payments
  cashAppCashtag: '$DemoRestaurant',
  cashAppLink: 'https://cash.app/$DemoRestaurant',
  cloverPublicAccessKey: '6dc45923ddf0fc88504d40de2159a25f',
  cloverMerchantId: '077GSWKBQZAR1',

  // Delivery
  taxRate: 0.0825,
  defaultDeliveryFee: 399, // cents
};

window.LC_BUILD = 'v17-2026-06-23';
