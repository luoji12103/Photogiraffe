import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const res = await fetch(`${GO_CORE_URL}/api/smart-albums/${id}`, {
    headers: buildProxyHeaders(req),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.text();
  const res = await fetch(`${GO_CORE_URL}/api/smart-albums/${id}`, {
    method: "PUT",
    headers: buildProxyHeaders(req, { "Content-Type": "application/json" }),
    body,
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const res = await fetch(`${GO_CORE_URL}/api/smart-albums/${id}`, {
    method: "DELETE",
    headers: buildProxyHeaders(req),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
