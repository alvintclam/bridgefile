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

  if (item.protocol === 'ftp') {
    return !hasRunningTransferForConnection(
      queue,
      runningTransferIds,
      item.protocol,
      item.connectionId,
      item.id,
    );
  }

  return true;
}
