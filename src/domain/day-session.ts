export type DaySessionStatus = "NOT_STARTED" | "OPEN" | "PREVIOUS_DAY_STILL_OPEN" | "CLOSED";
export type OpeningState = "NEW_DAY" | "CURRENT_OPEN" | "CURRENT_CLOSED" | "PREVIOUS_OPEN";

export interface DailyStock {
  productId: string;
  pickedQuantity: number;
  soldQuantity: number;
  remainingQuantity: number;
}

export function deriveDaySessionStatus(
  currentBusinessDate: string,
  session: { businessDate: string; status: "OPEN" | "CLOSED" } | null,
): DaySessionStatus {
  if (!session) return "NOT_STARTED";
  if (session.status === "OPEN" && session.businessDate < currentBusinessDate) return "PREVIOUS_DAY_STILL_OPEN";
  return session.status;
}

export function resolveOpeningState(
  trustedBusinessDate: string,
  sessions: ReadonlyArray<{ businessDate: string; status: "OPEN" | "CLOSED" }>,
): { openingState: OpeningState; session: { businessDate: string; status: "OPEN" | "CLOSED" } | null } {
  const olderOpen = sessions
    .filter((session) => session.status === "OPEN" && session.businessDate < trustedBusinessDate)
    .sort((a, b) => b.businessDate.localeCompare(a.businessDate))[0];
  if (olderOpen) return { openingState: "PREVIOUS_OPEN", session: olderOpen };

  const current = sessions.find((session) => session.businessDate === trustedBusinessDate) ?? null;
  if (!current) return { openingState: "NEW_DAY", session: null };
  return {
    openingState: current.status === "OPEN" ? "CURRENT_OPEN" : "CURRENT_CLOSED",
    session: current,
  };
}

export function canReopenCurrentDay(input: {
  trustedBusinessDate: string;
  target: { businessDate: string; status: "OPEN" | "CLOSED" };
  laterSessionExists: boolean;
  hasPermission: boolean;
}) {
  if (input.target.businessDate !== input.trustedBusinessDate) return { allowed: false, reason: "Only the trusted current Business Date can be reopened." };
  if (input.target.status !== "CLOSED") return { allowed: false, reason: "The Business Day is not closed." };
  if (input.laterSessionExists) return { allowed: false, reason: "A later Business Day has already started." };
  if (!input.hasPermission) return { allowed: false, reason: "You do not have permission to reopen this Business Day." };
  return { allowed: true, reason: null };
}

export function previewAdditionalPickup(stock: DailyStock, additionalQuantity: number) {
  if (!Number.isSafeInteger(additionalQuantity) || additionalQuantity < 0 || additionalQuantity > 9999) {
    throw new Error("Additional pickup must be a whole number between 0 and 9999.");
  }
  return {
    previousPickedQuantity: stock.pickedQuantity,
    previousRemainingQuantity: stock.remainingQuantity,
    additionalQuantity,
    newPickedQuantity: stock.pickedQuantity + additionalQuantity,
    newRemainingQuantity: stock.remainingQuantity + additionalQuantity,
  };
}

export function validateDailySale(stock: DailyStock | null, quantity: number) {
  if (!stock) throw new Error("This product was not prepared for the open business day.");
  if (stock.pickedQuantity === 0) throw new Error("This product was not picked today.");
  if (quantity > stock.remainingQuantity) {
    throw new Error(`Only ${stock.remainingQuantity} unit${stock.remainingQuantity === 1 ? "" : "s"} remain today.`);
  }
  if (stock.remainingQuantity - quantity < 0) throw new Error("Remaining stock cannot become negative.");
}

export function isDateChangeWarning(sessionBusinessDate: string | null, currentBusinessDate: string) {
  return Boolean(sessionBusinessDate && sessionBusinessDate < currentBusinessDate);
}
