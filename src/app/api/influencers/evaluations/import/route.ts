import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

// 简易 CSV 行解析：支持双引号包裹的字段（字段内可含逗号、"" 转义）
function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cols.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur.trim());
  return cols;
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "请选择 CSV 文件" }, { status: 400 });

    const text = await file.text();
    const lines = text.split("\n").filter(l => l.trim());
    if (lines.length < 2) return NextResponse.json({ error: "CSV 文件为空或缺少表头" }, { status: 400 });

    // Parse header
    const headers = parseCsvLine(lines[0]).map(h => h.toLowerCase());
    const tiktokIdx = headers.findIndex(h => h.includes("tiktok") || h.includes("链接") || h.includes("link"));
    const gmvIdx = headers.findIndex(h => h.includes("gmv"));
    const liveRatioIdx = headers.findIndex(h => h.includes("直播") || h.includes("live"));
    const ratingIdx = headers.findIndex(h => h.includes("rating") || h.includes("评级") || h.includes("等级"));
    const contentIdx = headers.findIndex(h => h.includes("内容") || h.includes("content"));
    const brandIdx = headers.findIndex(h => h.includes("品牌") || h.includes("brand") || h.includes("匹配"));
    const followersIdx = headers.findIndex(h => h.includes("粉丝") || h.includes("follower"));
    const avgViewsIdx = headers.findIndex(h => h.includes("观看") || h.includes("view"));
    // 如果存在第二个含 gmv 的列，视为 GMV 区间列；否则不取
    const gmvRangeIdx = headers.findIndex((h, idx) => h.includes("gmv") && idx !== gmvIdx);

    if (tiktokIdx === -1) return NextResponse.json({ error: "CSV 缺少 TikTok 链接列" }, { status: 400 });

    let imported = 0;
    let skipped: string[] = [];
    const insertEval = db.prepare(
      "INSERT INTO influencer_evaluations (influencer_id, gmv, live_stream_ratio, rating, content_quality, brand_fit, notes, evaluated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );

    const VALID_RATINGS = new Set(["A", "B", "C", "D"]);

    // 整个导入放进一个事务：任何一行出错全部回滚，避免"导入了一半"的脏数据
    const runImport = db.transaction(() => {
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        if (cols.length < 2) continue;

        const tiktokLink = cols[tiktokIdx] || "";
        if (!tiktokLink) { skipped.push(`第${i + 1}行: 无 TikTok 链接`); continue; }

        // Match by tiktok_link
        const influencer = db.prepare("SELECT * FROM influencers WHERE tiktok_link LIKE ?").get(`%${tiktokLink.replace(/^https?:\/\//, "").split("?")[0]}%`) as any;

        if (!influencer) {
          skipped.push(`第${i + 1}行: TikTok 链接未匹配到达人 (${tiktokLink.slice(0, 40)})`);
          continue;
        }

        const gmv = gmvIdx >= 0 ? cols[gmvIdx] || "" : "";
        const liveRatio = liveRatioIdx >= 0 ? cols[liveRatioIdx] || "" : "";
        // 评级只接受 A/B/C/D，其他值置空，避免触发数据库 CHECK 约束导致整个请求失败
        const rawRating = ratingIdx >= 0 ? cols[ratingIdx]?.toUpperCase() || "" : "";
        const rating = VALID_RATINGS.has(rawRating) ? rawRating : "";
        if (rawRating && !rating) skipped.push(`第${i + 1}行: 评级 "${rawRating}" 无效（仅支持 A/B/C/D），已按空处理`);
        const contentQuality = contentIdx >= 0 ? cols[contentIdx] || "" : "";
        const brandFit = brandIdx >= 0 ? cols[brandIdx] || "" : "";
        const followers = followersIdx >= 0 ? cols[followersIdx] || "" : "";
        const avgViews = avgViewsIdx >= 0 ? cols[avgViewsIdx] || "" : "";
        const gmvRange = gmvRangeIdx >= 0 ? cols[gmvRangeIdx] || "" : "";

        // Insert evaluation record
        insertEval.run(influencer.id, gmv, liveRatio, rating, contentQuality, brandFit, `CSV批量导入: ${gmv ? `GMV ${gmv}` : ""}`, auth.name);

        // Update influencer fields if provided
        const updates: string[] = [];
        const vals: any[] = [];
        if (followers) { updates.push("followers = ?"); vals.push(followers); }
        if (avgViews) { updates.push("avg_views = ?"); vals.push(avgViews); }
        if (gmv) { updates.push("monthly_gmv = ?"); vals.push(gmv); }
        if (gmvRange) { updates.push("gmv_range = ?"); vals.push(gmvRange); }
        if (rating) { updates.push("status = CASE WHEN status = '待评估' THEN '已评估' ELSE status END"); }

        if (updates.length > 0) {
          vals.push(influencer.id);
          db.prepare(`UPDATE influencers SET ${updates.join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...vals);
        }

        imported++;
      }
    });
    runImport();

    return NextResponse.json({
      success: true,
      imported,
      skipped,
      total: imported + skipped.length,
    });
  } catch (err) {
    console.error("CSV import error:", err);
    return NextResponse.json({ error: "导入失败: " + (err instanceof Error ? err.message : "未知错误") }, { status: 500 });
  }
}
