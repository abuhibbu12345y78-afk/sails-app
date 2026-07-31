"use client";

import {
  AlertTriangle, ArrowLeft, BarChart3, Boxes, CalendarCheck, Check,
  ChevronRight, Clock3, CloudOff, Gift, History, Home, IndianRupee, Minus,
  MoreHorizontal, Package, Play, Plus, ReceiptIndianRupee, RefreshCw, Save,
  ShoppingBag, Sparkles, Trophy, UserRound, WalletCards, Wifi, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings, SaleRecord, TrackerState } from "../application/contracts";
import {
  DEFAULT_BUSINESS_TIMEZONE,
  formatWorkingDuration,
  toBusinessDate,
} from "../domain/business-time";
import { calculateSale, formatCurrency } from "../domain/commission";
import { isDateChangeWarning } from "../domain/day-session";
import type { Product } from "../domain/products";
import { useTrustedClock } from "../hooks/use-trusted-clock";

type Screen = "home" | "start-day" | "sale" | "dashboard" | "rewards" | "history" | "day-close" | "settings";
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
      setState(await api<TrackerState>("/api/state"));
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
        {screen === "home" && <HomeScreen {...timeProps} state={state} money={money} navigate={navigate} dateChanged={dateChanged} />}
        {screen === "start-day" && <StartDayScreen {...timeProps} state={state} navigate={navigate} reload={load} showToast={setToast} />}
        {screen === "sale" && <SaleScreen state={state} money={money} navigate={navigate} openSale={openSale} dateChanged={dateChanged} />}
        {screen === "dashboard" && <DashboardScreen {...timeProps} state={state} money={money} navigate={navigate} />}
        {screen === "rewards" && <RewardsScreen state={state} money={money} navigate={navigate} formatTimestamp={(value) => clock.formatTime(new Date(value), false)} />}
        {screen === "history" && <HistoryScreen sales={state.sales} money={money} navigate={navigate} formatTimestamp={(value) => clock.formatTime(new Date(value), false)} />}
        {screen === "day-close" && <DayCloseScreen {...timeProps} state={state} money={money} navigate={navigate} reload={load} showToast={setToast} />}
        {screen === "settings" && <SettingsScreen settings={state.settings} navigate={navigate} reload={load} showToast={setToast} />}
      </main>
      <BottomNav screen={screen} navigate={navigate} />
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
              <div className="review-row"><span>Full Commission ({preview.fullUnits})</span><strong>{money(preview.totalFullCommissionPaise)}</strong></div>
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
  return <header className="topbar"><div><p className="eyebrow">GOOD DAY, {state.settings.salesmanName.toUpperCase()}</p><h1>{state.settings.businessName}</h1></div><div className="avatar" aria-hidden="true"><UserRound size={22} /></div></header>;
}

function TimeCard({ state, clock, trustedTime, compact = false }: TimeProps & { compact?: boolean }) {
  return <section className={`time-card${compact ? " compact" : ""}`}>
    <div><p className="business-date">{clock.formatDate(trustedTime)}</p><p className="live-time">{clock.formatTime(trustedTime)} <span>IST</span></p></div>
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
        <p className="live-time">{clock.formatTime(trustedTime)} <span>IST</span></p>
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
      <p className="hero-label">Session earnings</p>
      <h2 className="hero-value">{money(state.dashboard.totalEarningsPaise)}</h2>
      <p className="hero-foot"><Sparkles size={17} /> From {state.dashboard.totalUnits} unit{state.dashboard.totalUnits === 1 ? "" : "s"} in this business day</p>
    </div>
  </section>;
}

