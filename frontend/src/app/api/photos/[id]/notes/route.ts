import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const res = await fetch(`${GO_CORE_URL}/api/photos/${id}/notes`, {
      headers: buildProxyHeaders(request),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("notes GET proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = await request.text();
    const res = await fetch(`${GO_CORE_URL}/api/photos/${id}/notes`, {
      method: "POST",
      headers: buildProxyHeaders(request, { "Content-Type": "application/json" }),
      body,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("notes POST proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
