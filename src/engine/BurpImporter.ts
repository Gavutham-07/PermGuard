import { ImportedFinding, ImportResult, Severity } from '../types';

export const BurpImporter = {
  MAX_FILE_BYTES: 2 * 1024 * 1024, // 2 MiB

  SECRET_PATTERN: /(Authorization|Cookie|Set-Cookie|Token|Session|Bearer|Basic|api[_-]?key)[^\n]{0,200}/gi,

  redactText(text: string): string {
    return text.replace(this.SECRET_PATTERN, (_match, p1) => `${p1}: [REDACTED]`);
  },

  parseSeverity(raw: string): Severity | null {
    const s = raw.trim().toUpperCase();
    if (s === 'HIGH' || s === 'CRITICAL') return 'HIGH';
    if (s === 'MEDIUM' || s === 'MODERATE') return 'MEDIUM';
    if (s === 'LOW' || s === 'INFORMATION' || s === 'INFO') return 'LOW';
    return null;
  },

  deduplicationKey(f: ImportedFinding): string {
    return `${f.severity}|${f.host}|${f.path}|${f.issueType}`;
  },

  isoNow(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, '');
  },

  buildFinding(
    severityStr: string,
    issueType: string,
    host: string,
    path: string,
    attribution: string | null | undefined,
    importedAt: string
  ): ImportedFinding | null {
    const sev = this.parseSeverity(severityStr);
    if (!sev) return null;

    const trimmedAttr = attribution?.trim();
    const safeAttribution = trimmedAttr && trimmedAttr.includes('.') ? trimmedAttr : null;

    return {
      severity: sev,
      issueType: this.redactText(issueType).slice(0, 200),
      host: host.trim().slice(0, 200),
      path: (path.trim() || '/').slice(0, 500),
      attributedPackage: safeAttribution,
      importedAt,
    };
  },

  parse(
    rawText: string,
    sizeBytes: number,
    existingFindings: ImportedFinding[] = []
  ): ImportResult {
    if (sizeBytes > this.MAX_FILE_BYTES) {
      return {
        findings: [],
        duplicatesSkipped: 0,
        parseErrors: [
          `File too large (${Math.round(sizeBytes / 1024)} KB). Maximum is ${Math.round(this.MAX_FILE_BYTES / 1024)} KB.`,
        ],
        format: 'unknown',
      };
    }

    const trimmed = rawText.trimStart();

    if (trimmed.startsWith('<?xml') || trimmed.startsWith('<issues')) {
      return this.parseBurpXml(trimmed, existingFindings);
    } else if (trimmed.startsWith('# PermGuard Burp Findings') || trimmed.startsWith('# PermGuard Burp Suite Findings')) {
      return this.parseCsv(trimmed, existingFindings);
    } else if (trimmed.toLowerCase().startsWith('severity,host,path')) {
      return this.parseCsv(trimmed, existingFindings);
    }

    return {
      findings: [],
      duplicatesSkipped: 0,
      parseErrors: [
        "Unrecognised file format. Expected a Burp XML export or a PermGuard CSV file starting with '# PermGuard Burp Findings v1'.",
      ],
      format: 'unknown',
    };
  },

  parseBurpXml(content: string, existing: ImportedFinding[]): ImportResult {
    const findings: ImportedFinding[] = [];
    const errors: string[] = [];
    let duplicates = 0;
    const existingKeys = new Set(existing.map((f) => this.deduplicationKey(f)));
    const importedAt = this.isoNow();

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(content, 'application/xml');
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        errors.push(`XML parse error: ${parserError.textContent}`);
        return { findings, duplicatesSkipped: duplicates, parseErrors: errors, format: 'burp-xml' };
      }

      const issueNodes = doc.getElementsByTagName('issue');
      for (let i = 0; i < issueNodes.length; i++) {
        const issue = issueNodes[i];
        const severity = this.getChildText(issue, 'severity');
        const rawName = this.getChildText(issue, 'name');
        const host = this.getChildText(issue, 'host');
        const path = this.getChildText(issue, 'path');
        const attribution = this.getChildText(issue, 'attribution');

        const finding = this.buildFinding(severity, rawName, host, path, attribution, importedAt);
        if (finding) {
          const key = this.deduplicationKey(finding);
          if (existingKeys.has(key)) {
            duplicates++;
          } else {
            existingKeys.add(key);
            findings.push(finding);
          }
        } else {
          errors.push(`Skipped issue with unrecognised severity '${severity}' for host '${host}'`);
        }
      }
    } catch (e: any) {
      errors.push(`XML parse error: ${e?.message ?? e}`);
    }

    return {
      findings,
      duplicatesSkipped: duplicates,
      parseErrors: errors,
      format: 'burp-xml',
    };
  },

  getChildText(element: Element, tagName: string): string {
    const nodes = element.getElementsByTagName(tagName);
    if (nodes.length === 0) return '';
    return nodes[0]?.textContent?.trim() || '';
  },

  parseCsv(content: string, existing: ImportedFinding[]): ImportResult {
    const findings: ImportedFinding[] = [];
    const errors: string[] = [];
    let duplicates = 0;
    const existingKeys = new Set(existing.map((f) => this.deduplicationKey(f)));
    const importedAt = this.isoNow();

    const lines = content.split(/\r?\n/);
    const dataLines = lines.filter((line) => line.trim().length > 0 && !line.trimStart().startsWith('#'));

    if (dataLines.length === 0) {
      return {
        findings: [],
        duplicatesSkipped: 0,
        parseErrors: ['CSV file has no data rows.'],
        format: 'permguard-csv',
      };
    }

    const headerIndex = dataLines.findIndex((line) => line.toLowerCase().includes('severity'));
    if (headerIndex === -1) {
      errors.push('CSV header row not found. Expected: severity,host,path,issue_name,attribution');
    }

    const rowsToParse = headerIndex !== -1 ? dataLines.slice(headerIndex + 1) : dataLines;

    rowsToParse.forEach((line, index) => {
      // Split by comma while respecting quotes if any
      const cols = this.splitCsvRow(line);
      if (cols.length < 4) {
        errors.push(`Row ${index + 2}: too few columns (${cols.length}), skipping.`);
        return;
      }

      const [sev, host, path, issueName, attribution] = cols;
      const finding = this.buildFinding(sev, issueName, host, path, attribution, importedAt);
      if (!finding) {
        errors.push(`Row ${index + 2}: unrecognised severity '${sev}', skipping.`);
        return;
      }

      const key = this.deduplicationKey(finding);
      if (existingKeys.has(key)) {
        duplicates++;
      } else {
        existingKeys.add(key);
        findings.push(finding);
      }
    });

    return {
      findings,
      duplicatesSkipped: duplicates,
      parseErrors: errors,
      format: 'permguard-csv',
    };
  },

  splitCsvRow(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  },
};
