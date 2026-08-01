"use client";

import {
  AlertTriangle, ArrowLeft, BarChart3, Boxes, CalendarCheck, Check,
  ChevronRight, Clock3, CloudOff, Gift, History, Home, IndianRupee, Minus,
  MoreHorizontal, Package, Play, Plus, ReceiptIndianRupee, RefreshCw, RotateCcw, Save,
  ShoppingBag, Sparkles, Trophy, WalletCards, Wifi, X,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings, DayCloseSnapshot, FullCommissionReward, SaleRecord, TrackerState } from "../application/contracts";
import { BusinessDateFilter, type DateFilterValue, computeEffectiveDateRange } from "./business-date-filter";
import { Calendar } from "./ui/calendar";
import { Pagination } from "./ui/pagination";
import {
  DEFAULT_BUSINESS_TIMEZONE,
  formatWorkingDuration,
  toBusinessDate,
} from "../domain/business-time";
import { calculateSale, formatCurrency } from "../domain/commission";
import { isDateChangeWarning } from "../domain/day-session";
import type { Product } from "../domain/products";
import { useTrustedClock } from "../hooks/use-trusted-clock";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";

type Screen = "home" | "start-day" | "additional-pickup" | "sale" | "dashboard" | "rewards" | "history" | "day-close" | "settings" | "historical-entry" | "expenses";
type ToastState = { message: string; error?: boolean } | null;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result;
}

function sessionLabel(status: TrackerState["daySessionStatus"]) {
  return {
    NOT_STARTED: "Not Started",
    OPEN: "Open",
    PREVIOUS_DAY_STILL_OPEN: "Previous Day Still Open",
    CLOSED: "Closed",
  }[status];
}

