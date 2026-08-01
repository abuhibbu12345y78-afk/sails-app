import type { DashboardSummary, DaySession, OpeningState, ReopenEligibility } from "./contracts.ts";
import { canReopenCurrentDay, previewAdditionalPickup, resolveOpeningState } from "../domain/day-session.ts";

export interface SessionIdentity {
  id: string;
  businessDate: string;
  status: "OPEN" | "CLOSED";
}

export function getCurrentBusinessDayStateUseCase(
  trustedBusinessDate: string,
  sessions: readonly SessionIdentity[],
): { openingState: OpeningState; sessionId: string | null } {
  const decision = resolveOpeningState(trustedBusinessDate, sessions);
  const session = decision.session
    ? sessions.find((candidate) =>
      candidate.businessDate === decision.session?.businessDate &&
      candidate.status === decision.session.status
    ) ?? null
    : null;
  return { openingState: decision.openingState, sessionId: session?.id ?? null };
}

export function previewDayStartUseCase(
  products: ReadonlyArray<{ productId: string; pickedQuantity: number }>,
) {
  const selected = products.filter((item) => item.pickedQuantity > 0);
  return {
    totalProductsSelected: selected.length,
    totalPickedUnits: selected.reduce((total, item) => total + item.pickedQuantity, 0),
    items: selected,
  };
}

export function previewDayCloseUseCase(
  session: DaySession,
  dashboard: DashboardSummary,
) {
  return {
    businessDate: session.businessDate,
    startedAt: session.startedAt,
    stockItems: session.stockItems.map((item) => ({
      productId: item.productId,
      productName: item.productName,
      pickedQuantity: item.pickedQuantity,
      soldQuantity: item.soldQuantity,
      remainingQuantity: item.remainingQuantity,
    })),
    ...dashboard,
  };
}

export function reopenBusinessDayUseCase(input: {
  trustedBusinessDate: string;
  target: SessionIdentity;
  laterSessionExists: boolean;
  hasPermission: boolean;
}): ReopenEligibility {
  return canReopenCurrentDay(input);
}

export function canResetBusinessDayUseCase(input: {
  target: SessionIdentity;
  laterSessionExists: boolean;
  hasPermission: boolean;
}): { allowed: boolean; reason: string | null } {
  if (!input.hasPermission) {
    return { allowed: false, reason: "Insufficient permissions to reset the day." };
  }
  if (input.laterSessionExists) {
    return { allowed: false, reason: "Cannot reset a day because a newer session already exists." };
  }
  return { allowed: true, reason: null };
}

export function previewAdditionalPickupUseCase(
  stockItems: DaySession["stockItems"],
  quantities: ReadonlyArray<{ productId: string; additionalQuantity: number }>,
) {
  const byProduct = new Map(quantities.map((item) => [item.productId, item.additionalQuantity]));
  const items = stockItems.map((stock) => ({
    productId: stock.productId,
    productName: stock.productName,
    ...previewAdditionalPickup(stock, byProduct.get(stock.productId) ?? 0),
  })).filter((item) => item.additionalQuantity > 0);
  return {
    items,
    totalAdditionalUnits: items.reduce((total, item) => total + item.additionalQuantity, 0),
  };
}
