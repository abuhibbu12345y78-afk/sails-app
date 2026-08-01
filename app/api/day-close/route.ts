import { z } from "zod";
import { provider } from "../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../src/infrastructure/errors";
import { DomainError } from "../../../src/application/errors";

const closeDaySchema = z.object({
  sessionId: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const input = closeDaySchema.parse(await request.json());
    const result = await provider.daySession.closeDaySession(input.sessionId);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Choose the Business Day to close and try again." }, { status: 400 });
    }
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("DAY_CLOSE_FAILED", error);
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
