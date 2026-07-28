# GroceryApp 🛒

GroceryApp is a modern, premium, collaborative co-shopping application built with **React Native (Expo)**. It is designed to be elegant, high-fidelity, and extremely performant across both iOS and Android platforms. 

The app features real-time peer synchronization, offline-first local state storage (Yjs CRDTs), private zero-knowledge encryption, major grocery store price comparisons, and a smart multi-stop route optimizer to maximize shopping savings.

---

## ✨ Features

### 🎨 Premium Visual Redesign & Dark Mode
- Sleek, modern styling with soft rounded cards (12px to 16px), subtle shadows, and clean border separations.
- **Dynamic Theming**: Segmented theme controls inside the Settings page supporting **Light Mode**, **Dark Mode**, and **System Default** auto-toggling.
- Glowing emerald green accent branding (`#10B981`) for checkboxes, primary buttons, and cheapest-price markers.

### 🗺️ Multi-Stop Route Optimizer ("Smart Splits")
- Computes greedy multi-stop shopping routes to get the best pricing across local grocery stores.
- Displays horizontal **Route Proposal Cards** (e.g. 1 Stop, 2 Stops, 3 Stops) with estimated subtotals, store listings, and highlighted savings.
- Highlights the optimal compromise proposal with a glowing **Best Value** label.
- **Dynamic List Splits**: Tapping any route proposal splits the shopping list into stop-by-stop visit segments (e.g., `Stop 1: No Frills`, `Stop 2: Walmart`) displaying live stop subtotals and showing the best price per item for that store.

### ➕ Modern Add Item Sheet
- Clean form inputs for custom grocery additions.
- Interactive **Quantity Micro-Selectors** (`-` / `+` buttons) to easily adjust quantities.
- Categorized horizontal scroll tabs (Produce, Dairy, Meat, Bakery, etc.) and quick-add grids of commonly purchased items.
- **Voice Dictation (NLP)**: Microphone trigger to dictate items (e.g., *"add two bags of apples"*), which automatically parses the name, quantity, and unit.

### 🔄 Local-First Real-Time Sync
- Uses **Yjs CRDTs** for instant local-first data mutations.
- Syncs seamlessly in the background over secure WebSocket connections.
- Clean header badge indicators showing synced state status and connection latency.

---

## 📸 Screenshots

### 1. Home Dashboard & Shared Shopping List (Light Mode)
Collaborative list dashboard with progress indicators and the **Smart Route Optimizer** displaying optimal multi-stop splits:
![Home & List Light Mode](assets/screenshots/grocery_list_multi_stop_light.png)

### 2. Shopping List & Split Routing (Dark Mode)
Sleek slate-based dark interface showing a route proposal selected, splitting list items into Stop-specific groups:
![List Dark Mode](assets/screenshots/grocery_list_multi_stop_dark.png)

### 3. Add Item Bottom Sheet
Dynamic add sheet with category tabs, quick chips, and quantity selectors:
![Add Item Sheet](assets/screenshots/add_item_sheet_mockup.png)

### 4. Personal Dashboard
Overview of lists, syncing devices, and active collaboration metrics:
![Home Dashboard](assets/screenshots/home_dashboard_mockup.png)

---

## 🛠️ Technology Stack

- **Framework**: React Native with Expo SDK 56
- **Real-Time Sync**: Yjs (CRDTs)
- **Local Storage**: WatermelonDB & Expo Secure Store
- **State Management**: Zustand
- **Language**: TypeScript
- **Styling**: Vanilla React Native Stylesheets

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- Expo CLI (`npm install -g expo-cli`)
- iOS Simulator (macOS Xcode) or Android Emulator (Android Studio)

### Installation
1. Clone the repository and navigate to the project directory:
   ```bash
   git clone https://github.com/arshad1416/grocery-app.git
   cd grocery-app/GroceryApp
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
   Or launch directly on simulators:
   ```bash
   npm run ios     # Start iOS simulator
   npm run android # Start Android emulator
   ```
