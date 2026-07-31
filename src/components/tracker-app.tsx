"use client";

import {
  ArrowLeft, BarChart3, CalendarCheck, Check, ChevronRight, IndianRupee,
  Clock3, Gift, History, Home, Minus, MoreHorizontal, Package, Plus, ReceiptIndianRupee,
  RefreshCw, Save, ShoppingBag, Sparkles, Trophy, UserRound, WalletCards, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppSettings, SaleRecord, TrackerState } from "../application/contracts";
import { calculateSale, formatCurrency } from "../domain/commission";
import type { Product } from "../domain/products";

type Screen = "home" | "sale" | "dashboard" | "rewards" | "history" | "day-close" | "settings";
type ToastState = { message: string; error?: boolean } | null;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Something went wrong.");
  return result;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(`${value}Z`));
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
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const preview = useMemo(() => selectedProduct ? calculateSale({
    quantity,
    currentProgress: selectedProduct.progress,
    currentCycle: selectedProduct.cycleNumber,
    rule: selectedProduct,
  }) : null, [quantity, selectedProduct]);

  function openSale(product: Product) {
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
      setSelectedProduct(null);
      setQuantity(1);
      await load(true);
      setToast({ message: `${quantity} ${quantity === 1 ? "sale" : "sales"} saved successfully.` });
    } catch (saveError) {
      setToast({ message: saveError instanceof Error ? saveError.message : "Sale could not be saved.", error: true });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading"><div><div className="spinner" aria-label="Loading" /></div></div>;
  if (!state || error) return (
    <main className="content error-panel">
      <RefreshCw size={34} />
      <h1>We couldn’t open the tracker</h1>
      <p>{error}</p>
      <button className="primary-button" onClick={() => void load()}><RefreshCw size={18} /> Try again</button>
    </main>
  );

  const navigate = (next: Screen) => { setScreen(next); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const money = (value: number) => formatCurrency(value, state.settings.locale, state.settings.currency);

  return (
    <div className="app-shell">
      <main className="content">
        {screen === "home" && <HomeScreen state={state} money={money} navigate={navigate} />}
        {screen === "sale" && <SaleScreen products={state.products} money={money} navigate={navigate} openSale={openSale} />}
        {screen === "dashboard" && <DashboardScreen state={state} money={money} navigate={navigate} />}
        {screen === "rewards" && <RewardsScreen state={state} money={money} navigate={navigate} />}
        {screen === "history" && <HistoryScreen sales={state.sales} money={money} navigate={navigate} />}
        {screen === "day-close" && <DayCloseScreen state={state} money={money} navigate={navigate} reload={load} showToast={setToast} />}
        {screen === "settings" && <SettingsScreen settings={state.settings} navigate={navigate} reload={load} showToast={setToast} />}
      </main>
      <BottomNav screen={screen} navigate={navigate} />
      {selectedProduct && preview && (
        <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setSelectedProduct(null);
        }}>
          <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="sale-title">
            <div className="drawer-grip" />
            <div className="drawer-head">
              <div><h2 id="sale-title">{selectedProduct.name}</h2><p>{money(selectedProduct.sellingPricePaise)} each</p></div>
              <button className="close-button" aria-label="Close" disabled={saving} onClick={() => setSelectedProduct(null)}><X size={20} /></button>
            </div>
            <div className="quantity" aria-label="Quantity">
              <button aria-label="Decrease quantity" onClick={() => setQuantity((value) => Math.max(1, value - 1))}><Minus /></button>
              <strong aria-live="polite">{quantity}</strong>
              <button aria-label="Increase quantity" onClick={() => setQuantity((value) => Math.min(999, value + 1))}><Plus /></button>
            </div>
            <div className="review">
              <div className="review-row"><span>Gross Sales</span><strong>{money(preview.grossSalesPaise)}</strong></div>
              <div className="review-row"><span>Normal Commission ({preview.normalUnits})</span><strong>{money(preview.totalNormalCommissionPaise)}</strong></div>
              <div className="review-row"><span>Full Commission ({preview.fullUnits})</span><strong>{money(preview.totalFullCommissionPaise)}</strong></div>
              <div className="review-row total"><span>Total Earnings</span><strong>{money(preview.totalEarningsPaise)}</strong></div>
              <div className="review-row"><span>Net Collection</span><strong>{money(preview.netCollectionPaise)}</strong></div>
              <div className="review-row"><span>Final Progress</span><strong>{preview.finalProgress} / {selectedProduct.rewardThreshold}</strong></div>
            </div>
            <button className="primary-button full-width" disabled={saving} onClick={() => void saveSale()}>
              {saving ? <><div className="spinner" /> Saving…</> : <><Save size={19} /> Save Sale</>}
            </button>
          </section>
        </div>
      )}
      {toast && <div className={`toast${toast.error ? " error" : ""}`} role="status">{toast.error ? <X size={20} /> : <Check size={20} />}{toast.message}</div>}
    </div>
  );
}

