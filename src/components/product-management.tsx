import { Check, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "../domain/commission";
import { ml } from "../lib/ui-text-ml";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "./ui/alert-dialog";

interface ProductManagementItem {
  id: string;
  code: string;
  name: string;
  sellingPricePaise: number;
  normalCommissionPaise: number;
  offerEnabled: boolean;
  fullCommissionPaise: number;
  rewardThreshold: number;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  usage: {
    sales: number;
    stockItems: number;
    progress: number;
    rewards: number;
    closures: number;
    auditLogs: number;
  };
}

interface ToastState {
  message: string;
  error?: boolean;
}

interface ProductManagementScreenProps {
  locale: string;
  currency: string;
  showToast: (toast: ToastState) => void;
}

interface ProductForm {
  name: string;
  sellingPrice: string;
  normalCommission: string;
  offerEnabled: boolean;
  fullCommission: string;
  rewardThreshold: string;
  sortOrder: string;
  active: boolean;
  reason: string;
}

const emptyForm: ProductForm = {
  name: "",
  sellingPrice: "",
  normalCommission: "",
  offerEnabled: false,
  fullCommission: "",
  rewardThreshold: "",
  sortOrder: "0",
  active: true,
  reason: "",
};

function parseRupees(value: string): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

export function ProductManagementScreen({ locale, currency, showToast }: ProductManagementScreenProps) {  const [items, setItems] = useState<ProductManagementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<ProductManagementItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductManagementItem | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [disableTarget, setDisableTarget] = useState<ProductManagementItem | null>(null);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetch("/api/products", { cache: "no-store" });
      const body = await result.json() as { products?: ProductManagementItem[]; error?: string };
      if (!result.ok) throw new Error(body.error ?? "Failed to load products.");
      setItems(body.products ?? []);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load products.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const usageTotal = (item: ProductManagementItem) =>
    item.usage.sales + item.usage.stockItems + item.usage.progress + item.usage.rewards + item.usage.closures + item.usage.auditLogs;

  const formValid = useMemo(() => {
    if (!form.name.trim()) return false;
    if (parseRupees(form.sellingPrice) === null || (parseRupees(form.sellingPrice) ?? 0) < 1) return false;
    if (parseRupees(form.normalCommission) === null) return false;
    if (form.offerEnabled) {
      if (parseRupees(form.fullCommission) === null || (parseRupees(form.fullCommission) ?? 0) < 1) return false;
      if (!Number.isInteger(Number(form.rewardThreshold)) || Number(form.rewardThreshold) < 1) return false;
    }
    return Number.isInteger(Number(form.sortOrder)) && Number(form.sortOrder) >= 0;
  }, [form]);

  function openAdd() {
    setEditing(null);
    setForm({ ...emptyForm, sortOrder: String(items.length + 1) });
    setFormOpen(true);
  }

  function openEdit(item: ProductManagementItem) {
    setEditing(item);
    setForm({
      name: item.name,
      sellingPrice: String(item.sellingPricePaise / 100),
      normalCommission: String(item.normalCommissionPaise / 100),
      offerEnabled: item.offerEnabled,
      fullCommission: item.offerEnabled ? String(item.fullCommissionPaise / 100) : "",
      rewardThreshold: item.offerEnabled ? String(item.rewardThreshold) : "",
      sortOrder: String(item.sortOrder),
      active: item.active,
      reason: item.active ? ml.products.reasonEdit : ml.products.reasonEnable,
    });
    setFormOpen(true);
  }

  async function saveForm() {
    if (!formValid || saving) return;
    setSaving(true);
    try {
      const payload = {
        productId: editing?.id ?? null,
        name: form.name.trim(),
        sellingPricePaise: parseRupees(form.sellingPrice)!,
        normalCommissionPaise: parseRupees(form.normalCommission)!,
        offerEnabled: form.offerEnabled,
        fullCommissionPaise: form.offerEnabled ? parseRupees(form.fullCommission)! : null,
        rewardThreshold: form.offerEnabled ? Number(form.rewardThreshold) : null,
        active: form.active,
        sortOrder: Number(form.sortOrder),
        reason: form.reason.trim() || undefined,
      };
      const result = await fetch("/api/products", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await result.json() as { product?: ProductManagementItem; error?: string };
      if (!result.ok) throw new Error(body.error ?? "Failed to save product.");
      setFormOpen(false);
      await load();
      showToast({ message: ml.products.productSaved });
    } catch (saveError) {
      showToast({ message: saveError instanceof Error ? saveError.message : "Failed to save product.", error: true });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive() {
    if (!disableTarget || toggling) return;
    setToggling(true);
    try {
      const item = disableTarget;
      const payload = {
        productId: item.id,
        name: item.name,
        sellingPricePaise: item.sellingPricePaise,
        normalCommissionPaise: item.normalCommissionPaise,
        offerEnabled: item.offerEnabled,
        fullCommissionPaise: item.offerEnabled ? item.fullCommissionPaise : null,
        rewardThreshold: item.offerEnabled ? item.rewardThreshold : null,
        active: !item.active,
        sortOrder: item.sortOrder,
        reason: item.active ? ml.products.reasonDisable : ml.products.reasonEnable,
      };
      const result = await fetch("/api/products", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await result.json() as { product?: ProductManagementItem; error?: string };
      if (!result.ok) throw new Error(body.error ?? "Failed to update product.");
      setDisableTarget(null);
      await load();
      showToast({ message: item.active ? ml.products.productDisabled : ml.products.productEnabled });
    } catch (toggleError) {
      showToast({ message: toggleError instanceof Error ? toggleError.message : "Failed to update product.", error: true });
    } finally {
      setToggling(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      const params = new URLSearchParams({ id: deleteTarget.id });
      const result = await fetch(`/api/products?${params.toString()}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason.trim() || ml.products.reasonDelete }),
      });
      const body = await result.json() as { deleted?: boolean; blocked?: boolean; error?: string };
      if (!result.ok) throw new Error(body.error ?? "Failed to delete product.");
      setDeleteTarget(null);
      setDeleteReason("");
      await load();
      showToast({ message: ml.products.productDeleted });
    } catch (deleteError) {
      showToast({ message: deleteError instanceof Error ? deleteError.message : "Failed to delete product.", error: true });
    } finally {
      setDeleting(false);
    }
  }

  const money = (paise: number) => formatCurrency(paise, locale, currency);

  return (
    <>
      <section className="settings-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>{ml.products.manageProducts}</h2>
          <button className="primary-button" style={{ minHeight: "2.6rem", width: "auto" }} onClick={openAdd}>
            <Plus size={18} /> {ml.products.addNewProduct}
          </button>
        </div>

        {loading ? (
          <p className="eyebrow" style={{ textAlign: "center" }}>{ml.messages.loading}</p>
        ) : error ? (
          <p style={{ color: "var(--destructive)", textAlign: "center", fontWeight: 600 }}>{error}</p>
        ) : items.length === 0 ? (
          <p style={{ textAlign: "center", color: "var(--muted)", fontSize: "0.85rem", margin: 0 }}>{ml.products.noProductsYet}</p>
        ) : (
          <div style={{ display: "grid", gap: "0.75rem" }}>
            {items.map((item) => {
              const totalUsage = usageTotal(item);
              return (
                <div key={item.id} className="product-card" style={{ cursor: "default", gap: "0.4rem", opacity: item.active ? 1 : 0.72 }}>
                  <div className="list-row">
                    <div>
                      <h3>{item.name}</h3>
                      <p style={{ color: "var(--muted)", fontSize: "0.75rem", fontWeight: 600 }}>{item.code}</p>
                    </div>
                    <span className={`status-${item.active ? "open" : "closed"}`}
                      style={{ borderRadius: "99px", padding: ".28rem .7rem", fontSize: ".78rem", fontWeight: 800, whiteSpace: "nowrap" }}>
                      {item.active ? ml.products.active : ml.products.inactive}
                    </span>
                  </div>
                  <div className="list-row" style={{ fontSize: "0.82rem", color: "#1e293b", flexWrap: "wrap", rowGap: ".35rem" }}>
                    <span><strong>{ml.products.sellingPrice}:</strong> {money(item.sellingPricePaise)}</span>
                    <span><strong>{ml.products.normalCommission}:</strong> {money(item.normalCommissionPaise)}</span>
                    {item.offerEnabled ? (
                      <>
                        <span><strong>{ml.products.offerAmount}:</strong> {money(item.fullCommissionPaise)}</span>
                        <span><strong>{ml.products.offerLimit}:</strong> {item.rewardThreshold}</span>
                      </>
                    ) : (
                      <span><strong>{ml.products.offerAvailable}:</strong> {ml.products.noOffer}</span>
                    )}
                    <span><strong>{ml.products.displayOrder}:</strong> {item.sortOrder}</span>
                  </div>
                  <div className="list-row" style={{ fontSize: "0.78rem", color: "var(--muted)" }}>
                    <span>{ml.products.usedRecords}: {totalUsage}</span>
                  </div>
                  <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                    <button className="secondary-button" style={{ minHeight: "2.4rem", width: "auto", fontSize: "0.82rem" }}
                      onClick={() => openEdit(item)}>
                      <Pencil size={16} /> {ml.products.edit}
                    </button>
                    <button className="secondary-button" style={{ minHeight: "2.4rem", width: "auto", fontSize: "0.82rem" }}
                      onClick={() => setDisableTarget(item)}>
                      <Power size={16} /> {item.active ? ml.products.disable : ml.products.enable}
                    </button>
                    <button className="danger-button" style={{ minHeight: "2.4rem", width: "auto", fontSize: "0.82rem" }}
                      onClick={() => { setDeleteTarget(item); setDeleteReason(""); }}>
                      <Trash2 size={16} /> {ml.products.deleteProduct}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Add / Edit dialog */}
      <AlertDialog open={formOpen} onOpenChange={setFormOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{editing ? ml.products.editProduct : ml.products.addProduct}</AlertDialogTitle>
            <AlertDialogDescription>
              {editing && editing.usage.sales > 0 ? ml.products.financialChangeWarning : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="field">
            <label htmlFor="pm-name">{ml.products.productName}</label>
            <input id="pm-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="pm-price">{ml.products.sellingPrice}</label>
            <input id="pm-price" inputMode="decimal" placeholder="₹" value={form.sellingPrice}
              onChange={(e) => setForm({ ...form, sellingPrice: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pm-normal">{ml.products.normalCommission}</label>
            <input id="pm-normal" inputMode="decimal" placeholder="₹" value={form.normalCommission}
              onChange={(e) => setForm({ ...form, normalCommission: e.target.value })} />
          </div>
          <div className="switch-row">
            <div>
              <strong>{ml.products.offerAvailable}</strong>
              <p className="eyebrow" style={{ marginTop: ".2rem" }}>
                {form.offerEnabled ? ml.products.offerAmount : ml.products.offerAvailableHint}
              </p>
            </div>
            <button className={`switch${form.offerEnabled ? " on" : ""}`} role="switch"
              aria-checked={form.offerEnabled}
              onClick={() => setForm({ ...form, offerEnabled: !form.offerEnabled })}>
              <span />
            </button>
          </div>
          {form.offerEnabled && (
            <>
              <div className="field">
                <label htmlFor="pm-full">{ml.products.offerAmount}</label>
                <input id="pm-full" inputMode="decimal" placeholder="₹" value={form.fullCommission}
                  onChange={(e) => setForm({ ...form, fullCommission: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="pm-threshold">{ml.products.offerLimit}</label>
                <p className="eyebrow" style={{ margin: "0 0 .3rem" }}>{ml.products.offerLimitHint}</p>
                <input id="pm-threshold" inputMode="numeric" value={form.rewardThreshold}
                  onChange={(e) => setForm({ ...form, rewardThreshold: e.target.value })} />
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="pm-sort">{ml.products.displayOrder}</label>
            <input id="pm-sort" inputMode="numeric" value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="pm-reason">{ml.products.reasonOptional}</label>
            <input id="pm-reason" value={form.reason} maxLength={200}
              onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div className="switch-row">
            <div>
              <strong>{ml.products.status}</strong>
              <p className="eyebrow" style={{ marginTop: ".2rem" }}>
                {form.active ? ml.products.active : ml.products.inactive}
              </p>
            </div>
            <button className={`switch${form.active ? " on" : ""}`} role="switch"
              aria-checked={form.active}
              onClick={() => setForm({ ...form, active: !form.active })}>
              <span />
            </button>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>{ml.actions.cancel}</AlertDialogCancel>
            <button className="primary-button" style={{ width: "auto" }} disabled={!formValid || saving} onClick={(e) => {
              e.preventDefault();
              void saveForm();
            }}>
              {saving ? "..." : <><Check size={18} /> {ml.products.saveChanges}</>}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Enable / Disable confirmation */}
      <AlertDialog open={disableTarget !== null} onOpenChange={(open) => { if (!toggling && !open) setDisableTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {disableTarget?.active ? ml.products.confirmDisable : ml.products.confirmEnable}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {disableTarget?.active ? ml.products.disableHint : ml.products.confirmEnable}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={toggling}>{ml.actions.cancel}</AlertDialogCancel>
            <button className="primary-button" style={{ width: "auto" }} disabled={toggling} onClick={(e) => {
              e.preventDefault();
              void handleToggleActive();
            }}>
              {toggling ? "..." : disableTarget?.active ? ml.products.disable : ml.products.enable}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!deleting && !open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{ml.products.confirmDelete}</AlertDialogTitle>
            <AlertDialogDescription>
              <span style={{ display: "block", fontWeight: 700, marginBottom: "0.5rem" }}>
                {deleteTarget ? `${deleteTarget.name} — ${ml.products.usedRecords}: ${usageTotal(deleteTarget)}` : ""}
              </span>
              {ml.products.deleteHint}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTarget && usageTotal(deleteTarget) > 0 && (
            <p style={{ fontSize: "0.85rem", color: "var(--destructive)", fontWeight: 700, margin: 0 }}>
              {ml.products.deleteBlockedMessage}
            </p>
          )}
          <div className="field">
            <label htmlFor="pm-del-reason">{ml.products.reasonOptional}</label>
            <input id="pm-del-reason" value={deleteReason} maxLength={200}
              onChange={(e) => setDeleteReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{ml.actions.cancel}</AlertDialogCancel>
            <button className="danger-button" style={{ width: "auto" }}
              disabled={deleting || (deleteTarget !== null && usageTotal(deleteTarget) > 0)}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}>
              {deleting ? "..." : ml.products.deleteProduct}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
