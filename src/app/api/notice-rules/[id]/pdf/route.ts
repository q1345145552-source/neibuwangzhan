import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { ownEmployeeNotice } from "@/lib/notice-rule-access";
import { generateNoticeRulePdf } from "@/lib/notice-rule-pdf";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const result = ownEmployeeNotice(auth, (await params).id);
  if (result.error) return result.error;
  try {
    const buffer = await generateNoticeRulePdf({ ...result.notice, employee_name: auth.name });
    return new NextResponse(new Uint8Array(buffer), { headers: {
      "Content-Type": "application/pdf", "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="notice-${result.notice.id}.pdf"; filename*=UTF-8''${encodeURIComponent(result.notice.title + ".pdf")}`,
    } });
  } catch (error) {
    console.error("[通知/规则 PDF]", error);
    return NextResponse.json({ error: "PDF 生成失败，请稍后重试或使用直接打印" }, { status: 500 });
  }
}
