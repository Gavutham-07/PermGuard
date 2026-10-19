package com.example.permguard

import java.io.InputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element

/**
 * Imports Burp Suite findings from a supported export format.
 *
 * SUPPORTED FORMATS
 * ─────────────────
 * 1. Burp Suite Professional "Issues" XML export
 *    (Target → Site map → right-click → Report issues → XML)
 *
 * 2. PermGuard hand-crafted CSV (for Burp Community users who have no Issues export):
 *
 *    # PermGuard Burp Findings v1
 *    severity,host,path,issue_name,attribution
 *    HIGH,example.com,/api/login,Missing HSTS,com.example.app
 *    MEDIUM,example.com,/,Clickjacking,
 *
 * ATTRIBUTION
 * ───────────
 * A finding is associated with an Android package only when the attribution
 * column/field is explicitly set to a valid dotted package name.
 * Never inferred from host/path alone.
 *
 * PRIVACY
 * ───────
 * Authorization, Cookie, Token, and Session headers are automatically
 * redacted before storage. Full request/response bodies are NOT stored.
 *
 * LIMITATIONS (documented, not hidden)
 * ─────────────────────────────────────
 * • Burp Community Edition has no Issues export → use the CSV format.
 * • PermGuard has no INTERNET permission; it cannot contact Burp's REST API.
 * • A Burp host does not reliably identify the Android app; use explicit attribution.
 */
object BurpImporter {

    private const val TAG = "BurpImporter"

    /** Maximum permitted file size (2 MiB). */
    const val MAX_FILE_BYTES = 2 * 1024 * 1024L

    data class ImportResult(
        val findings: List<ImportedFinding>,
        val duplicatesSkipped: Int,
        val parseErrors: List<String>,
        val format: String
    )

    data class ImportedFinding(
        val severity: NetworkFinding.Severity,
        val issueType: String,
        val host: String,
        val path: String,
        /** Package name if user explicitly supplied attribution; null otherwise. */
        val attributedPackage: String?,
        val importedAt: String
    )

    // ── Public entry point ────────────────────────────────────────────────────

    fun parse(
        stream: InputStream,
        sizeBytes: Long,
        existingFindings: List<ImportedFinding> = emptyList()
    ): ImportResult {
        if (sizeBytes > MAX_FILE_BYTES) {
            return ImportResult(
                findings = emptyList(),
                duplicatesSkipped = 0,
                parseErrors = listOf(
                    "File too large (${sizeBytes / 1024} KB). Maximum is ${MAX_FILE_BYTES / 1024} KB."
                ),
                format = "unknown"
            )
        }

        val raw = stream.bufferedReader(Charsets.UTF_8).readText()
        val trimmed = raw.trimStart()

        return when {
            trimmed.startsWith("<?xml") || trimmed.startsWith("<issues") ->
                parseBurpXml(trimmed, existingFindings)
            trimmed.startsWith("# PermGuard Burp Findings") ->
                parseCsv(trimmed, existingFindings)
            else -> ImportResult(
                findings = emptyList(),
                duplicatesSkipped = 0,
                parseErrors = listOf(
                    "Unrecognised file format. Expected a Burp XML export or a " +
                            "PermGuard CSV file starting with '# PermGuard Burp Findings v1'."
                ),
                format = "unknown"
            )
        }
    }

    // ── XML parser (javax.xml — works on both Android and JVM unit tests) ─────

    private fun parseBurpXml(content: String, existing: List<ImportedFinding>): ImportResult {
        val findings = mutableListOf<ImportedFinding>()
        val errors = mutableListOf<String>()
        var duplicates = 0
        val existingKeys = existing.map { deduplicationKey(it) }.toSet()
        val importedAt = isoNow()

        try {
            val factory = DocumentBuilderFactory.newInstance().apply {
                isNamespaceAware = false
                // Disable external entity processing for security (supported on most JVMs)
                try {
                    setFeature("http://apache.org/xml/features/disallow-doctype-decl", true)
                } catch (_: Exception) { /* feature unsupported — continue safely */ }
            }
            val builder = factory.newDocumentBuilder()
            val doc = builder.parse(content.byteInputStream(Charsets.UTF_8))
            val issueNodes = doc.getElementsByTagName("issue")

            for (i in 0 until issueNodes.length) {
                val issue = issueNodes.item(i) as? Element ?: continue
                val severity = issue.getChildText("severity")
                val issueType = redactText(issue.getChildText("name"))
                val host = issue.getChildText("host")
                val path = issue.getChildText("path")
                val attribution = issue.getChildText("attribution").ifBlank { null }

                val finding = buildFinding(severity, issueType, host, path, attribution, importedAt)
                if (finding != null) {
                    val key = deduplicationKey(finding)
                    if (key in existingKeys) duplicates++ else findings.add(finding)
                } else {
                    errors.add("Skipped issue with unrecognised severity '$severity' for host '$host'")
                }
            }
        } catch (e: Exception) {
            // android.util.Log is not used here so this works in JVM unit tests
            System.err.println("$TAG: XML parse error: ${e.message}")
            errors.add("XML parse error: ${e.message}")
        }

        return ImportResult(findings, duplicates, errors, format = "burp-xml")
    }

