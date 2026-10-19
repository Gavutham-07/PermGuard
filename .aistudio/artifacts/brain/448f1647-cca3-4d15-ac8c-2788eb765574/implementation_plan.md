# PermGuard: Risk Scoring Fix, Search/Filtering, and Real-Time Burp Suite Integration

1-2 concise sentences summarizing the overarching goal:
This plan addresses risk-score classification mismatches, unifies the scoring threshold across all modules, adds multi-criteria search, sorting, and filtering to the dashboard, implements persistent change-detection notifications for meaningful shifts (&ge;5 pts or category transitions), and introduces a real-time Burp Suite Python Montoya extension with an authenticated local bridge.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were clarified in Phase 1 and govern the implementation:
> - **Bridge Architecture**: Local authenticated HTTP server with bearer token and deduplication.
> - **Notification Sensitivity**: Any risk category shift or a score delta of 5 or more points (&Delta;&ge;5 pts).
> - **Extension Format**: Python Montoya extension script ready to load in Burp Suite Extender (`permguard_burp_extension.py`), accompanied by an interactive in-app test generator for synthetic proxy events.

---

### 1. Overview & Core Concept

- **What It Does**:
  PermGuard audits mobile applications for silent permission abuse, dormant access risks, per-app network consumption, and network vulnerability findings. This update eliminates score-versus-category discrepancies, introduces responsive search, multi-field sorting, and category filters, adds persistent change notifications, and connects Burp Suite proxy traffic directly to PermGuard in real time via an authenticated loopback bridge.
- **Target Audience / Persona**:
  Mobile application security engineers, privacy researchers, and penetration testers who evaluate Android app permissions and dynamic network traffic.
- **Key Value**:
  Guarantees complete consistency between numerical scores and severity classifications, provides instant filtering across large application suites, alerts users to critical permission and vulnerability changes, and automates real-time ingestion of Burp Suite proxy findings without manual file exports.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Dashboard Overview & Audit**: User opens PermGuard to view summary count cards (High, Medium, Low), a search bar, sort options, and risk category filter buttons. The app list reflects the combined search, filter, and sort criteria with an exact count of matching apps.
  2. **Risk Scoring Transparency**: User clicks any app card to view the App Detail screen. Scores are clearly distinguished: "Permission Score" (0–40 pts) versus "Combined Risk Score" (0–100 pts), alongside human-readable explanations detailing which evidence buckets contributed points and which were unavailable.
  3. **Live Burp Bridge & Pairing**: User clicks "Burp Bridge" in the header to view connection status, copy the local bearer authentication token, view the Python Montoya extension instructions, and test synthetic proxy events.
  4. **Change Detection Feed**: When an app's permissions change, a new attributed vulnerability is ingested, or its combined score shifts by &ge;5 points (or changes category), a persistent change alert is generated with before/after comparisons.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Utilitarian security dashboard inspired by Material Design 3 and professional developer consoles, adhering to strict zero-pill metadata discipline and unboxed typography.
  - *Color Palette & Mood*: Dominant dark navy header (`#1A237E`), lavender subtext (`#C5CAE9`), off-white canvas (`#F5F5F7`), white single-elevation cards (`#FFFFFF`), with semantic status tokens:
    - High Risk: `#E53935` (Crimson)
    - Medium Risk: `#FB8C00` (Amber)
    - Low Risk: `#43A047` (Emerald)
    - Neutral / Attributed: `#1565C0` (Cobalt)
  - *Typography & Hierarchy*: High-legibility system sans font with tabular figures (`tabular-nums`) for byte metrics, scores, and timestamps.
  - *Component Styling*: Single-elevation flat cards with 1px border lines (`border border-gray-100`), clean segmented filter buttons, and high-contrast badges for risk classifications.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Authoritative Classification Reconciler**:
  - *Chosen Approach*: A single unified classification function `classifyRiskScore(score: number): RiskLevel` implementing documented provisional thresholds: `0..29: LOW`, `30..59: MEDIUM`, `60..100: HIGH`. Stored database snapshots are automatically reconciled so legacy 2-rule permission classifications never override combined scores.
  - *Why*: Eliminates the root cause where an app with 37 points was marked "High" due to legacy permission checks, and an app with 62 points was marked "Low".
  - *Alternatives Considered*: Retaining the legacy rule as the primary label was rejected because it contradicts the 4-bucket evidence model and misleads security auditors.

- **Decision 2: Separation of Permission-Only and Combined Risk**:
  - *Chosen Approach*: Provide explicit separate fields everywhere: `permissionScore` / `permissionRiskLevel` (0–40 pts) and `combinedScore` / `combinedRiskLevel` (0–100 pts).
  - *Why*: Gives security auditors complete visibility into static permission accumulation versus dynamic network and usage evidence.

- **Decision 3: Authenticated Local Loopback HTTP Bridge**:
  - *Chosen Approach*: An authenticated HTTP endpoint (`/api/burp/events`) guarded by a pre-shared bearer token generated by the application, with rate limiting, payload validation, secret redaction, and deduplication.
  - *Why*: Secure, reliable, does not open public ports, and integrates cleanly with Python Montoya Burp extensions.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Burp Suite (Localhost)                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │   Python Montoya Extension (permguard_burp_extension.py)         │  │
│  │   • ProxyResponseHandler detects sensitive unencrypted findings  │  │
│  │   • Secret Redaction (Auth, Tokens, Cookies -> [REDACTED])       │  │
│  │   • Package Attribution via Header/Host                          │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
└────────────────────────────────────┼───────────────────────────────────┘
                                     │ HTTP POST (Bearer Token)
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      PermGuard Web Application                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Local Bridge Receiver (/api/burp/events or In-App Web Bridge)    │  │
│  │ • Token validation & Deduplication (severity|host|path|issue)    │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
│                                    ▼                                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Database Layer (DatabaseHelper / localStorage)                   │  │
│  │ • Network Findings Ledger • App Snapshots • Change History       │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
│                                    ▼                                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Unified Risk Engine (RiskEngine.ts)                              │  │
│  │ • 4 Evidence Buckets (0-40, 0-15, 0-20, 0-25 capped at 100)      │  │
│  │ • Authoritative Classifier: 0-29 Low, 30-59 Med, 60-100 High     │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
│                                    ▼                                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Change Detector Engine                                           │  │
│  │ • Compares snapshot vs current state                             │  │
│  │ • Emits alert if category changes OR |Δscore| ≥ 5                │  │
│  └─────────────────────────────────┬────────────────────────────────┘  │
│                                    ▼                                   │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Presentation Views (React / Tailwind)                            │  │
│  │ • Dashboard (Search, Sort, Filters: All/High/Med/Low)            │  │
│  │ • App Detail (Permission score vs Combined score, evidence)      │  │
│  │ • Findings Screen (Burp Ledger & Attribution)                    │  │
│  │ • Notifications Drawer & Burp Bridge Manager Modal               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

- **Interactive Component & State Mapping**:
  - `SearchFilterBar`: Handles instant text search query (app label or package name), sort dropdown (Name A-Z, Name Z-A, Score Desc, Score Asc, Last Changed), and risk category filter chips (`All`, `High`, `Medium`, `Low`).
  - `DashboardScreen`: Renders the filtered & sorted list, matching counter (`Showing X of Y apps`), and empty state when no results match.
  - `AppDetailScreen`: Displays permission score vs combined score, evidence points breakdown, and heuristic indicator disclaimer.
  - `BurpBridgeModal`: Displays pairing token, connection logs, extension installation instructions, and an interactive test event generator.
  - `NotificationDrawer`: Displays persisted change notifications with before/after score metrics.
