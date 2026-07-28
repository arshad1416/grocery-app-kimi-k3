# PantryRun — Antigravity Redesign Architecture

> **Date:** 2026-06-16  
> **Current tag:** v1.17 (reverted to v1.15 working codebase)  
> **Goal:** Implement the 3 Antigravity mockup designs exactly  
> **Mockup files:**
> - `grocery_list_dark_mockup_1781582776216.png` — Dark mode
> - `grocery_list_light_mockup_1781582759815.png` — Light mode
> - `splash_screen_mockup_1781582746993.png` — Splash screen

---

## 1. Design Language Overview

The Antigravity designs use a **neon-green glassmorphism** aesthetic in dark mode and a **warm cream/sage** aesthetic in light mode — completely different from the current "Midnight Forest" / "Fresh Leaf" theme.

### Key Visual Differences from Current v1.15

| Aspect | Current v1.15 | Antigravity Mockups |
|--------|--------------|-------------------|
| Dark bg | `#080D09` (deep pine black) | `#0B0F12` (deep charcoal, almost black) |
| Dark accent | `#22C55E` (minty green) | `#00E676` (neon green glow) |
| Light bg | `#F4F6F3` (sage-white) | `#FDF8F0` (warm cream/off-white) |
| Light accent | `#16A34A` (leaf green) | `#7CB342` (sage/olive green) |
| Icons | Feather | Ionicons / MaterialCommunityIcons |
| Nav | Stack-only (no tabs) | Bottom tab bar with 5 tabs |
| Cards | Flat white cards | Glassmorphism / frosted glass cards |

---

## 2. Complete Color Palette

### 2.1 Dark Mode (from `grocery_list_dark_mockup`)

```
// Backgrounds
bg:              '#0B0F12'   — Deep charcoal/black main background
cardBg:          'rgba(255, 255, 255, 0.06)'  — Frosted glass cards
cardBorder:      'rgba(0, 230, 118, 0.15)'    — Neon green subtle border
headerBg:        '#0B0F12'   — Same as bg, seamless
inputBg:         'rgba(255, 255, 255, 0.08)'  — Glass input fields
searchBg:        'rgba(255, 255, 255, 0.06)'  — Search bar glass

// Text
text:            '#FFFFFF'   — Pure white primary text
secondaryText:   '#8A9BA8'   — Cool gray secondary
tertiaryText:    '#5A6B78'   — Muted tertiary

// Accents
primary:         '#00E676'   — Neon green (main accent)
primaryGlow:     'rgba(0, 230, 118, 0.3)'  — Glow effect for active elements
primaryDim:      'rgba(0, 230, 118, 0.12)' — Subtle neon tint
accent:          '#FFD740'   — Amber/gold for warnings/badges
danger:          '#FF5252'   — Red for delete
info:            '#448AFF'   — Blue for info

// Store cards
storeCardBg:     'rgba(255, 255, 255, 0.04)'
storeCardBorder: 'rgba(0, 230, 118, 0.1)'

// Bottom nav
navBg:           'rgba(11, 15, 18, 0.95)'  — Near-opaque dark
navActive:       '#00E676'   — Neon green active icon
navInactive:     '#5A6B78'   — Gray inactive
navBorder:       'rgba(255, 255, 255, 0.08)' — Top separator

// Checkbox
checkBg:         '#00E676'   — Neon green when checked
checkBorder:     '#5A6B78'   — Gray when unchecked
checkIcon:       '#0B0F12'   — Dark checkmark on green

// Quantity buttons
qtyBtnBg:        'rgba(255, 255, 255, 0.08)'
qtyBtnText:      '#FFFFFF'
qtyBtnBorder:    'rgba(255, 255, 255, 0.12)'

// Category pills
pillBg:          'rgba(0, 230, 118, 0.1)'
pillText:        '#00E676'
pillActiveBg:    '#00E676'
pillActiveText:  '#0B0F12'

// Glassmorphism effect
blur:            20        — blurRadius
glassOpacity:    0.06      — rgba white overlay
glowShadow:      { shadowColor: '#00E676', shadowOpacity: 0.3, shadowRadius: 12 }
```

### 2.2 Light Mode (from `grocery_list_light_mockup`)

