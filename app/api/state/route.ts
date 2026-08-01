import { provider } from "../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../src/infrastructure/errors";
import { DomainError } from "../../../src/application/errors";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate") || searchParams.get("from") || undefined;
    const endDate = searchParams.get("endDate") || searchParams.get("to") || undefined;
    const status = (searchParams.get("status")?.toUpperCase() as "ALL" | "EARNED" | "RECEIVED") || undefined;
    const productId = searchParams.get("productId") || searchParams.get("product") || undefined;
    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("pageSize");
    const page = pageParam ? parseInt(pageParam, 10) : undefined;
    const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : undefined;

    const state = await provider.state.getTrackerState({
      startDate,
      endDate,
      status,
      productId,
      page,
      pageSize,
    });
    return Response.json(state);
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
