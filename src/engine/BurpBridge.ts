import { BurpEventPayload, ImportedFinding, Severity } from '../types';
import { BurpImporter } from './BurpImporter';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 60; // 60 events per minute
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export const BurpBridge = {
  /**
   * Validates pairing token.
   */
  authenticate(authHeader: string | undefined, expectedToken: string): boolean {
    if (!authHeader || !expectedToken) return false;
    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      return false;
    }
    return parts[1] === expectedToken;
  },

  /**
   * Enforces rate limiting per client IP or identifier.
   */
  checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(clientId);

    if (!entry || now > entry.resetAt) {
      rateLimitMap.set(clientId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return true;
    }

    if (entry.count >= RATE_LIMIT_MAX) {
      return false;
    }

    entry.count++;
    return true;
  },

  /**
   * Validates and sanitizes a Burp proxy event payload.
   */
  processIncomingEvent(
    raw: any,
    authHeader: string | undefined,
    expectedToken: string,
    existingFindings: ImportedFinding[],
    clientId: string = 'local'
  ): {
    statusCode: number;
    response: {
      success: boolean;
      message: string;
      finding?: ImportedFinding;
      duplicate?: boolean;
    };
  } {
    // 1. Authentication
    if (!this.authenticate(authHeader, expectedToken)) {
      return {
        statusCode: 401,
        response: {
          success: false,
          message: 'Unauthorized: Invalid or missing Bearer pairing token.',
        },
      };
    }

    // 2. Rate Limiting
    if (!this.checkRateLimit(clientId)) {
      return {
        statusCode: 429,
        response: {
          success: false,
          message: 'Too Many Requests: Rate limit exceeded (max 60 events/min).',
        },
      };
    }

    // 3. Payload validation
    if (!raw || typeof raw !== 'object') {
      return {
        statusCode: 400,
        response: { success: false, message: 'Invalid payload: JSON object required.' },
      };
    }

    const { issueType, severity, host, path, attributedPackage, confidence, synthetic } = raw;

    if (!issueType || typeof issueType !== 'string' || issueType.trim().length === 0) {
      return {
        statusCode: 400,
        response: { success: false, message: 'Field "issueType" is required and must be non-empty.' },
      };
    }

    if (!severity || typeof severity !== 'string') {
      return {
        statusCode: 400,
        response: { success: false, message: 'Field "severity" is required (HIGH, MEDIUM, LOW).' },
      };
    }

    const parsedSev = BurpImporter.parseSeverity(severity);
    if (!parsedSev) {
      return {
        statusCode: 400,
        response: { success: false, message: `Invalid severity "${severity}". Allowed: HIGH, MEDIUM, LOW.` },
      };
    }

    if (!host || typeof host !== 'string' || host.trim().length === 0) {
      return {
        statusCode: 400,
        response: { success: false, message: 'Field "host" is required.' },
      };
    }

    // Size and string length constraints
    if (issueType.length > 200 || host.length > 200 || (path && path.length > 500)) {
      return {
        statusCode: 400,
        response: { success: false, message: 'Payload field length exceeds safety limit.' },
      };
    }

    // 4. Secret redaction
    const safeIssueType = BurpImporter.redactText(issueType).trim().slice(0, 200);
    const safeHost = BurpImporter.redactText(host).trim().slice(0, 200);
    const safePath = BurpImporter.redactText(path || '/').trim().slice(0, 500);

    // 5. Attribution validation (must be valid dotted package name, never inferred blindly)
    let validatedAttribution: string | null = null;
    if (attributedPackage && typeof attributedPackage === 'string') {
      const trimmed = attributedPackage.trim();
      if (trimmed.includes('.') && /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/.test(trimmed)) {
        validatedAttribution = trimmed;
      }
    }

    const importedAt = BurpImporter.isoNow();

    const finding: ImportedFinding = {
      severity: parsedSev,
      issueType: safeIssueType,
      host: safeHost,
      path: safePath,
      attributedPackage: validatedAttribution,
      importedAt,
      confidence: confidence || (validatedAttribution ? 'HIGH' : 'UNKNOWN'),
      synthetic: Boolean(synthetic),
    };

    // 6. Deduplication check
    const dedupKey = BurpImporter.deduplicationKey(finding);
    const isDuplicate = existingFindings.some((f) => BurpImporter.deduplicationKey(f) === dedupKey);

    if (isDuplicate) {
      return {
        statusCode: 200,
        response: {
          success: true,
          message: 'Event is a duplicate of an existing finding; recorded without inflating score.',
          duplicate: true,
          finding,
        },
      };
    }

    return {
      statusCode: 201,
      response: {
        success: true,
        message: 'Finding accepted, validated, and recorded.',
        duplicate: false,
        finding,
      },
    };
  },
};