```
// Backgrounds
bg:              '#FDF8F0'   — Warm cream/off-white
cardBg:          '#FFFFFF'   — Pure white cards
cardBorder:      'rgba(0, 0, 0, 0.06)'  — Very subtle border
headerBg:        '#FFFFFF'   — White header
inputBg:         '#F5F0E8'   — Warm tinted input
searchBg:        '#F5F0E8'   — Search bar

// Text
text:            '#1A1A1A'   — Near-black primary text
secondaryText:   '#6B7B6F'   — Sage-gray secondary
tertiaryText:    '#9CA89E'   — Muted tertiary

// Accents
primary:         '#7CB342'   — Sage/olive green
primaryLight:    'rgba(124, 179, 66, 0.12)' — Light green tint
accent:          '#FF8F00'   — Amber/orange for badges
danger:          '#E53935'   — Red for delete
info:            '#1E88E5'   — Blue for info

// Store cards
storeCardBg:     '#FFFFFF'
storeCardBorder: 'rgba(0, 0, 0, 0.08)'
storeCardShadow: { shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8 }

// Bottom nav
navBg:           '#FFFFFF'
navActive:       '#7CB342'   — Sage green active
navInactive:     '#9CA89E'   — Gray inactive
navBorder:       'rgba(0, 0, 0, 0.06)'

// Checkbox
checkBg:         '#7CB342'
checkBorder:     '#D2DEC9'
checkIcon:       '#FFFFFF'

// Quantity buttons
qtyBtnBg:        '#F5F0E8'
qtyBtnText:      '#1A1A1A'
qtyBtnBorder:    'rgba(0, 0, 0, 0.08)'

// Category pills
pillBg:          '#F5F0E8'
pillText:        '#6B7B6F'
pillActiveBg:    '#7CB342'
pillActiveText:  '#FFFFFF'
```

### 2.3 Splash Screen (from `splash_screen_mockup`)

```
bg:              '#FFFFFF'   — Clean white
logoBagPrimary:  '#FF8F00'   — Orange grocery bag
logoBagSecondary:'#7CB342'   — Green accents (leaf)
logoTomato:      '#E53935'   — Red tomato
logoCarrot:      '#FF8F00'   — Orange carrot
logoLeaf:        '#7CB342'   — Green leaf
titleText:       '#1A1A1A'   — Bold black "PantryRun"
subtitleText:    '#6B7B6F'   — Gray "Your Intelligent Grocery Path"
```

---

## 3. Typography

### Font Stack
```typescript
// Primary font — Outfit (already in use for title)
fontFamily: {
  title:     'Outfit-Bold'     // "PantryRun" header
  subtitle:  'Outfit-Regular'  // "Your Intelligent Grocery Path"
  body:      'Inter-Regular'   // Item names, body text
  bodyBold:  'Inter-SemiBold'  // Emphasized body
  caption:   'Inter-Regular'   // Secondary text, labels
  button:    'Inter-SemiBold'  // Button labels
  price:     'Inter-Bold'      // Price display
}
```

### Size Scale
```
splashTitle:     48  // "PantryRun" on splash
splashSubtitle:  16  // Tagline
screenTitle:     28  // "My Grocery List" headers
sectionHeader:   18  // Category headers like "Produce"
itemName:        16  // Grocery item names
itemNotes:       13  // Subtitle/notes
button:          15  // Button text
caption:         12  // Timestamps, store names
price:           16  // Price values
tabLabel:        11  // Bottom nav labels
```

### Weights
```
splashTitle:     800 (ExtraBold)
screenTitle:     700 (Bold)
sectionHeader:   600 (SemiBold)
itemName:        500 (Medium)
body:            400 (Regular)
caption:         400 (Regular)
```

---

## 4. Component Architecture

### 4.1 New Components to Create

#### `src/components/BottomTabBar.tsx`
Custom bottom navigation bar — NOT using React Navigation's built-in tabs.
```
Props:
  - activeTab: 'list' | 'explore' | 'cart' | 'profile' (dark) / 'home' | 'lists' | 'scan' | 'deals' | 'account' (light)
  - onTabPress: (tab: string) => void
  - isDark: boolean

Dark mode tabs: List, Explore, Cart, Profile
  - Icons: Ionicons list, Ionicons compass, Ionicons cart, Ionicons person

Light mode tabs: Home, Lists, Scan, Deals, Account
  - Icons: Ionicons home, Ionicons list, Ionicons scan, Ionicons pricetag, Ionicons person

Layout:
  - Height: 56 + safe area bottom
  - Background: glassmorphism (dark) or white (light)
  - Top border: subtle separator
  - Active icon: primary color with glow (dark) or solid primary (light)
  - Inactive icon: gray
  - Label: 11px below icon
```

