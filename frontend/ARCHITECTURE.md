# Frontend Architecture

## 1. Overview
The frontend is a **Single Page Application (SPA)** built with **React** that provides the user interface for Guests (Room Control), Receptionists (Check-in/Check-out), and Managers (Monitor/Reports). It communicates with the backend via REST APIs.

## 2. Tech Stack
-   **Framework**: React 18+
-   **Build Tool**: Vite
-   **Language**: TypeScript
-   **Styling**: Tailwind CSS
-   **Routing**: React Router DOM
-   **Charts**: Chart.js (via react-chartjs-2)
-   **HTTP Client**: Axios (custom wrapper)

## 3. Directory Structure
```
frontend/
├── public/                  # Static assets
├── src/
│   ├── api/                 # API Clients
│   │   ├── client.ts        # Base Axios instance
│   │   ├── acClient.ts      # Room AC control API
│   │   ├── frontdeskClient.ts # Check-in/out API
│   │   ├── monitorClient.ts # Monitoring API
│   │   └── reportClient.ts  # Reporting API
│   ├── assets/              # Images and icons
│   ├── components/          # Reusable UI Components
│   │   ├── Hero.tsx         # Homepage hero section
│   │   ├── RoomHeader.tsx   # Room status header
│   │   ├── TempGauge.tsx    # Temperature visualization
│   │   ├── SpeedSelector.tsx# Fan speed control
│   │   ├── RoomStatusGrid.tsx # Monitor grid
│   │   └── ...
│   ├── pages/               # Route Pages
│   │   ├── Home.tsx         # Landing page
│   │   ├── RoomControlPage.tsx # Guest AC control panel
│   │   ├── CheckInPage.tsx  # Reception check-in
│   │   ├── CheckOutPage.tsx # Reception check-out & billing
│   │   ├── MonitorPage.tsx  # Manager monitoring dashboard
│   │   └── ReportPage.tsx   # Manager statistical reports
│   ├── styles/              # Global styles
│   │   └── tokens.css       # CSS variables (if any)
│   ├── types/               # TypeScript definitions
│   ├── App.tsx              # Main layout & Routing
│   └── main.tsx             # Entry point
├── index.html               # HTML template
├── tailwind.config.js       # Tailwind configuration
└── vite.config.ts           # Vite configuration
```

## 4. Key Features & Implementation

### 4.1 Room Control (`RoomControlPage`)
-   **Real-time State**: Polls the backend every few seconds to update current temperature, cost, and AC status.
-   **Throttling**: Implements debouncing/throttling for temperature adjustment buttons to prevent API flooding.
-   **Visuals**: Uses `TempGauge` to visualize temperature and `SpeedSelector` for fan control.

### 4.2 Monitoring (`MonitorPage`)
-   **Grid View**: Displays all rooms in a grid, color-coded by status (Serving, Waiting, Idle).
-   **Queue Visualization**: Shows the current state of the Service Queue and Waiting Queue, helping visualize the scheduling algorithm.
-   **Filtering**: Allows filtering rooms by status or floor.

### 4.3 Reporting (`ReportPage`)
-   **Dashboard**: A comprehensive dashboard with summary cards, trend lines, and pie charts.
-   **Data Visualization**: Uses `react-chartjs-2` to render:
    -   Income/Energy trends over time.
    -   Fan speed usage distribution.
    -   Room-specific performance.

### 4.4 Check-in/Out (`CheckInPage`, `CheckOutPage`)
-   **Forms**: Simple forms to capture guest details.
-   **Billing**: Fetches and displays detailed bills (Accommodation + AC) upon checkout.

## 5. Styling Strategy
-   **Tailwind CSS**: Used for utility-first styling.
-   **Design System**: Follows a clean, modern "Apple-like" aesthetic with generous whitespace, rounded corners, and soft shadows.
-   **Responsive**: Layouts adapt to mobile and desktop screens.

## 6. Running the Frontend
```bash
# From frontend/ directory
npm install
npm run dev
```
Access the app at: `http://localhost:5173`
