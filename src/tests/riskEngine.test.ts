import { describe, it, expect } from 'vitest';
import { RiskEngine } from '../engine/RiskEngine';
import { ChangeDetector } from '../engine/ChangeDetector';
import { BurpBridge } from '../engine/BurpBridge';
import { BurpImporter } from '../engine/BurpImporter';
import { PermissionScanner } from '../engine/PermissionScanner';
import { DatabaseHelper } from '../storage/db';
import { AppRisk } from '../types';

describe('A. Unified Risk Classification & Boundary Tests', () => {
  it('correctly classifies score 0 as LOW', () => {
    expect(RiskEngine.classifyRiskScore(0)).toBe('LOW');
  });

  it('correctly classifies score 29 as LOW (upper Low boundary)', () => {
    expect(RiskEngine.classifyRiskScore(29)).toBe('LOW');
  });

  it('correctly classifies score 30 as MEDIUM (lower Medium boundary)', () => {
    expect(RiskEngine.classifyRiskScore(30)).toBe('MEDIUM');
  });

  it('correctly classifies regression score 37 as MEDIUM (previously mislabeled HIGH)', () => {
    expect(RiskEngine.classifyRiskScore(37)).toBe('MEDIUM');
  });

  it('correctly classifies score 59 as MEDIUM (upper Medium boundary)', () => {
    expect(RiskEngine.classifyRiskScore(59)).toBe('MEDIUM');
  });

  it('correctly classifies score 60 as HIGH (lower High boundary)', () => {
    expect(RiskEngine.classifyRiskScore(60)).toBe('HIGH');
  });

  it('correctly classifies regression score 62 as HIGH (previously mislabeled LOW)', () => {
    expect(RiskEngine.classifyRiskScore(62)).toBe('HIGH');
  });

  it('correctly classifies score 100 as HIGH', () => {
    expect(RiskEngine.classifyRiskScore(100)).toBe('HIGH');
  });

  it('clamps out-of-range negative scores to LOW (0)', () => {
    expect(RiskEngine.classifyRiskScore(-15)).toBe('LOW');
  });

  it('clamps out-of-range scores > 100 to HIGH (100)', () => {
    expect(RiskEngine.classifyRiskScore(145)).toBe('HIGH');
  });

  it('correctly classifies permission-only score separately (0-40 scale)', () => {
    expect(RiskEngine.classifyPermissionScore(0)).toBe('LOW');
    expect(RiskEngine.classifyPermissionScore(15)).toBe('LOW');
    expect(RiskEngine.classifyPermissionScore(16)).toBe('MEDIUM');
    expect(RiskEngine.classifyPermissionScore(31)).toBe('MEDIUM');
    expect(RiskEngine.classifyPermissionScore(32)).toBe('HIGH');
    expect(RiskEngine.classifyPermissionScore(40)).toBe('HIGH');
  });

  it('preserves legacyCalculateRisk for audit without overwriting combinedRiskLevel', () => {
    // 2 permissions & 2 min foreground was legacy HIGH
    const legacy = RiskEngine.legacyCalculateRisk(2, 2);
    expect(legacy).toBe('HIGH');

    // But combined score is 16 + 15 = 31, which is MEDIUM!
    const combined = RiskEngine.computeCombinedRisk(
      { permissions: ['CAMERA', 'RECORD_AUDIO'], foregroundMinutes: 2 },
      true,
      null,
      []
    );
    expect(combined.totalScore).toBe(31);
    expect(combined.level).toBe('MEDIUM'); // NOT HIGH!
  });
});

describe('B. Change Detection & Meaningful Notifications', () => {
  const baseApp: AppRisk = {
    appName: 'Test App',
    packageName: 'com.example.test',
    permissions: ['CAMERA'],
    foregroundMinutes: 20,
    permissionScore: 8,
    permissionRiskLevel: 'LOW',
    combinedScore: 19,
    combinedRiskLevel: 'LOW',
    riskLevel: 'LOW',
    isSystemApp: false,
    lastUsedTime: 'Yesterday',
    scoreExplanations: [],
    networkFindingsCount: 0,
  };

  it('first scan establishes baseline without spurious alerts', () => {
    const events = ChangeDetector.detectChanges([baseApp], null);
    expect(events.length).toBe(0);
  });

  it('does not alert on repeated identical scans', () => {
    const events = ChangeDetector.detectChanges([baseApp], [baseApp]);
    expect(events.length).toBe(0);
  });

  it('a 4-point score delta alone creates NO score-change alert', () => {
    const modified: AppRisk = {
      ...baseApp,
      combinedScore: 23, // 19 -> 23 = +4 pts, both are LOW
      combinedRiskLevel: 'LOW',
      riskLevel: 'LOW',
    };
    const events = ChangeDetector.detectChanges([modified], [baseApp]);
    expect(events.filter((e) => e.type === 'SCORE_DELTA').length).toBe(0);
  });

  it('a 5-point score delta creates an alert', () => {
    const modified: AppRisk = {
      ...baseApp,
      combinedScore: 24, // 19 -> 24 = +5 pts, both are LOW
      combinedRiskLevel: 'LOW',
      riskLevel: 'LOW',
    };
    const events = ChangeDetector.detectChanges([modified], [baseApp]);
    const scoreEvents = events.filter((e) => e.type === 'SCORE_DELTA');
    expect(scoreEvents.length).toBe(1);
    expect(scoreEvents[0].oldScore).toBe(19);
    expect(scoreEvents[0].newScore).toBe(24);
  });

  it('any category transition creates an alert even with small score delta', () => {
    const prev: AppRisk = { ...baseApp, combinedScore: 29, combinedRiskLevel: 'LOW' };
    const curr: AppRisk = { ...baseApp, combinedScore: 31, combinedRiskLevel: 'MEDIUM' }; // +2 pts, but LOW -> MEDIUM
    const events = ChangeDetector.detectChanges([curr], [prev]);
    const catEvents = events.filter((e) => e.type === 'CATEGORY_TRANSITION');
    expect(catEvents.length).toBe(1);
    expect(catEvents[0].oldCategory).toBe('LOW');
    expect(catEvents[0].newCategory).toBe('MEDIUM');
  });

  it('permission set changes trigger a permission alert', () => {
    const modified: AppRisk = {
      ...baseApp,
      permissions: ['CAMERA', 'RECORD_AUDIO'],
    };
    const events = ChangeDetector.detectChanges([modified], [baseApp]);
    const permEvents = events.filter((e) => e.type === 'PERMISSION_CHANGED');
    expect(permEvents.length).toBe(1);
    expect(permEvents[0].description).toContain('Granted: RECORD_AUDIO');
  });

  it('newly attributed vulnerability findings trigger an alert', () => {
    const modified: AppRisk = {
      ...baseApp,
      networkFindingsCount: 2,
    };
    const events = ChangeDetector.detectChanges([modified], [baseApp]);
    const findingEvents = events.filter((e) => e.type === 'NEW_FINDING');
    expect(findingEvents.length).toBe(1);
  });
});

