package com.example.permguard

import org.junit.Assert.*
import org.junit.Test

/**
 * Unit tests for the BurpImporter: CSV parsing, XML detection, duplicate
 * skipping, secret redaction, unattributed findings, and malformed inputs.
 *
 * No Android context needed — runs on JVM only.
 */
class BurpImporterTest {

    // ── CSV — happy path ──────────────────────────────────────────────────────

    @Test
    fun `valid CSV with attribution parses correctly`() {
        val csv = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            HIGH,example.com,/api/login,Missing HSTS,com.example.testapp
            MEDIUM,example.com,/,Clickjacking,
        """.trimIndent()
        val result = parse(csv)
        assertEquals("permguard-csv", result.format)
        assertEquals(2, result.findings.size)
        assertEquals(0, result.duplicatesSkipped)
        assertTrue(result.parseErrors.isEmpty())

        val first = result.findings[0]
        assertEquals(NetworkFinding.Severity.HIGH, first.severity)
        assertEquals("example.com", first.host)
        assertEquals("/api/login", first.path)
        assertEquals("com.example.testapp", first.attributedPackage)

        val second = result.findings[1]
        assertEquals(NetworkFinding.Severity.MEDIUM, second.severity)
        assertNull(second.attributedPackage) // blank attribution → null
    }

    @Test
    fun `CSV with CRITICAL severity maps to HIGH`() {
        val csv = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            CRITICAL,evil.com,/,SQL Injection,com.example.app
        """.trimIndent()
        val result = parse(csv)
        assertEquals(NetworkFinding.Severity.HIGH, result.findings[0].severity)
    }

    @Test
    fun `CSV with INFO severity maps to LOW`() {
        val csv = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            INFO,example.com,/,Verbose headers,
        """.trimIndent()
        val result = parse(csv)
        assertEquals(NetworkFinding.Severity.LOW, result.findings[0].severity)
    }

    @Test
    fun `unrecognised severity causes a row-level error and skips the row`() {
        val csv = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            UNKNOWN,x.com,/,Foo,
            HIGH,x.com,/bar,Bar,
        """.trimIndent()
        val result = parse(csv)
        assertEquals(1, result.findings.size) // only HIGH row kept
        assertEquals(1, result.parseErrors.size)
    }

    @Test
    fun `row with too few columns produces a parse error`() {
        val csv = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            HIGH,example.com
        """.trimIndent()
        val result = parse(csv)
        assertEquals(0, result.findings.size)
        assertTrue(result.parseErrors.isNotEmpty())
    }

    @Test
    fun `empty CSV body produces no findings and a descriptive error`() {
        val csv = "# PermGuard Burp Findings v1\n"
        val result = parse(csv)
        assertEquals(0, result.findings.size)
        assertTrue(result.parseErrors.isNotEmpty())
    }

    // ── Deduplication ─────────────────────────────────────────────────────────

    @Test
    fun `duplicate finding is skipped and counted`() {
        val csv = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            HIGH,example.com,/api,Missing HSTS,com.example.app
        """.trimIndent()
        // First import
        val first = parse(csv)
        assertEquals(1, first.findings.size)
        // Second import with same content as existing
        val second = parse(csv, existing = first.findings)
        assertEquals(0, second.findings.size)
        assertEquals(1, second.duplicatesSkipped)
    }

    @Test
    fun `same host and path but different severity is not a duplicate`() {
        val csv1 = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            HIGH,example.com,/api,Missing HSTS,com.example.app
        """.trimIndent()
        val csv2 = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            LOW,example.com,/api,Missing HSTS,com.example.app
        """.trimIndent()
        val first = parse(csv1)
        val second = parse(csv2, existing = first.findings)
        assertEquals(1, second.findings.size) // different severity → not a dup
        assertEquals(0, second.duplicatesSkipped)
    }

    // ── Secret redaction ──────────────────────────────────────────────────────

