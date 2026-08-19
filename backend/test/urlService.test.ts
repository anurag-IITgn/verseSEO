import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateAndNormalizeUrl } from '../src/services/urlService.js';
import { AppError } from '../src/utils/errors.js';

test('normalizes a bare URL and extracts the domain', () => {
  const result = validateAndNormalizeUrl('https://Example.com');
  assert.equal(result.websiteUrl, 'https://example.com');
  assert.equal(result.domain, 'example.com');
});

test('strips a trailing slash from the path', () => {
  const result = validateAndNormalizeUrl('https://example.com/about/');
  assert.equal(result.websiteUrl, 'https://example.com/about');
});

test('removes a trailing slash from the root URL', () => {
  const result = validateAndNormalizeUrl('https://example.com/');
  assert.equal(result.websiteUrl, 'https://example.com');
});

test('extracts the domain without www prefix', () => {
  const result = validateAndNormalizeUrl('https://www.example.com');
  assert.equal(result.websiteUrl, 'https://www.example.com');
  assert.equal(result.domain, 'example.com');
});

test('accepts http and strips default ports', () => {
  const result = validateAndNormalizeUrl('http://example.com:80');
  assert.equal(result.websiteUrl, 'http://example.com');
  assert.equal(result.domain, 'example.com');
});

test('drops URL fragments', () => {
  const result = validateAndNormalizeUrl('https://example.com/path#section');
  assert.equal(result.websiteUrl, 'https://example.com/path');
});

test('preserves a non-default port', () => {
  const result = validateAndNormalizeUrl('https://example.com:8080');
  assert.equal(result.websiteUrl, 'https://example.com:8080');
});

test('rejects an empty string', () => {
  assert.throws(() => validateAndNormalizeUrl(''), AppError);
});

test('rejects a malformed URL', () => {
  assert.throws(() => validateAndNormalizeUrl('not-a-url'), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal((error as AppError).statusCode, 400);
    return true;
  });
});

test('rejects a missing protocol', () => {
  assert.throws(() => validateAndNormalizeUrl('example.com'), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal((error as AppError).statusCode, 400);
    return true;
  });
});

test('rejects a non-http(s) protocol', () => {
  assert.throws(() => validateAndNormalizeUrl('ftp://example.com'), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal((error as AppError).statusCode, 400);
    return true;
  });
});

test('rejects embedded credentials', () => {
  assert.throws(() => validateAndNormalizeUrl('https://user:pass@example.com'), (error: unknown) => {
    assert.ok(error instanceof AppError);
    assert.equal((error as AppError).statusCode, 400);
    return true;
  });
});