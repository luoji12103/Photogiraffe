import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const res = await fetch(`${GO_CORE_URL}/api/photos/${id}/favorite`, {
    method: "POST",
    headers: buildProxyHeaders(req),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const res = await fetch(`${GO_CORE_URL}/api/photos/${id}/favorite`, {
    method: "DELETE",
    headers: buildProxyHeaders(req),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
