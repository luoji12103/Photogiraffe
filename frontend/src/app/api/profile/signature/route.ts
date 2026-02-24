import { NextRequest, NextResponse } from "next/server";

const API = process.env.INTERNAL_API_URL || "http://go-core:8080";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const res = await fetch(`${API}/api/profile/signature`, {
      method: "POST",
      headers: { Authorization: request.headers.get("Authorization") || "" },
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: data.error || "failed" }, { status: res.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
