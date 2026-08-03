import { z } from "zod";
import { provider } from "../../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../../src/infrastructure/errors";
import { DomainError } from "../../../../src/application/errors";

const correctPickupSchema = z.object({
  auditLogId: z.string().uuid(),
  productId: z.string().uuid(),
  correctedQuantity: z.number().int().min(0).max(9999),
  reason: z.string().trim().min(3).max(300),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  try {
    const input = correctPickupSchema.parse(await request.json());
    const result = await provider.daySession.correctPickup(input);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Check the corrected quantity and reason." }, { status: 400 });
    }
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
