import React, { useState, useEffect } from "react";
import { safeUpper } from "../../../utils/safeFormat";
import { Plus, Search, Eye, Edit3, Trash2, Share2, FileText, ExternalLink, CalendarClock } from "lucide-react";
import { api } from "../../../lib/api";
import { toast } from "sonner";
import SocialShareModal from "./SocialShareModal";
import useBackToClose from "../../../lib/popupRules"; // v456: phone Back closes admin popups
import { appConfirm } from "../../common/Popup"; // v456: app popup instead of the browser's confirm
import BlogAiModal from "./BlogAiModal";

export default function BlogList({ onNewPost, onEditPost, onAiGeneratedPost }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSharePost, setSelectedSharePost] = useState(null);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [loadError, setLoadError] = useState(false); // v332: a failed load read "No articles found"
  const [rowBusy, setRowBusy] = useState(null); // v332: no double publish / delete
  // v451 (Ravi): pick drafts → schedule them all in one go (one every N days at a set time)
  const [picked, setPicked] = useState([]);
  const [schedOpen, setSchedOpen] = useState(false);

  const fetchPosts = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (categoryFilter !== "all") params.category = categoryFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await api.get("/admin/blog/posts", { params });
      if (res.data?.posts) {
        setPosts(res.data.posts);
      }
    } catch (err) {
      console.error("[BlogList fetch]", err);
      setLoadError(true); // v332
      toast.error("Couldn't load blog posts. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosts();
  }, [statusFilter, categoryFilter]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchPosts();
  };

  // Quick Toggle Publish / Unpublish
  const handleTogglePublish = async (post) => {
    if (rowBusy) return; // v332
    // v332: tapping the status pill used to publish / unpublish straight away
    if (!(await appConfirm(post.status === "published" ? `Unpublish "${post.title}"? It will leave the public blog.` : `Publish "${post.title}" on the public blog now?`))) return;
    setRowBusy(post.id);
    try {
      if (post.status === "published") {
        await api.post(`/admin/blog/posts/${post.id}/unpublish`);
        toast.success("Post unpublished (moved to draft)");
      } else {
        await api.post(`/admin/blog/posts/${post.id}/publish`);
        toast.success("Post published live!");
      }
      fetchPosts();
    } catch (err) {
      toast.error("Couldn't change the post. Please try again.");
    } finally {
      setRowBusy(null);
    }
  };

  // Delete Post
  const handleDeletePost = async (id, title) => {
    if (rowBusy) return; // v332
    if (!(await appConfirm(`Are you sure you want to delete "${title}"?`))) return;
    setRowBusy(id);
    try {
      await api.delete(`/admin/blog/posts/${id}`);
      toast.success("Blog post deleted");
      fetchPosts();
    } catch (err) {
      toast.error("Couldn't delete the post. Please try again.");
    } finally {
      setRowBusy(null);
    }
  };

  const drafts = posts.filter((p) => p.status === "draft");
  const togglePick = (id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const unschedule = async (post) => {
    setRowBusy(post.id);
    try { await api.post("/admin/blog/schedule", { items: [{ id: post.id, scheduled_at: null }] }); toast.success("Schedule removed — it's a plain draft again"); fetchPosts(); }
    catch { toast.error("Couldn't remove the schedule."); } finally { setRowBusy(null); }
  };

  // Computed metrics
  const totalPosts = posts.length;
  const publishedCount = posts.filter((p) => p.status === "published").length;
  const draftCount = posts.filter((p) => p.status === "draft").length;
  const totalViews = posts.reduce((acc, p) => acc + (p.views_count || 0), 0);

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="p-4 rounded-3xl bg-white border border-[#E5E5E2] shadow-xs flex flex-wrap items-center justify-between gap-4">
        {/* Search & Category Filter */}
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <form onSubmit={handleSearchSubmit} className="relative min-w-[240px] flex-1 max-w-md">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#5F6672]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, tags, or author..."
              className="w-full pl-9 pr-4 py-2 text-[16px] sm:text-xs rounded-xl border border-[#E5E5E2] bg-[#F9F9FB] focus:outline-none focus:border-[#7C3AED] text-[#0A0A0A]"
            />
          </form>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Category" /* v332 */
            className="px-3 py-2 text-[16px] sm:text-xs font-semibold rounded-xl border border-[#E5E5E2] bg-[#F9F9FB] text-[#0A0A0A] focus:outline-none focus:border-[#7C3AED]"
          >
            <option value="all">All Categories</option>
            <option value="Influencer Marketing">Influencer Marketing</option>
            <option value="Creator Economy">Creator Economy</option>
            <option value="Platform Updates">Platform Updates</option>
            <option value="Guides & Playbooks">Guides & Playbooks</option>
            <option value="Case Studies">Case Studies</option>
            <option value="Monetization & Payouts">Monetization & Payouts</option>
          </select>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5">
          {drafts.length > 0 && (
            <button
              onClick={() => { if (!picked.length) setPicked(drafts.filter((d) => !d.scheduled_at).map((d) => d.id)); setSchedOpen(true); }}
              data-testid="blog-schedule-btn"
              className="px-4 py-2 rounded-xl bg-white text-[#0A0A0A] border border-[#E5E5E2] hover:border-[#7C3AED] text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <CalendarClock size={14} />
              {picked.length ? `Schedule ${picked.length} selected` : "Schedule drafts"}
            </button>
          )}
          <button
            onClick={() => setIsAiModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-[#F5F0FF] text-[#7C3AED] hover:bg-[#EDE5FF] border border-[#DDD6FE] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
          >
            AI Write
          </button>

          <button
            onClick={onNewPost}
            className="px-4 py-2 rounded-xl bg-[#7C3AED] hover:bg-[#6D28D9] text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer"
          >
            <Plus size={15} />
            New Post
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-[#F0F0F0] pb-2">
        {["all", "published", "draft"].map((st) => (
          <button
            key={st}
            onClick={() => setStatusFilter(st)}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer ${
              statusFilter === st
                ? "bg-[#0A0A0A] text-white"
                : "text-[#5F6672] hover:text-[#0A0A0A] hover:bg-[#F2F2F7]"
            }`}
          >
            {st}
          </button>
        ))}
      </div>

      {/* Posts Table / List */}
      <div className="rounded-3xl bg-white border border-[#E5E5E2] shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-xs text-[#5F6672]">
            <div className="w-8 h-8 border-2 border-[#7C3AED] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            Loading blog articles...
          </div>
        ) : loadError && posts.length === 0 ? (
          <div className="py-16 px-6 text-center text-sm text-red-600">{/* v332 */}
            Couldn't load blog posts. <button type="button" onClick={fetchPosts} className="underline font-semibold">Try again</button>
          </div>
        ) : posts.length === 0 && (statusFilter !== "all" || categoryFilter !== "all" || searchQuery.trim()) ? (
          <div className="py-16 px-6 text-center text-sm text-[#5F6672]">No articles match these filters.</div>
        ) : posts.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="w-14 h-14 rounded-2xl bg-[#F5F0FF] text-[#7C3AED] flex items-center justify-center mx-auto mb-4 border border-[#DDD6FE]">
              <FileText size={24} />
            </div>
            <h3 className="text-base font-bold text-[#0A0A0A] mb-1">No articles found</h3>
            <p className="text-xs text-[#5F6672] max-w-md mx-auto mb-5">
              Start sharing authoritative influencer marketing insights, creator playbooks, and platform updates.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setIsAiModalOpen(true)}
                className="px-4 py-2 rounded-xl bg-[#F5F0FF] text-[#7C3AED] text-xs font-bold hover:bg-[#EDE5FF] transition-colors flex items-center gap-1.5"
              >
                Generate with Gemini
              </button>
              <button
                onClick={onNewPost}
                className="px-4 py-2 rounded-xl bg-[#7C3AED] text-white text-xs font-bold hover:bg-[#6D28D9] transition-colors flex items-center gap-1.5"
              >
                <Plus size={14} /> Create Post
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left border-collapse">{/* v332: scrolls on phones instead of squashing */}
              <thead>
                <tr className="bg-[#F9F9FB] border-b border-[#F0F0F0] text-[11px] font-bold text-[#5F6672] uppercase tracking-wider">
                  <th className="py-3.5 pl-4 pr-0 w-8">
                    {drafts.length > 0 && (
                      <input type="checkbox" aria-label="Select all drafts" data-testid="blog-pick-all"
                        checked={drafts.length > 0 && drafts.every((d) => picked.includes(d.id))}
                        onChange={(e) => setPicked(e.target.checked ? drafts.map((d) => d.id) : [])} className="accent-[#7C3AED] w-4 h-4 cursor-pointer" />
                    )}
                  </th>
                  <th className="py-3.5 px-6">Article</th>
                  <th className="py-3.5 px-4">Category</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Author</th>
                  <th className="py-3.5 px-4">Views</th>
                  <th className="py-3.5 px-4">Date</th>
                  <th className="py-3.5 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F0F0F0] text-xs">
                {posts.map((post) => {
                  const isPub = post.status === "published";
                  return (
                    <tr key={post.id} className="hover:bg-[#F9F9FB] transition-colors group">
                      <td className="py-4 pl-4 pr-0 w-8">
                        {!isPub && (
                          <input type="checkbox" aria-label={`Select ${post.title}`} data-testid={`blog-pick-${post.id}`}
                            checked={picked.includes(post.id)} onChange={() => togglePick(post.id)} className="accent-[#7C3AED] w-4 h-4 cursor-pointer" />
                        )}
                      </td>
                      {/* Post info */}
                      <td className="py-4 px-6 max-w-sm">
                        <div className="flex items-center gap-3.5">
                          {post.cover_image_url ? (
                            <img
                              src={post.cover_image_url}
                              alt=""
                              referrerPolicy="no-referrer"
                              className="w-14 h-10 rounded-xl object-cover border border-[#E5E5E2] shrink-0"
                            />
                          ) : (
                            <div className="w-14 h-10 rounded-xl bg-[#F2F2F7] border border-[#E5E5E2] flex items-center justify-center text-[#5F6672] shrink-0">
                              <FileText size={16} />
                            </div>
                          )}
                          <div className="truncate">
                            <div
                              onClick={() => onEditPost(post)}
                              className="font-bold text-[#0A0A0A] hover:text-[#7C3AED] cursor-pointer truncate transition-colors"
                            >
                              {post.title}
                            </div>
                            <div className="text-[11px] text-[#5F6672] font-mono truncate mt-0.5">
                              /blog/{post.slug}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[#F2F2F7] text-[#0A0A0A]">
                          {post.category || "General"}
                        </span>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <button
                          onClick={() => handleTogglePublish(post)}
                          disabled={rowBusy === post.id} /* v332 */
                          title={isPub ? "Unpublish" : "Publish"}
                          className={`disabled:opacity-50 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                            isPub
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                              : "bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200"
                          }`}
                        >
                          {safeUpper(post.status)}
                        </button>
                        {!isPub && post.scheduled_at && (
                          <div className="mt-1 flex items-center gap-1.5" data-testid={`blog-scheduled-${post.id}`}>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#F1EBFE] text-[#6D28D9] border border-[#D9C8FB]">
                              ⏰ {new Date(post.scheduled_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                            </span>
                            <button type="button" onClick={() => unschedule(post)} disabled={rowBusy === post.id} className="text-[10px] font-semibold text-[#5F6672] hover:text-red-600 cursor-pointer">✕</button>
                          </div>
                        )}
                      </td>

                      {/* Author */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <span className="font-semibold text-[#0A0A0A]">
                          {(() => {
                            const authorNameTag = post.tags?.find(t => t.startsWith('__author_name:'));
                            return authorNameTag ? authorNameTag.substring(14) : "YBEX Editorial";
                          })()}
                        </span>
                      </td>

                      {/* Views */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 font-mono text-[#0A0A0A]">
                          <Eye size={12} className="text-[#5F6672]" />
                          {(Number(post.views_count) || 0).toLocaleString('en-IN') /* v330 */}
                        </div>
                      </td>

                      {/* Date */}
                      <td className="py-4 px-4 whitespace-nowrap text-[11px] text-[#5F6672]">
                        {post.published_at
                          ? new Date(post.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
                          : post.created_at ? new Date(post.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—'}{/* v330: IST, no Invalid Date */}
                      </td>

                      {/* Action buttons */}
                      <td className="py-4 px-6 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {isPub && (
                            <a
                              href={`/blog/${post.slug}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1.5 rounded-lg text-[#5F6672] hover:text-[#0A0A0A] hover:bg-white transition-colors"
                              title="View Public Post"
                              aria-label="View public post" /* v332 */
                            >
                              <ExternalLink size={14} />
                            </a>
                          )}

                          <button
                            onClick={() => setSelectedSharePost(post)}
                            className="p-1.5 rounded-lg text-[#5F6672] hover:text-[#7C3AED] hover:bg-[#F5F0FF] transition-colors cursor-pointer"
                            title="Social Distribution Pack"
                            aria-label="Share post"
                          >
                            <Share2 size={14} />
                          </button>

                          <button
                            onClick={() => onEditPost(post)}
                            className="p-1.5 rounded-lg text-[#5F6672] hover:text-[#0A0A0A] hover:bg-white transition-colors cursor-pointer"
                            title="Edit Post"
                            aria-label="Edit post"
                          >
                            <Edit3 size={14} />
                          </button>

                          <button
                            onClick={() => handleDeletePost(post.id, post.title)}
                            disabled={rowBusy === post.id}
                            aria-label="Delete post"
                            className="disabled:opacity-50 p-1.5 rounded-lg text-[#5F6672] hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                            title="Delete Post"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Social Modal */}
      {schedOpen && (
        <ScheduleDraftsModal
          posts={drafts.filter((d) => picked.includes(d.id))}
          onClose={() => setSchedOpen(false)}
          onDone={() => { setSchedOpen(false); setPicked([]); fetchPosts(); }}
        />
      )}
      <SocialShareModal
        isOpen={Boolean(selectedSharePost)}
        onClose={() => setSelectedSharePost(null)}
        post={selectedSharePost}
      />

      {/* AI Write Modal */}
      <BlogAiModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        onApplyContent={(aiData) => {
          onAiGeneratedPost(aiData);
        }}
      />
    </div>
  );
}

/** v451: one slot per post — start date + time, then one post every `gapDays` days (0 = all at the same time). Pure. */
export function scheduleSlots(count, startDate, time, gapDays) {
  const [h, m] = String(time || "10:00").split(":").map((x) => Number(x) || 0);
  const base = new Date(`${startDate}T00:00:00`);
  if (!Number.isFinite(base.getTime())) return [];
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(base);
    d.setDate(d.getDate() + i * Math.max(0, Number(gapDays) || 0));
    d.setHours(h, m, 0, 0);
    return d;
  });
}

function ScheduleDraftsModal({ posts, onClose, onDone }) {
  useBackToClose(true, () => onClose?.()); // v456 (admin review): phone Back closes it instead of leaving the page
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); })();
  const [order, setOrder] = useState(posts);
  const [start, setStart] = useState(tomorrow);
  const [time, setTime] = useState("10:00");
  const [gap, setGap] = useState(1);
  const [busy, setBusy] = useState(false);
  const slots = scheduleSlots(order.length, start, time, gap);
  const past = slots.some((d) => d.getTime() < Date.now());
  const move = (i, d) => setOrder((cur) => { const n = [...cur]; const j = i + d; if (j < 0 || j >= n.length) return cur; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const save = async () => {
    if (!order.length) { toast.error("Select at least one draft."); return; }
    if (past) { toast.error("Pick a time in the future."); return; }
    setBusy(true);
    try {
      const r = await api.post("/admin/blog/schedule", { items: order.map((p, i) => ({ id: p.id, scheduled_at: slots[i].toISOString() })) });
      toast.success(`${r.data?.scheduled ?? order.length} post(s) scheduled — they go live on their own`);
      onDone();
    } catch (e) { toast.error(e?.response?.data?.error || "Couldn't schedule. Try again."); } finally { setBusy(false); }
  };
  const fmt = (d) => d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div className="yb-fade fixed inset-0 z-[200] bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" data-testid="blog-schedule-modal">
      <div className="yb-pop bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-[17px] font-bold text-[#0A0A0A]">Schedule {order.length} draft{order.length === 1 ? "" : "s"}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[#5F6672] text-lg cursor-pointer">✕</button>
        </div>
        <p className="text-xs text-[#5F6672] mt-1">Each post goes live by itself at its time. You can change the order.</p>
        <div className="grid grid-cols-3 gap-2 mt-4">
          <label className="text-[11px] font-bold text-[#5F6672]">First post on
            <input type="date" value={start} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setStart(e.target.value)} className="mt-1 w-full px-2 py-2 rounded-xl border border-[#E5E5E2] text-[14px] text-[#0A0A0A]" />
          </label>
          <label className="text-[11px] font-bold text-[#5F6672]">Time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 w-full px-2 py-2 rounded-xl border border-[#E5E5E2] text-[14px] text-[#0A0A0A]" />
          </label>
          <label className="text-[11px] font-bold text-[#5F6672]">Then every
            <select value={gap} onChange={(e) => setGap(Number(e.target.value))} className="mt-1 w-full px-2 py-2 rounded-xl border border-[#E5E5E2] text-[14px] text-[#0A0A0A]">
              <option value={0}>Same time</option>
              <option value={1}>1 day</option>
              <option value={2}>2 days</option>
              <option value={3}>3 days</option>
              <option value={7}>Week</option>
            </select>
          </label>
        </div>
        <div className="mt-4 divide-y divide-[#F0F0F0] border border-[#F0F0F0] rounded-2xl">
          {order.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-2.5">
              <div className="flex flex-col">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-[10px] text-[#5F6672] disabled:opacity-30 cursor-pointer">▲</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} className="text-[10px] text-[#5F6672] disabled:opacity-30 cursor-pointer">▼</button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-[#0A0A0A] truncate">{p.title}</div>
                <div className="text-[11px] text-[#7C3AED] font-semibold">{slots[i] ? fmt(slots[i]) : "—"}</div>
              </div>
            </div>
          ))}
        </div>
        {past && <p className="text-xs text-red-600 mt-2">That time has already passed — pick a later one.</p>}
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl border border-[#E5E5E2] text-[14px] font-bold text-[#0A0A0A] cursor-pointer">Cancel</button>
          <button type="button" onClick={save} disabled={busy || past || !order.length} data-testid="blog-schedule-save" className="flex-[1.4] h-11 rounded-xl bg-[#7C3AED] text-white text-[14px] font-bold disabled:opacity-50 cursor-pointer">{busy ? "Scheduling…" : "Schedule"}</button>
        </div>
      </div>
    </div>
  );
}
