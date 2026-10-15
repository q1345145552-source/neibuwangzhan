"use client";

import { useState, useEffect } from "react";
import { fetchWithAuth } from "@/lib/api";
import { apiCall } from "@/lib/api-call";
import { useAuth } from "@/components/auth-provider";
import { cn, fileUrl, toThaiTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, X, CalendarClock, Trash2 } from "lucide-react";

interface Meeting {
  id: number;
  title: string;
  meeting_date: string;
  meeting_time: string;
  agenda: string;
  topics: string;
  story: string;
  participants: string;
  creator: string;
  created_at: string;
  participant_count: number;
  submitted_count: number;
  unsubmitted_count: number;
  my_submitted: boolean;
}

interface Reflection {
  id: number;
  meeting_id: number;
  employee_name: string;
  content: string;
  content_zh: string;
  images: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface EmpOption { id: number; name: string; }

function ReflectionTranslation({ reflection, onTranslated }: {
  reflection: Reflection;
  onTranslated: (id: number, content: string) => void;
}) {
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState("");
  const translate = async () => {
    setTranslating(true);
    setError("");
    try {
      const res = await fetchWithAuth(`/api/meetings/reflections/${reflection.id}/translate`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "翻译失败，请重试");
      onTranslated(reflection.id, data.content_zh);
    } catch (err) {
      setError(err instanceof Error ? err.message : "翻译失败，请重试");
    } finally {
      setTranslating(false);
    }
  };
  return reflection.content_zh ? (
    <div className="mt-2 min-w-0 rounded-lg border border-blue-200/60 bg-blue-50/60 p-2.5 dark:border-blue-400/20 dark:bg-blue-950/30">
      <p className="text-xs font-medium text-blue-600 dark:text-blue-300">AI 中文翻译</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{reflection.content_zh}</p>
    </div>
  ) : (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={translate} disabled={translating || !reflection.content.trim()}>
        {translating ? "翻译中…" : "AI 翻译"}
      </Button>
      {error && <p role="alert" className="min-w-0 break-words text-xs text-[var(--destructive)]">{error}</p>}
    </div>
  );
}

function parseList(s: string): string[] {
  try { const a = JSON.parse(s || "[]"); return Array.isArray(a) ? a.map((x) => String(x)) : []; } catch { return []; }
}

function statusBadge(st: string) {
  return (
    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", st === "已提交" ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300")}>
      {st}
    </span>
  );
}

