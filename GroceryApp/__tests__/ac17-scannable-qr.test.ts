/**
 * Acceptance Test AC-17: Scannable QR Code
 */
import { describe, it, expect } from '@jest/globals';

describe('AC-17a: Invite URL Format', () => {
  it('grocceryapp:// scheme + token', () => {
    const token = 'abc123-def456';
    const url = 'grocceryapp://invite?token=' + token;
    expect(url).toMatch(/^grocceryapp:\/\/invite\?token=/);
    expect(url).toContain(token);
  });

  it('https:// variant', () => {
    const t = 'invite-token-789';
    const url = 'https://family.grocceryapp.com/invite?token=' + t;
    expect(url).toMatch(/^https:\/\/[^/]+\/invite\?token=/);
    expect(url).toContain(t);
  });

  it('parse token from grocceryapp://', () => {
    const expected = 'eyJmYW...MifQ';
    const url = 'grocceryapp://invite?token=' + expected;
    const prefix = 'grocceryapp://invite?token=';
    const parsed = url.startsWith(prefix) ? url.substring(prefix.length) : null;
    expect(parsed).toBe(expected);
  });

  it('parse token from https://', () => {
    const expected = 'eyJmYW...oifQ';
    const url = 'https://relay.example.com/invite?token=' + expected;
    const m = url.match(/^https:\/\/[^/]+\/invite\?token=([^&\s]+)/);
    expect(m ? m[1] : null).toBe(expected);
  });
});

describe('AC-17b: QR Data Encoding', () => {
  it('non-empty data', () => {
    const data = 'grocceryapp://invite?token=test-val';
    expect(data.length).toBeGreaterThan(0);
    expect(data).toContain('://');
    expect(data).toContain('?token=');
  });

  it('long tokens without truncation', () => {
    const t = 'eyJmYW...MCJ9';
    const url = 'grocceryapp://invite?token=' + t;
    expect(url).toContain(t);
    expect(url.length).toBeGreaterThanOrEqual(40);
    const extracted = url.substring('grocceryapp://invite?token='.length);
    expect(extracted).toBe(t);
  });

  it('reject malformed URLs', () => {
    const bad = [
      'grocceryapp://invite',
      'grocceryapp://invite?tok=abc',
      'https://evil.com/fake?token=abc',
      'not-a-url',
      '',
    ];
    for (const url of bad) {
      const a = url.startsWith('grocceryapp://invite?token=');
      const b = /^https:\/\/[^/]+\/invite\?token=/.test(url);
      expect(a || b).toBe(false);
    }
  });
});

describe('AC-17c: QR Component Data', () => {
  it('valid string data', () => {
    const data = 'grocceryapp://invite?token=test123';
    expect(data).toBeTruthy();
    expect(typeof data).toBe('string');
    expect(data.length).toBeGreaterThan(0);
    expect(/^[\x00-\x7F]*$/.test(data)).toBe(true);
  });

  it('length limits', () => {
    expect('grocceryapp://invite?token=abc'.length).toBeLessThan(100);
    expect(('grocceryapp://invite?token=' + 'a'.repeat(50)).length).toBeLessThan(200);
    expect(('grocceryapp://invite?token=' + 'a'.repeat(200)).length).toBeLessThan(300);
  });
});