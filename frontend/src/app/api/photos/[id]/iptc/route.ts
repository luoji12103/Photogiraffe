import { type NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const res = await fetch(`${GO_CORE_URL}/api/photos/${id}/iptc`, {
    headers: buildProxyHeaders(req),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.text();
  const res = await fetch(`${GO_CORE_URL}/api/photos/${id}/iptc`, {
    method: "PUT",
    headers: buildProxyHeaders(req, { "Content-Type": "application/json" }),
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
