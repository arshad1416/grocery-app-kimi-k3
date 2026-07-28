/**
 * Pool Server — Test Data Seeder.
 *
 * Seeds ~20 items across 3 chains: Loblaws, No Frills, FreshCo.
 * Mix: 15 current-week prices, 5 expired prices.
 * Multiple reports per item (2-5) to test median aggregation.
 *
 * Can run standalone: node seed-pool.js
 */

const { PoolStore } = require('./pool/store');

// ─── Helper ──────────────────────────────────────────────────────────────────

/**
 * Generate a flyer week string relative to now.
 * E.g. 2026-W22 for the current ISO week.
 */
function getCurrentFlyerWeek() {
  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const diff = now - startOfYear;
  const weekNum = Math.ceil((diff / 86400000 + startOfYear.getDay() + 1) / 7);
  const padded = String(weekNum).padStart(2, '0');
  return `${now.getFullYear()}-W${padded}`;
}

/**
 * Get a flyer week N weeks in the past.
 */
function getPastFlyerWeek(weeksAgo) {
  const now = new Date();
  now.setDate(now.getDate() - weeksAgo * 7);
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const diff = now - startOfYear;
  const weekNum = Math.ceil((diff / 86400000 + startOfYear.getDay() + 1) / 7);
  const padded = String(weekNum).padStart(2, '0');
  return `${now.getFullYear()}-W${padded}`;
}

/**
 * Create a key for the pool store.
 */
function makeKey(storeId, itemName, flyerWeek) {
  return `${storeId}:${itemName.toLowerCase().trim()}:${flyerWeek}`;
}

// ─── Seed Data ───────────────────────────────────────────────────────────────

function seedTestData(store) {
  const currentWeek = getCurrentFlyerWeek();
  const pastWeek1 = getPastFlyerWeek(3);  // 3 weeks ago — still valid
  const pastWeek4 = getPastFlyerWeek(5);  // 5 weeks ago — expired
  const now = Date.now();
  const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  const PAST_TIME = now - ONE_DAY_MS; // expired (yesterday)

  const items = [];
  const stores = ['loblaws', 'no_frills', 'freshco'];

  // Helper: add reports for an item across multiple prices
  function addItem(storeId, itemName, flyerWeek, prices, validTo) {
    const key = makeKey(storeId, itemName, flyerWeek);
    for (const price of prices) {
      items.push({ key, price, validTo });
    }
  }

  // ─── Loblaws — Current week items (15 prices, 2-5 per item) ─────────

  // Milk 4L: 5 reports (median ~$5.99)
  addItem('loblaws', 'Milk 4L', currentWeek, [5.99, 6.49, 5.79, 5.99, 6.29], now + TWO_WEEKS_MS);
  // Bread White: 3 reports
  addItem('loblaws', 'Bread White', currentWeek, [3.49, 3.99, 3.29], now + TWO_WEEKS_MS);
  // Eggs Large 12: 4 reports (with outlier at 8.99)
  addItem('loblaws', 'Eggs Large 12', currentWeek, [4.99, 5.49, 8.99, 5.29], now + TWO_WEEKS_MS);
  // Butter: 2 reports
  addItem('loblaws', 'Butter', currentWeek, [4.99, 5.49], now + TWO_WEEKS_MS);
  // Cheese Block: 3 reports
  addItem('loblaws', 'Cheese Block', currentWeek, [7.99, 8.49, 7.49], now + TWO_WEEKS_MS);

  // ─── No Frills — Current week items ─────────────────────────────────

  // Apples: 4 reports
  addItem('no_frills', 'Apples', currentWeek, [1.99, 2.29, 1.89, 2.49], now + TWO_WEEKS_MS);
  // Bananas: 3 reports
  addItem('no_frills', 'Bananas', currentWeek, [0.99, 1.19, 0.89], now + TWO_WEEKS_MS);
  // Chicken Breast: 5 reports
  addItem('no_frills', 'Chicken Breast', currentWeek, [11.99, 12.99, 10.99, 12.49, 11.49], now + TWO_WEEKS_MS);
  // Rice 5kg: 3 reports
  addItem('no_frills', 'Rice 5kg', currentWeek, [9.99, 10.99, 8.99], now + TWO_WEEKS_MS);
  // Pasta: 2 reports
  addItem('no_frills', 'Pasta', currentWeek, [1.49, 1.79], now + TWO_WEEKS_MS);

  // ─── FreshCo — Current week items ───────────────────────────────────

  // Tomatoes: 4 reports
  addItem('freshco', 'Tomatoes', currentWeek, [2.99, 3.49, 2.79, 3.29], now + TWO_WEEKS_MS);
  // Yogurt 4-pack: 3 reports
  addItem('freshco', 'Yogurt 4-pack', currentWeek, [4.49, 4.99, 4.29], now + TWO_WEEKS_MS);
  // Orange Juice: 3 reports
  addItem('freshco', 'Orange Juice', currentWeek, [3.99, 4.49, 3.79], now + TWO_WEEKS_MS);
  // Ground Beef: 4 reports
  addItem('freshco', 'Ground Beef', currentWeek, [8.99, 9.49, 7.99, 9.29], now + TWO_WEEKS_MS);
  // Potatoes 5lb: 2 reports
  addItem('freshco', 'Potatoes 5lb', currentWeek, [4.99, 5.49], now + TWO_WEEKS_MS);

  // ─── Expired items (validTo in the past) ────────────────────────────

  // Loblaws — expired
  addItem('loblaws', 'Coffee Ground', pastWeek4, [8.99, 9.49, 8.49], PAST_TIME);
  // No Frills — expired
  addItem('no_frills', 'Cereal', pastWeek4, [4.99, 5.49], PAST_TIME);
  // FreshCo — expired (3 reports)
  addItem('freshco', 'Frozen Pizza', pastWeek4, [5.99, 6.49, 5.49], PAST_TIME);
  // Loblaws — expired single
  addItem('loblaws', 'Ice Cream', pastWeek1, [6.99], PAST_TIME);
  // FreshCo — expired
  addItem('freshco', 'Paper Towels', pastWeek4, [7.99, 8.99], PAST_TIME);

  // Seed the store
  store.seed(items);

  console.log(`Seeded ${items.length} price reports across ${stores.length} chains`);
  console.log(`Current flyer week: ${currentWeek}`);
  console.log(`Total store entries: ${store.getAll().length}`);
}

// ─── Standalone Execution ────────────────────────────────────────────────────

if (require.main === module) {
  const store = new PoolStore();
  seedTestData(store);

  // Print aggregates for each store
  const storeIds = ['loblaws', 'no_frills', 'freshco'];
  for (const storeId of storeIds) {
    const aggs = store.getAggregates(storeId);
    console.log(`\n--- ${storeId} (${aggs.length} items) ---`);
    for (const a of aggs) {
      console.log(`  ${a.itemName}: median=$${a.median?.toFixed(2)}, count=${a.count}, validTo=${new Date(a.validTo).toISOString()}`);
    }
  }
}

module.exports = { seedTestData };