#### `src/components/StoreCard.tsx`
Renders a store section (ALDI, Kroger, Trader Joe's, etc.)
```
Props:
  - storeName: string
  - storeLogo?: ImageSource
  - items: GroceryItem[]
  - isExpanded: boolean
  - onToggle: () => void
  - isDark: boolean

Layout:
  - Rounded card (borderRadius: 16)
  - Glass background (dark) or white shadow (light)
  - Store name + item count badge
  - Chevron toggle
  - Collapsible item list
```

#### `src/components/QuantityStepper.tsx`
The +/- quantity buttons from mockups.
```
Props:
  - quantity: number
  - unit: string
  - onIncrement: () => void
  - onDecrement: () => void
  - isDark: boolean

Layout:
  - Horizontal: [ − ] [ qty ] [ + ]
  - Circular buttons (32×32)
  - Glass bg buttons (dark) or warm tinted (light)
  - Quantity in center, bold
```

#### `src/components/CategoryPill.tsx`
Horizontal scrolling category filter pills.
```
Props:
  - label: string
  - isActive: boolean
  - onPress: () => void
  - isDark: boolean

Layout:
  - Rounded pill (borderRadius: 20)
  - Active: primary filled
  - Inactive: glass bg (dark) / tinted bg (light)
```

#### `src/components/SearchBar.tsx`
Prominent search bar at top of list screen.
```
Props:
  - value: string
  - onChangeText: (text: string) => void
  - placeholder?: string
  - isDark: boolean

Layout:
  - Glass/input bg
  - Search icon left
  - Clear button right (when has text)
  - borderRadius: 12
```

#### `src/components/GlassCard.tsx`
Reusable glassmorphism card wrapper.
```
Props:
  - children: ReactNode
  - style?: ViewStyle
  - isDark: boolean
  - glowColor?: string  // For neon glow in dark mode

Renders:
  - Dark: BlurView with rgba white overlay, neon green border glow
  - Light: White card with subtle shadow
```

#### `src/screens/SplashScreen.tsx`
New splash screen with grocery bag logo.
```
Layout:
  - Full white background
  - Centered grocery bag SVG/image
    - Orange bag body
    - Green leaf accent
    - Tomato (red) + Carrot (orange) peeking out
  - "PantryRun" — bold, black, large
  - "Your Intelligent Grocery Path" — gray, regular weight
  - Auto-dismiss after 2s
```

### 4.2 Existing Components to Modify

#### `src/components/groceryTheme.ts` — **COMPLETE REWRITE**
Replace all colors with Antigravity palette. Add glassmorphism tokens.

#### `src/components/ItemRow.tsx` — **MAJOR CHANGES**
- Replace `Feather` icons with `Ionicons`
- Add `QuantityStepper` integration (replace static badge)
- Add item emoji/icon column (from mockup: small colored icon per item)
- Checkbox: neon green glow in dark mode
- Strikethrough: keep but adjust color
- Remove reorder buttons (not in mockups)

#### `src/screens/HomeScreen.tsx` — **MAJOR CHANGES**
- Add `BottomTabBar` component
- Remove FAB (mockup shows bottom nav, not FAB)
- Add search bar at top
- Convert list cards to `StoreCard` style
- Tab navigation: Home, Lists, Scan, Deals, Account (light) / List, Explore, Cart, Profile (dark)

#### `src/screens/GroceryListScreen.tsx` — **MAJOR CHANGES**
- Add `SearchBar` component
- Add `CategoryPill` horizontal scroll
- Replace `SectionList` items with new `ItemRow` design
- Add `BottomTabBar`
- Store-based grouping (ALDI, Kroger, etc.) instead of category grouping

#### `App.tsx` — **MODERATE CHANGES**
- Add `SplashScreen` as initial route
- Change navigation structure to accommodate tab bar
- Add tab navigator or custom tab state management

---

## 5. File Change Summary

### Files to Create (8)
```
src/components/BottomTabBar.tsx
src/components/StoreCard.tsx
src/components/QuantityStepper.tsx
src/components/CategoryPill.tsx
src/components/SearchBar.tsx
src/components/GlassCard.tsx
src/screens/SplashScreen.tsx
docs/ARCHITECTURE-ANTIGRAVITY-REDESIGN.md  ← this file
```

### Files to Modify (6)
```
src/components/groceryTheme.ts              ← complete color overhaul
src/components/ItemRow.tsx                   ← new layout + icons
src/screens/HomeScreen.tsx                  ← tabs + search + store cards
src/screens/GroceryListScreen.tsx           ← new layout + components
App.tsx                                     ← splash + tab navigation
android/app/src/main/res/values/colors.xml  ← update native colors
```

### Files Unchanged
```
src/screens/SettingsScreen.tsx     — (will need tab bar access later)
src/screens/PairingScreen.tsx      — unchanged
src/screens/ItemEditScreen.tsx     — unchanged
src/state/*.ts                     — all state stores unchanged
src/pricing/*.ts                   — all pricing logic unchanged
src/storage/*.ts                   — all storage unchanged
src/sync/*.ts                      — all sync logic unchanged
```

---

## 6. Implementation Order

### Phase 1: Theme Foundation (do first)
1. **`src/components/groceryTheme.ts`** — Replace all colors with Antigravity palette
2. **`src/components/GlassCard.tsx`** — Create reusable glass card component

### Phase 2: Splash Screen
3. **`src/screens/SplashScreen.tsx`** — New splash with grocery bag logo
4. **`App.tsx`** — Add splash as initial screen, auto-navigate after 2s

### Phase 3: Navigation Shell
5. **`src/components/BottomTabBar.tsx`** — Bottom tab bar component
6. **`App.tsx`** (continued) — Integrate tab bar into navigation

### Phase 4: List Screen Redesign
7. **`src/components/SearchBar.tsx`** — Search input component
8. **`src/components/CategoryPill.tsx`** — Category filter pills
9. **`src/components/QuantityStepper.tsx`** — +/- quantity buttons
10. **`src/components/ItemRow.tsx`** — Redesign item row layout
11. **`src/components/StoreCard.tsx`** — Store section cards
12. **`src/screens/GroceryListScreen.tsx`** — Wire up all new components

### Phase 5: Home Screen
13. **`src/screens/HomeScreen.tsx`** — Redesign with tabs and new card style

### Phase 6: Polish
14. Update `android/app/src/main/res/values/colors.xml` for splash/status bar
15. Test light/dark mode switching
16. Verify all glassmorphism effects render correctly

---

## 7. Technical Notes

### Glassmorphism in React Native
- Use `@react-native-community/blur` (BlurView) for real glass effect
- Fallback: `rgba` overlays with opacity when BlurView unavailable
- Card styling: `backdropFilter: 'blur(20px)'` on web, BlurView on native

### Bottom Tab Bar Strategy
- **Custom component**, NOT `@react-navigation/bottom-tabs`
- Reason: mockup has different tabs per theme (dark: 4 tabs, light: 5 tabs)
- Use a simple state variable + conditional rendering
- SafeAreaProvider handles bottom inset

### Icon Migration (Feather → Ionicons)
- Already importing Ionicons in HomeScreen
- `@expo/vector-icons` includes Ionicons by default
- Key icon mapping:
  - `Feather.check` → `Ionicons.checkmark`
  - `Feather.plus` → `Ionicons.add`
  - `Feather.minus` → `Ionicons.remove`
  - `Feather.search` → `Ionicons.search`
  - `Feather.x` → `Ionicons.close`
  - `Feather.settings` → `Ionicons.settings-outline`
  - `Feather.users` → `Ionicons.people-outline`
  - `Feather.chevron-up/down` → `Ionicons.chevron-up/down`

### Inter Font
- Need to install `@expo-google-fonts/inter` if not already present
- Or use system font with appropriate weights
- Outfit font already used for title

### Store Logos
- Mockups show store logos (ALDI, Kroger, Trader Joe's, Whole Foods, Target)
- Options: SVG icons, emoji fallbacks, or remote images
- For MVP: use text + colored circle with store initial

---

## 8. Dark Mode Glassmorphism CSS Recipe

```typescript
// Dark glass card
{
  backgroundColor: 'rgba(255, 255, 255, 0.06)',
  borderRadius: 16,
  borderWidth: 1,
  borderColor: 'rgba(0, 230, 118, 0.15)',
  shadowColor: '#00E676',
  shadowOffset: { width: 0, height: 0 },
  shadowOpacity: 0.15,
  shadowRadius: 12,
  // BlurView overlay with intensity 20
}

// Light card
{
  backgroundColor: '#FFFFFF',
  borderRadius: 16,
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.04,
  shadowRadius: 8,
  elevation: 2,
}
```

---

## 9. Mockup-Specific Layout Details

### Dark Mode Grocery List Screen
```
┌─────────────────────────────┐
│ [Search icon] Search...     │  ← SearchBar (glass bg)
├─────────────────────────────┤
│ [Produce] [Dairy] [Bakery]  │  ← CategoryPill scroll
├─────────────────────────────┤
│ ▼ ALDI                (3)   │  ← StoreCard header
│   🥦 Organic Broccoli       │
│      [−]  2 lbs  [+]       │  ← QuantityStepper
│   🥛 Whole Milk              │
│      [−]  1 gal  [+]       │
│   🍞 Sourdough Bread        │
│      [−]  1 loaf [+]       │
├─────────────────────────────┤
│ ▼ Kroger              (2)   │
│   🍗 Chicken Breast          │
│      [−]  2 lbs  [+]       │
│   🧀 Cheddar Cheese          │
│      [−]  1 pkg  [+]       │
├─────────────────────────────┤
│ ▼ Trader Joe's        (1)   │
│   🥑 Avocados               │
│      [−]  4 ct   [+]       │
├─────────────────────────────┤
│ [List] [Explore] [Cart] [👤] │  ← BottomTabBar
└─────────────────────────────┘
```

### Light Mode Grocery List Screen
```
┌─────────────────────────────┐
│ [🔍] Search groceries...    │  ← SearchBar (warm bg)
├─────────────────────────────┤
│ [All] [Produce] [Dairy] [+] │  ← CategoryPill scroll
├─────────────────────────────┤
│ Whole Foods            (2)  │  ← StoreCard
│   ☐ Avocados (4)   − 4 +   │
│   ☐ Organic Milk   − 1 +   │
├─────────────────────────────┤
│ Kroger                 (1)  │
│   ☐ Chicken Breast − 2 +   │
├─────────────────────────────┤
│ Target                 (1)  │
│   ☐ Paper Towels   − 1 +   │
├─────────────────────────────┤
│ Trader Joe's           (1)  │
│   ☐ Sourdough Bread− 1 +   │
├─────────────────────────────┤
│ [🏠] [📋] [📷] [🏷] [👤]   │  ← BottomTabBar (5 tabs)
└─────────────────────────────┘
```

### Splash Screen
```
┌─────────────────────────────┐
│                             │
│                             │
│      ┌─────────────┐       │
│      │  🛒 (logo)  │       │  ← Grocery bag illustration
│      │  🍅 🥕 🍃   │       │     (orange bag, red tomato,
│      └─────────────┘       │      orange carrot, green leaf)
│                             │
│        PantryRun              │  ← Bold, black, ~48px
│  Your Intelligent Grocery   │  ← Regular, gray, ~16px
│           Path              │
│                             │
│                             │
└─────────────────────────────┘
```

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| BlurView not available on all devices | Fallback to rgba overlay without blur |
| Inter font not installed | Use system font with weight adjustments |
| Different tab count (4 dark, 5 light) | Custom tab bar handles both configurations |
| Store logos missing | Use colored circle with initial letter as fallback |
| Glassmorphism performance | Limit blur to static cards, not scrolling elements |
| Status bar contrast | Use `StatusBar style="light"` for dark, `style="dark"` for light |

---

## 11. Dependencies

### Required (already in project)
- `@expo/vector-icons` — Ionicons
- `react-native-safe-area-context` — SafeAreaProvider
- `@react-navigation/native` — NavigationContainer
- `@react-navigation/native-stack` — Stack navigator
- `expo-status-bar` — StatusBar

### May Need to Install
- `@react-native-community/blur` — For real glassmorphism BlurView
- `@expo-google-fonts/inter` — Inter font family (optional, can use system)

### Assets Needed
- `assets/splash-logo.png` — Grocery bag logo (SVG preferred)
- Or build the logo with React Native SVG components
