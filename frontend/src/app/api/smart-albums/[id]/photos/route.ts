import { NextRequest, NextResponse } from "next/server";

import { GO_CORE_URL, buildProxyHeaders } from "@/app/api/_utils/proxy";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const query = searchParams.toString();
  const res = await fetch(
    `${GO_CORE_URL}/api/smart-albums/${id}/photos${query ? `?${query}` : ""}`,
    { headers: buildProxyHeaders(req) }
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
