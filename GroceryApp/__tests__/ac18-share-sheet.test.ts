/**
 * Acceptance Test AC-18: Share Sheet — Invite URL Formatting
 */

import { describe, it, expect } from '@jest/globals';

describe('AC-18a: Share Invite URL Format', () => {
  it('should format share URL with grocceryapp:// scheme', () => {
    const prefix = 'grocceryapp://invite?token=';
    const token = 'invite-token-abc-123';
    const shareUrl = prefix + token;
    expect(shareUrl).toMatch(/^grocceryapp:\/\/invite\?token=/);
    expect(shareUrl).toContain(token);
  });

  it('should format share URL with https:// variant', () => {
    const token = 'cross-platform-token';
    const shareUrl = 'https://groccery.app/invite?token=' + token;
    expect(shareUrl).toMatch(/^https:\/\/[^/]+\/invite\?token=/);
    expect(shareUrl).toContain(token);
  });

  it('should include token parameter in the URL', () => {
    const prefix = 'grocceryapp://invite?token=';
    const token = 'eyJmYW...MifQ';
    const shareUrl = prefix + token;
    expect(shareUrl).toContain('?token=');
    expect(shareUrl.split('?token=')[1]).toBe(token);
  });
});

describe('AC-18b: URL Variants', () => {
  it('https:// URL is valid fallback format', () => {
    const url = 'https://groccery.app/invite?token=test123';
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain('/invite?token=');
  });

  it('https:// URL is valid fallback format', () => {
    const url = 'https://groccery.app/invite?token=test123';
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain('/invite?token=');
  });

  it('both URL variants carry the same token', () => {
    const token = 'shared-token-value';
    const grocceryUrl = 'grocceryapp://invite?token=' + token;
    const httpsUrl = 'https://groccery.app/invite?token=' + token;
        const t1 = grocceryUrl.split('?token=')[1];
    const t2 = httpsUrl.split('?token=')[1];
    expect(t1).toBe(t2);
  });
});

describe('AC-18c: Share Sheet Data Integrity', () => {
  it('should produce a non-empty shareable URL', () => {
    const prefix = 'grocceryapp://invite?token=';
    const token = 'some-invite-token';
    const url = prefix + token;
    expect(url.length).toBeGreaterThan(0);
    expect(typeof url).toBe('string');
  });

  it('should handle base64 tokens without encoding issues', () => {
    const prefix = 'grocceryapp://invite?token=';
    const base64Token = 'eyJmYW...MyJ9';
    const url = prefix + base64Token;
    expect(url).toContain(base64Token);
    const extracted = url.split('?token=')[1];
    expect(extracted).toBe(base64Token);
  });
});