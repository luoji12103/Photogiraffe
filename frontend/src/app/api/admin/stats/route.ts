import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function GET(request: NextRequest) {
  try {
    const res = await fetch(`${GO_CORE_URL}/api/admin/stats`, {
      cache: "no-store",
      headers: buildProxyHeaders(request),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("admin stats proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
