import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function POST(request: NextRequest) {
  try {
    const res = await fetch(`${GO_CORE_URL}/api/admin/smtp/test`, {
      method: "POST",
      headers: buildProxyHeaders(request),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("smtp/test proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
