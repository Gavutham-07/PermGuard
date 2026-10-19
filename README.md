# PermGuard — Silent Permission Abuse & Network Risk Detector

PermGuard is an Android security application designed to analyze installed applications for silent permission abuse, dormant access risks, per-app network consumption, and network vulnerability findings.

---

## Key Features

1. **Permission & Dormant Usage Analysis:**
   - Scans installed apps for sensitive permissions (`CAMERA`, `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `READ_CONTACTS`).
   - Correlates granted permissions with 7-day foreground usage (`UsageStatsManager`) to detect dormant apps retaining sensitive permissions without active use.

2. **Per-App Data Usage (Wi-Fi & Mobile):**
   - Collects 7-day mobile and Wi-Fi data statistics via `NetworkStatsManager`.
   - Distinguishes between zero bytes and genuinely unavailable statistics (e.g. platform restrictions).

3. **Unified Risk Scoring (0–100):**
   - Four distinct evidence buckets:
     - **Permissions:** 0–40 pts
     - **Usage Pattern:** 0–15 pts
     - **Data Consumption:** 0–20 pts
     - **Network Findings:** 0–25 pts
   - Fully explainable: every calculation displays human-readable reasons and coverage indicators.
   - Heuristic indicator: displays clear disclaimers that high scores indicate risk heuristics rather than definitive malicious behaviour.

4. **Burp Suite Findings Import:**
   - Imports vulnerability reports from Burp Suite (XML issues export or PermGuard CSV).
   - Automatically redacts credentials, bearer tokens, API keys, and session cookies from issue descriptions.
   - Requires explicit package attribution for per-app scoring; unattributed findings are tracked in the Findings ledger without distorting app scores.

5. **Privacy First (Zero External Network Transmission):**
   - PermGuard declares **no `android.permission.INTERNET`**.
   - All analyses, scans, and imports run completely offline on-device with an encrypted-ready local SQLite database.

6. **Automated Background Checks:**
   - Native `WorkManager` periodic checks (every 15 minutes) and `PackageChangeReceiver` for app install/update events.
   - Local notification alerts with 24-hour deduplication cooldowns.

---

## Architecture & Project Structure

- `app/src/main/java/com/example/permguard/`
  - `RiskEngine.kt`: Pure Kotlin rule-based scoring engine with evidence buckets and explanations.
  - `PermissionScanner.kt`: Unified scanner for installed packages, usage stats, and combined risk calculation.
  - `DataUsageCollector.kt`: Collects per-app Wi-Fi and mobile byte statistics via `NetworkStatsManager`.
  - `BurpImporter.kt`: Parses CSV and XML Burp exports with secret redaction and attribution validation.
  - `DatabaseHelper.kt`: Versioned SQLite database (`scan_results` and `network_findings` tables).
  - `PermissionCheckWorker.kt`: Background `CoroutineWorker` for periodic scanning.
  - `PackageChangeReceiver.kt`: BroadcastReceiver for package added/replaced/removed events.
  - `MainActivity.kt`: Jetpack Compose UI (Dashboard, App Detail, and Findings screens).

---

## Building and Testing

### Run Automated Unit Tests (54 Tests)

```bash
./gradlew testDebugUnitTest
```

### Build Debug APK

```bash
./gradlew assembleDebug
```
The output APK will be generated at:
`app/build/outputs/apk/debug/app-debug.apk`

---

## Installing on Device / Emulator

```bash
# Install the APK
adb install -r app/build/outputs/apk/debug/app-debug.apk

# (Optional) Grant Usage Access directly via ADB:
adb shell appops set com.example.permguard GET_USAGE_STATS allow

# Launch PermGuard
adb shell am start -n com.example.permguard/.MainActivity
```

---

## Sample Burp Findings Import Format

PermGuard supports standard Burp XML reports or a lightweight CSV (`sample_burp_findings.csv`):

```csv
# PermGuard Burp Findings v1
severity,host,path,issue_name,attribution
HIGH,api.example.com,/v1/login,Cleartext HTTP Transmission,com.example.app
MEDIUM,cdn.example.com,/assets,Missing Cache-Control Header,
```
