import { NextRequest, NextResponse } from "next/server";

const API = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const res = await fetch(`${API}/share/album/${token}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data.error || "not found" }, { status: res.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
