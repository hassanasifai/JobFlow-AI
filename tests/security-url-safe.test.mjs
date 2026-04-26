import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateHost, assertPublicUrl, SsrfError } from '../lib/url-safe.mjs';

test('isPrivateHost flags loopback IPv4', async () => {
  assert.equal(await isPrivateHost('127.0.0.1'), true);
  assert.equal(await isPrivateHost('127.255.255.255'), true);
});

test('isPrivateHost flags RFC 1918 ranges', async () => {
  assert.equal(await isPrivateHost('10.0.0.1'), true);
  assert.equal(await isPrivateHost('10.255.255.254'), true);
  assert.equal(await isPrivateHost('172.16.0.1'), true);
  assert.equal(await isPrivateHost('172.31.255.255'), true);
  assert.equal(await isPrivateHost('192.168.1.1'), true);
});

test('isPrivateHost flags AWS/GCE metadata + link-local', async () => {
  assert.equal(await isPrivateHost('169.254.169.254'), true);
  assert.equal(await isPrivateHost('169.254.0.1'), true);
});

test('isPrivateHost flags IPv6 loopback and link-local', async () => {
  assert.equal(await isPrivateHost('::1'), true);
  assert.equal(await isPrivateHost('fe80::1'), true);
  assert.equal(await isPrivateHost('fc00::1'), true);
});

test('isPrivateHost flags localhost variants', async () => {
  assert.equal(await isPrivateHost('localhost'), true);
  assert.equal(await isPrivateHost('foo.localhost'), true);
  assert.equal(await isPrivateHost('bar.local'), true);
});

test('isPrivateHost does NOT flag 172.15 or 172.32 (just outside range)', async () => {
  // Note: requires DNS, but 172.15.x.x is outside the private block
  // and unlikely to resolve. We check the regex boundary directly.
  assert.equal(await isPrivateHost('172.15.0.1'), false);
  assert.equal(await isPrivateHost('172.32.0.1'), false);
});

test('assertPublicUrl rejects private hosts', async () => {
  await assert.rejects(
    () => assertPublicUrl('http://127.0.0.1/'),
    (err) => err instanceof SsrfError && /private|loopback/i.test(err.message),
  );
  await assert.rejects(
    () => assertPublicUrl('http://10.0.0.1/api'),
    SsrfError,
  );
  await assert.rejects(
    () => assertPublicUrl('http://169.254.169.254/latest/meta-data/'),
    SsrfError,
  );
});

test('assertPublicUrl rejects file:// and other non-http schemes', async () => {
  await assert.rejects(() => assertPublicUrl('file:///etc/passwd'), SsrfError);
  await assert.rejects(() => assertPublicUrl('gopher://example.com/'), SsrfError);
  await assert.rejects(() => assertPublicUrl('ftp://example.com/'), SsrfError);
});

test('assertPublicUrl rejects URLs with credentials', async () => {
  await assert.rejects(
    () => assertPublicUrl('http://user:pass@example.com/'),
    (err) => err instanceof SsrfError && /credentials/i.test(err.message),
  );
});

test('assertPublicUrl rejects malformed URLs', async () => {
  await assert.rejects(() => assertPublicUrl('not a url'), SsrfError);
  await assert.rejects(() => assertPublicUrl(''), SsrfError);
});
