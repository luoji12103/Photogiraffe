import { NextResponse } from "next/server";

export async function GET() {
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
  try {
    const res = await fetch(`${apiUrl}/api/config/ai`, { cache: "no-store" });
    if (!res.ok) {
      throw new Error("Failed to fetch AI config");
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to fetch AI config" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const apiUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
  try {
    const body = await request.json();
    const res = await fetch(`${apiUrl}/api/config/ai`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error("Failed to update AI config");
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update AI config" }, { status: 500 });
  }
}
