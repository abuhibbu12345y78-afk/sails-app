import { z } from "zod";
import { provider } from "../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../src/infrastructure/errors";
import { DomainError } from "../../../src/application/errors";

const reopenSchema = z.object({
  sessionId: z.string().uuid(),
  reason: z.string().trim().min(8).max(300),
});

export async function POST(request: Request) {
  try {
    const input = reopenSchema.parse(await request.json());
    const result = await provider.daySession.reopenDaySession(input);
    return Response.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Enter a reopen reason of at least 8 characters." }, { status: 400 });
    }
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
