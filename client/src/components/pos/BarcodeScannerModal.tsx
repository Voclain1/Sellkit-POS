import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Camera, CameraOff, Zap, ZapOff, Check, AlertTriangle, Loader2 } from 'lucide-react';
import type { ScanResult } from '../../types/pos';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves ok when the code matched a product and was added to the cart. */
  onDetected: (code: string) => Promise<ScanResult>;
}

/** The same barcode stays in frame for many frames; only act on it once. */
const REPEAT_SCAN_COOLDOWN_MS = 1500;
/** Native detector polling interval. Faster than this just burns battery. */
const DETECT_INTERVAL_MS = 200;

type Status =
  | { kind: 'starting' }
  | { kind: 'scanning' }
  | { kind: 'hit'; message: string }
  | { kind: 'miss'; message: string }
  | { kind: 'error'; message: string };

/** `BarcodeDetector` ships in Chromium but is not in TypeScript's DOM lib yet. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

const FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'itf',
  'codabar',
  'qr_code',
];

/** Short confirmation tone — a cashier watching the customer, not the screen, needs to hear the hit. */
function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = ok ? 1180 : 320;
    gain.gain.value = 0.06;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (ok ? 0.08 : 0.2));
    osc.onended = () => void ctx.close();
  } catch {
    // Audio is a nicety; never let it break a scan.
  }
}

/**
 * Camera barcode scanner. Uses the native `BarcodeDetector` where the browser
 * has it and lazily falls back to ZXing everywhere else, so the ~300kB decoder
 * is only ever fetched on the terminals that actually need it.
 */
export function BarcodeScannerModal({ isOpen, onClose, onDetected }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastCodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const busyRef = useRef(false);

  const [status, setStatus] = useState<Status>({ kind: 'starting' });
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;

  const handleCode = useCallback(async (raw: string) => {
    const code = raw.trim();
    if (!code) return;

    const now = Date.now();
    if (code === lastCodeRef.current.code && now - lastCodeRef.current.at < REPEAT_SCAN_COOLDOWN_MS) {
      return;
    }
    lastCodeRef.current = { code, at: now };

    // One lookup at a time: the frame loop keeps firing while an await is open.
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const result = await onDetectedRef.current(code);
      beep(result.ok);
      setStatus(
        result.ok
          ? { kind: 'hit', message: `Added ${code}` }
          : { kind: 'miss', message: result.message ?? `No product matches ${code}` }
      );
    } catch {
      setStatus({ kind: 'miss', message: `Lookup failed for ${code}` });
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;
    let zxingControls: { stop: () => void } | undefined;
    // Captured now: by cleanup time the refs may already point elsewhere, and a
    // camera left streaming is a lit torch and a recording light at the counter.
    const video = videoRef.current;
    let activeStream: MediaStream | null = null;

    const start = async () => {
      setStatus({ kind: 'starting' });

      // getUserMedia is gated on a secure context; on plain http the API is
      // simply absent, which otherwise surfaces as a confusing TypeError.
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({
          kind: 'error',
          message: window.isSecureContext
            ? 'This browser has no camera API. Use the USB scanner or search instead.'
            : 'Camera access needs HTTPS. Use the USB scanner or search instead.',
        });
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } },
          audio: false,
        });
      } catch (err) {
        const name = (err as DOMException)?.name;
        setStatus({
          kind: 'error',
          message:
            name === 'NotAllowedError'
              ? 'Camera permission denied. Allow it in the browser, or use the USB scanner.'
              : name === 'NotFoundError'
                ? 'No camera found on this terminal.'
                : 'Could not start the camera.',
        });
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      activeStream = stream;
      streamRef.current = stream;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay rejection still leaves a decodable stream on most browsers.
      }

      const track = stream.getVideoTracks()[0];
      const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined;
      setTorchSupported(Boolean(caps?.torch));

      if (cancelled) return;
      setStatus({ kind: 'scanning' });

      const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;

      if (Detector) {
        const detector = new Detector({ formats: FORMATS });
        interval = setInterval(async () => {
          if (cancelled || video.readyState < 2) return;
          try {
            const results = await detector.detect(video);
            if (results.length > 0) void handleCode(results[0].rawValue);
          } catch {
            // A dropped frame is not worth surfacing; the next tick retries.
          }
        }, DETECT_INTERVAL_MS);
        return;
      }

      // Fallback: pull ZXing in only where the native detector is missing.
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader();
        zxingControls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) void handleCode(result.getText());
        });
      } catch {
        setStatus({ kind: 'error', message: 'Could not load the barcode decoder.' });
      }
    };

    void start();

    return () => {
      cancelled = true;
      clearInterval(interval);
      zxingControls?.stop();
      activeStream?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (video) video.srcObject = null;
      setTorchOn(false);
      setTorchSupported(false);
    };
  }, [isOpen, handleCode]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      // `torch` is a real constraint on Android Chrome but is absent from the
      // DOM typings, so it has to be laundered through unknown.
      await track.applyConstraints({
        advanced: [{ torch: next }],
      } as unknown as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  };

  if (!isOpen) return null;

  const isError = status.kind === 'error';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 no-print">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand/10 text-brand flex items-center justify-center">
              <Camera className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="font-bold text-xs">Scan Barcode</h2>
              <span className="text-[10px] text-muted">Hold the code inside the frame</span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {torchSupported && (
              <button
                onClick={toggleTorch}
                title={torchOn ? 'Turn torch off' : 'Turn torch on'}
                aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'}
                className={`p-1.5 rounded-lg border transition ${
                  torchOn
                    ? 'bg-amber-500/15 border-amber-500/40 text-amber-500'
                    : 'bg-surface border-border text-muted hover:text-foreground'
                }`}
              >
                {torchOn ? <Zap className="w-4 h-4" /> : <ZapOff className="w-4 h-4" />}
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close scanner"
              className="p-1.5 rounded-lg bg-surface border border-border text-muted hover:text-danger transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewfinder. Black ground is the camera image itself, not app chrome. */}
        <div className="relative aspect-[4/3] bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={`w-full h-full object-cover ${isError ? 'opacity-0' : ''}`}
          />

          {!isError && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className={`w-[70%] h-[38%] rounded-xl border-2 transition-colors ${
                  status.kind === 'hit'
                    ? 'border-success shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]'
                    : status.kind === 'miss'
                      ? 'border-danger shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]'
                      : 'border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]'
                }`}
              />
            </div>
          )}

          {status.kind === 'starting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-xs font-semibold">Starting camera…</span>
            </div>
          )}

          {isError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center bg-surface">
              <CameraOff className="w-8 h-8 text-danger" />
              <p className="text-xs font-semibold text-foreground">{status.message}</p>
            </div>
          )}
        </div>

        {/* Status strip */}
        <div className="px-4 py-3 border-t border-border flex items-center gap-2 min-h-[52px]">
          {status.kind === 'hit' && (
            <>
              <Check className="w-4 h-4 text-success shrink-0" />
              <span className="text-xs font-bold text-success truncate">{status.message}</span>
            </>
          )}
          {status.kind === 'miss' && (
            <>
              <AlertTriangle className="w-4 h-4 text-danger shrink-0" />
              <span className="text-xs font-bold text-danger truncate">{status.message}</span>
            </>
          )}
          {(status.kind === 'scanning' || status.kind === 'starting') && (
            <span className="text-[11px] text-muted">
              Scanning continuously — the panel stays open so you can scan a whole basket.
            </span>
          )}
          {isError && (
            <span className="text-[11px] text-muted">Press Esc to close.</span>
          )}
        </div>
      </div>
    </div>
  );
}
