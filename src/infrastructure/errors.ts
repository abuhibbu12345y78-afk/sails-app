export function friendlyDatabaseError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  
  // D1 / SQLite Errors
  if (message.includes("UNIQUE") && message.includes("idempotency")) return "This sale was already saved.";
  if (message.includes("UNIQUE") && message.includes("day_sessions.status")) return "A previous business day is still open.";
  if (message.includes("UNIQUE") && message.includes("day_session_scopes")) return "This Business Date already has a session.";
  if (message.includes("UNIQUE") && message.includes("day_close_snapshots")) return "This close operation was already completed.";
  if (message.includes("UNIQUE") && message.includes("business_date")) return "This business date already exists.";
  if (message.includes("CHECK constraint failed")) return "The requested quantity is greater than the remaining stock.";
  
  // Supabase / Postgres Errors
  if (message.includes("23505")) { // unique_violation
    if (message.includes("idempotency")) return "This sale was already saved.";
    if (message.includes("day_sessions_status")) return "A previous business day is still open.";
    if (message.includes("day_session_scopes")) return "This Business Date already has a session.";
    if (message.includes("day_close_snapshots")) return "This close operation was already completed.";
    if (message.includes("business_date")) return "This business date already exists.";
  }
  if (message.includes("23514")) { // check_violation
    return "The requested quantity is greater than the remaining stock.";
  }

  return "We could not complete that request. Please try again.";
}
