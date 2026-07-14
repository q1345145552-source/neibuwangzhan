import { NextResponse } from "next/server";

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:3000,http://localhost:3001").split(",");

export function corsHeaders(origin?: string | null): Record<string, string> {
  const allowOrigin = (origin && ALLOWED_ORIGINS.includes(origin)) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

export function corsResponse(body: any, status: number, origin?: string | null) {
  return NextResponse.json(body, { status, headers: corsHeaders(origin) });
}

export function handleOptions(origin?: string | null) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}
