import { NextRequest, NextResponse } from "next/server";
import { buildProxyHeaders } from "@/app/api/_utils/proxy";

const API = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; photo_id: string }> }
) {
  const { id, photo_id } = await params;
  try {
    const res = await fetch(`${API}/api/albums/${id}/photos/${photo_id}`, {
      method: "DELETE",
      headers: buildProxyHeaders(request),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data.error || "failed" }, { status: res.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
