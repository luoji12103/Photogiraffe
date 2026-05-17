import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function PUT(request: NextRequest) {
  try {
    const body = await request.text();
    const res = await fetch(`${GO_CORE_URL}/api/auth/change-password`, {
      method: "PUT",
      headers: buildProxyHeaders(request, { "Content-Type": "application/json" }),
      body,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("change-password proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
