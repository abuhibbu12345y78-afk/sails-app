import { provider } from "../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../src/infrastructure/errors";
import { DomainError } from "../../../src/application/errors";

export async function GET() {
  try {
    const time = await provider.state.getTrustedTime();
    return Response.json(time, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 503 });
  }
}
