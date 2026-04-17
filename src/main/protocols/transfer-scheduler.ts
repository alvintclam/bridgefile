import type { TransferItem } from '../../shared/types';

export function hasRunningTransferForConnection(
  queue: TransferItem[],
  runningTransferIds: ReadonlySet<string>,
  protocol: TransferItem['protocol'],
  connectionId: string,
  excludeTransferId?: string,
): boolean {
  return queue.some(
    (candidate) =>
      candidate.id !== excludeTransferId &&
      candidate.protocol === protocol &&
      candidate.connectionId === connectionId &&
      runningTransferIds.has(candidate.id),
  );
}

export function canStartTransfer(
  item: TransferItem,
  queue: TransferItem[],
  runningTransferIds: ReadonlySet<string>,
): boolean {
  if (item.status !== 'queued' || runningTransferIds.has(item.id)) {
    return false;
  }

  // FTP now uses a session pool (src/main/protocols/ftp.ts) so parallel
  // transfers on one connection are supported up to the pool's session limit.
  // The pool itself enforces per-client serialization; no scheduler gate needed.
  return true;
}

/** @deprecated retained for the transfer-scheduler test suite */
export function _hasRunningTransferForConnection(
  queue: TransferItem[],
  runningTransferIds: ReadonlySet<string>,
  protocol: TransferItem['protocol'],
  connectionId: string,
  excludeTransferId?: string,
): boolean {
  return hasRunningTransferForConnection(queue, runningTransferIds, protocol, connectionId, excludeTransferId);
}
