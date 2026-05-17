import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.text();
  const res = await fetch(`${GO_CORE_URL}/api/photos/${id}/metadata`, {
    method: "PUT",
    headers: buildProxyHeaders(req, { "Content-Type": "application/json" }),
    body,
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