    @Test
    fun `authorization token is redacted from issue name`() {
        val csv = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            MEDIUM,example.com,/,Authorization: Bearer eyJhbGciOi...,
        """.trimIndent()
        val result = parse(csv)
        assertEquals(1, result.findings.size)
        val issueName = result.findings[0].issueType
        assertFalse("Secret should not appear verbatim", issueName.contains("eyJhbGciOi"))
        assertTrue("REDACTED should appear", issueName.contains("[REDACTED]"))
    }

    @Test
    fun `cookie header is redacted`() {
        val csv = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            LOW,example.com,/,Cookie: session=abc123,
        """.trimIndent()
        val result = parse(csv)
        val name = result.findings[0].issueType
        assertFalse(name.contains("abc123"))
        assertTrue(name.contains("[REDACTED]"))
    }

    // ── File size limit ───────────────────────────────────────────────────────

    @Test
    fun `file larger than limit is rejected`() {
        val content = "# PermGuard Burp Findings v1\n"
        val result = BurpImporter.parse(
            stream = content.byteInputStream(),
            sizeBytes = BurpImporter.MAX_FILE_BYTES + 1
        )
        assertEquals(0, result.findings.size)
        assertTrue(result.parseErrors.any { it.contains("too large") || it.contains("large") })
    }

    // ── Unknown format ────────────────────────────────────────────────────────

    @Test
    fun `unrecognised format returns error and no findings`() {
        val content = "this is not a valid format"
        val result = parse(content)
        assertEquals("unknown", result.format)
        assertEquals(0, result.findings.size)
        assertTrue(result.parseErrors.isNotEmpty())
    }

    // ── XML parsing ───────────────────────────────────────────────────────────

    @Test
    fun `valid Burp XML parses a finding`() {
        val xml = """<?xml version="1.0" encoding="utf-8"?>
<issues burpVersion="2023.1" exportTime="Mon Jan 01 00:00:00 UTC 2024">
  <issue>
    <serialNumber>1</serialNumber>
    <type>5244416</type>
    <name>Missing HTTP Strict Transport Security</name>
    <host ip="93.184.216.34">https://example.com</host>
    <path>/</path>
    <severity>High</severity>
  </issue>
</issues>"""
        val result = parse(xml)
        assertEquals("burp-xml", result.format)
        assertEquals(1, result.findings.size)
        assertEquals(NetworkFinding.Severity.HIGH, result.findings[0].severity)
        assertEquals("https://example.com", result.findings[0].host)
        assertNull(result.findings[0].attributedPackage) // no attribution in XML → unattributed
    }

    @Test
    fun `malformed XML produces a parse error and no findings`() {
        val xml = "<?xml version='1.0'?><issues><issue><severity>High</BADCLOSE>"
        val result = parse(xml)
        assertTrue(result.parseErrors.isNotEmpty())
    }

    @Test
    fun `XML with attribution element is honoured`() {
        val xml = """<?xml version="1.0"?>
<issues>
  <issue>
    <name>Clickjacking</name>
    <host>app.example.com</host>
    <path>/dashboard</path>
    <severity>Medium</severity>
    <attribution>com.example.myapp</attribution>
  </issue>
</issues>"""
        val result = parse(xml)
        assertEquals(1, result.findings.size)
        assertEquals("com.example.myapp", result.findings[0].attributedPackage)
    }

    // ── Attribution validation ────────────────────────────────────────────────

    @Test
    fun `attribution without a dot is rejected as invalid package name`() {
        val csv = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            HIGH,host.com,/,Issue,notapackage
        """.trimIndent()
        val result = parse(csv)
        // "notapackage" has no dot → not a valid package name → set to null
        assertNull(result.findings.firstOrNull()?.attributedPackage)
    }

    @Test
    fun `valid dotted attribution is preserved`() {
        val csv = """
            # PermGuard Burp Findings v1
            severity,host,path,issue_name,attribution
            HIGH,host.com,/,Issue,com.example.valid
        """.trimIndent()
        val result = parse(csv)
        assertEquals("com.example.valid", result.findings[0].attributedPackage)
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    private fun parse(
        content: String,
        sizeBytes: Long = content.length.toLong(),
        existing: List<BurpImporter.ImportedFinding> = emptyList()
    ): BurpImporter.ImportResult {
        return BurpImporter.parse(content.byteInputStream(), sizeBytes, existing)
    }
}
