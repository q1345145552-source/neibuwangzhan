import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { generateEmployeePdf } from "@/lib/employee-pdf";

// GET /api/employees/[id]/pdf — 导出员工档案 PDF（管理员看任意员工；员工只能导自己）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const employeeId = Number(id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return NextResponse.json({ error: "缺少员工ID" }, { status: 400 });
  if (auth.role !== "admin" && employeeId !== auth.id) return NextResponse.json({ error: "无权限" }, { status: 403 });

  const result = await generateEmployeePdf(employeeId);
  if (!result) return NextResponse.json({ error: "员工不存在" }, { status: 404 });

  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.asciiName}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    },
  });
}
