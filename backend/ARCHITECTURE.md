# Backend Architecture

## 1. Overview
The backend is a **FastAPI** application that manages the core logic of the Hotel Central AC System. It handles room state management, AC scheduling (priority + time slice), billing calculation, and data persistence.

## 2. Tech Stack
- **Language**: Python 3.10+
- **Framework**: FastAPI
- **Server**: Uvicorn
- **Database**: SQLite (via SQLModel/SQLAlchemy)
- **Testing**: Pytest

## 3. Directory Structure
```
backend/
├── app/
│   ├── main.py              # Application entry point, CORS, Scheduler loop
│   ├── config.py            # Configuration loader
│   └── app_config.yaml      # Business rules (pricing, temp limits, etc.)
├── application/             # Application Services (Business Logic)
│   ├── scheduler.py         # Core scheduling algorithm (Priority + Time Slice)
│   ├── billing_service.py   # Bill generation & Detail record aggregation
│   ├── use_ac_service.py    # AC control logic (Power On/Off, Temp/Speed change)
│   ├── checkin_service.py   # Check-in logic
│   ├── checkout_service.py  # Check-out logic
│   └── report_service.py    # Reporting logic
├── domain/                  # Domain Models (Data Structures)
│   ├── room.py              # Room entity
│   ├── bill.py              # Bill & Invoice entities
│   ├── detail_record.py     # AC usage detail records
│   ├── queues.py            # Waiting & Service queues
│   └── service_object.py    # Active service session
├── infrastructure/          # Data Access Layer
│   ├── database.py          # DB connection & Session management
│   ├── models.py            # SQLModel DB tables
│   ├── repository.py        # Abstract Repository Interface
│   └── sqlite_repo.py       # SQLite implementation of Repository
└── interfaces/              # API Layer (Controllers)
    ├── ac_router.py         # Room AC control endpoints
    ├── frontdesk_router.py  # Check-in/Check-out endpoints
    ├── monitor_router.py    # Monitoring endpoints
    └── report_router.py     # Reporting endpoints
```

## 4. Key Components

### 4.1 Scheduler (`application/scheduler.py`)
The heart of the system. It runs a 1-second tick loop (triggered in `main.py`) to:
1.  **Update State**: Increment served time, wait time, and simulate temperature changes.
2.  **Enforce Limits**: Manage the maximum number of concurrent running ACs (default: 3).
3.  **Schedule**:
    -   **Priority**: High speed > Mid speed > Low speed.
    -   **Time Slice**: Round-robin scheduling for equal priority requests.
    -   **Preemption**: Higher priority requests can preempt lower priority ones.
4.  **Auto-Control**: Stop AC when target temperature is reached; restart when temperature deviates by 1°C.

### 4.2 Billing (`application/billing_service.py`)
-   Calculates costs based on usage duration and fan speed rates.
-   Generates **Detail Records** whenever the AC state changes (Speed change, Power On/Off).
-   Aggregates records into a final **Bill** upon checkout.

### 4.3 Infrastructure (`infrastructure/`)
-   Uses **SQLModel** to define database schemas that map to Domain models.
-   **SQLiteRepository** provides CRUD operations, ensuring business logic is decoupled from specific database implementation.

## 5. Configuration
Business rules are defined in `app/app_config.yaml` and loaded via `app/config.py`. This includes:
-   Temperature ranges (Cool/Heat)
-   Pricing rates per unit
-   Energy consumption rates per fan speed
-   Scheduling limits (Max concurrent services, Time slice duration)

## 6. Running the Backend
```bash
# From backend/ directory
python -m venv .venv
# Activate venv (Windows: .venv\Scripts\activate, Mac/Linux: source .venv/bin/activate)
pip install -r requirements.txt
uvicorn app.main:app --reload
```
API Docs available at: `http://localhost:8000/docs`
