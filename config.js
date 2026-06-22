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
  cloverBackendUrl: 'http://localhost:3001',

  // Payments
  cashAppCashtag: '$DemoRestaurant',
  cashAppLink: 'https://cash.app/$DemoRestaurant',

  // Delivery
  taxRate: 0.0825,
  defaultDeliveryFee: 399, // cents
};

window.LC_BUILD = 'v12-2026-06-22';
