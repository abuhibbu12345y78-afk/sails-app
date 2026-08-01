import { z } from "zod";
import { provider } from "../../../src/infrastructure/provider";
import { friendlyDatabaseError } from "../../../src/infrastructure/errors";
import { DomainError } from "../../../src/application/errors";

const settingsSchema = z.object({
  salesmanName: z.string().trim().min(1).max(80),
  businessName: z.string().trim().min(1).max(120),
  whatsappNumber: z.string().trim().regex(/^\+?[0-9]{0,15}$/),
  realtimeEnabled: z.boolean(),
});

export async function GET() {
  try {
    const settings = await provider.settings.getSettings();
    return Response.json(settings);
  } catch (error) {
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const input = settingsSchema.parse(await request.json());
    await provider.settings.updateSettings(input);
    return Response.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Check the settings and try again." }, { status: 400 });
    if (error instanceof DomainError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: friendlyDatabaseError(error) }, { status: 500 });
  }
}
