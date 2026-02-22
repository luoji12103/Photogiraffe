import { NextRequest, NextResponse } from "next/server";


export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";
  try {
    const res = await fetch(`${internalApiUrl}/api/presets/${id}`, {
      method: "DELETE",
      headers: { Authorization: request.headers.get("Authorization") || "" },
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.error || "Failed to delete preset" }, { status: res.status });
    }
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
