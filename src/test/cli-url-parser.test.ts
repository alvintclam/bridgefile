import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseUrl } from '../cli/url-parser';

test('parseUrl handles SFTP URLs with all parts', () => {
  const p = parseUrl('sftp://alice@host.example.com:2222/var/www');
  assert.equal(p.protocol, 'sftp');
  assert.equal(p.username, 'alice');
  assert.equal(p.host, 'host.example.com');
  assert.equal(p.port, 2222);
  assert.equal(p.path, '/var/www');
});

test('parseUrl defaults SFTP port to 22', () => {
  const p = parseUrl('sftp://user@host/home');
  assert.equal(p.port, 22);
});

test('parseUrl defaults FTP port to 21', () => {
  const p = parseUrl('ftp://user@host/pub');
  assert.equal(p.protocol, 'ftp');
  assert.equal(p.port, 21);
});

test('parseUrl handles SFTP without username', () => {
  const p = parseUrl('sftp://host.example.com/data');
  assert.equal(p.username, undefined);
  assert.equal(p.host, 'host.example.com');
});

test('parseUrl handles SFTP without path (defaults to /)', () => {
  const p = parseUrl('sftp://user@host');
  assert.equal(p.path, '/');
});

test('parseUrl splits S3 bucket and prefix', () => {
  const p = parseUrl('s3://my-bucket/path/to/object');
  assert.equal(p.protocol, 's3');
  assert.equal(p.bucket, 'my-bucket');
  assert.equal(p.prefix, 'path/to/object');
  assert.equal(p.path, '/path/to/object');
});

test('parseUrl handles S3 bucket with no prefix', () => {
  const p = parseUrl('s3://my-bucket');
  assert.equal(p.bucket, 'my-bucket');
  assert.equal(p.prefix, '');
});

test('parseUrl rejects unsupported schemes', () => {
  assert.throws(() => parseUrl('http://example.com'), /Unsupported URL scheme/);
  assert.throws(() => parseUrl('gs://bucket'), /Unsupported URL scheme/);
});

test('parseUrl rejects malformed SFTP URLs', () => {
  assert.throws(() => parseUrl('sftp://'), /Invalid URL/);
});
