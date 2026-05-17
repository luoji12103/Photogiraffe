import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";
  try {
    const res = await fetch(`${internalApiUrl}/api/photos/map`, {
      headers: { Authorization: request.headers.get("Authorization") || "",
        "X-Csrf-Token": request.headers.get("X-Csrf-Token") || "" },
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: data.error || "Failed to fetch map data" }, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching map data:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
