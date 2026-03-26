import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    const res = await fetch(`${GO_CORE_URL}/api/admin/jobs/${id}`, {
      cache: "no-store",
      headers: buildProxyHeaders(request),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("admin job detail proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
