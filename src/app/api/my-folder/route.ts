import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import path from "node:path";
import os from "node:os";
import { uploadsDir } from "@/lib/uploads";
import { deletePersonalFile } from "@/lib/personal-file-deletion";
import { personalWorkspace } from "@/lib/workspace-data";

export async function GET(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({error:"未登录"}, {status:401});
  if (!isStaff(user)) return NextResponse.json({error:"仅员工可用"}, {status:403});
  const filename = req.nextUrl.searchParams.get("filename");
  if (filename !== null) {
    const db = getDb();
    if (!db.prepare("SELECT 1 FROM personal_files p JOIN file_uploads u ON u.filename=p.filename WHERE p.filename=? AND p.owner_id=? AND u.uploaded_by_id=?").get(filename,user.id,user.id)) return NextResponse.json({error:"文件不存在或无权查看"},{status:403});
    const history = db.prepare("SELECT id,old_note,new_note,changed_by,created_at FROM personal_file_note_history WHERE filename=? ORDER BY id DESC").all(filename);
    return NextResponse.json({history},{headers:{"Cache-Control":"private, no-store"}});
  }
  return NextResponse.json(personalWorkspace(getDb(), user), {headers:{"Cache-Control":"private, no-store"}});
}

// 所有写操作都从登录身份决定所有者，不接受请求传入员工身份。
export async function POST(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({error:"未登录"}, {status:401});
  if (!isStaff(user)) return NextResponse.json({error:"仅员工可用"}, {status:403});
  const db = getDb();
  const body = await readJson(req);
  const fail = (error: string, status = 400) => NextResponse.json({error}, {status});
  const folderId = body.folder_id == null ? null : Number(body.folder_id);
  if (folderId !== null && (!Number.isSafeInteger(folderId) || folderId <= 0)) return fail("文件夹编号无效");
  try {
    return db.transaction(() => {
      if (body.action === "note") {
        const filename = typeof body.filename === "string" ? body.filename : "";
        if (typeof body.note_name !== "string" || body.note_name.trim().length > 200) return fail("备注名最多200个字");
        const file = db.prepare("SELECT p.note_name FROM personal_files p JOIN file_uploads u ON u.filename=p.filename WHERE p.filename=? AND p.owner_id=? AND u.uploaded_by_id=?").get(filename,user.id,user.id) as {note_name:string}|undefined;
        if (!file) return fail("文件不存在或不是你上传的文件",403);
        const next = body.note_name.trim();
        if (next !== file.note_name) {
          db.prepare("UPDATE personal_files SET note_name=? WHERE filename=? AND owner_id=?").run(next,filename,user.id);
          db.prepare("INSERT INTO personal_file_note_history(filename,old_note,new_note,changed_by_id,changed_by) VALUES(?,?,?,?,?)").run(filename,file.note_name,next,user.id,user.name);
        }
        return NextResponse.json({success:true});
      }
      if (body.action !== "create" && folderId !== null && !db.prepare("SELECT 1 FROM personal_folders WHERE id = ? AND owner_id = ?").get(folderId, user.id)) return fail("文件夹不存在或无权操作", 404);
      if (body.action === "create" || body.action === "rename") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!name || name.length > 80) return fail("文件夹名称需为1至80个字");
        if (body.action === "rename" && folderId === null) return fail("请选择文件夹");
        if (db.prepare("SELECT 1 FROM personal_folders WHERE owner_id = ? AND name = ? AND id <> ?").get(user.id, name, folderId ?? -1)) return fail("已有同名文件夹", 409);
        if (body.action === "create") db.prepare("INSERT INTO personal_folders(owner_id,name) VALUES (?,?)").run(user.id,name);
        else db.prepare("UPDATE personal_folders SET name = ? WHERE id = ? AND owner_id = ?").run(name,folderId,user.id);
      } else if (body.action === "delete") {
        if (folderId === null) return fail("请选择文件夹");
        // ON DELETE SET NULL 保留上传文件；引用级联移除，原始业务记录不变。
        db.prepare("DELETE FROM personal_folders WHERE id = ? AND owner_id = ?").run(folderId,user.id);
      } else if (body.action === "file") {
        const filename = typeof body.filename === "string" ? body.filename : "";
        const upload = db.prepare("SELECT 1 FROM file_uploads WHERE filename = ? AND uploaded_by_id = ? AND uploaded_by_role = ?").get(filename,user.id,user.role);
        if (!upload) return fail("文件不存在或不是你上传的文件",403);
        const existing = db.prepare("SELECT owner_id FROM personal_files WHERE filename = ?").get(filename) as {owner_id:number}|undefined;
        if (existing && existing.owner_id !== user.id) return fail("无权操作该文件",403);
        db.prepare("INSERT INTO personal_files(filename,owner_id,folder_id) VALUES (?,?,?) ON CONFLICT(filename) DO UPDATE SET folder_id=excluded.folder_id WHERE personal_files.owner_id=excluded.owner_id").run(filename,user.id,folderId);
      } else if (body.action === "assign") {
        if (folderId === null) return fail("请选择文件夹");
        const workspace = personalWorkspace(db,user);
        const record = workspace.groups.flatMap(g=>g.items).find(r=>r.type===body.record_type && r.id===String(body.record_id));
        if (!record) return fail("记录不存在或不在你的自动分区中",403);
        db.prepare("INSERT OR IGNORE INTO personal_folder_records(folder_id,record_type,record_id) VALUES (?,?,?)").run(folderId,record.type,record.id);
        // 从自定义文件夹移动时移除旧引用；从自动分区归类时保留原记录。
        const from = Number(body.from_folder_id);
        if (Number.isSafeInteger(from) && from !== folderId) db.prepare("DELETE FROM personal_folder_records WHERE folder_id = ? AND record_type = ? AND record_id = ? AND folder_id IN (SELECT id FROM personal_folders WHERE owner_id = ?)").run(from,record.type,record.id,user.id);
      } else return fail("不支持的操作");
      return NextResponse.json({success:true});
    })();
  } catch (error) {
    console.error("[我的文件夹] 保存失败",error);
    return fail("保存失败，请重试",500);
  }
}

export async function DELETE(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({error:"未登录"}, {status:401});
  if (!isStaff(user)) return NextResponse.json({error:"仅员工可用"}, {status:403});
  const body = await readJson(req);
  try {
    const {status, ...result} = deletePersonalFile(getDb(), user.id, typeof body.filename === "string" ? body.filename : "", [uploadsDir,path.join(os.tmpdir(),"xiangtai-uploads")]);
    return NextResponse.json(result,{status});
  } catch (error) {
    console.error("[我的文件夹] 删除文件失败",error);
    return NextResponse.json({error:"删除失败，请重试"},{status:500});
  }
}
