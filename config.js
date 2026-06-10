/**
 * Gigi's WingShack — Web App Config
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

  // Business
  businessName: "Gigi's WingShack",
  businessAddress: '587 S Sam Houston Blvd, San Benito, TX 78586',
  businessPhone: '(956) 399-1399',

  // Payments
  cashAppCashtag: '$GigisWingShack',
  cashAppLink: 'https://cash.app/$GigisWingShack',

  // Delivery
  taxRate: 0.0825,
  defaultDeliveryFee: 399, // cents
};
