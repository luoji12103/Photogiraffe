import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const res = await fetch(`${GO_CORE_URL}/api/tags/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: buildProxyHeaders(req),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
