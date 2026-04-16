import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  exportToJSON,
  importFromJSON,
  importFromFileZilla,
  importFromWinSCP,
  importAuto,
  type ImportedProfile,
} from '../renderer/lib/profile-io';

test('exportToJSON produces a versioned bundle', () => {
  const profiles: ImportedProfile[] = [
    { name: 'Test', type: 'SFTP', host: 'example.com', port: 22, username: 'user' },
  ];
  const json = exportToJSON(profiles);
  const parsed = JSON.parse(json);
  assert.equal(parsed.version, 1);
  assert.ok(Array.isArray(parsed.profiles));
  assert.equal(parsed.profiles.length, 1);
  assert.equal(parsed.profiles[0].name, 'Test');
});

test('importFromJSON round-trips BridgeFile bundles', () => {
  const profiles: ImportedProfile[] = [
    { name: 'Prod', type: 'S3', bucket: 'my-bucket', region: 'us-east-1' },
  ];
  const roundTripped = importFromJSON(exportToJSON(profiles));
  assert.equal(roundTripped.length, 1);
  assert.equal(roundTripped[0].type, 'S3');
  assert.equal(roundTripped[0].bucket, 'my-bucket');
});

test('importFromJSON accepts raw arrays too', () => {
  const arr = [{ name: 'Raw', type: 'FTP' as const, host: 'ftp.example.com' }];
  const result = importFromJSON(JSON.stringify(arr));
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Raw');
});

test('importFromFileZilla parses sitemanager.xml', () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FileZilla3>
  <Servers>
    <Server>
      <Host>sftp.example.com</Host>
      <Port>2222</Port>
      <Protocol>1</Protocol>
      <Name>Prod SFTP</Name>
      <User>deploy</User>
    </Server>
    <Server>
      <Host>ftp.example.com</Host>
      <Port>21</Port>
      <Protocol>0</Protocol>
      <Name>Legacy FTP</Name>
      <User>guest</User>
    </Server>
  </Servers>
</FileZilla3>`;
  const profiles = importFromFileZilla(xml);
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].type, 'SFTP');
  assert.equal(profiles[0].host, 'sftp.example.com');
  assert.equal(profiles[0].port, 2222);
  assert.equal(profiles[0].username, 'deploy');
  assert.equal(profiles[0].name, 'Prod SFTP');
  assert.equal(profiles[1].type, 'FTP');
  assert.equal(profiles[1].port, 21);
});

test('importFromFileZilla decodes XML entities', () => {
  const xml = `<Servers>
    <Server>
      <Host>host.com</Host>
      <Name>My &amp; Site</Name>
      <User>a &lt; b</User>
      <Protocol>1</Protocol>
    </Server>
  </Servers>`;
  const profiles = importFromFileZilla(xml);
  assert.equal(profiles[0].name, 'My & Site');
  assert.equal(profiles[0].username, 'a < b');
});

test('importFromWinSCP parses INI sessions', () => {
  const ini = `[Sessions\\My%20Server]
HostName=host.example.com
PortNumber=2222
UserName=user
FSProtocol=2

[Sessions\\FTP%20Site]
HostName=ftp.example.com
PortNumber=21
UserName=anon
FSProtocol=1
Ftps=3
`;
  const profiles = importFromWinSCP(ini);
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].name, 'My Server');
  assert.equal(profiles[0].host, 'host.example.com');
  assert.equal(profiles[0].port, 2222);
  assert.equal(profiles[0].type, 'SFTP');
  assert.equal(profiles[1].type, 'FTP');
  assert.equal(profiles[1].secure, true);
});

test('importAuto routes by content / filename', () => {
  assert.equal(importAuto('<Servers><Server></Server></Servers>').length, 1);
  assert.equal(importAuto('[Sessions\\Test]\nHostName=x\nFSProtocol=2\n').length, 1);
  assert.equal(importAuto('[]').length, 0);
});
