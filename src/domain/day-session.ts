export type DaySessionStatus = "NOT_STARTED" | "OPEN" | "PREVIOUS_DAY_STILL_OPEN" | "CLOSED";

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
