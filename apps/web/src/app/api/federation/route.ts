/**
 * GET /api/federation — the same snapshot the page renders, for the live
 * panel to poll. Keeps service URLs server-side and avoids CORS.
 */
import { getFederationSnapshot } from "@/lib/federation";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getFederationSnapshot();
    return Response.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json(
      {
        error: {
          code: "federation_unavailable",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      { status: 503 },
    );
  }
}
