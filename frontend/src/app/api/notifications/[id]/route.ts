import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const res = await fetch(`${GO_CORE_URL}/api/notifications/${id}`, {
    method: "PUT",
    headers: buildProxyHeaders(req),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const res = await fetch(`${GO_CORE_URL}/api/notifications/${id}`, {
    method: "DELETE",
    headers: buildProxyHeaders(req),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
