import { z } from "zod";
import { provider } from "../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../src/infrastructure/errors";
import { DomainError } from "../../../src/application/errors";

const startDaySchema = z.object({
  items: z.array(z.object({
    productId: z.string().min(1).max(80),
    pickedQuantity: z.number().int().min(0).max(9999),
  })).max(100),
}).refine((input) => new Set(input.items.map((item) => item.productId)).size === input.items.length, {
  message: "Each product may appear only once.",
});

export async function POST(request: Request) {
  try {
    const input = startDaySchema.parse(await request.json());
    const result = await provider.daySession.startDaySession(input);
    return Response.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Check the picked quantities and try again." }, { status: 400 });
    }
    if (error instanceof DomainError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