function Header({ state }: { state: TrackerState }) {
  return <header className="topbar"><div><p className="eyebrow">GOOD DAY, {state.settings.salesmanName.toUpperCase()}</p><h1>{state.settings.businessName}</h1></div><div className="avatar" aria-hidden="true"><UserRound size={22} /></div></header>;
}

function HomeScreen({ state, money, navigate }: { state: TrackerState; money: (value: number) => string; navigate: (screen: Screen) => void }) {
  const actions = [
    { screen: "sale" as const, icon: ShoppingBag, title: "Sale", text: "Record a product sale" },
    { screen: "dashboard" as const, icon: BarChart3, title: "Dashboard", text: "See today’s totals" },
    { screen: "rewards" as const, icon: Trophy, title: "Full Commission", text: "Review full earnings" },
    { screen: "history" as const, icon: History, title: "History", text: "Open recent sales" },
  ];
  return <>
    <Header state={state} />
    <div className="home-layout">
      <section className="hero">
        <p className="hero-label">Today’s earnings</p>
        <h2 className="hero-value">{money(state.dashboard.totalEarningsPaise)}</h2>
        <p className="hero-foot"><Sparkles size={17} /> From {state.dashboard.totalUnits} {state.dashboard.totalUnits === 1 ? "sale" : "sales"} today</p>
      </section>
      <section>
        <div className="section-head"><div><h2>What would you like to do?</h2><p>Choose an action to get started.</p></div></div>
        <div className="action-grid">{actions.map(({ screen, icon: Icon, title, text }) =>
          <button className="action-card" key={screen} onClick={() => navigate(screen)}>
            <span className="icon-tile"><Icon size={22} /></span><h3>{title}</h3><p>{text}</p>
          </button>)}</div>
        <div className="section-head"><div><h2>End of day</h2><p>Review totals before closing.</p></div></div>
        <button className="secondary-button full-width" onClick={() => navigate("day-close")}><CalendarCheck size={20} /> Day Close <ChevronRight size={18} /></button>
      </section>
    </div>
  </>;
}

function PageTitle({ title, navigate }: { title: string; navigate: (screen: Screen) => void }) {
  return <div className="page-title"><button className="back-button" aria-label="Back to home" onClick={() => navigate("home")}><ArrowLeft size={20} /></button><h1>{title}</h1></div>;
}

function SaleScreen({ products, money, navigate, openSale }: { products: Product[]; money: (value: number) => string; navigate: (screen: Screen) => void; openSale: (product: Product) => void }) {
  return <><PageTitle title="Record a Sale" navigate={navigate} /><p className="eyebrow">CHOOSE A PRODUCT</p><div className="product-grid">{products.map((product) =>
    <button className="product-card" key={product.id} onClick={() => openSale(product)}>
      <span className="product-name">{product.name}</span>
      <span className="product-price">{money(product.sellingPricePaise)}</span>
      <span className="product-commission">{money(product.normalCommissionPaise)} Normal Commission</span>
      <span className={`badge${product.progress === product.rewardThreshold ? " ready" : ""}`}>
        {product.progress === product.rewardThreshold ? <><Sparkles size={12} /> Next: Full Commission</> : <>Cycle {product.cycleNumber}</>}
      </span>
      <span className="progress-row"><span>Progress</span><strong>{product.progress} / {product.rewardThreshold}</strong></span>
      <span className="progress-track"><span className="progress-fill" style={{ width: `${product.progress / product.rewardThreshold * 100}%` }} /></span>
    </button>)}</div></>;
}

