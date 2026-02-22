import { NextResponse } from "next/server";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ job_id: string }> }
) {
  const { job_id } = await params;
  const internalApiUrl = process.env.INTERNAL_API_URL || "http://go-core:8080";

  try {
    const res = await fetch(`${internalApiUrl}/api/exports/${job_id}`, {
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || "Export job not found" },
        { status: res.status }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching export job:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
