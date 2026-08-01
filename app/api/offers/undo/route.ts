import { NextResponse } from "next/server";
import { provider } from "../../../../src/infrastructure/provider";
import { DomainError } from "../../../../src/application/errors";

export async function POST(request: Request) {
  try {
    const { rewardId } = await request.json();
    if (!rewardId) {
      return NextResponse.json({ error: "Missing rewardId" }, { status: 400 });
    }

    await provider.sale.undoOfferReceived(rewardId);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to undo offer received:", error);
    return NextResponse.json({ error: "An unexpected error occurred." }, { status: 500 });
  }
}