function PreviousDayWarning({ state, navigate, money, formatTime }: { state: TrackerState; navigate: (screen: Screen) => void; money: (value: number) => string; formatTime: (date: Date) => string }) {
  if (!state.daySession || state.daySessionStatus !== "PREVIOUS_DAY_STILL_OPEN") return null;
  return <section className="warning-card">
    <div className="warning-title"><AlertTriangle size={22} /><div><h2>Previous Day Is Still Open</h2><p>{state.daySession.businessDate} · Started {formatTime(new Date(state.daySession.startedAt))}. Close it before starting a new business day.</p></div></div>
    <div className="stock-summary">{state.daySession.stockItems.map((item) => <div key={item.id}><strong>{item.productName}</strong><span>Picked {item.pickedQuantity} · Sold {item.soldQuantity} · Remaining {item.remainingQuantity}</span></div>)}</div>
    <div className="warning-finance"><span>Gross Sales <strong>{money(state.dashboard.grossSalesPaise)}</strong></span><span>Normal Commission <strong>{money(state.dashboard.totalNormalCommissionPaise)}</strong></span><span>Full Commission <strong>{money(state.dashboard.totalFullCommissionPaise)}</strong></span><span>Total Earnings <strong>{money(state.dashboard.totalEarningsPaise)}</strong></span><span>Net Collection <strong>{money(state.dashboard.netCollectionPaise)}</strong></span></div>
    <div className="warning-actions"><button className="secondary-button" onClick={() => navigate("dashboard")}>View Previous Day</button><button className="danger-button" onClick={() => navigate("day-close")}>Close Previous Day</button></div>
  </section>;
}

function HomeScreen({ state, clock, trustedTime, money, navigate, dateChanged }: TimeProps & { money: (value: number) => string; navigate: (screen: Screen) => void; dateChanged: boolean }) {
  const actions = [
    { screen: "sale" as const, icon: ShoppingBag, title: "Sale", text: state.daySessionStatus === "OPEN" ? "Record a product sale" : "Start a day before selling" },
    { screen: "dashboard" as const, icon: BarChart3, title: "Dashboard", text: "See session totals" },
    { screen: "rewards" as const, icon: Trophy, title: "Full Commission", text: "Review full earnings" },
    { screen: "history" as const, icon: History, title: "History", text: "Open session sales" },
  ];
  return <>
    <Header state={state} />
    <HomeSummaryCard state={state} clock={clock} trustedTime={trustedTime} money={money} />
    {dateChanged && state.daySessionStatus === "OPEN" && <section className="warning-card"><div className="warning-title"><AlertTriangle size={22} /><div><h2>The calendar date has changed</h2><p>The previous business day remains open and unchanged. Close {state.daySession?.businessDate} before starting the new day.</p></div></div><div className="warning-actions"><button className="secondary-button" onClick={() => navigate("dashboard")}>View Previous Day</button><button className="danger-button" onClick={() => navigate("day-close")}>Close Previous Day</button></div></section>}
    <PreviousDayWarning state={state} navigate={navigate} money={money} formatTime={(date) => clock.formatTime(date, false)} />
    {state.daySessionStatus === "NOT_STARTED" && <button className="start-day-callout" onClick={() => navigate("start-day")}><span className="icon-tile"><Play size={22} /></span><span><strong>Start New Day</strong><small>Enter today’s picked quantities</small></span><ChevronRight /></button>}
    {state.daySessionStatus === "CLOSED" && <section className="info-card"><CalendarCheck size={22} /><div><strong>Business day closed</strong><p>A new day will not start automatically. Start it manually after the calendar date changes.</p></div></section>}
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
  const canStart = state.daySessionStatus === "NOT_STARTED";
  async function startDay() {
    if (!canStart || !clock.synchronized) return;
    const dateLabel = clock.formatDate(trustedTime);
    if (!window.confirm(`Start the business day for ${dateLabel}? Picked quantities cannot be copied automatically.`)) return;
    setStarting(true);
    try {
      await api("/api/day-start", {
        method: "POST",
        body: JSON.stringify({ items: state.products.map((product) => ({ productId: product.id, pickedQuantity: quantities[product.id] ?? 0 })) }),
      });
      await reload(true);
      showToast({ message: "Business day started with server-confirmed time." });
      navigate("sale");
    } catch (startError) {
      showToast({ message: startError instanceof Error ? startError.message : "The business day could not be started.", error: true });
    } finally { setStarting(false); }
  }
  return <><PageTitle title="Start New Day" navigate={navigate} /><TimeCard state={state} clock={clock} trustedTime={trustedTime} compact />
    {!canStart && <section className="warning-card"><div className="warning-title"><AlertTriangle /><div><h2>New day unavailable</h2><p>{state.daySessionStatus === "PREVIOUS_DAY_STILL_OPEN" ? "Close the previous day first." : "This business date has already been started."}</p></div></div></section>}
    <div className="section-head"><div><h2>Select today’s picked quantities</h2><p>Products left at 0 are not picked today.</p></div></div>
    <div className="pickup-list">{state.products.map((product) => {
      const value = quantities[product.id] ?? 0;
      return <article className="pickup-card" key={product.id}><div><strong>{product.name}</strong><span>Commission progress continues at {product.progress} / {product.rewardThreshold}</span></div><div className="mini-quantity"><button aria-label={`Decrease ${product.name}`} onClick={() => setQuantities({ ...quantities, [product.id]: Math.max(0, value - 1) })}><Minus /></button><strong>{value}</strong><button aria-label={`Increase ${product.name}`} onClick={() => setQuantities({ ...quantities, [product.id]: Math.min(9999, value + 1) })}><Plus /></button></div></article>;
    })}</div>
    <button className="primary-button full-width sticky-action" disabled={!canStart || !clock.synchronized || starting} onClick={() => void startDay()}><Play size={19} />{starting ? "Starting…" : clock.synchronized ? "Confirm & Start Day" : "Waiting for trusted time"}</button>
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
        <span className={`badge${product.progress === product.rewardThreshold ? " ready" : ""}`}>{product.progress === product.rewardThreshold ? <><Sparkles size={12} /> Next: Full Commission</> : <>Cycle {product.cycleNumber}</>}</span>
        <span className="stock-line">{stock ? `Picked ${stock.pickedQuantity} · Sold ${stock.soldQuantity} · Left ${stock.remainingQuantity}` : "Not prepared"}</span>
        <span className="progress-row"><span>Commission Progress</span><strong>{product.progress} / {product.rewardThreshold}</strong></span>
        <span className="progress-track"><span className="progress-fill" style={{ width: `${product.progress / product.rewardThreshold * 100}%` }} /></span>
      </button>;
    })}</div></>;
}