describe('C. Authenticated Burp Bridge & Validation', () => {
  const token = 'pg_sec_test_valid_token_12345';

  it('rejects unauthenticated requests with 401', () => {
    const res = BurpBridge.processIncomingEvent(
      { issueType: 'Test', severity: 'HIGH', host: 'example.com' },
      undefined,
      token,
      []
    );
    expect(res.statusCode).toBe(401);
  });

  it('rejects malformed payloads with 400', () => {
    const res = BurpBridge.processIncomingEvent(
      { issueType: '', severity: 'HIGH', host: 'example.com' },
      `Bearer ${token}`,
      token,
      []
    );
    expect(res.statusCode).toBe(400);
  });

  it('accepts valid findings and redacts secrets', () => {
    const res = BurpBridge.processIncomingEvent(
      {
        issueType: 'Cleartext Authorization Leak',
        severity: 'HIGH',
        host: 'api.example.com',
        path: '/v1/login?token=secret_12345&password=mypassword',
        attributedPackage: 'com.example.app',
      },
      `Bearer ${token}`,
      token,
      []
    );
    expect(res.statusCode).toBe(201);
    expect(res.response.finding?.severity).toBe('HIGH');
    expect(res.response.finding?.path).toContain('[REDACTED]');
    expect(res.response.finding?.attributedPackage).toBe('com.example.app');
  });

  it('deduplicates identical events and returns duplicate flag without error', () => {
    const existing = [
      {
        severity: 'HIGH' as const,
        issueType: 'Cleartext Leak',
        host: 'api.example.com',
        path: '/v1/login',
        attributedPackage: 'com.example.app',
        importedAt: '2026-10-19T10:00:00',
      },
    ];

    const res = BurpBridge.processIncomingEvent(
      {
        issueType: 'Cleartext Leak',
        severity: 'HIGH',
        host: 'api.example.com',
        path: '/v1/login',
        attributedPackage: 'com.example.app',
      },
      `Bearer ${token}`,
      token,
      existing
    );

    expect(res.statusCode).toBe(200);
    expect(res.response.duplicate).toBe(true);
  });

  it('rejects invalid package attribution names without dot', () => {
    const res = BurpBridge.processIncomingEvent(
      {
        issueType: 'Test',
        severity: 'LOW',
        host: 'example.com',
        path: '/home',
        attributedPackage: 'invalidpackagename',
      },
      `Bearer ${token}`,
      token,
      []
    );
    expect(res.statusCode).toBe(201);
    // Invalid attribution is cleared to null
    expect(res.response.finding?.attributedPackage).toBeNull();
  });
});

describe('D. Incremental Differential Scanning (5s Monitor)', () => {
  it('detects no changed apps when data is identical', async () => {
    // Perform initial scan to populate database
    await PermissionScanner.performScan('Baseline test scan');
    const { results } = DatabaseHelper.loadLastScan();
    const { changedApps } = PermissionScanner.performIncrementalScan(results);
    expect(changedApps.length).toBe(0);
  });

  it('isolates and updates only the modified app when one app changes', () => {
    const apps = DatabaseHelper.getInstalledApps();
    const target = apps[0];
    const modifiedApps = apps.map((a, i) =>
      i === 0 ? { ...a, foregroundMinutes: a.foregroundMinutes + 10 } : a
    );
    DatabaseHelper.saveInstalledApps(modifiedApps);

    const { results } = DatabaseHelper.loadLastScan();
    const { changedApps, updatedList } = PermissionScanner.performIncrementalScan(results);

    expect(changedApps.length).toBe(1);
    expect(changedApps[0].app.packageName).toBe(target.packageName);
    expect(changedApps[0].app.lastChangedAt).toBeDefined();

    // Restore original apps
    DatabaseHelper.saveInstalledApps(apps);
  });
});
