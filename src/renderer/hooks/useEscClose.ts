import { useEffect } from 'react';

/**
 * Attach an Escape key listener while `active` is true, and invoke `onClose`.
 * Cleans up on unmount or when `active` flips to false.
 */
export function useEscClose(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, onClose]);
}