function DashboardScreen({ state, clock, trustedTime, money, navigate }: TimeProps & { money: (value: number) => string; navigate: (screen: Screen) => void }) {
  const metrics = [
    { label: "Units Sold", value: String(state.dashboard.totalUnits), icon: ShoppingBag },
    { label: "Gross Sales", value: money(state.dashboard.grossSalesPaise), icon: ReceiptIndianRupee },
    { label: "Normal Commission", value: money(state.dashboard.totalNormalCommissionPaise), icon: WalletCards },
    { label: "Full Commission", value: money(state.dashboard.totalFullCommissionPaise), icon: Trophy },
    { label: "Total Earnings", value: money(state.dashboard.totalEarningsPaise), icon: IndianRupee, featured: true },
    { label: "Net Collection", value: money(state.dashboard.netCollectionPaise), icon: Package },
  ];
  return <><PageTitle title="Dashboard" navigate={navigate} /><TimeCard state={state} clock={clock} trustedTime={trustedTime} compact />
    <div className="dashboard-meta"><span><Clock3 size={15} /> Last updated {clock.formatTime(new Date(state.lastUpdatedAt), false)}</span><span><Wifi size={15} /> {state.settings.realtimeEnabled ? "Live refresh enabled" : "Live refresh off"}</span></div>
    <section className="metrics">{metrics.map(({ label, value, icon: Icon, featured }) => <article className={`metric${featured ? " featured" : ""}`} key={label}><Icon className="metric-icon" size={21} /><span>{label}</span><strong>{value}</strong></article>)}</section>
    <div className="section-head"><div><h2>Daily Stock</h2><p>Stock resets only when a new day is manually started.</p></div></div>
    <div className="list">{state.daySession?.stockItems.map((item) => <article className="list-card" key={item.id}><div className="list-row"><div><h3>{item.productName}</h3><p>Picked {item.pickedQuantity}</p></div><span className="badge">{item.remainingQuantity} remaining</span></div><div className="stock-strip"><span>Picked <strong>{item.pickedQuantity}</strong></span><span>Sold <strong>{item.soldQuantity}</strong></span><span>Remaining <strong>{item.remainingQuantity}</strong></span></div></article>) ?? <Empty icon={Boxes} text="Start a business day to prepare daily stock." />}</div>
    <div className="section-head"><div><h2>Persistent Commission Progress</h2><p>Day Start and Day Close never reset these cycles.</p></div></div>
    <div className="list">{state.products.map((product) => <article className="list-card" key={product.id}><div className="list-row"><div><h3>{product.name}</h3><p>Cycle {product.cycleNumber}</p></div><span className={`badge${product.progress === product.rewardThreshold ? " ready" : ""}`}>{product.progress} / {product.rewardThreshold}</span></div><div className="progress-track" style={{ marginTop: ".75rem" }}><div className="progress-fill" style={{ width: `${product.progress / product.rewardThreshold * 100}%` }} /></div></article>)}</div>
  </>;
}

