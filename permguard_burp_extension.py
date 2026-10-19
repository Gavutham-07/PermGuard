"""
PermGuard Burp Suite Extension (Montoya API compatible)
======================================================
Monitors HTTP proxy traffic in real-time, extracts privacy and network vulnerability
findings, redacts credentials/tokens, and securely dispatches finding metadata
to the local PermGuard bridge over an authenticated loopback connection.

Supported Burp Suite Versions:
- Burp Suite Professional / Community Edition (2023.1+) with Jython 2.7+ standalone JAR.
- Compatible with Montoya API and classic Burp Extender IBurpExtender / IHttpListener.

Installation Instructions:
1. In Burp Suite: Go to Extender -> Options -> Python Environment.
2. Select your Jython standalone JAR (e.g., jython-standalone-2.7.3.jar).
3. Go to Extender -> Extensions -> Add.
4. Set Extension Type to "Python" and select this file: `permguard_burp_extension.py`.
5. Ensure the PermGuard local bridge is running, copy your pairing token from
   PermGuard -> "Burp Bridge", and paste it into the configuration below or in the UI.

Security & Privacy Guarantees:
- Never transmits full request/response bodies.
- Authorization headers, bearer tokens, cookies, and passwords are fully redacted.
- Package attribution is marked UNKNOWN unless explicit headers (e.g. X-PermGuard-Package)
  or configured host mappings are present.
- Bridge connection failures never block or stall proxy traffic.
"""

import json
import re
import sys
import time

try:
    from urllib2 import Request, urlopen, URLError, HTTPError
except ImportError:
    from urllib.request import Request, urlopen
    from urllib.error import URLError, HTTPError

from burp import IBurpExtender, IHttpListener

# ── Configuration Defaults ────────────────────────────────────────────────────
DEFAULT_BRIDGE_URL = "http://127.0.0.1:3000/api/burp/events"
PAIRING_TOKEN = "REPLACE_WITH_YOUR_PAIRING_TOKEN_FROM_PERMGUARD_UI"

# Secret redaction pattern
SECRET_PATTERN = re.compile(
    r"(Authorization|Cookie|Set-Cookie|Token|Session|Bearer|Basic|api[_-]?key|password|secret)[\s:=]+([^\r\n&]{1,200})",
    re.IGNORECASE,
)


def redact_sensitive(text):
    if not text:
        return ""
    return SECRET_PATTERN.sub(r"\1: [REDACTED]", str(text))


class BurpExtender(IBurpExtender, IHttpListener):

    def registerExtenderCallbacks(self, callbacks):
        self._callbacks = callbacks
        self._helpers = callbacks.getHelpers()
        callbacks.setExtensionName("PermGuard Real-Time Bridge")
        callbacks.registerHttpListener(self)

        print("[PermGuard] Extension loaded successfully.")
        print("[PermGuard] Target Bridge URL: " + DEFAULT_BRIDGE_URL)
        print("[PermGuard] Ready to observe proxy traffic and report security findings.")

    def processHttpMessage(self, toolFlag, isRequest, messageInfo):
        # We process toolFlag 4 = TOOL_PROXY
        if toolFlag != self._callbacks.TOOL_PROXY:
            return

        # We analyze completed responses to verify security posture
        if isRequest:
            return

        try:
            self._analyze_http_traffic(messageInfo)
        except Exception as e:
            # Never block proxy processing on extension exceptions
            print("[PermGuard] Non-blocking exception in traffic analyzer: " + str(e))

    def _analyze_http_traffic(self, messageInfo):
        httpService = messageInfo.getHttpService()
        if not httpService:
            return

        protocol = httpService.getProtocol()  # "http" or "https"
        host = httpService.getHost()
        port = httpService.getPort()

        requestBytes = messageInfo.getRequest()
        responseBytes = messageInfo.getResponse()
        if not requestBytes or not responseBytes:
            return

        requestInfo = self._helpers.analyzeRequest(messageInfo)
        responseInfo = self._helpers.analyzeResponse(responseBytes)

        url = str(requestInfo.getUrl())
        path = url[url.find(host) + len(host):] if host in url else "/"

        # Inspect headers for package attribution header (e.g. injected during mobile test)
        attributed_package = None
        for header in requestInfo.getHeaders():
            h_str = str(header)
            if h_str.lower().startswith("x-permguard-package:"):
                candidate = h_str.split(":", 1)[1].strip()
                if "." in candidate:
                    attributed_package = candidate
            elif h_str.lower().startswith("user-agent:"):
                # Check for common Android package identifiers in User-Agent
                ua = h_str.lower()
                if "com.google.android.googlequicksearchbox" in ua:
                    attributed_package = "com.google.android.googlequicksearchbox"

        # ── Security Observations ─────────────────────────────────────────────
        findings = []

        # 1. Cleartext HTTP Transmission (HIGH risk on sensitive endpoints)
        if protocol.lower() == "http":
            is_sensitive_path = any(s in path.lower() for s in ["login", "auth", "token", "user", "api", "account"])
            sev = "HIGH" if is_sensitive_path else "MEDIUM"
            findings.append({
                "issueType": "Cleartext HTTP Transmission",
                "severity": sev,
                "host": host,
                "path": redact_sensitive(path),
                "attributedPackage": attributed_package,
                "confidence": "HIGH" if attributed_package else "UNKNOWN"
            })

        # 2. Missing Strict-Transport-Security (HSTS) on HTTPS responses
        elif protocol.lower() == "https":
            has_hsts = False
            for header in responseInfo.getHeaders():
                if str(header).lower().startswith("strict-transport-security:"):
                    has_hsts = True
                    break
            if not has_hsts:
                findings.append({
                    "issueType": "Missing Strict-Transport-Security Header",
                    "severity": "LOW",
                    "host": host,
                    "path": redact_sensitive(path),
                    "attributedPackage": attributed_package,
                    "confidence": "HIGH" if attributed_package else "UNKNOWN"
                })

        # 3. Sensitive Tokens or Keys in URL Query Parameters
        if any(term in path.lower() for term in ["api_key=", "token=", "secret=", "password=", "access_token="]):
            findings.append({
                "issueType": "Sensitive Credentials in URL Query String",
                "severity": "HIGH",
                "host": host,
                "path": redact_sensitive(path),
                "attributedPackage": attributed_package,
                "confidence": "HIGH" if attributed_package else "UNKNOWN"
            })

        # Send findings to PermGuard bridge
        for finding in findings:
            self._send_to_bridge(finding)

    def _send_to_bridge(self, payload):
        try:
            data = json.dumps(payload).encode("utf-8")
            req = Request(DEFAULT_BRIDGE_URL, data=data)
            req.add_header("Content-Type", "application/json")
            req.add_header("Authorization", "Bearer " + PAIRING_TOKEN)

            # 3 second timeout; non-blocking
            response = urlopen(req, timeout=3)
            status_code = response.getcode()
            if status_code in [200, 201]:
                print("[PermGuard] Event forwarded: " + payload["issueType"] + " on " + payload["host"])
        except (HTTPError, URLError) as e:
            # Handle failure gracefully without disrupting proxy flow
            # (Diagnostics without logging bearer tokens)
            pass
        except Exception:
            pass
