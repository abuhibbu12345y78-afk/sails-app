import { NextResponse } from "next/server";
import { provider } from "../../../src/infrastructure/provider";
import { DomainError } from "../../../src/application/errors";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { businessDate, pickupItems, salesItems } = body;

    if (!businessDate || !pickupItems || !salesItems) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const result = await provider.daySession.submitHistoricalData({
      businessDate,
      pickupItems,
      salesItems,
    });

    return NextResponse.json({ success: true, sessionId: result.sessionId });
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Historical data entry error:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