function RewardsScreen({ state, money, navigate, formatTimestamp }: { state: TrackerState; money: (value: number) => string; navigate: (screen: Screen) => void; formatTimestamp: (value: string) => string }) {
  const total = state.rewards.reduce((sum, reward) => sum + reward.amountPaise, 0);
  return <><PageTitle title="Full Commission" navigate={navigate} /><section className="hero"><p className="hero-label">Session Full Commission</p><h2 className="hero-value">{money(total)}</h2><p className="hero-foot"><Trophy size={17} /> {state.rewards.length} earned record{state.rewards.length === 1 ? "" : "s"}</p></section>
    <div className="section-head"><div><h2>Commission Records</h2><p>Persistent history remains in the database.</p></div></div>
    {state.rewards.length ? <div className="list">{state.rewards.map((reward) => <article className="list-card" key={reward.id}><div className="list-row"><div><h3>{reward.productName}</h3><p>{formatTimestamp(reward.createdAt)} · Cycle {reward.cycleNumber}</p></div><div className="list-amount">{money(reward.amountPaise)}</div></div></article>)}</div> : <Empty icon={Trophy} text="No Full Commission earned in this session." />}</>;
}

function HistoryScreen({ sales, money, navigate, formatTimestamp }: { sales: SaleRecord[]; money: (value: number) => string; navigate: (screen: Screen) => void; formatTimestamp: (value: string) => string }) {
  return <><PageTitle title="Sales History" navigate={navigate} /><div className="section-head"><div><h2>Current Business Day</h2><p>{sales.length} recent record{sales.length === 1 ? "" : "s"}</p></div></div>
    {sales.length ? <div className="list">{sales.map((sale) => <article className="list-card" key={sale.id}><div className="list-row"><div><h3>{sale.productName}</h3><p>{formatTimestamp(sale.createdAt)} · Qty {sale.quantity}</p></div><div className="list-amount">{money(sale.grossSalesPaise)}<p>Gross Sales</p></div></div><div className="list-details"><div><span>Normal ({sale.normalUnits})</span><strong>{money(sale.totalNormalCommissionPaise)}</strong></div><div><span>Full ({sale.fullUnits})</span><strong>{money(sale.totalFullCommissionPaise)}</strong></div><div><span>Net Collection</span><strong>{money(sale.netCollectionPaise)}</strong></div></div></article>)}</div> : <Empty icon={History} text="No sales have been recorded for this business day." />}</>;
}