function DashboardScreen({ state, money, navigate }: { state: TrackerState; money: (value: number) => string; navigate: (screen: Screen) => void }) {
  const metrics = [
    { label: "Today’s Sales", value: String(state.dashboard.totalUnits), icon: ShoppingBag },
    { label: "Gross Sales", value: money(state.dashboard.grossSalesPaise), icon: ReceiptIndianRupee },
    { label: "Normal Commission", value: money(state.dashboard.totalNormalCommissionPaise), icon: WalletCards },
    { label: "Full Commission", value: money(state.dashboard.totalFullCommissionPaise), icon: Trophy },
    { label: "Total Earnings", value: money(state.dashboard.totalEarningsPaise), icon: IndianRupee, featured: true },
    { label: "Net Collection", value: money(state.dashboard.netCollectionPaise), icon: Package },
  ];
  return <><PageTitle title="Dashboard" navigate={navigate} /><section className="metrics">{metrics.map(({ label, value, icon: Icon, featured }) =>
    <article className={`metric${featured ? " featured" : ""}`} key={label}><Icon className="metric-icon" size={21} /><span>{label}</span><strong>{value}</strong></article>)}</section>
    <div className="section-head"><div><h2>Product Progress</h2><p>Each product has its own cycle.</p></div></div>
    <div className="list">{state.products.map((product) => <article className="list-card" key={product.id}>
      <div className="list-row"><div><h3>{product.name}</h3><p>Cycle {product.cycleNumber}</p></div><span className={`badge${product.progress === product.rewardThreshold ? " ready" : ""}`}>{product.progress} / {product.rewardThreshold}</span></div>
      <div className="progress-track" style={{ marginTop: ".75rem" }}><div className="progress-fill" style={{ width: `${product.progress / product.rewardThreshold * 100}%` }} /></div>
    </article>)}</div></>;
}

function RewardsScreen({ state, money, navigate }: { state: TrackerState; money: (value: number) => string; navigate: (screen: Screen) => void }) {
  const total = state.rewards.reduce((sum, reward) => sum + reward.amountPaise, 0);
  return <><PageTitle title="Full Commission" navigate={navigate} /><section className="hero"><p className="hero-label">Full Commission total</p><h2 className="hero-value">{money(total)}</h2><p className="hero-foot"><Trophy size={17} /> {state.rewards.length} earned record{state.rewards.length === 1 ? "" : "s"}</p></section>
    <div className="section-head"><div><h2>Commission Records</h2><p>Most recent first.</p></div></div>
    {state.rewards.length ? <div className="list">{state.rewards.map((reward) => <article className="list-card" key={reward.id}><div className="list-row"><div><h3>{reward.productName}</h3><p>{formatTime(reward.createdAt)} · Cycle {reward.cycleNumber}</p></div><div className="list-amount">{money(reward.amountPaise)}</div></div><div className="list-details"><div><span>Sale reference</span><strong>{reward.saleId.slice(0, 8).toUpperCase()}</strong></div><div><span>Status</span><strong>Earned</strong></div><div><span>Salesman</span><strong>{state.settings.salesmanName}</strong></div></div></article>)}</div> : <Empty icon={Trophy} text="Full Commission records will appear here." />}</>;
}

