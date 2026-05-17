import { NextRequest, NextResponse } from "next/server";
import { buildProxyHeaders } from "@/app/api/_utils/proxy";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { id, noteId } = await params;
  try {
    const body = await request.text();
    const res = await fetch(`${INTERNAL_API_URL}/api/photos/${id}/notes/${noteId}`, {
      method: "PUT",
      headers: { ...buildProxyHeaders(request), "Content-Type": "application/json" },
      body,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("noteId PUT proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { id, noteId } = await params;
  try {
    const res = await fetch(`${INTERNAL_API_URL}/api/photos/${id}/notes/${noteId}`, {
      method: "DELETE",
      headers: buildProxyHeaders(request),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error("noteId DELETE proxy error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 502 });
  }
}
