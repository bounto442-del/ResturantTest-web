/**
 * Demo Restaurant — Web App Config
 * Environment variables for Appwrite and business settings.
 */

const ENV = {
  // Appwrite
  appwriteEndpoint: 'https://nyc.cloud.appwrite.io/v1',
  appwriteProjectId: '6a279558003800b0b4d6',
  appwriteApiKey: '', // leave empty for public-permission collections
  appwriteProjectName: 'Wing_Shack_Test',
  appwriteDatabaseId: 'gigis-wingshack',

  // Collections
  collectionOrders: 'orders',
  collectionMenuItems: 'menuItems',
  collectionPromos: 'promos',
  collectionSeasonMenus: 'seasonMenus',
  collectionSettings: 'settings',

  // Storage
  bucketMenuImages: 'menuImages',

  // Business (demo values — swap for real client info)
  businessName: "Demo Restaurant",
  businessAddress: '123 Main Street, City, ST 00000',
  businessPhone: '(555) 123-4567',

  // Payments
  cashAppCashtag: '$DemoRestaurant',
  cashAppLink: 'https://cash.app/$DemoRestaurant',

  // Delivery
  taxRate: 0.0825,
  defaultDeliveryFee: 399, // cents
};