function HistoryScreen({ sales, money, navigate }: { sales: SaleRecord[]; money: (value: number) => string; navigate: (screen: Screen) => void }) {
  const [filter, setFilter] = useState("Today");
  return <><PageTitle title="Sales History" navigate={navigate} /><div className="filter-row">{["Today", "Yesterday", "Weekly", "Monthly"].map((item) => <button key={item} className={`filter-button${filter === item ? " active" : ""}`} onClick={() => setFilter(item)}>{item}</button>)}</div>
    <div className="section-head"><div><h2>{filter}</h2><p>{sales.length} recent record{sales.length === 1 ? "" : "s"}</p></div></div>
    {sales.length ? <div className="list">{sales.map((sale) => <article className="list-card" key={sale.id}><div className="list-row"><div><h3>{sale.productName}</h3><p>{formatTime(sale.createdAt)} · Qty {sale.quantity}</p></div><div className="list-amount">{money(sale.grossSalesPaise)}<p>Gross Sales</p></div></div><div className="list-details"><div><span>Normal ({sale.normalUnits})</span><strong>{money(sale.totalNormalCommissionPaise)}</strong></div><div><span>Full ({sale.fullUnits})</span><strong>{money(sale.totalFullCommissionPaise)}</strong></div><div><span>Net Collection</span><strong>{money(sale.netCollectionPaise)}</strong></div></div></article>)}</div> : <Empty icon={History} text="No sales have been recorded today." />}</>;
}

function DayCloseScreen({ state, money, navigate, reload, showToast }: { state: TrackerState; money: (value: number) => string; navigate: (screen: Screen) => void; reload: (silent?: boolean) => Promise<void>; showToast: (toast: ToastState) => void }) {
  const [closing, setClosing] = useState(false);
  const [report, setReport] = useState("");
  async function closeDay() {
    if (!window.confirm("Close today? This saves the final totals and cannot be repeated.")) return;
    setClosing(true);
    try {
      const result = await api<{ reportText: string; whatsappNumber: string }>("/api/day-close", { method: "POST" });
      setReport(result.reportText);
      await reload(true);
      showToast({ message: "Day closed successfully." });
      if (result.whatsappNumber) {
        window.open(`https://wa.me/${result.whatsappNumber.replace(/\D/g, "")}?text=${encodeURIComponent(result.reportText)}`, "_blank", "noopener,noreferrer");
      }
    } catch (closeError) {
      showToast({ message: closeError instanceof Error ? closeError.message : "Day close failed.", error: true });
    } finally { setClosing(false); }
  }
  async function copyReport() {
    await navigator.clipboard.writeText(report);
    showToast({ message: "Report copied." });
  }
  return <><PageTitle title="Day Close" navigate={navigate} /><section className="close-summary"><h2>Today’s summary</h2><div className="review-row"><span>Units Sold</span><strong>{state.dashboard.totalUnits}</strong></div><div className="review-row"><span>Gross Sales</span><strong>{money(state.dashboard.grossSalesPaise)}</strong></div><div className="review-row"><span>Normal Commission</span><strong>{money(state.dashboard.totalNormalCommissionPaise)}</strong></div><div className="review-row"><span>Full Commission</span><strong>{money(state.dashboard.totalFullCommissionPaise)}</strong></div><div className="review-row"><span>Total Earnings</span><strong>{money(state.dashboard.totalEarningsPaise)}</strong></div><div className="review-row"><span>Net Collection</span><strong>{money(state.dashboard.netCollectionPaise)}</strong></div></section>
    {report ? <><pre className="list-card" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", lineHeight: 1.6 }}>{report}</pre><button className="secondary-button full-width" onClick={() => void copyReport()}>Copy Message</button></> :
      <button className="primary-button full-width" disabled={closing || state.isDayClosed} onClick={() => void closeDay()}><CalendarCheck size={20} />{state.isDayClosed ? "Day Already Closed" : closing ? "Closing…" : "Close Day & Prepare WhatsApp"}</button>}
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
    <div className="field"><label htmlFor="whatsapp">WhatsApp report number</label><input id="whatsapp" inputMode="tel" placeholder="919876543210" value={form.whatsappNumber} onChange={(event) => setForm({ ...form, whatsappNumber: event.target.value })} /></div>
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
