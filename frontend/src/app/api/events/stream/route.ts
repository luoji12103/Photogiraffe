import { NextRequest } from "next/server";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://go-core:8080";

/**
 * GET /api/events/stream
 *
 * Proxies the SSE (Server-Sent Events) stream from Go Core to the browser.
 * The browser EventSource API cannot set custom headers, so the access token
 * is passed as a query parameter and forwarded accordingly.
 *
 * This route is only needed when the frontend is accessed directly on port 3000
 * (e.g. via port forwarding during development). In production, nginx routes
 * /api/events/ directly to go-core without going through Next.js.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  const upstreamUrl = `${INTERNAL_API_URL}/api/events/stream${token ? `?token=${encodeURIComponent(token)}` : ""}`;

  try {
    const upstreamRes = await fetch(upstreamUrl, {
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
      // @ts-expect-error – Node 18 fetch supports duplex streaming
      duplex: "half",
    });

    if (!upstreamRes.ok) {
      return new Response(
        JSON.stringify({ error: "SSE upstream error" }),
        { status: upstreamRes.status, headers: { "Content-Type": "application/json" } }
      );
    }

    // Stream the upstream SSE response directly to the client
    const stream = upstreamRes.body;
    if (!stream) {
      return new Response("No stream body from upstream", { status: 502 });
    }

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // disable nginx buffering if ever proxied again
      },
    });
  } catch (error) {
    console.error("[SSE proxy] Error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
