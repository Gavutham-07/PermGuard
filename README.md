# PermGuard — Silent Permission Abuse & Network Risk Detector

PermGuard is a privacy-first mobile security and audit tool designed to evaluate applications for silent permission abuse, dormant access risks, per-app network consumption, and network vulnerability findings.

---

## 1. Unified Risk Classification & Scoring Rules

### Exact Authoritative Thresholds (0–100 Scale)
Combined risk scores are evaluated across 4 evidence buckets and classified via the single authoritative function `RiskEngine.classifyRiskScore(score: number): RiskLevel`:

- **`0–29`**: **`LOW`**
- **`30–59`**: **`MEDIUM`**
- **`60–100`**: **`HIGH`**

### Evidence Buckets (0–100 Max)
1. **Permissions Bucket (0–40 pts)**: Weighted by sensitive permission count (8 pts per permission across `CAMERA`, `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `READ_CONTACTS`).
2. **Usage Pattern Bucket (0–15 pts)**: Identifies dormant applications retaining sensitive permissions (&lt;5 min foreground active time = 15 pts; &lt;15 min = 10 pts; &ge;15 min = 5 pts).
3. **Data Consumption Bucket (0–20 pts)**: Evaluates 7-day data volume (&ge;100 MiB = 20 pts; &ge;10 MiB = 13 pts; &gt;0 B = 6 pts; 0 B = 0 pts). Missing data statistics are preserved as unavailable rather than zero.
4. **Network Findings Bucket (0–25 pts)**: Integrates validated Burp Suite findings (HIGH = 15 pts, MEDIUM = 8 pts, LOW = 3 pts, capped at 25 pts).

### Root Cause of Scoring Inconsistency & Fix
- **Root Cause**: Previously, `PermissionScanner` evaluated a legacy 2-rule condition (`>= 2 perms & < 5 min = HIGH`) and assigned it to `app.riskLevel`, while `RiskEngine` computed a 4-bucket combined score (`app.combinedScore`). This caused an app with 37 points to be displayed with a "HIGH" badge, and an app with 62 points to be displayed with a "LOW" badge.
- **Resolution**: Both permission-only risk (`permissionScore` 0–40 pts and `permissionRiskLevel`) and combined risk (`combinedScore` 0–100 pts and `combinedRiskLevel`) are strictly separated. The legacy rule is retained only for audit diagnostics and never overrides the authoritative combined classification.

---

## 2. Dashboard Search, Sorting, and Filtering

- **Instant Search**: Case-insensitive substring matching against both application label and package name.
- **Multi-Field Sorting**:
  - Combined Score (High &rarr; Low)
  - Combined Score (Low &rarr; High)
  - Name (A &rarr; Z)
  - Name (Z &rarr; A)
  - Last Changed
  - Deterministic secondary tie-breaking by `packageName`.
- **Risk Filters**: Segmented controls for `All`, `High`, `Medium`, and `Low`.
- **Matching Counter & Empty State**: Live display of `Showing X of Y apps` with an interactive "Reset Filters" action when queries yield zero matches.

---

## 3. Persistent Change-Detection Engine

PermGuard compares consecutive scan results against saved snapshots to detect meaningful shifts:
- **Permission Changes**: Flags newly granted or revoked sensitive permissions.
- **Vulnerability Ingestion**: Alerts when new findings are attributed to an application.
- **Meaningful Score Delta**: Generates an alert when `|newScore - oldScore| >= 5 pts`. (A 4-point delta alone does not trigger an alert).
- **Category Transitions**: Alerts on any category change (e.g., `LOW` &rarr; `MEDIUM` or `MEDIUM` &rarr; `HIGH`), even if the delta is &lt;5 points.
- **Baseline Establishment**: Initial scans establish the baseline without generating spurious alerts.

---

## 4. Real-Time Burp Suite Integration & Local Bridge

### Local Authenticated Bridge (`server.ts` & `/api/burp/events`)
- **Transport**: Loopback HTTP listener running on port 3000.
- **Authentication**: Pre-shared Bearer token generated using cryptographic entropy (`pg_sec_...`) with rotation support.
- **Safety**: Rejects unauthenticated requests (HTTP 401), validates schema and payload length (HTTP 400), rate-limits to 60 events/minute (HTTP 429), and automatically redacts credentials, bearer tokens, and session cookies (`[REDACTED]`).
- **Deduplication**: Identical findings return HTTP 200 with `duplicate: true` to prevent score inflation.

### Python Montoya Extension (`permguard_burp_extension.py`)
- Compatible with Burp Suite Extender / Montoya API using Jython 2.7+.
- Non-blocking traffic analysis of proxy HTTP requests/responses.
- Automatically redacts authorization headers, cookies, and tokens.
- Dispatches security metadata (cleartext HTTP transmissions, missing HSTS, credential leaks in URL parameters) to `http://127.0.0.1:3000/api/burp/events`.
- Does not transmit full request/response bodies.

### Synthetic Event Generator
- Built-in synthetic test tool accessible from the "Bridge" button in the dashboard header.
- Sends synthetic security findings through the actual validation, rate-limiting, and risk-scoring pipeline to verify end-to-end functionality.

---

## 5. Verification & Test Suite

All 24 automated unit tests pass:
```bash
npm run test
```
Build verification:
```bash
npm run build
```
