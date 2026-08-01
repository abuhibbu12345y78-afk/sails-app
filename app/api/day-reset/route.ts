import { z } from "zod";
import { provider } from "../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../src/infrastructure/errors";
import { DomainError } from "../../../src/application/errors";

const resetDaySchema = z.object({
  sessionId: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const input = resetDaySchema.parse(await request.json());
    await provider.daySession.resetBusinessDay(input.sessionId);
    return Response.json({ success: true }, { status: 200 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Invalid session ID." }, { status: 400 });
    }
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
