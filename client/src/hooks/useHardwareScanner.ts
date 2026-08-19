import { useEffect, useRef } from 'react';

/**
 * Longest gap between keystrokes still treated as one scan. A hardware scanner
 * bursts in ~10-30ms; this is loose enough that a human typing a code by hand
 * (or a test dispatching synthetic events) is not silently discarded.
 */
const SCAN_KEY_GAP_MS = 500;
/** How stale the buffer may be when Enter arrives, so an old buffer cannot fire a phantom scan. */
const SCAN_COMMIT_WINDOW_MS = 2000;
/** Shorter than this is a stray keypress, not a product code. */
const MIN_CODE_LENGTH = 3;

interface Options {
  /** Called with the buffered code when Enter commits a burst. */
  onScan: (code: string) => void;
  /**
   * Off while a modal owns the till — adding items behind an open payment screen
   * would change a cart whose total the cashier has already read out.
   */
  enabled?: boolean;
}

/**
 * Global listener for USB/Bluetooth barcode scanners, which present themselves
 * as keyboards: a fast burst of printable characters terminated by Enter.
 *
 * Keystrokes are ignored while a text field has focus — a scanner aimed at the
 * search box lands in that field, and that field's own Enter handler rings it
 * up. Buffering here as well would add the item twice.
 */
export function useHardwareScanner({ onScan, enabled = true }: Options): void {
  const bufRef = useRef('');
  const lastKeyRef = useRef(0);

  // Keep the listener stable while still calling the latest handler.
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) {
      bufRef.current = '';
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Ctrl+C and friends are shortcuts, not scan payloads.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();

      if (e.key.length === 1) {
        if (now - lastKeyRef.current > SCAN_KEY_GAP_MS) bufRef.current = '';
        lastKeyRef.current = now;
        bufRef.current += e.key;
        return;
      }

      if (e.key === 'Enter') {
        const code = bufRef.current;
        bufRef.current = '';
        if (code.length >= MIN_CODE_LENGTH && now - lastKeyRef.current <= SCAN_COMMIT_WINDOW_MS) {
          e.preventDefault();
          onScanRef.current(code);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
