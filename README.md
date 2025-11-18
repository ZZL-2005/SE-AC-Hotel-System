# Hotel Central AC Billing System (SE-AC-Hotel-System)

A distributed Central Air Conditioning management and billing system for hotels. This system manages room temperatures, schedules AC resources based on priority and time slices, and calculates detailed billing for guests.

## 🚀 Quick Start

### Prerequisites
-   **Python 3.10+**
-   **Node.js 18+**

### 1. Start the Backend
The backend handles the core logic, database, and scheduling.

```bash
cd backend

# Create and activate virtual environment
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Mac/Linux:
# source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the server
uvicorn app.main:app --reload
```
*Backend runs on `http://localhost:8000`*

### 2. Start the Frontend
The frontend provides the web interface for guests and staff.

```bash
cd frontend

# Install dependencies
npm install

# Run the development server
npm run dev
```
*Frontend runs on `http://localhost:5173`*

---

## ✨ Features

### 🏨 For Guests (Room Control)
-   **Control Panel**: Turn AC on/off, set target temperature, and adjust fan speed (High/Mid/Low).
-   **Real-time Feedback**: View current room temperature, current cost, and AC status (Serving/Waiting).
-   **Smart Scheduling**: Requests are queued and served based on priority (Speed) and time slices.

### 🛎️ For Reception (Front Desk)
-   **Check-in**: Register guests and assign rooms.
-   **Check-out**: Generate comprehensive bills including accommodation fees and detailed AC usage costs.
-   **Invoice**: Print/View detailed usage logs.

### 📊 For Managers (Monitor & Report)
-   **Live Monitor**: View the status of all rooms, including current temperature, fan speed, and queue status.
-   **Queue Visualization**: See exactly which rooms are being served and which are waiting.
-   **Statistical Reports**: Analyze income, energy consumption, and usage trends with interactive charts.

---

## 🏗️ Architecture

This project is divided into a Python FastAPI backend and a React frontend.

-   **Backend**: Implements the "Time Slice + Priority" scheduling algorithm, billing logic, and temperature simulation.
    -   [Read Backend Architecture](./backend/ARCHITECTURE.md)
-   **Frontend**: A modern SPA built with React, Vite, and Tailwind CSS.
    -   [Read Frontend Architecture](./frontend/ARCHITECTURE.md)

## ⚙️ Configuration

System parameters (pricing, temperature limits, scheduling rules) are defined in `backend/app/app_config.yaml`.
-   **Default Max Concurrent ACs**: 3
-   **Time Slice**: 60 seconds
-   **Pricing**: 1.0 CNY/unit

## 📝 Documentation
-   **API Documentation**: Start the backend and visit `http://localhost:8000/docs`.
