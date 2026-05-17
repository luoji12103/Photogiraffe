import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "summary";
  const validTypes = ["monthly", "camera", "focal-length", "iso", "summary"];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }

  const res = await fetch(`${GO_CORE_URL}/api/analytics/${type}`, {
    headers: buildProxyHeaders(req),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
