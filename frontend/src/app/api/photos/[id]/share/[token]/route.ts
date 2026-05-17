import { NextRequest, NextResponse } from "next/server";
import { buildProxyHeaders } from "@/app/api/_utils/proxy";

const INTERNAL = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; token: string }> }
) {
  const { id, token } = await params;
  const res = await fetch(`${INTERNAL}/api/photos/${id}/share/${token}`, {
    method: "DELETE",
    cache: "no-store",
    headers: buildProxyHeaders(request),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