function DayCloseScreen({ state, clock, trustedTime, money, navigate, reload, showToast }: TimeProps & { money: (value: number) => string; navigate: (screen: Screen) => void; reload: (silent?: boolean) => Promise<void>; showToast: (toast: ToastState) => void }) {
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState("");
  const [confirmedCloseTime, setConfirmedCloseTime] = useState<string | null>(state.daySession?.closedAt ?? null);
  const startedAt = state.daySession ? new Date(state.daySession.startedAt) : null;
  const durationEnd = confirmedCloseTime ? new Date(confirmedCloseTime) : trustedTime;
  async function closeDay() {
    if (!state.daySession || state.daySession.status !== "OPEN" || !clock.synchronized) return;
    if (!window.confirm(`Close business day ${state.daySession.businessDate}? No further sales can be added.`)) return;
    setClosing(true);
    try {
      const result = await api<{ reportText: string; whatsappNumber: string; closedAt: string }>("/api/day-close", { method: "POST" });
      setReport(result.reportText);
      setConfirmedCloseTime(result.closedAt);
      await reload(true);
      showToast({ message: "Business day closed with server-confirmed time." });
      if (result.whatsappNumber) window.open(`https://wa.me/${result.whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(result.reportText)}`, "_blank", "noopener,noreferrer");
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
    <section className="close-summary"><h2>Session summary</h2><div className="review-row"><span>Units Sold</span><strong>{state.dashboard.totalUnits}</strong></div><div className="review-row"><span>Gross Sales</span><strong>{money(state.dashboard.grossSalesPaise)}</strong></div><div className="review-row"><span>Normal Commission</span><strong>{money(state.dashboard.totalNormalCommissionPaise)}</strong></div><div className="review-row"><span>Full Commission</span><strong>{money(state.dashboard.totalFullCommissionPaise)}</strong></div><div className="review-row"><span>Total Earnings</span><strong>{money(state.dashboard.totalEarningsPaise)}</strong></div><div className="review-row"><span>Net Collection</span><strong>{money(state.dashboard.netCollectionPaise)}</strong></div></section>
    {report ? <><pre className="list-card report-text">{report}</pre><button className="secondary-button full-width" onClick={() => void copyReport()}>Copy Message</button></> :
      <button className="primary-button full-width" disabled={closing || state.daySession?.status !== "OPEN" || !clock.synchronized} onClick={() => void closeDay()}><CalendarCheck size={20} />{state.daySession?.status === "CLOSED" ? "Day Already Closed" : closing ? "Closing…" : !clock.synchronized ? "Waiting for trusted time" : "Close Day & Prepare WhatsApp"}</button>}
  </>;
}

function SettingsScreen({ settings, navigate, reload, showToast }: { settings: AppSettings; navigate: (screen: Screen) => void; reload: (silent?: boolean) => Promise<void>; showToast: (toast: ToastState) => void }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
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
  return <><PageTitle title="Settings" navigate={navigate} /><section className="settings-card">
    <div className="field"><label htmlFor="salesman">Salesman name</label><input id="salesman" value={form.salesmanName} onChange={(event) => setForm({ ...form, salesmanName: event.target.value })} /></div>
    <div className="field"><label htmlFor="business">Business name</label><input id="business" value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} /></div>
    <div className="field"><label htmlFor="whatsapp">WhatsApp report number</label><input id="whatsapp" inputMode="tel" placeholder="Country code and number" value={form.whatsappNumber} onChange={(event) => setForm({ ...form, whatsappNumber: event.target.value })} /></div>
    <div className="field"><label>Business timezone</label><input value={form.timezone} disabled /></div>
    <div className="switch-row"><div><strong>Live refresh</strong><p className="eyebrow" style={{ marginTop: ".2rem" }}>Keep totals up to date</p></div><button className={`switch${form.realtimeEnabled ? " on" : ""}`} role="switch" aria-checked={form.realtimeEnabled} onClick={() => setForm({ ...form, realtimeEnabled: !form.realtimeEnabled })}><span /></button></div>
    <button className="primary-button full-width" disabled={saving} onClick={() => void save()}><Save size={19} />{saving ? "Saving…" : "Save Settings"}</button>
  </section></>;
}

function Empty({ icon: Icon, text }: { icon: typeof Gift; text: string }) {
  return <div className="empty-card"><Icon size={30} /><div>{text}</div></div>;
}

function BottomNav({ screen, navigate }: { screen: Screen; navigate: (screen: Screen) => void }) {
  const items = [
    { screen: "home" as const, icon: Home, label: "Home" },
    { screen: "sale" as const, icon: ShoppingBag, label: "Sale" },
    { screen: "dashboard" as const, icon: BarChart3, label: "Dashboard" },
    { screen: "history" as const, icon: Clock3, label: "History" },
    { screen: "settings" as const, icon: MoreHorizontal, label: "More" },
  ];
  return <nav className="bottom-nav" aria-label="Main navigation">{items.map(({ screen: target, icon: Icon, label }) => <button key={target} className={`nav-button${screen === target ? " active" : ""}`} aria-current={screen === target ? "page" : undefined} onClick={() => navigate(target)}><Icon size={20} /><span>{label}</span></button>)}</nav>;
}
