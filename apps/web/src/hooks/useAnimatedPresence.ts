import { useEffect, useRef, useState } from 'react';

export function useAnimatedPresence(
  open: boolean,
  exitMs = 200,
): { mounted: boolean; phase: 'enter' | 'exit' } {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<'enter' | 'exit'>(open ? 'enter' : 'exit');
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (open) {
      setMounted(true);
      setPhase('enter');
      return;
    }

    if (!mounted) return;
    setPhase('exit');
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setMounted(false);
    }, exitMs);

    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [open, exitMs, mounted]);

  return { mounted, phase };
}

export function useLastValue<T>(value: T | null | undefined): T | null {
  const ref = useRef<T | null>(value ?? null);
  if (value !== null && value !== undefined) {
    ref.current = value;
  }
  return value ?? ref.current;
}