export default function MeetingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  // 发起会议表单
  const [formOpen, setFormOpen] = useState(false);
  const [employees, setEmployees] = useState<EmpOption[]>([]);
  const [formTitle, setFormTitle] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formTime, setFormTime] = useState("");
  const [formAgenda, setFormAgenda] = useState("");
  const [formParticipants, setFormParticipants] = useState<string[]>([]);
  const [availableTopics, setAvailableTopics] = useState<string[]>([]);
  const [formTopics, setFormTopics] = useState<string[]>([]);
  const [newTopic, setNewTopic] = useState("");
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsError, setTopicsError] = useState("");
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);

  // 会议详情 + 心得
  const [detailMeeting, setDetailMeeting] = useState<Meeting | null>(null);
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [storyGenerating, setStoryGenerating] = useState(false);
  const [storyError, setStoryError] = useState("");
  const onTranslated = (id: number, content: string) => {
    setReflections((rows) => rows.map((row) => row.id === id ? { ...row, content_zh: content } : row));
  };

  // 心得表单（提交/重交）
  const [rfOpen, setRfOpen] = useState(false);
  const [rfMode, setRfMode] = useState<"create" | "edit">("create");
  const [rfId, setRfId] = useState<number | null>(null);
  const [rfContent, setRfContent] = useState("");
  const [rfImages, setRfImages] = useState<string[]>([]);
  const [rfUploading, setRfUploading] = useState(false);
  const [rfErr, setRfErr] = useState("");
  const [rfSaving, setRfSaving] = useState(false);

  // 图片灯箱
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchWithAuth("/api/meetings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setMeetings(Array.isArray(d) ? d : []))
      .catch(() => setMeetings([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [user?.name]);

  // ── 发起会议 ──
  const loadTopics = async () => {
    setTopicsLoading(true);
    setTopicsError("");
    try {
      const res = await fetchWithAuth("/api/meetings/topics", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "会议主题加载失败");
      setAvailableTopics(Array.isArray(data) ? data.filter((topic): topic is string => typeof topic === "string") : []);
    } catch (error) {
      setTopicsError(error instanceof Error ? error.message : "会议主题加载失败");
    } finally { setTopicsLoading(false); }
  };

  const addTopic = () => {
    const topic = newTopic.trim();
    if (!topic) return;
    setAvailableTopics((topics) => [...new Set([...topics, topic])]);
    setFormTopics((topics) => [...new Set([...topics, topic])]);
    setNewTopic("");
  };

  const openCreate = () => {
    setFormTitle("");
    setFormDate("");
    setFormTime("");
    setFormAgenda("");
    setFormParticipants([]);
    setFormTopics([]);
    setNewTopic("");
    setAvailableTopics([]);
    void loadTopics();
    setFormErr("");
    setFormOpen(true);
    fetchWithAuth("/api/employees", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setEmployees((Array.isArray(d) ? d : []).filter((e: any) => e.role === "employee" && e.status === "在职").map((e: any) => ({ id: e.id, name: e.name }))))
      .catch(() => setEmployees([]));
  };

  const toggleParticipant = (name: string) => {
    setFormParticipants((p) => (p.includes(name) ? p.filter((n) => n !== name) : [...p, name]));
  };

  const submitMeeting = async () => {
    if (!formTitle.trim()) { setFormErr("请填写会议主题"); return; }
    if (!formDate) { setFormErr("请选择会议日期"); return; }
    if (formParticipants.length === 0) { setFormErr("请至少勾选一名参会人"); return; }
    setSaving(true);
    // 尚未点“添加”就直接发布时，也保存输入框中的新主题。
    const topics = [...new Set([...formTopics, newTopic.trim()].filter(Boolean))];
    const body = { title: formTitle, meeting_date: formDate, meeting_time: formTime, agenda: formAgenda, participants: formParticipants, topics };
    const ok = await apiCall("/api/meetings", { method: "POST", body, onError: (m) => setFormErr(m) });
    setSaving(false);
    if (ok) { setFormOpen(false); setFormErr(""); load(); }
  };

  // ── 会议详情 + 心得 ──
  const loadReflections = (meetingId: number) => {
    setRefLoading(true);
    fetchWithAuth(`/api/meetings/${meetingId}/reflections`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setReflections(Array.isArray(d) ? d : []))
      .catch(() => setReflections([]))
      .finally(() => setRefLoading(false));
  };

  const openMeeting = (m: Meeting) => {
    setDetailMeeting(m);
    setStoryError("");
    setReflections([]);
    loadReflections(m.id);
  };

  const generateStory = async () => {
    if (!detailMeeting || storyGenerating) return;
    const meetingId = detailMeeting.id;
    setStoryGenerating(true);
    setStoryError("");
    try {
      const res = await fetchWithAuth(`/api/meetings/${meetingId}/story`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败，请重试");
      setMeetings((rows) => rows.map((meeting) => meeting.id === meetingId ? { ...meeting, story: data.story } : meeting));
      setDetailMeeting((meeting) => meeting?.id === meetingId ? { ...meeting, story: data.story } : meeting);
    } catch (error) {
      setStoryError(error instanceof Error ? error.message : "生成失败，请重试");
    } finally { setStoryGenerating(false); }
  };

  const openRfCreate = () => {
    setRfMode("create");
    setRfId(null);
    setRfContent("");
    setRfImages([]);
    setRfErr("");
    setRfOpen(true);
  };

  const openRfEdit = (r: Reflection) => {
    setRfMode("edit");
    setRfId(r.id);
    setRfContent(r.content || "");
    setRfImages(parseList(r.images));
    setRfErr("");
    setRfOpen(true);
  };

  const handleRfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setRfUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetchWithAuth("/api/upload", { method: "POST", body: fd });
        if (res.ok) {
          const data = await res.json();
          if (data.url) urls.push(data.url);
        }
      }
      if (urls.length) setRfImages((p) => [...p, ...urls]);
    } catch { setRfErr("图片上传失败"); }
    finally { setRfUploading(false); e.target.value = ""; }
  };

  const removeRfImage = (url: string) => setRfImages((p) => p.filter((u) => u !== url));

  const submitRf = async () => {
    if (!detailMeeting) return;
    if (!rfContent.trim()) { setRfErr("请填写心得内容"); return; }
    setRfSaving(true);
    const body = { content: rfContent, images: rfImages };
    const ok = rfMode === "create"
      ? await apiCall(`/api/meetings/${detailMeeting.id}/reflections`, { method: "POST", body, onError: (m) => setRfErr(m) })
      : await apiCall(`/api/meetings/${detailMeeting.id}/reflections/${rfId}`, { method: "PATCH", body, onError: (m) => setRfErr(m) });
    setRfSaving(false);
    if (ok) { setRfOpen(false); setRfErr(""); loadReflections(detailMeeting.id); load(); }
  };

  const deleteRf = async (r: Reflection) => {
    if (!detailMeeting) return;
    if (!confirm("确定删除这条心得？")) return;
    const ok = await apiCall(`/api/meetings/${detailMeeting.id}/reflections/${r.id}`, { method: "DELETE" });
    if (ok) { loadReflections(detailMeeting.id); load(); }
  };

  const rejectRf = async (r: Reflection) => {
    if (!detailMeeting) return;
    if (!confirm(`确定退回 ${r.employee_name} 的这条心得？`)) return;
    const ok = await apiCall(`/api/meetings/${detailMeeting.id}/reflections/${r.id}`, { method: "PATCH", body: { action: "reject" } });
    if (ok) { loadReflections(detailMeeting.id); load(); }
  };

  const dateTimeLabel = (m: Meeting) => (m.meeting_time ? `${m.meeting_date} ${m.meeting_time}` : m.meeting_date);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-light tracking-tight text-[var(--foreground)]">会议记录</h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{isAdmin ? "发起会议通知，查看员工提交的心得" : "查看你被邀请参加的会议，提交心得"}</p>
        </div>
        {isAdmin && (
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="size-4" />发起会议
          </Button>
        )}
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
      ) : meetings.length === 0 ? (
        <p className="py-12 text-center text-sm text-[var(--muted-foreground)]">{isAdmin ? "还没有会议，点右上角发起会议" : "暂无你参加的会议"}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {meetings.map((m) => (
            <button
              key={m.id}
              onClick={() => openMeeting(m)}
              className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-left transition-colors hover:border-[var(--primary)]"
            >
              <div className="flex flex-wrap items-center gap-2">
                <CalendarClock className="size-4 text-[var(--muted-foreground)]" />
                <span className="text-sm font-medium text-[var(--foreground)]">{m.title}</span>
                <span className="text-xs text-[var(--muted-foreground)]">{dateTimeLabel(m)}</span>
              </div>
              {m.agenda && <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{m.agenda}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {isAdmin && <span className="text-xs text-[var(--muted-foreground)]">发起人：{m.creator}</span>}
                <span className="text-xs text-[var(--muted-foreground)]">参会人：</span>
                {parseList(m.participants).map((p) => (
                  <span key={p} className="rounded-full bg-[var(--muted)]/40 px-2 py-0.5 text-xs text-[var(--foreground)]">{p}</span>
                ))}
              </div>
              {isAdmin ? (
                <div className="mt-3 min-w-0 rounded-xl border border-blue-200/60 bg-gradient-to-br from-blue-50/80 via-sky-50/50 to-blue-100/40 p-3 shadow-[0_4px_20px_rgba(59,130,246,0.10)] backdrop-blur-md dark:border-blue-400/20 dark:from-blue-950/60 dark:via-slate-900/40 dark:to-blue-900/30">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                    <span className="font-medium text-blue-800 dark:text-blue-200">已交 {m.submitted_count} 人 / 共 {m.participant_count} 人</span>
                    <span className="font-semibold tabular-nums text-blue-600 dark:text-sky-300">{m.participant_count > 0 ? Math.round(m.submitted_count / m.participant_count * 100) : 0}%</span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label="会议心得提交进度"
                    aria-valuemin={0}
                    aria-valuemax={m.participant_count || 1}
                    aria-valuenow={m.submitted_count}
                    aria-valuetext={`已交 ${m.submitted_count} 人，共 ${m.participant_count} 人，未交 ${m.unsubmitted_count} 人`}
                    className="mt-2.5 h-2.5 overflow-hidden rounded-full bg-slate-200/80 shadow-inner dark:bg-slate-700/70"
                  >
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-600 via-blue-400 to-cyan-300 shadow-[0_0_12px_rgba(59,130,246,0.55)] transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${m.participant_count > 0 ? m.submitted_count / m.participant_count * 100 : 0}%` }} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-blue-700 dark:text-blue-300">已交 {m.submitted_count} 人</span>
                    <span className="text-red-600 dark:text-red-300">未交 {m.unsubmitted_count} 人</span>
                  </div>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-[var(--muted-foreground)]">我的状态</span>
                  <span className={cn("rounded-full px-2.5 py-1 font-medium", m.my_submitted ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300")}>
                    {m.my_submitted ? "已交" : "未交"}
                  </span>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 会议详情弹窗（含心得） */}
      {detailMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetailMeeting(null)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--foreground)]">{detailMeeting.title}</h3>
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">{dateTimeLabel(detailMeeting)}</p>
              </div>
              <button onClick={() => setDetailMeeting(null)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            {detailMeeting.agenda && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3 text-sm">{detailMeeting.agenda}</p>}

            {(isAdmin || detailMeeting.story) && (
              <div className="mt-4 min-w-0 rounded-xl border border-blue-200/60 bg-blue-50/60 p-3 dark:border-blue-400/20 dark:bg-blue-950/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-medium text-blue-700 dark:text-blue-200">会议故事线</h4>
                  {isAdmin && !detailMeeting.story && <Button size="sm" onClick={generateStory} disabled={storyGenerating}>{storyGenerating ? "生成中…" : "生成故事线"}</Button>}
                </div>
                {detailMeeting.story && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--foreground)]">{detailMeeting.story}</p>}
                {isAdmin && storyError && <p role="alert" className="mt-2 break-words text-xs text-[var(--destructive)]">{storyError}</p>}
              </div>
            )}

            {isAdmin ? (
              <>
                <div className="mt-4 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-[var(--foreground)]">参会人提交情况（{parseList(detailMeeting.participants).length} 人）</h4>
                </div>
                {refLoading ? (
                  <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {parseList(detailMeeting.participants).map((p) => {
                      const mine = reflections.filter((r) => r.employee_name === p);
                      return (
                        <div key={p} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
                          <div className="flex items-center gap-2">
                            <span className={cn("text-sm font-medium", mine.length === 0 ? "text-red-600" : "text-[var(--foreground)]")}>{p}</span>
                            {mine.length === 0 ? (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">未交</span>
                            ) : (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">已交 {mine.length} 条</span>
                            )}
                          </div>
                          {mine.map((r) => (
                            <div key={r.id} className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-2.5">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-[var(--muted-foreground)]">{toThaiTime(r.created_at)}</span>
                                {statusBadge(r.status)}
                              </div>
                              {r.content && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{r.content}</p>}
                              <ReflectionTranslation reflection={r} onTranslated={onTranslated} />
                              {parseList(r.images).length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-2">
                                  {parseList(r.images).map((img, i) => (
                                    <img key={i} src={fileUrl(img)} alt={`图片 ${i + 1}`} className="h-16 w-16 cursor-pointer rounded-md border border-[var(--border)] object-cover hover:opacity-80" onClick={() => setLightbox(img)} />
                                  ))}
                                </div>
                              )}
                              {r.status === "已提交" && (
                                <div className="mt-1.5"><Button size="sm" variant="destructive" onClick={() => rejectRf(r)}>退回</Button></div>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mt-4 flex items-center justify-between">
                  <h4 className="text-sm font-medium text-[var(--foreground)]">会议心得 {reflections.length > 0 && `(${reflections.length})`}</h4>
                  <Button size="sm" onClick={openRfCreate} className="gap-1"><Plus className="size-3.5" />提交心得</Button>
                </div>
                {refLoading ? (
                  <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">加载中…</p>
                ) : reflections.length === 0 ? (
                  <p className="py-8 text-center text-sm text-[var(--muted-foreground)]">你还没提交心得</p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {reflections.map((r) => (
                      <div key={r.id} className="rounded-xl border border-[var(--border)] bg-[var(--background)] p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-[var(--muted-foreground)]">{toThaiTime(r.created_at)}</span>
                          {statusBadge(r.status)}
                        </div>
                        {r.content && <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{r.content}</p>}
                        <ReflectionTranslation reflection={r} onTranslated={onTranslated} />
                        {parseList(r.images).length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {parseList(r.images).map((img, i) => (
                              <img key={i} src={fileUrl(img)} alt={`图片 ${i + 1}`} className="h-16 w-16 cursor-pointer rounded-md border border-[var(--border)] object-cover hover:opacity-80" onClick={() => setLightbox(img)} />
                            ))}
                          </div>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          {r.status === "退回" && <Button size="sm" onClick={() => openRfEdit(r)}>修改重交</Button>}
                          <Button size="sm" variant="ghost" onClick={() => deleteRf(r)} className="gap-1 text-[var(--muted-foreground)]"><Trash2 className="size-3.5" />删除</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 提交/重交心得弹窗 */}
      {rfOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setRfOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">{rfMode === "create" ? "提交心得" : "修改重交"}</h3>
              <button onClick={() => setRfOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4">
              <label className="text-xs font-medium">心得内容 <span className="text-[var(--destructive)]">*</span></label>
              <textarea value={rfContent} onChange={(e) => setRfContent(e.target.value)} rows={4} placeholder="写下你这场会议的收获、心得" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
            </div>

            <div className="mt-3">
              <label className="text-xs font-medium">图片（可选，可传多张）</label>
              {rfImages.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {rfImages.map((img, i) => (
                    <div key={i} className="relative">
                      <img src={fileUrl(img)} alt={`图片 ${i + 1}`} className="h-16 w-16 rounded-md border border-[var(--border)] object-cover" />
                      <button type="button" onClick={() => removeRfImage(img)} className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--background)]"><X className="size-3" /></button>
                    </div>
                  ))}
                </div>
              )}
              <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-xs text-[var(--primary)] hover:underline">
                <Plus className="size-3.5" />{rfUploading ? "上传中…" : "上传图片"}
                <input type="file" accept="image/*" multiple className="hidden" onChange={handleRfUpload} disabled={rfUploading} />
              </label>
            </div>

            {rfErr && <p className="mt-2 text-xs text-[var(--destructive)]">{rfErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submitRf} disabled={rfSaving}>{rfSaving ? "提交中…" : "提交"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setRfOpen(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}

      {/* 图片灯箱 */}
      {lightbox && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4" onClick={() => setLightbox(null)}>
          <img src={fileUrl(lightbox)} alt="放大图片" className="max-h-full max-w-full rounded-md object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {/* 发起会议弹窗 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--background)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-base font-semibold text-[var(--foreground)]">发起会议</h3>
              <button onClick={() => setFormOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X className="size-5" /></button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium">会议标题 <span className="text-[var(--destructive)]">*</span></label>
                <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="例如：周会 / 项目进度讨论" className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
              </div>

              <fieldset className="min-w-0">
                <legend className="text-xs font-medium">会议主题（可多选）</legend>
                {topicsLoading && <p className="mt-1 text-xs text-[var(--muted-foreground)]">加载已有主题…</p>}
                {topicsError && <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--destructive)]">{topicsError}<Button size="sm" variant="ghost" onClick={() => void loadTopics()}>重试</Button></div>}
                <div className="mt-1.5 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                  {[...new Set([...availableTopics, ...formTopics])].map((topic) => (
                    <label key={topic} className={cn("flex min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm", formTopics.includes(topic) ? "border-blue-400/60 bg-blue-50/70 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200" : "border-[var(--border)]")}>
                      <input type="checkbox" checked={formTopics.includes(topic)} onChange={() => setFormTopics((topics) => topics.includes(topic) ? topics.filter((item) => item !== topic) : [...topics, topic])} className="size-4 shrink-0" />
                      <span className="min-w-0 break-words">{topic}</span>
                    </label>
                  ))}
                </div>
                {!topicsLoading && !topicsError && availableTopics.length === 0 && <p className="mt-1 text-xs text-[var(--muted-foreground)]">暂无已有主题，可在下方新建</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <input aria-label="新会议主题" value={newTopic} onChange={(e) => setNewTopic(e.target.value)} onBlur={addTopic} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); addTopic(); } }} placeholder="输入新主题，回车添加" className="h-9 min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                  <Button type="button" size="sm" variant="outline" onClick={addTopic}>添加主题</Button>
                </div>
              </fieldset>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium">会议日期 <span className="text-[var(--destructive)]">*</span></label>
                  <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
                <div>
                  <label className="text-xs font-medium">会议时间</label>
                  <input type="time" value={formTime} onChange={(e) => setFormTime(e.target.value)} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 text-sm outline-none focus:border-[var(--ring)]" />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium">会议内容 / 议程</label>
                <textarea value={formAgenda} onChange={(e) => setFormAgenda(e.target.value)} rows={4} placeholder="会议要讨论什么、有哪些议程" className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none focus:border-[var(--ring)]" />
              </div>

              <div>
                <label className="text-xs font-medium">参会人 <span className="text-[var(--destructive)]">*</span>（勾选多人）</label>
                {employees.length === 0 ? (
                  <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">暂无在职员工</p>
                ) : (
                  <div className="mt-1.5 grid max-h-48 grid-cols-2 gap-1.5 overflow-y-auto">
                    {employees.map((e) => (
                      <label key={e.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm", formParticipants.includes(e.name) ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary),var(--background)_90%)]" : "border-[var(--border)]")}>
                        <input type="checkbox" checked={formParticipants.includes(e.name)} onChange={() => toggleParticipant(e.name)} className="size-4" />
                        <span className="truncate">{e.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {formErr && <p className="mt-2 text-xs text-[var(--destructive)]">{formErr}</p>}
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={submitMeeting} disabled={saving}>{saving ? "发布中…" : "发布"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>取消</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
