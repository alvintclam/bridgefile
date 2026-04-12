import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  toSftpConnectConfig,
  toStoredProfile,
  toUIProfile,
  type UIConnectionProfile,
} from '../shared/connection-profile-ui';
import type { SFTPConfig } from '../shared/types';

test('round-trips encrypted-key SFTP profile data through storage mapping', () => {
  const profile: UIConnectionProfile = {
    id: 'profile-1',
    name: 'Production SFTP',
    type: 'SFTP',
    favorite: true,
    lastUsed: 1712345678901,
    group: 'Production',
    host: 'sftp.example.com',
    port: 2222,
    username: 'deploy',
    password: '',
    privateKeyPath: '~/.ssh/deploy_key',
    passphrase: 'correct-horse',
    proxyHost: 'jump.example.com',
    proxyPort: 2223,
    proxyUsername: 'jump-user',
    proxyPassword: 'jump-secret',
    timeout: 45,
  };

  const stored = toStoredProfile(profile);
  const storedConfig = stored.config as SFTPConfig;
  assert.equal(stored.type, 'sftp');
  assert.equal(stored.group, 'Production');
  assert.equal(stored.favorite, true);
  assert.equal(stored.lastUsed, 1712345678901);
  assert.equal(storedConfig.passphrase, 'correct-horse');
  assert.equal(storedConfig.privateKey, '~/.ssh/deploy_key');

  const restored = toUIProfile(stored);
  assert.equal(restored.passphrase, 'correct-horse');
  assert.equal(restored.privateKeyPath, '~/.ssh/deploy_key');
  assert.equal(restored.proxyHost, 'jump.example.com');
  assert.equal(restored.group, 'Production');
});

test('builds SFTP runtime config with passphrase and proxy details', () => {
  const config = toSftpConnectConfig({
    id: 'profile-1',
    name: 'Production SFTP',
    type: 'SFTP',
    favorite: false,
    host: 'sftp.example.com',
    port: 22,
    username: 'deploy',
    privateKeyPath: '~/.ssh/deploy_key',
    passphrase: 'correct-horse',
    proxyHost: 'jump.example.com',
    proxyPort: 2222,
    proxyUsername: 'jump-user',
    proxyPassword: 'jump-secret',
    timeout: 30,
  });

  assert.equal(config.privateKey, '~/.ssh/deploy_key');
  assert.equal(config.passphrase, 'correct-horse');
  assert.equal(config.proxyHost, 'jump.example.com');
  assert.equal(config.proxyPort, 2222);
  assert.equal(config.proxyUsername, 'jump-user');
  assert.equal(config.proxyPassword, 'jump-secret');
});