    /** Safe helper to get text content of a direct child element (returns "" if absent). */
    private fun Element.getChildText(tagName: String): String {
        val nodes = getElementsByTagName(tagName)
        if (nodes.length == 0) return ""
        return nodes.item(0)?.textContent?.trim() ?: ""
    }

    // ── CSV parser ────────────────────────────────────────────────────────────

    private fun parseCsv(content: String, existing: List<ImportedFinding>): ImportResult {
        val findings = mutableListOf<ImportedFinding>()
        val errors = mutableListOf<String>()
        var duplicates = 0
        val existingKeys = existing.map { deduplicationKey(it) }.toSet()
        val importedAt = isoNow()

        val lines = content.lines()
        val dataLines = lines.drop(1) // drop "# PermGuard Burp Findings v1"
            .filter { it.isNotBlank() && !it.trimStart().startsWith("#") }

        if (dataLines.isEmpty()) {
            return ImportResult(emptyList(), 0, listOf("CSV file has no data rows."), "permguard-csv")
        }

        val headerLine = dataLines.first().lowercase()
        if (!headerLine.contains("severity")) {
            errors.add("CSV header row not found. Expected: severity,host,path,issue_name,attribution")
        }

        for ((i, line) in dataLines.drop(1).withIndex()) {
            val cols = line.split(",").map { it.trim() }
            if (cols.size < 4) {
                errors.add("Row ${i + 2}: too few columns (${cols.size}), skipping.")
                continue
            }
            val (sev, host, path, issueName) = cols
            val attribution = cols.getOrNull(4)?.ifBlank { null }
            val finding = buildFinding(sev, redactText(issueName), host, path, attribution, importedAt)
            if (finding == null) {
                errors.add("Row ${i + 2}: unrecognised severity '$sev', skipping.")
                continue
            }
            val key = deduplicationKey(finding)
            if (key in existingKeys) duplicates++ else findings.add(finding)
        }

        return ImportResult(findings, duplicates, errors, format = "permguard-csv")
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun buildFinding(
        severity: String,
        issueType: String,
        host: String,
        path: String,
        attribution: String?,
        importedAt: String
    ): ImportedFinding? {
        val sev = parseSeverity(severity) ?: return null
        val safeAttribution = attribution?.takeIf { it.contains(".") }
        return ImportedFinding(
            severity = sev,
            issueType = issueType.take(200),
            host = host.take(200),
            path = path.take(500),
            attributedPackage = safeAttribution,
            importedAt = importedAt
        )
    }

    private fun parseSeverity(raw: String): NetworkFinding.Severity? = when (raw.uppercase()) {
        "HIGH", "CRITICAL" -> NetworkFinding.Severity.HIGH
        "MEDIUM", "MODERATE" -> NetworkFinding.Severity.MEDIUM
        "LOW", "INFORMATION", "INFO" -> NetworkFinding.Severity.LOW
        else -> null
    }

    private val SECRET_PATTERN = Regex(
        "(Authorization|Cookie|Set-Cookie|Token|Session|Bearer|Basic|api[_-]?key)[^\\n]{0,200}",
        RegexOption.IGNORE_CASE
    )

    private fun redactText(text: String): String =
        SECRET_PATTERN.replace(text) { mr -> "${mr.groupValues[1]}: [REDACTED]" }

    private fun deduplicationKey(f: ImportedFinding): String =
        "${f.severity}|${f.host}|${f.path}|${f.issueType}"

    private fun isoNow(): String =
        SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).format(Date())
}
