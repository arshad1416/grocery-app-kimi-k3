/**
 * Emoji Map — Maps grocery item names to emoji for visual thumbnails.
 *
 * Uses substring matching so "Granny Smith Apples" → 🍎,
 * "Chicken Breast" → 🍗, etc.
 * Returns empty string for unrecognized items (graceful degradation).
 */

const EMOJI_MAP: [string[], string][] = [
  // ─── Produce ────────────────────────────────────────────────────────────
  [['apple'], '🍎'],
  [['banana'], '🍌'],
  [['orange', 'mandarin', 'clementine'], '🍊'],
  [['grape'], '🍇'],
  [['strawberr'], '🍓'],
  [['blueberr'], '🫐'],
  [['watermelon'], '🍉'],
  [['lemon'], '🍋'],
  [['lime'], '🍈'],
  [['pear'], '🍐'],
  [['peach'], '🍑'],
  [['cherr'], '🍒'],
  [['mango'], '🥭'],
  [['pineapple'], '🍍'],
  [['coconut'], '🥥'],
  [['kiwi'], '🥝'],
  [['tomato'], '🍅'],
  [['avocado'], '🥑'],
  [['potato'], '🥔'],
  [['carrot'], '🥕'],
  [['corn'], '🌽'],
  [['pepper', 'hot pepper', 'chili'], '🌶️'],
  [['cucumber'], '🥒'],
  [['broccoli'], '🥦'],
  [['garlic'], '🧄'],
  [['onion'], '🧅'],
  [['mushroom'], '🍄'],
  [['peanut'], '🥜'],
  [['chestnut'], '🌰'],
  [['lettuce', 'salad', 'arugula', 'spinach', 'kale', 'greens'], '🥬'],
  [['herb', 'basil', 'parsley', 'cilantro', 'dill', 'rosemary', 'thyme'], '🌿'],

  // ─── Dairy & Eggs ───────────────────────────────────────────────────────
  [['milk'], '🥛'],
  [['cheese'], '🧀'],
  [['butter'], '🧈'],
  [['egg'], '🥚'],
  [['yogurt', 'yoghurt'], '🥄'],
  [['ice cream'], '🍦'],

  // ─── Meat & Protein ─────────────────────────────────────────────────────
  [['chicken', 'poultry', 'wing'], '🍗'],
  [['steak', 'beef', 'ground beef'], '🥩'],
  [['bacon', 'ham', 'prosciutto'], '🥓'],
  [['sausage', 'hot dog', 'wiener'], '🌭'],
  [['burger', 'hamburger'], '🍔'],

  // ─── Seafood ────────────────────────────────────────────────────────────
  [['fish', 'salmon', 'trout', 'tilapia', 'cod', 'mahi'], '🐟'],
  [['shrimp', 'prawn', 'crab', 'lobster', 'shellfish'], '🦐'],

  // ─── Bakery & Grains ────────────────────────────────────────────────────
  [['bread', 'loaf', 'baguette', 'toast'], '🍞'],
  [['bagel'], '🥯'],
  [['pretzel'], '🥨'],
  [['croissant'], '🥐'],
  [['rice'], '🍚'],
  [['noodle', 'pasta', 'spaghetti', 'penne', 'fusilli'], '🍝'],

  // ─── Prepared / Snacks ──────────────────────────────────────────────────
  [['pizza'], '🍕'],
  [['taco'], '🌮'],
  [['burrito', 'wrap'], '🌯'],
  [['sandwich', 'sub'], '🥪'],
  [['soup', 'broth'], '🍲'],
  [['popcorn'], '🍿'],
  [['cookie'], '🍪'],
  [['cake'], '🎂'],
  [['donut', 'doughnut'], '🍩'],
  [['pie'], '🥧'],
  [['chocolate', 'candy', 'sweet'], '🍫'],
  [['honey'], '🍯'],

  // ─── Beverages ──────────────────────────────────────────────────────────
  [['water', 'sparkling'], '💧'],
  [['juice', 'orange juice', 'apple juice'], '🧃'],
  [['coffee', 'espresso', 'latte'], '☕'],
  [['tea'], '🍵'],
  [['wine'], '🍷'],
  [['beer'], '🍺'],
  [['soda', 'pop', 'cola', 'coke', 'pepsi'], '🥤'],
  [['smoothie'], '🥤'],

  // ─── Pantry & Condiments ────────────────────────────────────────────────
  [['oil', 'olive oil', 'cooking oil'], '🫒'],
  [['salt'], '🧂'],
  [['sauce', 'ketchup', 'mustard', 'mayo', 'dressing'], '🫙'],
  [['canned', 'can of', 'beans'], '🥫'],

  // ─── Household / Non-food ───────────────────────────────────────────────
  [['soap', 'detergent', 'cleaner', 'dish soap'], '🧴'],
  [['tissue', 'paper towel', 'napkin'], '🧻'],
  [['trash bag', 'garbage bag'], '🗑️'],
  [['baby', 'diaper', 'wipe'], '👶'],
  [['pet', 'dog food', 'cat food', 'kibble'], '🐾'],
  [['toothpaste', 'toothbrush', 'dental'], '🪥'],
  [['vitamin', 'supplement', 'medicine', 'pill'], '💊'],
];

/**
 * Returns the best emoji for a grocery item name, or empty string if no match.
 * Uses lowercase substring matching — "Bananas" matches "banana".
 *
 * @example
 * emojiForItem('Bananas')     // → '🍌'
 * emojiForItem('Ground Beef') // → '🥩'
 * emojiForItem('xyz123')      // → ''
 */
export function emojiForItem(itemName: string): string {
  if (!itemName) return '';
  const lower = itemName.toLowerCase();

  for (const [keywords, emoji] of EMOJI_MAP) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return emoji;
      }
    }
  }

  return '';
}
