"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { calculateServerOffset, trustedNow } from "../domain/business-time";
import { HttpBusinessTimeService } from "../infrastructure/http/business-time-service";

const CACHE_KEY = "commission-compass-trusted-time";
const RESYNC_INTERVAL_MS = 5 * 60_000;

interface CachedClock {
  offsetMs: number;
  synchronizedAt: string;
}

function readCachedClock(): CachedClock | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedClock;
    return Number.isFinite(parsed.offsetMs) ? parsed : null;
  } catch {
    return null;
  }
}

export function useTrustedClock(timezone: string, locale: string) {
  const service = useMemo(() => new HttpBusinessTimeService(timezone, locale), [timezone, locale]);
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState<Date | null>(null);
  const [synchronized, setSynchronized] = useState(false);
  const [lastSynchronizedAt, setLastSynchronizedAt] = useState<string | null>(null);

  const synchronize = useCallback(async () => {
    try {
      const snapshot = await service.getSnapshot();
      const serverTime = new Date(snapshot.serverTime);
      const offset = calculateServerOffset(serverTime, new Date());
      const synchronizedAt = new Date().toISOString();
      setOffsetMs(offset);
      setCurrentTime(trustedNow(new Date(), offset));
      setLastSynchronizedAt(synchronizedAt);
      setSynchronized(true);
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({ offsetMs: offset, synchronizedAt }));
    } catch {
      const cached = readCachedClock();
      if (cached) {
        setOffsetMs(cached.offsetMs);
        setCurrentTime(trustedNow(new Date(), cached.offsetMs));
        setLastSynchronizedAt(cached.synchronizedAt);
      }
      setSynchronized(false);
    }
  }, [service]);

  useEffect(() => {
    const initial = window.setTimeout(() => void synchronize(), 0);
    const resync = window.setInterval(() => void synchronize(), RESYNC_INTERVAL_MS);
    const handleResume = () => {
      if (document.visibilityState === "visible") void synchronize();
    };
    const handleOnline = () => void synchronize();
    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("online", handleOnline);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(resync);
      document.removeEventListener("visibilitychange", handleResume);
      window.removeEventListener("online", handleOnline);
    };
  }, [synchronize]);

  useEffect(() => {
    if (offsetMs === null) return;
    const tick = () => setCurrentTime(trustedNow(new Date(), offsetMs));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [offsetMs]);

  return {
    currentTime,
    synchronized,
    lastSynchronizedAt,
    synchronize,
    formatDate: (date: Date) => service.formatBusinessDate(date),
    formatTime: (date: Date, includeSeconds = true) => service.formatBusinessTime(date, includeSeconds),
  };
}
