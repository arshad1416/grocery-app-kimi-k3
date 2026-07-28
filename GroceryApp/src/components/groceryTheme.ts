/**
 * Shared theme constants for GroceryListScreen and all other screens/components.
 * Centralized for a beautiful, organic "Fresh Grocery" visual identity.
 */

export const themeColors = {
  light: {
    // Core brand & background colors
    bg: '#F4F6F3',               // Soft organic sage-white backdrop
    cardBg: '#FFFFFF',           // Crisp pure white for cards
    text: '#1C2E24',             // Deep pine/avocado dark text
    secondaryText: '#6B7F73',    // Muted leaf-gray text
    border: '#E1EADF',           // Soft warm natural border
    primary: '#16A34A',          // Fresh Leaf Green
    headerBg: '#FFFFFF',         // White for clean header
    inputBg: '#E8EFE5',          // Sage-tinted light input fill
    divider: '#E1EADF',
    accent: '#F59E0B',           // Sunny Amber accent
    danger: '#EF4444',
    warning: '#F59E0B',
    info: '#3B82F6',

    // Component-specific colors
    btnBg: '#E8EFE5',            // Sage button background
    btnText: '#1C2E24',          // Pine text for buttons
    segmentedBg: '#E8EFE5',
    segmentActiveBg: '#16A34A',
    
    tabActiveBg: '#16A34A',
    tabInactiveBg: '#E8EFE5',
    tabActiveText: '#FFFFFF',
    tabInactiveText: '#6B7F73',
    modalOverlay: 'rgba(28, 46, 36, 0.4)',
    voiceBtnBg: '#3B82F6',

    // Stop Optimizer & Pricing
    savingsBg: '#D1FAE5',
    savingsText: '#065F46',
    bestValueBorder: '#16A34A',
    bestValueBg: '#D1FAE5',
    bestValueText: '#065F46',

    // Trip Plan Sheet
    overlay: 'rgba(28, 46, 36, 0.4)',
    stopBg: '#E8EFE5',
    subtotalBg: '#DCE6DA',
    unassignedBg: '#FEF3C7',
    unassignedBorder: '#F59E0B',
    unassignedText: '#92400E',

    // Stepper
    activeBg: '#16A34A',
    activeText: '#FFFFFF',
    inactiveBg: '#E8EFE5',
    disabledText: '#A3B3A9',

    // Permission Modal
    card: '#FFFFFF',
    primaryText: '#FFFFFF',
    noteBg: '#F0FDF4',
    noteBorder: '#BBF7D0',

    // Pill selectors (from old theme, mapped to new design)
    pillUnselectedBg: '#FFFFFF',
    pillUnselectedBorder: '#D2DEC9',
    pillSelectedBg: '#16A34A',
    pillCheapestBg: '#D1FAE5',
    pillCheapestBorder: '#16A34A',
  },
  dark: {
    // Core brand & background colors
    bg: '#080D09',               // Midnight Forest / Deep Pine Black
    cardBg: '#111C15',           // Deep Sage Dark Card
    text: '#F0FDF4',             // Pale mint text
    secondaryText: '#8BA093',    // Sage-gray secondary text
    border: '#1E2D23',           // Dark natural pine border
    primary: '#22C55E',          // Vibrant Minty Green
    headerBg: '#111C15',         // Integrated dark sage header
    inputBg: '#18271E',          // Sage dark input field
    divider: '#1E2D23',
    accent: '#FACC15',           // Warm Golden Yellow accent
    danger: '#EF4444',
    warning: '#FACC15',          // Warm Golden Yellow for warning in dark mode
    info: '#3B82F6',

    // Component-specific colors
    btnBg: '#1E2D23',            // Dark sage button background
    btnText: '#F0FDF4',          // Mint text for buttons
    segmentedBg: '#18271E',
    segmentActiveBg: '#22C55E',

    tabActiveBg: '#22C55E',
    tabInactiveBg: '#18271E',
    tabActiveText: '#FFFFFF',
    tabInactiveText: '#8BA093',
    modalOverlay: 'rgba(0, 0, 0, 0.75)',
    voiceBtnBg: '#3B82F6',

    // Stop Optimizer & Pricing
    savingsBg: '#0B2518',
    savingsText: '#34D399',
    bestValueBorder: '#22C55E',
    bestValueBg: '#0B2518',
    bestValueText: '#34D399',

    // Trip Plan Sheet
    overlay: 'rgba(0, 0, 0, 0.75)',
    stopBg: '#18271E',
    subtotalBg: '#243A2C',
    unassignedBg: '#422006',
    unassignedBorder: '#F59E0B',
    unassignedText: '#FCD34D',

    // Stepper
    activeBg: '#22C55E',
    activeText: '#FFFFFF',
    inactiveBg: '#18271E',
    disabledText: '#3B4E43',

    // Permission Modal
    card: '#111C15',
    primaryText: '#FFFFFF',
    noteBg: '#064E3B',
    noteBorder: '#065F46',

    // Pill selectors (from old theme, mapped to new design)
    pillUnselectedBg: '#111C15',
    pillUnselectedBorder: '#1E2D23',
    pillSelectedBg: '#22C55E',
    pillCheapestBg: '#0B2518',
    pillCheapestBorder: '#22C55E',
  },
};

export type ThemeColors = typeof themeColors.light;

export const CATEGORY_COLORS: Record<string, string> = {
  produce: '#16A34A',    // Leaf green for produce
  dairy: '#2563EB',      // Blue for milk/dairy
  meat: '#DC2626',       // Red for meat
  bakery: '#D97706',     // Amber for bakery
  frozen: '#06B6D4',     // Cyan for frozen
  pantry: '#7C3AED',     // Purple for pantry
  beverages: '#B45309',  // Brown for drinks
  other: '#4B5563',      // Gray for other
};

export function getCategoryColor(category: string): string {
  if (category.toLowerCase().startsWith('stop ')) {
    return '#16A34A';
  }
  return CATEGORY_COLORS[category.toLowerCase()] ?? '#4B5563';
}
