/**
 * Acceptance Test AC-16: Threat Model Document — Sections Verification
 *
 * Tests that:
 * - docs/threat-model.md exists
 * - The file contains required sections: Assets, Adversary Model,
 *   Trust Assumptions, Boundaries, Mitigations, Known Gaps
 *
 * Run: npx jest __tests__/ac16-threat-model.test.ts
 */

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const THREAT_MODEL_PATH = path.resolve(__dirname, '../docs/threat-model.md');

describe('AC-16a: docs/threat-model.md Exists', () => {
  it('threat-model.md file exists in docs/', () => {
    const exists = fs.existsSync(THREAT_MODEL_PATH);
    expect(exists).toBe(true);
  });

  it('threat-model.md is a non-empty file', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
  });
});

describe('AC-16b: Required Sections', () => {
  it('contains Assets Protected section', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    expect(content).toContain('## Assets Protected');
  });

  it('contains Adversary Model section', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    expect(content).toContain('## Adversary Model');
  });

  it('contains Trust Assumptions section', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    expect(content).toContain('## Trust Assumptions');
  });

  it('contains Boundaries (Out of Scope) section', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    expect(content).toContain('## Boundaries');
  });

  it('contains Mitigations Summary section', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    expect(content).toContain('## Mitigations Summary');
  });

  it('contains Known Gaps section', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    expect(content).toContain('## Known Gaps');
  });
});

describe('AC-16c: Section Content Verification', () => {
  it('Assets Protected lists at least 4 asset types', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    const assetLines = content
      .split('\n')
      .filter((line) => line.startsWith('- ') && line.includes('list content') || line.includes('Price query') || line.includes('Family membership') || line.includes('Device identity'));
    expect(assetLines.length).toBeGreaterThanOrEqual(4);
  });

  it('Adversary Model lists at least 5 adversary types', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    const adversaryCount = (content.match(/### \d+\./g) || []).length;
    expect(adversaryCount).toBeGreaterThanOrEqual(5);
  });

  it('Mitigations Summary includes opt-in pricing mention', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    expect(content).toContain('Opt-in pricing');
    expect(content).toContain('No analytics');
    // "Content-blind relay", not the former "Zero-knowledge relay". The relay
    // cannot read list content, but it does see and persist routing metadata
    // (familyId, listId, deviceId, timing, size), so "zero-knowledge" was an
    // overclaim in a document whose job is to be honest about exactly this.
    // Pinning the accurate phrase keeps the doc from drifting back.
    expect(content).toContain('Content-blind relay');
    expect(content).not.toContain('Zero-knowledge relay');
  });

  it('Known Gaps includes metadata leakage', () => {
    const content = fs.readFileSync(THREAT_MODEL_PATH, 'utf-8');
    expect(content).toContain('Metadata leakage');
  });
});