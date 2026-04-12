import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canStartTransfer, hasRunningTransferForConnection } from '../main/protocols/transfer-scheduler';
import type { TransferItem } from '../shared/types';

function createTransfer(overrides: Partial<TransferItem>): TransferItem {
  return {
    id: 'transfer-1',
    protocol: 'ftp',
    connectionId: 'connection-1',
    entryType: 'file',
    direction: 'upload',
    localPath: '/tmp/local.txt',
    remotePath: '/remote/local.txt',
    fileName: 'local.txt',
    size: 128,
    transferred: 0,
    status: 'queued',
    ...overrides,
  };
}

test('blocks same-connection FTP work while a cancelled transfer is still unwinding', () => {
  const activeCancelled = createTransfer({
    id: 'active',
    status: 'cancelled',
  });
  const queuedSameConnection = createTransfer({
    id: 'queued',
    status: 'queued',
  });
  const queue = [activeCancelled, queuedSameConnection];
  const runningTransferIds = new Set<string>(['active']);

  assert.equal(
    hasRunningTransferForConnection(queue, runningTransferIds, 'ftp', 'connection-1', 'queued'),
    true,
  );
  assert.equal(canStartTransfer(queuedSameConnection, queue, runningTransferIds), false);
});

test('allows FTP work to start on a different connection', () => {
  const activeCancelled = createTransfer({
    id: 'active',
    status: 'cancelled',
    connectionId: 'connection-1',
  });
  const queuedOtherConnection = createTransfer({
    id: 'queued',
    status: 'queued',
    connectionId: 'connection-2',
  });
  const queue = [activeCancelled, queuedOtherConnection];
  const runningTransferIds = new Set<string>(['active']);

  assert.equal(canStartTransfer(queuedOtherConnection, queue, runningTransferIds), true);
});

test('does not apply the FTP same-connection gate to other protocols', () => {
  const activeCancelled = createTransfer({
    id: 'active',
    status: 'cancelled',
    protocol: 'ftp',
  });
  const queuedSftp = createTransfer({
    id: 'queued',
    protocol: 'sftp',
    status: 'queued',
  });
  const queue = [activeCancelled, queuedSftp];
  const runningTransferIds = new Set<string>(['active']);

  assert.equal(canStartTransfer(queuedSftp, queue, runningTransferIds), true);
});
