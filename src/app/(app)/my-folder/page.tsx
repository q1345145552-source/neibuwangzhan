"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, ClipboardList, ListTodo, Package, FolderOpen, Plus, Upload, Pencil, Trash2, FolderInput, X } from "lucide-react";
import { fetchWithAuth } from "@/lib/api";
import { cn, fileUrl, toThaiTime } from "@/lib/utils";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import type { PersonalFile, PersonalWorkspace, WorkspaceRecord } from "@/lib/workspace-types";

const icons = { meetings: CalendarClock, reports: ClipboardList, todos: ListTodo, orders: Package };
const DRAG_TYPE = "application/x-personal-record";
type MoveTarget = { item: WorkspaceRecord; from_folder_id?: number };

export default function MyFolderPage() {
  const { user } = useAuth();
  const [data, setData] = useState<PersonalWorkspace | null>(null);
  const [active, setActive] = useState("auto");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<MoveTarget | null>(null);
  const [destination, setDestination] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFolder, setUploadFolder] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const sequence = useRef(0);
  const moveSelect = useRef<HTMLSelectElement>(null);
  const uploadSelect = useRef<HTMLSelectElement>(null);
  const reload = useCallback(() => {
    const run = ++sequence.current;
    return fetchWithAuth("/api/my-folder", {cache:"no-store"})
      .then(async res => {
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || "文件夹加载失败");
        if (sequence.current === run) { setData(result); setError(""); }
        return result as PersonalWorkspace;
      }).catch(err => {
        if (sequence.current === run) setError(err instanceof Error ? err.message : "文件夹加载失败，请重试");
        return null;
      });
  },[]);
  useEffect(() => {
    const counter = sequence;
    void reload();
    return () => { counter.current++; };
  },[reload,user?.id]);
  useEffect(() => {
    if (!moving && !uploadOpen) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (moving ? moveSelect.current : uploadSelect.current)?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { setMoving(null); setUploadOpen(false); }
      if (event.key !== "Tab") return;
      const dialog = document.querySelector<HTMLElement>('[data-folder-dialog]');
      const controls = dialog ? [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), select, input')].filter(el=>el.getClientRects().length) : [];
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    };
    document.addEventListener("keydown",key);
    return () => { document.removeEventListener("keydown",key); previous?.focus(); };
  },[moving,uploadOpen,busy]);

  const mutate = async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const res = await fetchWithAuth("/api/my-folder",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "保存失败，请重试");
      await reload(); return true;
    } catch(err) { setError(err instanceof Error ? err.message : "保存失败，请重试"); return false; }
    finally { setBusy(false); }
  };
  const createFolder = async () => {
    const name = prompt("新文件夹名称（最多80个字）");
    if (name?.trim()) await mutate({action:"create",name});
  };
  const move = async (target: MoveTarget, folderId: number | null) => {
    const success = await mutate(target.item.type === "files"
      ? {action:"file",filename:target.item.id,folder_id:folderId}
      : {action:"assign",record_type:target.item.type,record_id:target.item.id,folder_id:folderId,from_folder_id:target.from_folder_id});
    if (success) setMoving(null);
  };
  const onDrop = (e: React.DragEvent, folderId: number | null) => {
    e.preventDefault();
    if (busy) return;
    try {
      const target = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as MoveTarget;
      if (!target?.item?.id || !["meetings","reports","todos","orders","files"].includes(target.item.type)) return;
      if (folderId === null && target.item.type !== "files") return;
      void move(target,folderId);
    } catch { setError("无法识别拖拽内容，请使用“移动到文件夹”按钮"); }
  };
  const upload = async () => {
    if (!uploadFile || !uploadFolder) return;
    setBusy(true); setError("");
    try {
      const form = new FormData(); form.append("file",uploadFile); form.append("personal_folder_id",uploadFolder);
      const res = await fetchWithAuth("/api/upload",{method:"POST",body:form});
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "上传失败，请重试");
      await reload(); setActive(`folder:${uploadFolder}`); setUploadOpen(false); setUploadFile(null);
    } catch(err) { setError(err instanceof Error ? err.message : "上传失败，请重试"); }
    finally { setBusy(false); }
  };
  const activeFolderId = active.startsWith("folder:") ? Number(active.slice(7)) : undefined;
  const records = data?.groups.flatMap(g=>g.items) || [];
  const folderItems = (id: number): WorkspaceRecord[] => {
    const keys = new Set(data?.memberships.filter(m=>m.folder_id===id).map(m=>`${m.record_type}:${m.record_id}`));
    return [...records.filter(r=>keys.has(`${r.type}:${r.id}`)), ...(data?.files.filter(f=>f.folder_id===id) || [])];
  };
  const unclassified = data?.files.filter(f=>f.folder_id===null) || [];
  const dropProps = (id: number | null) => ({onDragOver:(e:React.DragEvent)=>{if(e.dataTransfer.types.includes(DRAG_TYPE)) {e.preventDefault(); e.dataTransfer.dropEffect="move";}}, onDrop:(e:React.DragEvent)=>onDrop(e,id)});
  const renderItems = (items: WorkspaceRecord[], fromFolder?: number) => items.length ? <ul className="divide-y divide-[var(--border)]">{items.map(item=><li key={`${item.type}:${item.id}`} draggable={!busy}
    onDragStart={e=>{e.dataTransfer.setData(DRAG_TYPE,JSON.stringify({item,from_folder_id:fromFolder}));e.dataTransfer.effectAllowed="copyMove";}}
    className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-3 sm:flex-nowrap">
    {item.type === "files" ? <a draggable={false} href={fileUrl(item.href)} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 hover:text-[var(--primary)]"><span className="block break-words text-sm font-medium">{item.title}</span><span className="mt-1 block text-xs text-[var(--muted-foreground)]">上传文件 · {toThaiTime(item.time)?.slice(0,16)}</span></a>
    : <Link draggable={false} href={item.href} className="min-w-0 flex-1 hover:text-[var(--primary)]"><span className="block break-words text-sm font-medium">{item.title}</span><span className="mt-1 block line-clamp-2 break-words text-xs text-[var(--muted-foreground)]">{item.summary}</span><span className="mt-1 block text-xs text-[var(--muted-foreground)]">{item.time.slice(0,10)}</span></Link>}
    <button type="button" disabled={busy} onClick={()=>{setMoving({item,from_folder_id:fromFolder});setDestination(item.type === "files" ? String((item as PersonalFile).folder_id ?? "") : String(data?.folders[0]?.id ?? ""));}}
      className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border)] px-2 py-2 text-xs hover:bg-[var(--muted)] disabled:opacity-50"><FolderInput className="size-3.5" />移动到文件夹</button>
  </li>)}</ul> : <p className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">暂无记录</p>;

  return <div className="flex min-w-0 flex-col gap-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-display text-2xl font-light">我的文件夹</h1><p className="mt-1 text-sm text-[var(--muted-foreground)]">自动汇集与你相关的资料，也可以创建文件夹整理和上传文件</p></div>
      <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={()=>void createFolder()}><Plus className="size-4" />新建文件夹</Button><Button disabled={busy || !data?.folders.length} onClick={()=>{setUploadFolder(String(activeFolderId ?? data?.folders[0]?.id ?? ""));setUploadFile(null);setUploadOpen(true);}}><Upload className="size-4" />上传文件</Button></div>
    </header>
    {error && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-red-500/10 p-3 text-sm text-red-600">{error}<button className="underline" onClick={()=>void reload()}>重新加载</button></div>}
    {!data ? <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">{error ? "暂时无法加载文件夹" : "加载中…"}</p> : <>
      <section aria-label="自动分区" className="grid grid-cols-2 gap-3 lg:grid-cols-4">{data.groups.map(group=>{const Icon=icons[group.type as keyof typeof icons];return <button type="button" key={group.type} onClick={()=>setActive(`auto:${group.type}`)} className={cn("min-w-0 rounded-xl border p-4 text-left transition-colors",active===`auto:${group.type}` ? "border-[var(--primary)] bg-[var(--primary)]/5":"border-[var(--border)] hover:border-[var(--primary)]")}><Icon className="mb-3 size-5 text-[var(--primary)]" /><span className="font-medium">{group.label}</span><span className="ml-2 text-sm text-[var(--muted-foreground)]">{group.items.length}</span></button>;})}</section>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside aria-label="自定义文件夹" className="min-w-0 space-y-2">
          <button type="button" onClick={()=>setActive("auto")} className={cn("w-full rounded-lg px-3 py-2 text-left text-sm",active==="auto"&&"bg-[var(--muted)]")}>全部自动分区</button>
          <h2 className="px-3 py-2 text-xs font-medium text-[var(--muted-foreground)]">自定义文件夹 · 电脑可拖入记录</h2>
          {!data.folders.length && <p className="px-3 pb-2 text-xs text-[var(--muted-foreground)]">先新建一个文件夹，即可归类和上传文件</p>}
          {data.folders.map(folder=><button key={folder.id} type="button" {...dropProps(folder.id)} onClick={()=>setActive(`folder:${folder.id}`)} className={cn("flex w-full min-w-0 items-center gap-2 rounded-lg border px-3 py-3 text-left text-sm",activeFolderId===folder.id ? "border-[var(--primary)] bg-[var(--muted)]" : "border-[var(--border)] hover:border-[var(--primary)]")}><FolderOpen className="size-4 shrink-0" /><span className="min-w-0 flex-1 break-words">{folder.name}</span><span className="text-xs text-[var(--muted-foreground)]">{folderItems(folder.id).length}</span></button>)}
          <button type="button" {...dropProps(null)} onClick={()=>setActive("unclassified")} className={cn("w-full rounded-lg px-3 py-3 text-left text-sm",active==="unclassified"&&"bg-[var(--muted)]")}>未分类文件 <span className="ml-2 text-xs text-[var(--muted-foreground)]">{unclassified.length}</span></button>
        </aside>
        <div className="min-w-0 space-y-5">
          {data.groups.filter(g=>active==="auto" || active===`auto:${g.type}`).map(group=><section key={group.type} className="min-w-0 rounded-xl border border-[var(--border)]"><h2 className="border-b border-[var(--border)] px-4 py-3 font-medium">{group.label}<span className="ml-2 text-xs font-normal text-[var(--muted-foreground)]">自动汇集 · {group.items.length}</span></h2>{renderItems(group.items)}</section>)}
          {activeFolderId !== undefined && data.folders.filter(f=>f.id===activeFolderId).map(folder=><section key={folder.id} {...dropProps(folder.id)} className="min-w-0 rounded-xl border border-[var(--border)]"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3"><h2 className="min-w-0 break-words font-medium">{folder.name}</h2><div className="flex gap-3"><button type="button" disabled={busy} className="flex items-center gap-1 text-xs" onClick={()=>{const name=prompt("重命名文件夹",folder.name);if(name?.trim())void mutate({action:"rename",folder_id:folder.id,name});}}><Pencil className="size-3.5" />重命名</button><button type="button" disabled={busy} className="flex items-center gap-1 text-xs text-red-600" onClick={async ()=>{if(!confirm(`删除“${folder.name}”？建议先将上传文件移到其他文件夹。继续删除后，上传文件保留在“未分类文件”，业务记录仍保留在自动分区。`))return;if(await mutate({action:"delete",folder_id:folder.id}))setActive("unclassified");}}><Trash2 className="size-3.5" />删除</button></div></div>{renderItems(folderItems(folder.id),folder.id)}</section>)}
          {active==="unclassified" && <section className="rounded-xl border border-[var(--border)]"><h2 className="border-b border-[var(--border)] px-4 py-3 font-medium">未分类文件</h2>{renderItems(unclassified)}</section>}
        </div>
      </div>
    </>}
    {(moving || uploadOpen) && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={()=>{if(!busy){setMoving(null);setUploadOpen(false);}}}>
      <div data-folder-dialog role="dialog" aria-modal="true" aria-labelledby="folder-dialog-title" onClick={e=>e.stopPropagation()} className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl bg-[var(--background)] p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-2"><h2 id="folder-dialog-title" className="font-medium">{moving ? "移动到文件夹" : "上传文件"}</h2><button aria-label="关闭" disabled={busy} onClick={()=>{setMoving(null);setUploadOpen(false);}}><X className="size-5" /></button></div>
        {error && <p role="alert" className="mb-3 text-sm text-red-600">{error}</p>}
        {moving ? <><p className="mb-3 break-words text-sm text-[var(--muted-foreground)]">{moving.item.title}</p><label className="block text-sm">目标文件夹<select ref={moveSelect} value={destination} disabled={busy} onChange={e=>setDestination(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3">{moving.item.type==="files" ? <option value="">未分类文件</option> : <option value="" disabled>请选择文件夹</option>}{data?.folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><p className="mt-3 text-xs text-[var(--muted-foreground)]">自动分区里的原记录会保留。{!data?.folders.length && "请先关闭此窗口，新建一个自定义文件夹。"}</p><Button className="mt-5 w-full" disabled={busy || (moving.item.type!=="files" && !destination)} onClick={()=>void move(moving,destination ? Number(destination):null)}>{busy ? "保存中…" : "确认移动"}</Button></>
        : <><label className="block text-sm">目标文件夹<select ref={uploadSelect} value={uploadFolder} disabled={busy} onChange={e=>setUploadFolder(e.target.value)} className="mt-2 h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3">{data?.folders.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label><label className="mt-4 block text-sm">选择文件<input type="file" disabled={busy} accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.pdf,.doc,.docx,.xls,.xlsx" onChange={e=>setUploadFile(e.target.files?.[0] || null)} className="mt-2 block w-full min-w-0 text-sm" /></label><p className="mt-2 text-xs text-[var(--muted-foreground)]">支持图片、PDF、Word、Excel，单个文件不超过10MB。</p><Button disabled={busy || !uploadFile || !uploadFolder} className="mt-5 w-full" onClick={()=>void upload()}>{busy ? "上传中…" : "上传"}</Button></>}
      </div>
    </div>}
  </div>;
}