export function TrackerApp() {
  const [screen, setScreen] = useState<Screen>("home");
  const [state, setState] = useState<TrackerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const timezone = state?.settings.timezone ?? DEFAULT_BUSINESS_TIMEZONE;
  const locale = state?.settings.locale ?? "en-IN";
  const clock = useTrustedClock(timezone, locale);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const search = typeof window !== "undefined" ? window.location.search : "";
      setState(await api<TrackerState>(`/api/state${search}`));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The tracker is unavailable.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!state?.settings.realtimeEnabled) return;
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load, state?.settings.realtimeEnabled]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const selectedStock = useMemo(() => state?.daySession?.stockItems.find(
    (item) => item.productId === selectedProduct?.id
  ) ?? null, [selectedProduct, state?.daySession?.stockItems]);
  const preview = useMemo(() => selectedProduct ? calculateSale({
    quantity,
    currentProgress: selectedProduct.progress,
    currentCycle: selectedProduct.cycleNumber,
    rule: selectedProduct,
  }) : null, [quantity, selectedProduct]);

  function navigate(next: Screen) {
    if (next === "sale" && state?.daySessionStatus !== "OPEN") {
      if (state?.daySessionStatus === "PREVIOUS_DAY_STILL_OPEN") {
        setScreen("day-close");
        setToast({ message: "Close the previous business day before recording new sales.", error: true });
      } else if (state?.daySessionStatus === "NOT_STARTED") {
        setScreen("start-day");
      } else {
        setScreen("home");
        setToast({ message: "This business day is closed.", error: true });
      }
    } else {
      setScreen(next);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openSale(product: Product) {
    const stock = state?.daySession?.stockItems.find((item) => item.productId === product.id);
    if (!stock || stock.pickedQuantity === 0) {
      setToast({ message: "This product was not picked today.", error: true });
      return;
    }
    if (stock.remainingQuantity === 0) {
      setToast({ message: "No remaining stock is available for this product.", error: true });
      return;
    }
    setSelectedProduct(product);
    setQuantity(1);
  }

  async function saveSale() {
    if (!selectedProduct || saving) return;
    setSaving(true);
    try {
      await api("/api/sales", {
        method: "POST",
        body: JSON.stringify({ productId: selectedProduct.id, quantity, idempotencyKey: crypto.randomUUID() }),
      });
      const savedQuantity = quantity;
      setSelectedProduct(null);
      setQuantity(1);
      await load(true);
      setToast({ message: `${savedQuantity} ${savedQuantity === 1 ? "sale" : "sales"} saved successfully.` });
    } catch (saveError) {
      setToast({ message: saveError instanceof Error ? saveError.message : "Sale could not be saved.", error: true });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading"><div className="spinner" aria-label="Loading" /></div>;
  if (!state || error) return (
    <main className="content error-panel">
      <RefreshCw size={34} />
      <h1>We couldn’t open the tracker</h1>
      <p>{error}</p>
      <button className="primary-button" onClick={() => void load()}><RefreshCw size={18} /> Try again</button>
    </main>
  );

  const trustedTime = clock.currentTime ?? new Date(state.time.serverTime);
  const currentBusinessDate = toBusinessDate(trustedTime, timezone);
  const dateChanged = state.daySession?.status === "OPEN" &&
    isDateChangeWarning(state.daySession.businessDate, currentBusinessDate);
  const money = (value: number) => formatCurrency(value, locale, state.settings.currency);
  const timeProps = { state, clock, trustedTime };

  return (
    <div className="app-shell">
      <main className="content">
        {screen === "home" && <HomeScreen {...timeProps} state={state} money={money} navigate={navigate} dateChanged={dateChanged} reload={load} showToast={setToast} />}
        {screen === "start-day" && <StartDayScreen {...timeProps} state={state} navigate={navigate} reload={load} showToast={setToast} />}
        {screen === "additional-pickup" && <AdditionalPickupScreen {...timeProps} state={state} navigate={navigate} reload={load} showToast={setToast} />}
        {screen === "sale" && <SaleScreen state={state} money={money} navigate={navigate} openSale={openSale} dateChanged={dateChanged} />}
        {screen === "dashboard" && <DashboardScreen {...timeProps} state={state} money={money} navigate={navigate} />}
        {screen === "rewards" && <RewardsScreen state={state} money={money} navigate={navigate} reload={load} showToast={setToast} formatTimestamp={(value) => clock.formatTime(new Date(value), false)} />}
        {screen === "history" && <HistoryScreen sales={state.historySales} closures={state.historyClosures || []} money={money} navigate={navigate} formatTimestamp={(value) => clock.formatTime(new Date(value), false)} />}
        {screen === "day-close" && <DayCloseScreen {...timeProps} state={state} money={money} navigate={navigate} reload={load} showToast={setToast} />}
        {screen === "settings" && <SettingsScreen state={state} settings={state.settings} navigate={navigate} reload={load} showToast={setToast} />}
        {screen === "historical-entry" && <HistoricalEntryScreen state={state} navigate={navigate} reload={load} showToast={setToast} />}
        {screen === "expenses" && <ExpenseScreen {...timeProps} state={state} money={money} navigate={navigate} reload={load} showToast={setToast} />}
      </main>
      {screen !== "additional-pickup" && <BottomNav screen={screen} navigate={navigate} />}
      {selectedProduct && preview && selectedStock && (
        <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setSelectedProduct(null);
        }}>
          <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="sale-title">
            <div className="drawer-grip" />
            <div className="drawer-head">
              <div><h2 id="sale-title">{selectedProduct.name}</h2><p>{money(selectedProduct.sellingPricePaise)} each</p></div>
              <button className="close-button" aria-label="Close" disabled={saving} onClick={() => setSelectedProduct(null)}><X size={20} /></button>
            </div>
            <div className="stock-strip"><span>Picked <strong>{selectedStock.pickedQuantity}</strong></span><span>Sold <strong>{selectedStock.soldQuantity}</strong></span><span>Remaining <strong>{selectedStock.remainingQuantity}</strong></span></div>
            <div className="quantity" aria-label="Quantity">
              <button aria-label="Decrease quantity" onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus /></button>
              <strong aria-live="polite">{quantity}</strong>
              <button aria-label="Increase quantity" onClick={() => setQuantity((value) => Math.min(selectedStock.remainingQuantity, value + 1))}><Plus /></button>
            </div>
            <div className="review">
              <div className="review-row"><span>Gross Sales</span><strong>{money(preview.grossSalesPaise)}</strong></div>
              <div className="review-row"><span>Normal Commission ({preview.normalUnits})</span><strong>{money(preview.totalNormalCommissionPaise)}</strong></div>
              <div className="review-row"><span>Offers Earned ({preview.fullUnits})</span><strong>{money(preview.totalFullCommissionPaise)}</strong></div>
              <div className="review-row total"><span>Total Earnings</span><strong>{money(preview.totalEarningsPaise)}</strong></div>
              <div className="review-row"><span>Net Collection</span><strong>{money(preview.netCollectionPaise)}</strong></div>
              <div className="review-row"><span>Final Commission Progress</span><strong>{preview.finalProgress} / {selectedProduct.rewardThreshold}</strong></div>
            </div>
            <button className="primary-button full-width" disabled={saving || quantity > selectedStock.remainingQuantity} onClick={() => void saveSale()}>
              {saving ? <><div className="spinner" /> Saving…</> : <><Save size={19} /> Save Sale</>}
            </button>
          </section>
        </div>
      )}
      {toast && <div className={`toast${toast.error ? " error" : ""}`} role="status">{toast.error ? <X size={20} /> : <Check size={20} />}{toast.message}</div>}
    </div>
  );
}

type Clock = ReturnType<typeof useTrustedClock>;
type TimeProps = { state: TrackerState; clock: Clock; trustedTime: Date };

function Header({ state }: { state: TrackerState }) {
  return <header className="topbar"><div><p className="eyebrow">GOOD DAY, {state.settings.salesmanName.toUpperCase()}</p><h1>{state.settings.businessName}</h1></div><div className="avatar"><Image src="/profile.webp" width={48} height={48} alt={`${state.settings.salesmanName} profile`} unoptimized /></div></header>;
}

function TimeCard({ state, clock, trustedTime, compact = false }: TimeProps & { compact?: boolean }) {
  return <section className={`time-card${compact ? " compact" : ""}`}>
    <div><p className="business-date">{clock.formatDate(trustedTime)}</p><p className="live-time">{clock.formatTime(trustedTime, false)}</p></div>
    <div className="time-meta">
      <span className={`sync-dot${clock.synchronized ? " online" : ""}`} />
      {clock.synchronized ? "Server time synchronized" : <><CloudOff size={14} /> Time not synchronized</>}
    </div>
    <span className={`session-badge status-${state.daySessionStatus.toLowerCase()}`}>Business Day: {sessionLabel(state.daySessionStatus)}</span>
  </section>;
}

function HomeSummaryCard({ state, clock, trustedTime, money }: TimeProps & { money: (value: number) => string }) {
  return <section className="home-summary-card">
    <div className="home-summary-time">
      <div>
        <p className="business-date">{clock.formatDate(trustedTime)}</p>
        <p className="live-time">{clock.formatTime(trustedTime, false)}</p>
      </div>
      <div className="home-summary-meta">
        <div className="time-meta">
          <span className={`sync-dot${clock.synchronized ? " online" : ""}`} />
          {clock.synchronized ? "Server time synchronized" : <><CloudOff size={14} /> Time not synchronized</>}
        </div>
        <span className={`session-badge status-${state.daySessionStatus.toLowerCase()}`}>Business Day: {sessionLabel(state.daySessionStatus)}</span>
      </div>
    </div>
    <div className="home-summary-divider" />
    <div className="home-summary-earnings">
      <div>
        <p className="hero-label">Session earnings</p>
        <h2 className="hero-value">{money(state.dashboard.totalEarningsPaise)}</h2>
      </div>
      <p className="hero-foot"><Sparkles size={17} /> From {state.dashboard.totalUnits} unit{state.dashboard.totalUnits === 1 ? "" : "s"} in this business day</p>
    </div>
  </section>;
}

function PreviousDayWarning({ state, navigate, money, formatTime }: { state: TrackerState; navigate: (screen: Screen) => void; money: (value: number) => string; formatTime: (date: Date) => string }) {
  if (!state.daySession || state.daySessionStatus !== "PREVIOUS_DAY_STILL_OPEN") return null;
  return <section className="warning-card">
    <div className="warning-title"><AlertTriangle size={22} /><div><h2>Previous Business Day Is Still Open</h2><p>{state.daySession.businessDate} · Started {formatTime(new Date(state.daySession.startedAt))}. Close it before starting a new business day.</p></div></div>
    <div className="stock-summary">{state.daySession.stockItems.map((item) => <div key={item.id}><strong>{item.productName}</strong><span>Picked {item.pickedQuantity} · Sold {item.soldQuantity} · Remaining {item.remainingQuantity}</span></div>)}</div>
    <div className="warning-finance"><span>Gross Sales <strong>{money(state.dashboard.grossSalesPaise)}</strong></span><span>Normal Commission <strong>{money(state.dashboard.totalNormalCommissionPaise)}</strong></span><span>Offers Earned <strong>{money(state.dashboard.totalFullCommissionPaise)}</strong></span><span>Total Earnings <strong>{money(state.dashboard.totalEarningsPaise)}</strong></span><span>Net Collection <strong>{money(state.dashboard.netCollectionPaise)}</strong></span></div>
    <div className="warning-actions"><button className="secondary-button" onClick={() => navigate("dashboard")}>View Previous Day</button><button className="danger-button" onClick={() => navigate("day-close")}>Close Previous Day</button></div>
  </section>;
}

function PreviousOpenLanding({ state, clock, trustedTime, money, navigate }: TimeProps & {
  money: (value: number) => string;
  navigate: (screen: Screen) => void;
}) {
  const session = state.daySession;
  if (!session) return null;
  return <div className="decision-screen">
    <p className="landing-brand">AL QUWWA</p>
    <section className="warning-card blocking-warning">
      <div className="warning-title"><AlertTriangle size={28} /><div>
        <h1>Previous Business Day Is Still Open</h1>
        <p>Close this Business Day manually before opening {clock.formatDate(trustedTime)}.</p>
      </div></div>
      <div className="session-timing compact-grid">
        <div><span>Previous Business Date</span><strong>{session.businessDate}</strong></div>
        <div><span>Day Start</span><strong>{clock.formatTime(new Date(session.startedAt), false)}</strong></div>
      </div>
      <div className="stock-summary detailed-stock">{session.stockItems.map((item) => <div key={item.id}>
        <strong>{item.productName}</strong>
        <span>Picked {item.pickedQuantity} · Sold {item.soldQuantity} · Remaining {item.remainingQuantity}</span>
      </div>)}</div>
      <div className="warning-finance">
        <span>Gross Sales <strong>{money(state.dashboard.grossSalesPaise)}</strong></span>
        <span>Normal Commission <strong>{money(state.dashboard.totalNormalCommissionPaise)}</strong></span>
        <span>Offers Earned <strong>{money(state.dashboard.totalFullCommissionPaise)}</strong></span>
        <span>Total Earnings <strong>{money(state.dashboard.totalEarningsPaise)}</strong></span>
        <span>Net Collection <strong>{money(state.dashboard.netCollectionPaise)}</strong></span>
      </div>
      <div className="warning-actions">
        <button className="secondary-button" onClick={() => navigate("dashboard")}>VIEW PREVIOUS DAY</button>
        <button className="danger-button" onClick={() => navigate("day-close")}>CLOSE PREVIOUS DAY</button>
      </div>
    </section>
  </div>;
}

function NewDayLanding({ state, clock, trustedTime, navigate }: TimeProps & { navigate: (screen: Screen) => void }) {
  return <div className="new-day-landing">
    <div className="landing-mark"><CalendarCheck size={28} /></div>
    <p className="landing-brand">AL QUWWA</p>
    <h1>{clock.formatDate(trustedTime)}</h1>
    <p className="landing-time">{clock.formatTime(trustedTime, false)}</p>
    <div className="time-meta landing-sync"><span className={`sync-dot${clock.synchronized ? " online" : ""}`} />{clock.synchronized ? "Server time synchronized" : "Waiting for trusted server time"}</div>
    <p className="landing-message">No business day has been started today.</p>
    <button className="primary-button landing-primary" disabled={!clock.synchronized || state.daySessionStatus !== "NOT_STARTED"} onClick={() => navigate("start-day")}>
      <Play size={22} /> OPEN NEW DAY
    </button>
  </div>;
}

function ClosedDayLanding({ state, clock, trustedTime, money, navigate, reload, showToast }: TimeProps & {
  money: (value: number) => string;
  navigate: (screen: Screen) => void;
  reload: (silent?: boolean) => Promise<void>;
  showToast: (toast: ToastState) => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [resetting, setResetting] = useState(false);
  const session = state.daySession;
  if (!session) return null;
  const sessionId = session.id;

  function openWhatsAppReport() {
    const report = state.dayCloseSnapshot?.reportText;
    if (!report) {
      showToast({ message: "The WhatsApp report is unavailable.", error: true });
      return;
    }
    const phone = state.settings.whatsappNumber.replace(/\D/g, "");
    if (phone) {
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(report)}`, "_blank", "noopener,noreferrer");
    } else {
      void navigator.clipboard.writeText(report);
      showToast({ message: "WhatsApp number is not configured. Report copied instead." });
    }
  }

  async function reopenDay() {
    if (!state.reopenEligibility.allowed || reason.trim().length < 8 || reopening) return;
    setReopening(true);
    try {
      await api("/api/day-reopen", {
        method: "POST",
        body: JSON.stringify({ sessionId, reason: reason.trim() }),
      });
      await reload(true);
      setDialogOpen(false);
      showToast({ message: "Current Business Day reopened. Add any additional picked items." });
      navigate("additional-pickup");
    } catch (reopenError) {
      showToast({ message: reopenError instanceof Error ? reopenError.message : "The Business Day could not be reopened.", error: true });
    } finally {
      setReopening(false);
    }
  }

  async function resetDay() {
    if (!state.resetEligibility.allowed || resetting) return;
    setResetting(true);
    try {
      await api("/api/day-reset", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      });
      await reload(true);
      setResetDialogOpen(false);
      showToast({ message: "Business day reset successfully." });
      navigate("home");
    } catch (resetError) {
      showToast({ message: resetError instanceof Error ? resetError.message : "The Business Day could not be reset.", error: true });
    } finally {
      setResetting(false);
    }
  }

  return <div className="decision-screen">
    <p className="landing-brand">AL QUWWA</p>
    <TimeCard state={state} clock={clock} trustedTime={trustedTime} compact />
    <section className="closed-day-card">
      <div className="closed-day-heading"><CalendarCheck size={25} /><div><h1>Business Day Closed</h1><p>Another session cannot be created for {session.businessDate}.</p></div></div>
      <div className="session-timing compact-grid">
        <div><span>Business Date</span><strong>{session.businessDate}</strong></div>
        <div><span>Started</span><strong>{clock.formatTime(new Date(session.startedAt), false)}</strong></div>
        <div><span>Closed</span><strong>{session.closedAt ? clock.formatTime(new Date(session.closedAt), false) : "—"}</strong></div>
        <div><span>Reopened</span><strong>{session.reopenCount} time{session.reopenCount === 1 ? "" : "s"}</strong></div>
      </div>
      <div className="stock-summary detailed-stock">{session.stockItems.map((item) => <div key={item.id}>
        <strong>{item.productName}</strong><span>Picked {item.pickedQuantity} · Sold {item.soldQuantity} · Remaining {item.remainingQuantity}</span>
      </div>)}</div>
      <div className="warning-finance">
        <span>Gross Sales <strong>{money(state.dashboard.grossSalesPaise)}</strong></span>
        <span>Normal Commission <strong>{money(state.dashboard.totalNormalCommissionPaise)}</strong></span>
        <span>Offers Earned <strong>{money(state.dashboard.totalFullCommissionPaise)}</strong></span>
        <span>Total Earnings <strong>{money(state.dashboard.totalEarningsPaise)}</strong></span>
        <span>Net Collection <strong>{money(state.dashboard.netCollectionPaise)}</strong></span>
      </div>
      <div className="closed-actions">
        <button className="secondary-button" onClick={() => navigate("dashboard")}>VIEW DAY SUMMARY</button>
        <button className="secondary-button" onClick={openWhatsAppReport}>OPEN WHATSAPP REPORT</button>
        {state.reopenEligibility.allowed && <button className="primary-button" onClick={() => setDialogOpen(true)}>REOPEN CURRENT DAY</button>}
        {state.resetEligibility.allowed && <button className="danger-button" onClick={() => setResetDialogOpen(true)}>RESET CURRENT DAY</button>}
      </div>
      {!state.reopenEligibility.allowed && state.reopenEligibility.reason && <p className="eligibility-note">{state.reopenEligibility.reason}</p>}
      {!state.resetEligibility.allowed && state.resetEligibility.reason && state.resetEligibility.reason !== state.reopenEligibility.reason && <p className="eligibility-note">{state.resetEligibility.reason}</p>}
    </section>
    <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reopen Current Business Day?</AlertDialogTitle>
          <AlertDialogDescription>This Business Day has already been closed. Reopening it will allow additional product pickup and new sales. Existing records remain unchanged; the previous close summary and WhatsApp report become outdated.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="dialog-summary">
          <span>Business Date <strong>{session.businessDate}</strong></span>
          <span>Original Start <strong>{clock.formatTime(new Date(session.startedAt), false)}</strong></span>
          <span>Original Close <strong>{session.closedAt ? clock.formatTime(new Date(session.closedAt), false) : "—"}</strong></span>
          <span>Total Picked <strong>{session.stockItems.reduce((sum, item) => sum + item.pickedQuantity, 0)}</strong></span>
          <span>Total Sold <strong>{state.dashboard.totalUnits}</strong></span>
          <span>Total Remaining <strong>{session.stockItems.reduce((sum, item) => sum + item.remainingQuantity, 0)}</strong></span>
          <span>Gross Sales <strong>{money(state.dashboard.grossSalesPaise)}</strong></span>
          <span>Normal Commission <strong>{money(state.dashboard.totalNormalCommissionPaise)}</strong></span>
          <span>Offers Earned <strong>{money(state.dashboard.totalFullCommissionPaise)}</strong></span>
          <span>Total Earnings <strong>{money(state.dashboard.totalEarningsPaise)}</strong></span>
          <span>Net Collection <strong>{money(state.dashboard.netCollectionPaise)}</strong></span>
        </div>
        <label className="dialog-field">Mandatory reopen reason
          <textarea value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Why must this Business Day be reopened?" />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={reopening}>CANCEL</AlertDialogCancel>
          <AlertDialogAction disabled={reason.trim().length < 8 || reopening} onClick={(event) => { event.preventDefault(); void reopenDay(); }}>
            {reopening ? "REOPENING…" : "REOPEN CURRENT DAY"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="danger-text">Reset Current Business Day?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to completely wipe the current Business Day?
            This will permanently delete the day session, all stock tracking, and reset the state as if the day was never started.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="dialog-summary">
          <span>Business Date <strong>{session.businessDate}</strong></span>
          <span>Original Start <strong>{clock.formatTime(new Date(session.startedAt), false)}</strong></span>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={resetting}>CANCEL</AlertDialogCancel>
          <button
            className="danger-button"
            disabled={resetting}
            onClick={(event) => { event.preventDefault(); void resetDay(); }}
            style={{ width: 'auto' }}
          >
            {resetting ? "RESETTING…" : "RESET CURRENT DAY"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}

function HomeScreen({ state, clock, trustedTime, money, navigate, dateChanged, reload, showToast }: TimeProps & {
  money: (value: number) => string;
  navigate: (screen: Screen) => void;
  dateChanged: boolean;
  reload: (silent?: boolean) => Promise<void>;
  showToast: (toast: ToastState) => void;
}) {
  if (state.openingState === "PREVIOUS_OPEN") {
    return <PreviousOpenLanding state={state} clock={clock} trustedTime={trustedTime} money={money} navigate={navigate} />;
  }
  if (state.openingState === "NEW_DAY") {
    return <NewDayLanding state={state} clock={clock} trustedTime={trustedTime} navigate={navigate} />;
  }
  if (state.openingState === "CURRENT_CLOSED") {
    return <ClosedDayLanding state={state} clock={clock} trustedTime={trustedTime} money={money} navigate={navigate} reload={reload} showToast={showToast} />;
  }
  const actions = [
    { screen: "sale" as const, icon: ShoppingBag, title: "Sale", text: state.daySessionStatus === "OPEN" ? "Record a product sale" : "Start a day before selling" },
    { screen: "expenses" as const, icon: WalletCards, title: "Expenses", text: "Petrol, food & daily costs" },
    { screen: "dashboard" as const, icon: BarChart3, title: "Dashboard", text: "See session totals" },
    { screen: "rewards" as const, icon: Trophy, title: "Offers", text: "Review earned Offers" },
    { screen: "history" as const, icon: History, title: "History", text: "Open session sales" },
  ];
  return <>
    <Header state={state} />
    <HomeSummaryCard state={state} clock={clock} trustedTime={trustedTime} money={money} />
    {dateChanged && state.daySessionStatus === "OPEN" && <section className="warning-card"><div className="warning-title"><AlertTriangle size={22} /><div><h2>The calendar date has changed</h2><p>The previous business day remains open and unchanged. Close {state.daySession?.businessDate} before starting the new day.</p></div></div><div className="warning-actions"><button className="secondary-button" onClick={() => navigate("dashboard")}>View Previous Day</button><button className="danger-button" onClick={() => navigate("day-close")}>Close Previous Day</button></div></section>}
    <PreviousDayWarning state={state} navigate={navigate} money={money} formatTime={(date) => clock.formatTime(date, false)} />
    <section className="home-actions">
      <div className="section-head"><div><h2>What would you like to do?</h2><p>Choose an action to get started.</p></div></div>
      <div className="action-grid">{actions.map(({ screen, icon: Icon, title, text }) =>
        <button className="action-card" key={screen} onClick={() => navigate(screen)}>
          <span className="icon-tile"><Icon size={22} /></span><h3>{title}</h3><p>{text}</p>
        </button>)}</div>
      <div className="section-head"><div><h2>End of day</h2><p>Review totals before closing.</p></div></div>
      <button className="secondary-button full-width" onClick={() => navigate("day-close")}><CalendarCheck size={20} /> Day Close <ChevronRight size={18} /></button>
    </section>
  </>;
}

function PageTitle({ title, navigate }: { title: string; navigate: (screen: Screen) => void }) {
  return <div className="page-title"><button className="back-button" aria-label="Back to home" onClick={() => navigate("home")}><ArrowLeft size={20} /></button><h1>{title}</h1></div>;
}

function StartDayScreen({ state, clock, trustedTime, navigate, reload, showToast }: TimeProps & { navigate: (screen: Screen) => void; reload: (silent?: boolean) => Promise<void>; showToast: (toast: ToastState) => void }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [starting, setStarting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const canStart = state.daySessionStatus === "NOT_STARTED";
  const selectedItems = state.products
    .map((product) => ({ product, quantity: quantities[product.id] ?? 0 }))
    .filter((item) => item.quantity > 0);
  const totalPickedUnits = selectedItems.reduce((total, item) => total + item.quantity, 0);
  async function startDay() {
    if (!canStart || !clock.synchronized) return;
    setStarting(true);
    try {
      await api("/api/day-start", {
        method: "POST",
        body: JSON.stringify({ items: state.products.map((product) => ({ productId: product.id, pickedQuantity: quantities[product.id] ?? 0 })) }),
      });
      await reload(true);
      setConfirmOpen(false);
      showToast({ message: "Business day started with server-confirmed time." });
      navigate("home");
    } catch (startError) {
      showToast({ message: startError instanceof Error ? startError.message : "The business day could not be started.", error: true });
    } finally { setStarting(false); }
  }
  return <><PageTitle title="Daily Product Pickup" navigate={navigate} /><p className="landing-brand">AL QUWWA</p><TimeCard state={state} clock={clock} trustedTime={trustedTime} compact />
    {!canStart && <section className="warning-card"><div className="warning-title"><AlertTriangle /><div><h2>New day unavailable</h2><p>{state.daySessionStatus === "PREVIOUS_DAY_STILL_OPEN" ? "Close the previous day first." : "This business date has already been started."}</p></div></div></section>}
    <div className="section-head"><div><h2>Select today’s picked quantities</h2><p>Products left at 0 are not picked today.</p></div></div>
    <div className="pickup-list">{state.products.map((product) => {
      const value = quantities[product.id] ?? 0;
      return <article className="pickup-card" key={product.id}><div><strong>{product.name}</strong><span>Commission progress continues at {product.progress} / {product.rewardThreshold}</span></div><div className="mini-quantity"><button aria-label={`Decrease ${product.name}`} onClick={() => setQuantities({ ...quantities, [product.id]: Math.max(0, value - 1) })}><Minus /></button><strong>{value}</strong><button aria-label={`Increase ${product.name}`} onClick={() => setQuantities({ ...quantities, [product.id]: Math.min(9999, value + 1) })}><Plus /></button></div></article>;
    })}</div>
    <button className="primary-button full-width sticky-action" disabled={!canStart || !clock.synchronized || starting} onClick={() => setConfirmOpen(true)}><Play size={19} />{clock.synchronized ? "CONFIRM & START DAY" : "Waiting for trusted time"}</button>
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm & Start Day?</AlertDialogTitle>
          <AlertDialogDescription>A new Business Day will be created only after this confirmation. Previous quantities and remaining stock are not copied.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="dialog-summary">
          <span>Business Date <strong>{clock.formatDate(trustedTime)}</strong></span>
          <span>Products Selected <strong>{selectedItems.length}</strong></span>
          <span>Total Picked Units <strong>{totalPickedUnits}</strong></span>
        </div>
        <div className="dialog-product-list">{selectedItems.length ? selectedItems.map(({ product, quantity }) => <span key={product.id}>{product.name}<strong>{quantity}</strong></span>) : <p>All products will start at zero picked quantity.</p>}</div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={starting}>CANCEL</AlertDialogCancel>
          <AlertDialogAction disabled={starting} onClick={(event) => { event.preventDefault(); void startDay(); }}>{starting ? "STARTING…" : "CONFIRM & START DAY"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function AdditionalPickupScreen({ state, clock, trustedTime, navigate, reload, showToast }: TimeProps & {
  navigate: (screen: Screen) => void;
  reload: (silent?: boolean) => Promise<void>;
  showToast: (toast: ToastState) => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("Additional pickup after reopening");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [savingPickup, setSavingPickup] = useState(false);
  const session = state.daySession;
  if (!session || session.status !== "OPEN") return <section className="warning-card"><h2>Additional pickup unavailable</h2><p>Reopen the trusted current Business Day first.</p></section>;
  const sessionId = session.id;
  const stockByProduct = new Map(session.stockItems.map((item) => [item.productId, item]));
  const selected = state.products.map((product) => {
    const stock = stockByProduct.get(product.id);
    const additional = quantities[product.id] ?? 0;
    return {
      product,
      stock,
      additional,
      newPicked: (stock?.pickedQuantity ?? 0) + additional,
      newRemaining: (stock?.remainingQuantity ?? 0) + additional,
    };
  }).filter((item) => item.additional > 0);
  const totalAdditional = selected.reduce((total, item) => total + item.additional, 0);

  async function saveAdditionalPickup() {
    if (savingPickup || totalAdditional < 1 || reason.trim().length < 3) return;
    setSavingPickup(true);
    try {
      await api("/api/additional-pickup", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          reason: reason.trim(),
          items: state.products
            .map((product) => ({
              productId: product.id,
              additionalQuantity: quantities[product.id] ?? 0,
            }))
            .filter((item) => item.additionalQuantity > 0),
        }),
      });
      await reload(true);
      setConfirmOpen(false);
      showToast({ message: `${totalAdditional} additional picked unit${totalAdditional === 1 ? "" : "s"} saved.` });
      navigate("home");
    } catch (pickupError) {
      showToast({ message: pickupError instanceof Error ? pickupError.message : "Additional pickup could not be saved.", error: true });
    } finally {
      setSavingPickup(false);
    }
  }

  return <><PageTitle title="Add Picked Items" navigate={navigate} /><p className="landing-brand">AL QUWWA</p><TimeCard state={state} clock={clock} trustedTime={trustedTime} compact />
    <div className="section-head"><div><h2>Additional Product Pickup</h2><p>Original pickup remains unchanged in history. Add only new quantities.</p></div></div>
    <div className="pickup-list">{state.products.map((product) => {
      const stock = stockByProduct.get(product.id);
      const value = quantities[product.id] ?? 0;
      return <article className="pickup-card pickup-adjustment" key={product.id}>
        <div><strong>{product.name}</strong><span>Previously Picked: {stock?.pickedQuantity ?? 0} · Sold: {stock?.soldQuantity ?? 0} · Remaining: {stock?.remainingQuantity ?? 0}</span><span className="pickup-result">New Total Picked: {(stock?.pickedQuantity ?? 0) + value} · New Remaining: {(stock?.remainingQuantity ?? 0) + value}</span></div>
        <div><small>Additional Pickup</small><div className="mini-quantity"><button aria-label={`Decrease additional ${product.name}`} onClick={() => setQuantities({ ...quantities, [product.id]: Math.max(0, value - 1) })}><Minus /></button><strong>{value}</strong><button aria-label={`Increase additional ${product.name}`} onClick={() => setQuantities({ ...quantities, [product.id]: Math.min(9999, value + 1) })}><Plus /></button></div></div>
      </article>;
    })}</div>
    <label className="dialog-field pickup-reason">Pickup reason
      <textarea value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
    </label>
    <button className="primary-button full-width sticky-action" disabled={totalAdditional < 1 || reason.trim().length < 3} onClick={() => setConfirmOpen(true)}>CONFIRM ADDITIONAL PICKUP</button>
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Confirm Additional Pickup?</AlertDialogTitle><AlertDialogDescription>Review the new quantities before saving this audited stock adjustment.</AlertDialogDescription></AlertDialogHeader>
        <div className="dialog-summary"><span>Business Date <strong>{session.businessDate}</strong></span><span>Total Additional Units <strong>{totalAdditional}</strong></span></div>
        <div className="dialog-product-list">{selected.map((item) => <span key={item.product.id}>{item.product.name}: +{item.additional}<strong>Picked {item.newPicked} · Remaining {item.newRemaining}</strong></span>)}</div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={savingPickup}>CANCEL</AlertDialogCancel>
          <AlertDialogAction disabled={savingPickup} onClick={(event) => { event.preventDefault(); void saveAdditionalPickup(); }}>{savingPickup ? "SAVING…" : "CONFIRM ADDITIONAL PICKUP"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function SaleScreen({ state, money, navigate, openSale, dateChanged }: { state: TrackerState; money: (value: number) => string; navigate: (screen: Screen) => void; openSale: (product: Product) => void; dateChanged: boolean }) {
  const stockMap = new Map(state.daySession?.stockItems.map((item) => [item.productId, item]) ?? []);
  return <><PageTitle title="Record a Sale" navigate={navigate} />
    {dateChanged && <section className="warning-card"><div className="warning-title"><AlertTriangle /><div><h2>Calendar date changed</h2><p>Close the previous business day before recording new sales.</p></div></div></section>}
    <p className="eyebrow">CHOOSE A PRODUCT</p><div className="product-grid">{state.products.map((product) => {
      const stock = stockMap.get(product.id);
      const unavailable = !stock || stock.pickedQuantity === 0 || stock.remainingQuantity === 0 || dateChanged;
      return <button className="product-card" key={product.id} disabled={unavailable} onClick={() => openSale(product)}>
        <span className="product-name">{product.name}</span><span className="product-price">{money(product.sellingPricePaise)}</span>
        <span className="product-commission">{money(product.normalCommissionPaise)} Normal Commission</span>
        <span className={`badge${product.progress === product.rewardThreshold ? " ready" : ""}`}>{product.progress === product.rewardThreshold ? <><Sparkles size={12} /> Next: Offer</> : <>Cycle {product.cycleNumber}</>}</span>
        <span className="stock-line">{stock ? `Picked ${stock.pickedQuantity} · Sold ${stock.soldQuantity} · Left ${stock.remainingQuantity}` : "Not prepared"}</span>
        <span className="progress-row"><span>Commission Progress</span><strong>{product.progress} / {product.rewardThreshold}</strong></span>
        <span className="progress-track"><span className="progress-fill" style={{ width: `${product.progress / product.rewardThreshold * 100}%` }} /></span>
      </button>;
    })}</div></>;
}

function DashboardScreen({ state, clock, trustedTime, money, navigate }: TimeProps & { money: (value: number) => string; navigate: (screen: Screen) => void }) {
  const [filter, setFilter] = useState<DateFilterValue>({ preset: "all" });

  const filteredSales = useMemo(() => {
    if (filter.preset === "all") return state.historySales.length > 0 ? state.historySales : state.sales;
    const { startDate, endDate } = computeEffectiveDateRange(filter, state.time.businessDate);
    return state.historySales.filter((s) => {
      const bDate = s.businessDate || s.createdAt.split("T")[0];
      if (startDate && bDate < startDate) return false;
      if (endDate && bDate > endDate) return false;
      return true;
    });
  }, [state.historySales, state.sales, state.time.businessDate, filter]);

  const totalUnits = filteredSales.reduce((sum, s) => sum + s.quantity, 0);
  const grossSalesPaise = filteredSales.reduce((sum, s) => sum + s.grossSalesPaise, 0);
  const totalNormalCommissionPaise = filteredSales.reduce((sum, s) => sum + s.totalNormalCommissionPaise, 0);
  const totalFullCommissionPaise = filteredSales.reduce((sum, s) => sum + s.totalFullCommissionPaise, 0);
  const totalEarningsPaise = totalNormalCommissionPaise + totalFullCommissionPaise;
  const netCollectionPaise = grossSalesPaise - totalEarningsPaise;

  const metrics = [
    { label: "Units Sold", value: String(filter.preset === "all" ? state.dashboard.totalUnits : totalUnits), icon: ShoppingBag },
    { label: "Gross Sales", value: money(filter.preset === "all" ? state.dashboard.grossSalesPaise : grossSalesPaise), icon: ReceiptIndianRupee },
    { label: "Normal Commission", value: money(filter.preset === "all" ? state.dashboard.totalNormalCommissionPaise : totalNormalCommissionPaise), icon: WalletCards },
    { label: "Offers Earned", value: money(filter.preset === "all" ? state.dashboard.totalFullCommissionPaise : totalFullCommissionPaise), icon: Trophy },
    { label: "Salesperson Earnings", value: money(filter.preset === "all" ? state.dashboard.totalEarningsPaise : totalEarningsPaise), icon: IndianRupee, featured: true },
    { label: "Daily Expenses", value: money(filter.preset === "all" ? state.dashboard.totalExpensesPaise : 0), icon: WalletCards },
    { label: "Company Payable", value: money(filter.preset === "all" ? state.dashboard.netCollectionPaise : (grossSalesPaise - totalEarningsPaise)), icon: Package },
  ];
  return <><PageTitle title="Dashboard" navigate={navigate} /><TimeCard state={state} clock={clock} trustedTime={trustedTime} compact />
    <BusinessDateFilter value={filter} onChange={setFilter} showProductFilter products={state.products} />
    <div className="dashboard-meta"><span><Clock3 size={15} /> Last updated {clock.formatTime(new Date(state.lastUpdatedAt), false)}</span><span><Wifi size={15} /> {state.settings.realtimeEnabled ? "Live refresh enabled" : "Live refresh off"}</span></div>
    <section className="metrics">{metrics.map(({ label, value, icon: Icon, featured }) => <article className={`metric${featured ? " featured" : ""}`} key={label}><Icon className="metric-icon" size={21} /><span>{label}</span><strong>{value}</strong></article>)}</section>
    <div className="section-head"><div><h2>Daily Stock</h2><p>Stock resets only when a new day is manually started.</p></div></div>
    <div className="list">{state.daySession?.stockItems.map((item) => <article className="list-card" key={item.id}><div className="list-row"><div><h3>{item.productName}</h3><p>Picked {item.pickedQuantity}</p></div><span className="badge">{item.remainingQuantity} remaining</span></div><div className="stock-strip"><span>Picked <strong>{item.pickedQuantity}</strong></span><span>Sold <strong>{item.soldQuantity}</strong></span><span>Remaining <strong>{item.remainingQuantity}</strong></span></div></article>) ?? <Empty icon={Boxes} text="Start a business day to prepare daily stock." />}</div>
    <div className="section-head"><div><h2>Persistent Commission Progress</h2><p>Day Start and Day Close never reset these cycles.</p></div></div>
    <div className="list">{state.products.map((product) => <article className="list-card" key={product.id}><div className="list-row"><div><h3>{product.name}</h3><p>Cycle {product.cycleNumber}</p></div><span className={`badge${product.progress === product.rewardThreshold ? " ready" : ""}`}>{product.progress} / {product.rewardThreshold}</span></div><div className="progress-track" style={{ marginTop: ".75rem" }}><div className="progress-fill" style={{ width: `${product.progress / product.rewardThreshold * 100}%` }} /></div></article>)}</div>
  </>;
}

function RewardsScreen({ state, money, navigate, reload, showToast, formatTimestamp }: {
  state: TrackerState;
  money: (value: number) => string;
  navigate: (screen: Screen) => void;
  reload: (silent?: boolean) => Promise<void>;
  showToast: (toast: ToastState) => void;
  formatTimestamp: (value: string) => string;
}) {
  const [selectedReward, setSelectedReward] = useState<FullCommissionReward | null>(null);
  const [confirmMode, setConfirmMode] = useState<"receive" | "undo" | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [filter, setFilter] = useState<DateFilterValue>({ preset: "all" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const filteredRewards = useMemo(() => {
    return state.rewards.filter((r) => {
      if (filter.status && filter.status !== "ALL" && r.status !== filter.status) return false;
      if (filter.productId && r.productId && r.productId !== filter.productId) return false;
      if (filter.preset !== "all") {
        const { startDate, endDate } = computeEffectiveDateRange(filter, state.time.businessDate);
        const rDate = r.createdAt.split("T")[0];
        if (startDate && rDate < startDate) return false;
        if (endDate && rDate > endDate) return false;
      }
      return true;
    });
  }, [state.rewards, state.time.businessDate, filter]);

  const paginatedRewards = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRewards.slice(start, start + pageSize);
  }, [filteredRewards, page, pageSize]);

  const total = filteredRewards.reduce((sum, reward) => sum + reward.amountPaise, 0);

  async function handleMarkReceived() {
    if (!selectedReward || submitting) return;
    setSubmitting(true);
    try {
      await api("/api/offers/receive", {
        method: "POST",
        body: JSON.stringify({ rewardId: selectedReward.id }),
      });
      await reload(true);
      showToast({ message: "Offer marked as RECEIVED." });
      setConfirmMode(null);
      setSelectedReward(null);
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Failed to update offer status.", error: true });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUndoReceived() {
    if (!selectedReward || submitting) return;
    setSubmitting(true);
    try {
      await api("/api/offers/undo", {
        method: "POST",
        body: JSON.stringify({ rewardId: selectedReward.id }),
      });
      await reload(true);
      showToast({ message: "Offer status reset back to EARNED." });
      setConfirmMode(null);
      setSelectedReward(null);
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Failed to undo offer status.", error: true });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageTitle title="Offers" navigate={navigate} />
      <BusinessDateFilter value={filter} onChange={setFilter} showStatusFilter showProductFilter products={state.products} />
      <section className="hero">
        <p className="hero-label">Filtered Offers Earned</p>
        <h2 className="hero-value">{money(total)}</h2>
        <p className="hero-foot">
          <Trophy size={17} /> {filteredRewards.length} earned Offer record{filteredRewards.length === 1 ? "" : "s"}
        </p>
      </section>

      <div className="section-head">
        <div>
          <h2>Offer Records</h2>
          <p>Tap an EARNED offer to mark as received.</p>
        </div>
      </div>

      {filteredRewards.length ? (
        <>
          <div className="list">
            {paginatedRewards.map((reward) => {
              const isEarned = reward.status === "EARNED";
              const isReceived = reward.status === "RECEIVED";

              return (
                <article
                  className={`list-card offer-card ${isReceived ? "received-card" : "earned-card"}`}
                  key={reward.id}
                  style={{
                    cursor: isEarned ? "pointer" : "default",
                    borderLeft: isReceived ? "4px solid #f59e0b" : "4px solid #10b981",
                    padding: "1rem",
                    marginBottom: "0.75rem",
                    borderRadius: "8px",
                    background: isReceived ? "rgba(245, 158, 11, 0.08)" : undefined,
                  }}
                  onClick={() => {
                    if (isEarned) {
                      setSelectedReward(reward);
                      setConfirmMode("receive");
                    }
                  }}
                >
                  <div className="list-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: "1.1rem" }}>{reward.productName}</h3>
                      <p style={{ margin: "0.25rem 0", color: "var(--muted)", fontSize: "0.85rem" }}>
                        Cycle {reward.cycleNumber} · Earned {formatTimestamp(reward.createdAt)}
                      </p>
                      {isReceived && reward.receivedAt && (
                        <p style={{ margin: 0, color: "#d97706", fontSize: "0.8rem", fontWeight: 600 }}>
                          Received at {formatTimestamp(reward.receivedAt)}
                        </p>
                      )}
                      {isEarned && (
                        <span style={{ fontSize: "0.75rem", color: "var(--primary-color)", fontWeight: 500 }}>
                          Tap to mark as received
                        </span>
                      )}
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div className="list-amount" style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
                        {money(reward.amountPaise)}
                      </div>
                      <span
                        className={`badge ${isReceived ? "amber-badge" : "ready"}`}
                        style={{
                          display: "inline-block",
                          marginTop: "0.25rem",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "4px",
                          fontSize: "0.75rem",
                          fontWeight: "bold",
                          backgroundColor: isReceived ? "#fef3c7" : "#d1fae5",
                          color: isReceived ? "#b45309" : "#047857",
                        }}
                      >
                        {reward.status}
                      </span>

                      {isReceived && (
                        <div style={{ marginTop: "0.5rem" }}>
                          <button
                            className="secondary-button"
                            style={{
                              padding: "0.25rem 0.6rem",
                              fontSize: "0.75rem",
                              lineHeight: 1,
                              minHeight: "auto",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedReward(reward);
                              setConfirmMode("undo");
                            }}
                          >
                            UNDO
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <Pagination
            currentPage={page}
            pageSize={pageSize}
            totalItems={filteredRewards.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      ) : (
        <Empty icon={Trophy} text="No Offers earned in this session." />
      )}

      {/* Confirmation Dialog for Receive */}
      <AlertDialog open={confirmMode === "receive"} onOpenChange={(open) => !open && setConfirmMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this Offer as Received?</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm that you have actually received this Offer. This will change the Offer status from EARNED to RECEIVED.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selectedReward && (
            <div className="dialog-summary">
              <span>Product <strong>{selectedReward.productName}</strong></span>
              <span>Offer Value <strong>{money(selectedReward.amountPaise)}</strong></span>
              <span>Cycle Number <strong>Cycle {selectedReward.cycleNumber}</strong></span>
              <span>Earned Date/Time <strong>{formatTimestamp(selectedReward.createdAt)}</strong></span>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                void handleMarkReceived();
              }}
            >
              {submitting ? "Updating…" : "Yes, Mark as Received"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation Dialog for Undo */}
      <AlertDialog open={confirmMode === "undo"} onOpenChange={(open) => !open && setConfirmMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Undo Received Status?</AlertDialogTitle>
            <AlertDialogDescription>
              This will change the Offer back from RECEIVED to EARNED.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selectedReward && (
            <div className="dialog-summary">
              <span>Product <strong>{selectedReward.productName}</strong></span>
              <span>Offer Value <strong>{money(selectedReward.amountPaise)}</strong></span>
              <span>Cycle Number <strong>Cycle {selectedReward.cycleNumber}</strong></span>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
            <button
              className="danger-button"
              disabled={submitting}
              style={{ width: "auto" }}
              onClick={(event) => {
                event.preventDefault();
                void handleUndoReceived();
              }}
            >
              {submitting ? "Undoing…" : "Undo"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function HistoryScreen({ sales, closures, money, navigate, formatTimestamp }: { sales: SaleRecord[]; closures: DayCloseSnapshot[]; money: (value: number) => string; navigate: (screen: Screen) => void; formatTimestamp: (value: string) => string }) {
  const [tab, setTab] = useState<"sales" | "closed-days">("sales");
  const [selectedClosure, setSelectedClosure] = useState<DayCloseSnapshot | null>(null);
  const [filter, setFilter] = useState<DateFilterValue>({ preset: "all" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  useEffect(() => {
    setPage(1);
  }, [filter, tab]);

  const filteredSales = useMemo(() => {
    if (filter.preset === "all") return sales;
    const { startDate, endDate } = computeEffectiveDateRange(filter, new Date().toISOString().split("T")[0]);
    return sales.filter((s) => {
      const bDate = s.businessDate || s.createdAt.split("T")[0];
      if (startDate && bDate < startDate) return false;
      if (endDate && bDate > endDate) return false;
      return true;
    });
  }, [sales, filter]);

  const filteredClosures = useMemo(() => {
    if (filter.preset === "all") return closures;
    const { startDate, endDate } = computeEffectiveDateRange(filter, new Date().toISOString().split("T")[0]);
    return closures.filter((c) => {
      const bDate = c.businessDate;
      if (startDate && bDate < startDate) return false;
      if (endDate && bDate > endDate) return false;
      return true;
    });
  }, [closures, filter]);

  const paginatedSales = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredSales.slice(start, start + pageSize);
  }, [filteredSales, page, pageSize]);

  const paginatedClosures = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredClosures.slice(start, start + pageSize);
  }, [filteredClosures, page, pageSize]);

  return (
    <>
      <PageTitle title="History & Closed Days" navigate={navigate} />
      <BusinessDateFilter value={filter} onChange={setFilter} />
      
      {/* Tab Switcher */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        <button
          className={tab === "sales" ? "primary-button" : "secondary-button"}
          style={{ flex: 1, padding: "0.6rem", fontSize: "0.9rem" }}
          onClick={() => setTab("sales")}
        >
          Sales History ({filteredSales.length})
        </button>
        <button
          className={tab === "closed-days" ? "primary-button" : "secondary-button"}
          style={{ flex: 1, padding: "0.6rem", fontSize: "0.9rem" }}
          onClick={() => setTab("closed-days")}
        >
          Closed Business Days ({filteredClosures.length})
        </button>
      </div>

      {tab === "sales" ? (
        <>
          <div className="section-head">
            <div>
              <h2>Sales History</h2>
              <p>{filteredSales.length} preserved transaction record{filteredSales.length === 1 ? "" : "s"}</p>
            </div>
          </div>
          {filteredSales.length ? (
            <>
              <div className="list">
                {paginatedSales.map((sale) => (
                  <article className="list-card" key={sale.id}>
                    <div className="list-row">
                      <div>
                        <h3>{sale.productName}</h3>
                        <p>{sale.businessDate ? `${sale.businessDate} · ` : ""}{formatTimestamp(sale.createdAt)} · Qty {sale.quantity}</p>
                      </div>
                      <div className="list-amount">
                        {money(sale.grossSalesPaise)}
                        <p>Gross Sales</p>
                      </div>
                    </div>
                    <div className="list-details">
                      <div><span>Normal ({sale.normalUnits})</span><strong>{money(sale.totalNormalCommissionPaise)}</strong></div>
                      <div><span>Offer ({sale.fullUnits})</span><strong>{money(sale.totalFullCommissionPaise)}</strong></div>
                      <div><span>Net Collection</span><strong>{money(sale.netCollectionPaise)}</strong></div>
                    </div>
                  </article>
                ))}
              </div>

              <Pagination
                currentPage={page}
                pageSize={pageSize}
                totalItems={filteredSales.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          ) : (
            <Empty icon={History} text="No sales have been recorded for this filter." />
          )}
        </>
      ) : (
        <>
          <div className="section-head">
            <div>
              <h2>Closed Business Days</h2>
              <p>{filteredClosures.length} confirmed business day closure{filteredClosures.length === 1 ? "" : "s"}</p>
            </div>
          </div>
          {filteredClosures.length ? (
            <>
              <div className="list">
                {paginatedClosures.map((c) => (
                  <article
                    className="list-card"
                    key={c.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelectedClosure(c)}
                  >
                    <div className="list-row">
                      <div>
                        <h3>Business Date: {c.businessDate}</h3>
                        <p>Closed at {formatTimestamp(c.createdAt)} · Version {c.closureVersion}</p>
                      </div>
                      <span className="badge ready">CLOSED</span>
                    </div>
                    {c.reportText && (
                      <p style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.85rem", whiteSpace: "pre-line" }}>
                        {c.reportText.split("\n\n")[0]}
                      </p>
                    )}
                    <span style={{ fontSize: "0.75rem", color: "var(--primary-color)", fontWeight: 500, marginTop: "0.5rem", display: "inline-block" }}>
                      Tap to view full closure summary
                    </span>
                  </article>
                ))}
              </div>

              <Pagination
                currentPage={page}
                pageSize={pageSize}
                totalItems={filteredClosures.length}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            </>
          ) : (
            <Empty icon={CalendarCheck} text="No closed business days found." />
          )}

          {/* Full Report Dialog */}
          <AlertDialog open={!!selectedClosure} onOpenChange={(open) => !open && setSelectedClosure(null)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Business Day Closure Summary</AlertDialogTitle>
                <AlertDialogDescription>
                  Date: {selectedClosure?.businessDate} · Closed at {selectedClosure?.createdAt ? formatTimestamp(selectedClosure.createdAt) : ""}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {selectedClosure && (
                <pre className="list-card report-text" style={{ maxHeight: "300px", overflowY: "auto", fontSize: "0.85rem", padding: "1rem" }}>
                  {selectedClosure.reportText}
                </pre>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel>Close</AlertDialogCancel>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </>
  );
}

function DayCloseScreen({ state, clock, trustedTime, money, navigate, reload, showToast }: TimeProps & { money: (value: number) => string; navigate: (screen: Screen) => void; reload: (silent?: boolean) => Promise<void>; showToast: (toast: ToastState) => void }) {
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmedCloseTime, setConfirmedCloseTime] = useState<string | null>(state.daySession?.closedAt ?? null);
  const startedAt = state.daySession ? new Date(state.daySession.startedAt) : null;
  const durationEnd = confirmedCloseTime ? new Date(confirmedCloseTime) : trustedTime;
  async function closeDay() {
    if (!state.daySession || state.daySession.status !== "OPEN" || !clock.synchronized) return;
    setClosing(true);
    try {
      const result = await api<{ reportText: string; whatsappNumber: string; closedAt: string }>("/api/day-close", {
        method: "POST",
        body: JSON.stringify({ sessionId: state.daySession.id }),
      });
      setReport(result.reportText);
      setConfirmedCloseTime(result.closedAt);
      await reload(true);
      setConfirmOpen(false);
      showToast({ message: "Business day closed with server-confirmed time." });
      navigate("home");
    } catch (closeError) {
      showToast({ message: closeError instanceof Error ? closeError.message : "Day Close failed.", error: true });
    } finally { setClosing(false); }
  }
  async function copyReport() {
    await navigator.clipboard.writeText(report);
    showToast({ message: "Report copied." });
  }
  return <><PageTitle title="Day Close" navigate={navigate} /><TimeCard state={state} clock={clock} trustedTime={trustedTime} compact />
    {state.daySessionStatus === "PREVIOUS_DAY_STILL_OPEN" && <PreviousDayWarning state={state} navigate={navigate} money={money} formatTime={(date) => clock.formatTime(date, false)} />}
    <section className="session-timing"><div><span>Business Date</span><strong>{state.daySession?.businessDate ?? "Not started"}</strong></div><div><span>Started</span><strong>{startedAt ? clock.formatTime(startedAt, false) : "—"}</strong></div><div><span>Current Time</span><strong>{clock.formatTime(trustedTime, false)}</strong></div><div><span>Closed</span><strong>{confirmedCloseTime ? clock.formatTime(new Date(confirmedCloseTime), false) : "Not closed"}</strong></div><div><span>Working Duration</span><strong>{startedAt ? formatWorkingDuration(startedAt, durationEnd) : "—"}</strong></div></section>
    <div className="section-head"><div><h2>Product-wise stock review</h2><p>Review every picked, sold, and remaining quantity.</p></div></div>
    <div className="list">{state.daySession?.stockItems.map((item) => <article className="list-card" key={item.id}><div className="list-row"><h3>{item.productName}</h3><span className="badge">{item.remainingQuantity} remaining</span></div><div className="stock-strip"><span>Picked <strong>{item.pickedQuantity}</strong></span><span>Sold <strong>{item.soldQuantity}</strong></span><span>Remaining <strong>{item.remainingQuantity}</strong></span></div></article>)}</div>
    <section className="close-summary"><h2>Session summary</h2><div className="review-row"><span>Total Units Sold</span><strong>{state.dashboard.totalUnits}</strong></div><div className="review-row"><span>Gross Sales</span><strong>{money(state.dashboard.grossSalesPaise)}</strong></div><div className="review-row"><span>Normal Commission</span><strong>{money(state.dashboard.totalNormalCommissionPaise)}</strong></div><div className="review-row"><span>Offers Earned</span><strong>{money(state.dashboard.totalFullCommissionPaise)}</strong></div><div className="review-row"><span>Salesperson Earnings</span><strong>{money(state.dashboard.totalEarningsPaise)}</strong></div><div className="review-row"><span>Daily Expenses</span><strong>{money(state.dashboard.totalExpensesPaise)}</strong></div><div className="review-row"><span>Company Payable</span><strong>{money(state.dashboard.netCollectionPaise)}</strong></div></section>
    {report ? <><pre className="list-card report-text">{report}</pre><button className="secondary-button full-width" onClick={() => void copyReport()}>Copy Message</button></> :
      <button className="primary-button full-width" disabled={closing || state.daySession?.status !== "OPEN" || !clock.synchronized} onClick={() => setConfirmOpen(true)}><CalendarCheck size={20} />{state.daySession?.status === "CLOSED" ? "Day Already Closed" : !clock.synchronized ? "Waiting for trusted time" : "CONTINUE TO DAY CLOSE"}</button>}
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{state.daySessionStatus === "PREVIOUS_DAY_STILL_OPEN" ? "Close Previous Business Day?" : "Close Current Business Day?"}</AlertDialogTitle>
          <AlertDialogDescription>Review the previous day&apos;s stock and financial details before closing it. After closing, no additional sales can be added unless the day is formally reopened.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="dialog-summary">
          <span>Business Date <strong>{state.daySession?.businessDate}</strong></span>
          <span>Total Units Sold <strong>{state.dashboard.totalUnits}</strong></span>
          <span>Salesperson Earnings <strong>{money(state.dashboard.totalEarningsPaise)}</strong></span>
          <span>Daily Expenses <strong>{money(state.dashboard.totalExpensesPaise)}</strong></span>
          <span>Company Payable <strong>{money(state.dashboard.netCollectionPaise)}</strong></span>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={closing}>CANCEL</AlertDialogCancel>
          <AlertDialogAction disabled={closing} onClick={(event) => { event.preventDefault(); void closeDay(); }}>{closing ? "CLOSING…" : "CONFIRM DAY CLOSE"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function SettingsScreen({ state, settings, navigate, reload, showToast }: { state: TrackerState; settings: AppSettings; navigate: (screen: Screen) => void; reload: (silent?: boolean) => Promise<void>; showToast: (toast: ToastState) => void }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);

  const canResetActiveDay = state.daySession && state.daySession.status === "OPEN" && state.resetEligibility.allowed;

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(form) });
      await reload(true);
      showToast({ message: "Settings saved." });
    } catch (settingsError) {
      showToast({ message: settingsError instanceof Error ? settingsError.message : "Settings could not be saved.", error: true });
    } finally { setSaving(false); }
  }

  async function handleResetActiveDay() {
    if (!state.daySession || resetting) return;
    setResetting(true);
    try {
      await api("/api/day-reset", {
        method: "POST",
        body: JSON.stringify({ sessionId: state.daySession.id }),
      });
      await reload(false);
      setResetDialogOpen(false);
      showToast({ message: "Active business day reset successfully." });
      navigate("home");
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Failed to reset active business day.", error: true });
    } finally {
      setResetting(false);
    }
  }

  return <><PageTitle title="Settings & More" navigate={navigate} /><section className="settings-card">
    <div className="field"><label htmlFor="salesman">Salesman name</label><input id="salesman" value={form.salesmanName} onChange={(event) => setForm({ ...form, salesmanName: event.target.value })} /></div>
    <div className="field"><label htmlFor="business">Business name</label><input id="business" value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} /></div>
    <div className="field"><label htmlFor="whatsapp">WhatsApp report number</label><input id="whatsapp" inputMode="tel" placeholder="Country code and number" value={form.whatsappNumber} onChange={(event) => setForm({ ...form, whatsappNumber: event.target.value })} /></div>
    <div className="field"><label>Business timezone</label><input value={form.timezone} disabled /></div>
    <div className="switch-row"><div><strong>Live refresh</strong><p className="eyebrow" style={{ marginTop: ".2rem" }}>Keep totals up to date</p></div><button className={`switch${form.realtimeEnabled ? " on" : ""}`} role="switch" aria-checked={form.realtimeEnabled} onClick={() => setForm({ ...form, realtimeEnabled: !form.realtimeEnabled })}><span /></button></div>
    <button className="primary-button full-width" disabled={saving} onClick={() => void save()}><Save size={19} />{saving ? "Saving…" : "Save Settings"}</button>
    <div style={{ marginTop: "2rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <button className="secondary-button full-width" onClick={() => navigate("historical-entry")} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
        <CalendarCheck size={19} /> Previous Business Data
      </button>

      {canResetActiveDay && (
        <button
          className="danger-button full-width"
          onClick={() => setResetDialogOpen(true)}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}
        >
          <RotateCcw size={19} /> Reset Active Business Day
        </button>
      )}
    </div>

    {/* Reset Active Day Confirmation Dialog */}
    <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset Active Business Day?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove all sales, offers, expenses, and picked-product entries linked to this active day ({state.daySession?.businessDate}). This day will not be counted as a completed business day. All data from previous days will remain unchanged.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
          <button
            className="danger-button"
            disabled={resetting}
            style={{ width: "auto" }}
            onClick={(e) => {
              e.preventDefault();
              void handleResetActiveDay();
            }}
          >
            {resetting ? "Resetting…" : "RESET ACTIVE DAY"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section></>;
}

function HistoricalEntryScreen({ state, navigate, reload, showToast }: { state: TrackerState; navigate: (screen: Screen) => void; reload: (silent?: boolean) => Promise<void>; showToast: (toast: ToastState) => void }) {
  const [step, setStep] = useState<"date" | "pickup" | "sales" | "review">("date");
  const [date, setDate] = useState("");
  const [pickup, setPickup] = useState<Record<string, number>>({});
  const [sales, setSales] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  const hasDraftData = date !== "" || Object.values(pickup).some(q => q > 0) || Object.values(sales).some(q => q > 0);

  function cancelDraft() {
    setStep("date");
    setDate("");
    setPickup({});
    setSales({});
    setCancelConfirmOpen(false);
    navigate("settings");
  }

  function requestCancel() {
    if (hasDraftData) {
      setCancelConfirmOpen(true);
    } else {
      cancelDraft();
    }
  }

  async function submit() {
    setSubmitting(true);
    try {
      const pickupItems = Object.entries(pickup).filter(([, q]) => q > 0).map(([id, q]) => ({ productId: id, pickedQuantity: q }));
      const salesItems = Object.entries(sales).filter(([, q]) => q > 0).map(([id, q]) => ({ productId: id, quantity: q }));

      await api("/api/historical-entry", {
        method: "POST",
        body: JSON.stringify({ businessDate: date, pickupItems, salesItems })
      });
      await reload(false);
      showToast({ message: "Historical data saved successfully." });
      navigate("history");
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Failed to save historical data.", error: true });
    } finally {
      setSubmitting(false);
    }
  }

  const products = state.products;

  const CancelDraftDialog = (
    <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel Historical Draft?</AlertDialogTitle>
          <AlertDialogDescription>All unsaved draft data will be discarded. Confirmed historical records already saved to the database will not be affected.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>KEEP EDITING</AlertDialogCancel>
          <AlertDialogAction onClick={cancelDraft}>DISCARD DRAFT</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (step === "date") {
    return <><PageTitle title="Previous Business Data" navigate={() => navigate("settings")} />
      {CancelDraftDialog}
      <section className="settings-card">
        <p className="eyebrow" style={{ marginBottom: "1rem" }}>SELECT PAST BUSINESS DATE</p>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "1.5rem" }}>
          <Calendar
            selectedDate={date}
            onSelectDate={(d) => setDate(d)}
            maxDate={new Date().toISOString().split("T")[0]}
          />
        </div>
        {date && (
          <p style={{ textAlign: "center", fontSize: "0.9rem", fontWeight: 600, color: "var(--primary-color)", marginBottom: "1rem" }}>
            Selected Date: {date}
          </p>
        )}
        <button className="primary-button full-width" disabled={!date} onClick={() => setStep("pickup")}>Next: Stock Pickup</button>
        <button className="secondary-button full-width" style={{ marginTop: "0.75rem" }} onClick={requestCancel}>CANCEL DRAFT</button>
      </section>
    </>;
  }

  if (step === "pickup") {
    return <><PageTitle title="Stock Pickup" navigate={() => setStep("date")} />
      {CancelDraftDialog}
      <section className="settings-card">
        <p className="eyebrow" style={{ marginBottom: "1rem" }}>ENTER STARTING STOCK FOR {date}</p>
        {products.map(p => (
          <div key={p.id} className="field">
            <label>{p.name}</label>
            <input type="number" min="0" value={pickup[p.id] || ""} onChange={e => setPickup({ ...pickup, [p.id]: parseInt(e.target.value) || 0 })} />
          </div>
        ))}
        <button className="primary-button full-width" onClick={() => setStep("sales")}>Next: Sales</button>
        <button className="secondary-button full-width" style={{ marginTop: "0.75rem" }} onClick={requestCancel}>CANCEL DRAFT</button>
      </section>
    </>;
  }

  if (step === "sales") {
    return <><PageTitle title="Sales" navigate={() => setStep("pickup")} />
      {CancelDraftDialog}
      <section className="settings-card">
        <p className="eyebrow" style={{ marginBottom: "1rem" }}>ENTER TOTAL SALES FOR {date}</p>
        {products.map(p => {
          const picked = pickup[p.id] || 0;
          if (picked === 0) return null;
          return <div key={p.id} className="field">
            <label>{p.name} (Max: {picked})</label>
            <input type="number" min="0" max={picked} value={sales[p.id] || ""} onChange={e => setSales({ ...sales, [p.id]: parseInt(e.target.value) || 0 })} />
          </div>;
        })}
        <button className="primary-button full-width" onClick={() => setStep("review")}>Next: Review</button>
        <button className="secondary-button full-width" style={{ marginTop: "0.75rem" }} onClick={requestCancel}>CANCEL DRAFT</button>
      </section>
    </>;
  }

  return <><PageTitle title="Review" navigate={() => setStep("sales")} />
    {CancelDraftDialog}
    <section className="settings-card">
      <p className="eyebrow" style={{ marginBottom: "1rem" }}>CONFIRM HISTORICAL DATA FOR {date}</p>
      <div className="summary-list">
        {products.filter(p => (pickup[p.id] || 0) > 0).map(p => (
          <div key={p.id} style={{ display: "flex", justifyContent: "space-between", marginBottom: ".5rem", paddingBottom: ".5rem", borderBottom: "1px solid var(--border)" }}>
            <span>{p.name}</span>
            <div style={{ textAlign: "right" }}>
              <div>Picked: {pickup[p.id] || 0}</div>
              <div><strong>Sold: {sales[p.id] || 0}</strong></div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: "2rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <button className="primary-button full-width" disabled={submitting} onClick={() => void submit()}>
          {submitting ? "SAVING..." : "CONFIRM AND SAVE"}
        </button>
        <button className="secondary-button full-width" disabled={submitting} onClick={requestCancel}>CANCEL DRAFT</button>
      </div>
    </section>
  </>;
}

function ExpenseScreen({ state, money, navigate, reload, showToast }: TimeProps & {
  money: (value: number) => string;
  navigate: (screen: Screen) => void;
  reload: (silent?: boolean) => Promise<void>;
  showToast: (toast: ToastState) => void;
}) {
  const session = state.daySession;
  const isSessionOpen = session?.status === "OPEN";

  const expenses = state.expenses || [];
  const petrolExpense = expenses.find((e) => e.category === "Petrol");
  const foodExpense = expenses.find((e) => e.category === "Food");
  const otherExpenses = expenses.filter((e) => e.category === "Other");

  const [petrolRupees, setPetrolRupees] = useState(petrolExpense ? String(petrolExpense.amountPaise / 100) : "");
  const [foodRupees, setFoodRupees] = useState(foodExpense ? String(foodExpense.amountPaise / 100) : "");

  const [otherDescription, setOtherDescription] = useState("");
  const [otherRupees, setOtherRupees] = useState("");
  const [savingCategory, setSavingCategory] = useState<string | null>(null);

  useEffect(() => {
    if (petrolExpense) setPetrolRupees(String(petrolExpense.amountPaise / 100));
    else setPetrolRupees("");
    if (foodExpense) setFoodRupees(String(foodExpense.amountPaise / 100));
    else setFoodRupees("");
  }, [expenses]);

  const totalOtherPaise = otherExpenses.reduce((sum, e) => sum + e.amountPaise, 0);
  const totalExpensesPaise = state.dashboard.totalExpensesPaise || expenses.reduce((sum, e) => sum + e.amountPaise, 0);

  async function handleSaveSingleCategory(category: "Petrol" | "Food", valStr: string) {
    if (!session || !isSessionOpen) return;
    const existing = category === "Petrol" ? petrolExpense : foodExpense;
    const amountRupees = parseFloat(valStr);
    
    if (isNaN(amountRupees) || amountRupees <= 0) {
      if (existing) {
        setSavingCategory(category);
        try {
          await api("/api/expenses", {
            method: "POST",
            body: JSON.stringify({ action: "delete", expenseId: existing.id }),
          });
          await reload(true);
          showToast({ message: `${category} expense removed.` });
        } catch (err) {
          showToast({ message: err instanceof Error ? err.message : "Failed to delete expense", error: true });
        } finally {
          setSavingCategory(null);
        }
      }
      return;
    }

    const amountPaise = Math.round(amountRupees * 100);
    setSavingCategory(category);

    try {
      if (existing) {
        await api("/api/expenses", {
          method: "POST",
          body: JSON.stringify({ action: "update", expenseId: existing.id, amountPaise }),
        });
      } else {
        await api("/api/expenses", {
          method: "POST",
          body: JSON.stringify({ sessionId: session.id, category, amountPaise }),
        });
      }
      await reload(true);
      showToast({ message: `${category} expense saved.` });
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Failed to save expense", error: true });
    } finally {
      setSavingCategory(null);
    }
  }

  async function handleAddOtherExpense() {
    if (!session || !isSessionOpen) return;
    const amountRupees = parseFloat(otherRupees);
    if (isNaN(amountRupees) || amountRupees <= 0) {
      showToast({ message: "Please enter a valid amount for Other expense.", error: true });
      return;
    }
    const amountPaise = Math.round(amountRupees * 100);
    setSavingCategory("Other");

    try {
      await api("/api/expenses", {
        method: "POST",
        body: JSON.stringify({
          sessionId: session.id,
          category: "Other",
          amountPaise,
          description: otherDescription.trim() || undefined,
        }),
      });
      setOtherRupees("");
      setOtherDescription("");
      await reload(true);
      showToast({ message: "Other expense added." });
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Failed to add expense", error: true });
    } finally {
      setSavingCategory(null);
    }
  }

  async function handleDeleteExpense(expenseId: string) {
    if (!session || !isSessionOpen) return;
    setSavingCategory(expenseId);
    try {
      await api("/api/expenses", {
        method: "POST",
        body: JSON.stringify({ action: "delete", expenseId }),
      });
      await reload(true);
      showToast({ message: "Expense deleted." });
    } catch (err) {
      showToast({ message: err instanceof Error ? err.message : "Failed to delete expense", error: true });
    } finally {
      setSavingCategory(null);
    }
  }

  return (
    <>
      <PageTitle title="Daily Expenses" navigate={navigate} />

      {!isSessionOpen ? (
        <section className="settings-card">
          <p style={{ textAlign: "center", color: "var(--muted)" }}>
            Expenses can only be added to an active business day. Start a day to record expenses.
          </p>
        </section>
      ) : (
        <>
          <section className="hero">
            <p className="hero-label">Total Daily Expenses</p>
            <h2 className="hero-value">{money(totalExpensesPaise)}</h2>
            <p className="hero-foot">
              Deducted from Company Payable (never reduces commission)
            </p>
          </section>

          <section className="settings-card" style={{ marginBottom: "1rem" }}>
            <h3 style={{ margin: "0 0 1rem 0", fontSize: "1.1rem" }}>Standard Expenses</h3>

            <div className="field" style={{ marginBottom: "1.25rem" }}>
              <label htmlFor="petrol-input">Petrol Expense (₹)</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  id="petrol-input"
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={petrolRupees}
                  onChange={(e) => setPetrolRupees(e.target.value)}
                />
                <button
                  className="secondary-button"
                  style={{ width: "auto", minWidth: "80px" }}
                  disabled={savingCategory === "Petrol"}
                  onClick={() => void handleSaveSingleCategory("Petrol", petrolRupees)}
                >
                  {savingCategory === "Petrol" ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="food-input">Food Expense (₹)</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  id="food-input"
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={foodRupees}
                  onChange={(e) => setFoodRupees(e.target.value)}
                />
                <button
                  className="secondary-button"
                  style={{ width: "auto", minWidth: "80px" }}
                  disabled={savingCategory === "Food"}
                  onClick={() => void handleSaveSingleCategory("Food", foodRupees)}
                >
                  {savingCategory === "Food" ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </section>

          <section className="settings-card" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem" }}>Other Expenses</h3>
              <strong style={{ fontSize: "0.95rem", color: "var(--primary-color)" }}>
                Total: {money(totalOtherPaise)}
              </strong>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem", background: "rgba(255,255,255,0.03)", padding: "0.85rem", borderRadius: "8px", border: "1px solid var(--border-color, #333)" }}>
              <div className="field">
                <label htmlFor="other-desc">Description (e.g. Parking, Repair, Toll)</label>
                <input
                  id="other-desc"
                  placeholder="e.g. Parking charge"
                  value={otherDescription}
                  onChange={(e) => setOtherDescription(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="other-amt">Amount (₹)</label>
                <input
                  id="other-amt"
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={otherRupees}
                  onChange={(e) => setOtherRupees(e.target.value)}
                />
              </div>
              <button
                className="primary-button full-width"
                disabled={savingCategory === "Other" || !otherRupees}
                onClick={() => void handleAddOtherExpense()}
              >
                {savingCategory === "Other" ? "Adding..." : "+ Add Other Expense"}
              </button>
            </div>

            {otherExpenses.length > 0 ? (
              <div className="list">
                {otherExpenses.map((exp) => (
                  <article key={exp.id} className="list-card" style={{ padding: "0.75rem", marginBottom: "0.5rem" }}>
                    <div className="list-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: "0.95rem" }}>{exp.description || "Other Expense"}</h4>
                        <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Category: Other</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                        <strong style={{ fontSize: "1rem" }}>{money(exp.amountPaise)}</strong>
                        <button
                          className="secondary-button"
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem", minHeight: "auto" }}
                          disabled={savingCategory === exp.id}
                          onClick={() => void handleDeleteExpense(exp.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p style={{ textAlign: "center", color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>
                No other expenses recorded for today.
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}

function Empty({ icon: Icon, text }: { icon: typeof Gift; text: string }) {
  return <div className="empty-card"><Icon size={30} /><div>{text}</div></div>;
}

function BottomNav({ screen, navigate }: { screen: Screen; navigate: (screen: Screen) => void }) {
  const items = [
    { screen: "home" as const, icon: Home, label: "Home" },
    { screen: "sale" as const, icon: ShoppingBag, label: "Sale" },
    { screen: "dashboard" as const, icon: BarChart3, label: "Dashboard" },
    { screen: "rewards" as const, icon: Trophy, label: "Offers" },
    { screen: "history" as const, icon: Clock3, label: "History" },
    { screen: "settings" as const, icon: MoreHorizontal, label: "More" },
  ];
  return <nav className="bottom-nav" aria-label="Main navigation">{items.map(({ screen: target, icon: Icon, label }) => <button key={target} className={`nav-button${screen === target ? " active" : ""}`} aria-current={screen === target ? "page" : undefined} onClick={() => navigate(target)}><Icon size={20} /><span>{label}</span></button>)}</nav>;
}
