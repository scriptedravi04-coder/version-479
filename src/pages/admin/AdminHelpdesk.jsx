import React, { useState, useEffect, useRef } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";
import { Clock, CheckCircle, Clock3, AlertCircle, ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";
import { ignored } from "../../utils/ignored";

// v330: readable labels for machine category keys (the brand home "Schedule a call" sheet sends campaign_manager_call).
const CATEGORY_LABELS = { campaign_manager_call: "Call request", chat_dispute_support: "Chat dispute" };
// v482: any other machine key ("profile_kyc") reads as words ("Profile kyc" → "Profile KYC")
const categoryLabel = (c) => CATEGORY_LABELS[c] || (/_/.test(String(c || "")) ? String(c).replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase()).replace(/\bkyc\b/i, "KYC") : (c || "Other"));
const ticketAge = (d) => { const t = d ? new Date(d).getTime() : NaN; if (isNaN(t)) return ""; const h = Math.floor((Date.now() - t) / 3600000); return h < 1 ? "just now" : h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`; };
// v332: readable status names (tabs used to show raw OPEN / IN PROGRESS / RESOLVED codes).
const STATUS_LABELS = { OPEN: "Open", "IN PROGRESS": "In progress", RESOLVED: "Resolved" };
// v332: calm error text instead of raw "Request failed with status code 500".
const calmError = (err, fallback) => {
  const m = err?.response?.data?.error || err?.response?.data?.detail;
  return typeof m === "string" && m && m.length < 140 ? m : fallback;
};

export default function AdminHelpdesk() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  // v483: Eva answers tickets nobody has replied to (users thought support never answered)
  const [evaPending, setEvaPending] = useState(null);
  const [evaBusy, setEvaBusy] = useState(false);
  useEffect(() => { api.post("admin/support/eva-answer-pending", { dry_run: true }).then((r) => setEvaPending(r.data?.pending ?? null)).catch(() => {}); }, []);
  const runEva = async () => {
    setEvaBusy(true);
    try {
      const r = await api.post("admin/support/eva-answer-pending", {});
      toast.success(`Eva replied to ${r.data?.answered || 0} ticket${r.data?.answered === 1 ? "" : "s"}${r.data?.left ? ` · ${r.data.left} left — press again` : ""}`);
      setEvaPending(r.data?.left ?? 0);
    } catch (e) { toast.error(e?.response?.data?.error || "Eva couldn't run. Try again."); }
    finally { setEvaBusy(false); }
  };
  const [loading, setLoading] = useState(true);
  const [ticketsLoadError, setTicketsLoadError] = useState(false); // v330: failed load is not "No tickets found"
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const shownTicketIdRef = useRef(null); // v332: clear messages only when a DIFFERENT ticket opens
  const [reply, setReply] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [activeTab, setActiveTab] = useState('OPEN');
  const [enrichedThread, setEnrichedThread] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false); // v332: no double status change

  useEffect(() => {
    fetchTickets();

    // Session 22: polling the staff API instead of Supabase realtime (which needed the table
    // to be readable by anyone).
    const ticketsPoll = setInterval(() => { if (!document.hidden) fetchTickets(); }, 60000); // v419: was 20 s — the list changes rarely; the open ticket still refreshes fast

    return () => {
      clearInterval(ticketsPoll);
    };
  }, []);

  const fetchTickets = async () => {
    setLoading(true);
    let ticketsData = null;
    let ticketsError = null;
    try {
      const r = await api.get("/admin/support/tickets");
      ticketsData = Array.isArray(r?.data) ? r.data : [];
    } catch (e) { ticketsError = e; }
    
    if (ticketsError) {
      console.error(ticketsError);
      // v330: keep what is already on screen (a failed 20s poll used to wipe the list) and flag the error
      setTicketsLoadError(true);
      setLoading(false);
      return;
    }
    setTicketsLoadError(false); // v330

    if (!ticketsData || ticketsData.length === 0) {
      setTickets([]);
      setLoading(false);
      return;
    }

    const userIds = [...new Set(ticketsData.map(t => t.user_id).filter(Boolean))];
    
    let usersMap = {};
    if (userIds.length > 0) {
      // Through the server (session 22): the browser may no longer read `users` directly.
      const usersError = null;
      const usersData = await api.get(`/admin/helpdesk/users?ids=${encodeURIComponent(userIds.join(","))}`).then((r) => r?.data?.users || []).catch(() => []);
        
      if (!usersError && usersData) {
        usersData.forEach(u => {
          usersMap[u.user_id] = u;
        });
      }
    }

    const ticketsWithUsers = ticketsData.map(ticket => ({
      ...ticket,
      users: usersMap[ticket.user_id] || null
    }));

    setTickets(ticketsWithUsers);
    setLoading(false);
  };

  const fetchMessages = async (ticketId) => {
    const data = await api.get(`/support/tickets/${encodeURIComponent(ticketId)}/messages`).then((r) => (Array.isArray(r?.data) ? r.data : [])).catch(() => null);
    if (data === null) return; // v332: a failed 10s poll no longer wipes the conversation
    setMessages(data);
  };


  useEffect(() => {
    if (selectedTicket) {
      // v332: don't flash the previous ticket's messages — but a status change on the SAME ticket
      // (new selectedTicket object) must not blank the conversation (it stayed blank if that refetch failed).
      if (shownTicketIdRef.current !== selectedTicket.ticket_id) {
        shownTicketIdRef.current = selectedTicket.ticket_id;
        setMessages([]);
      }
      fetchMessages(selectedTicket.ticket_id);
      
      
      // Try fetching thread info if metadata is missing/incomplete
      const fetchThreadInfo = async () => {
        setEnrichedThread(null);
        const meta = selectedTicket.metadata || {};
        let orderId = selectedTicket.order_id || meta.order_id || (selectedTicket.page_context?.includes('/chat/') ? selectedTicket.page_context.replace('/chat/', '') : null);
        
        // Through the server (session 22): the browser may no longer read chat_threads/deals/users.
        let fetchedData = null;
        if (orderId && (orderId.startsWith('thread_') || orderId.startsWith('ORD-'))) {
          try {
            const { data: ctx } = await api.get(`/admin/helpdesk/context?order_id=${encodeURIComponent(orderId)}`);
            fetchedData = ctx?.data || null;
          } catch (e) { ignored("AdminHelpdesk:context", e); }
        }

        if (fetchedData) {
           // We also fetch user records for safety (phone, email)
           try {
              const brandId = fetchedData.brand_id || (fetchedData.brand && (fetchedData.brand.id || fetchedData.brand.user_id));
              const creatorId = fetchedData.creator_id || (fetchedData.creator && (fetchedData.creator.id || fetchedData.creator.user_id));
              
              if (brandId || creatorId) {
                 const usersData = null; // contact details now come with /admin/helpdesk/context
                 if (usersData) {
                    const brandUser = usersData.find(u => u.user_id === brandId);
                    const creatorUser = usersData.find(u => u.user_id === creatorId);
                    
                    if (brandUser) {
                       fetchedData.brand = { ...fetchedData.brand, ...brandUser };
                    }
                    if (creatorUser) {
                       fetchedData.creator = { ...fetchedData.creator, ...creatorUser };
                    }
                 }
              }
           } catch (e) { ignored("AdminHelpdesk:135", e); }
           setEnrichedThread(fetchedData);
        }
      };
      
      fetchThreadInfo();
      
      const messagesPoll = setInterval(() => { if (!document.hidden) fetchMessages(selectedTicket.ticket_id); }, 20000); // v419: was 10 s

      return () => {
        clearInterval(messagesPoll);
      };
    }
  }, [selectedTicket]);

  const handleReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;

    setIsSending(true);
    try {
      await api.post(`/support/tickets/${selectedTicket.ticket_id}/reply`, {
        message: reply
      });
      setReply("");
      fetchMessages(selectedTicket.ticket_id);
      toast.success("Reply sent"); // v332: we don't know the email was delivered
    } catch (err) {
      console.error(err);
      toast.error(calmError(err, "Couldn't send the reply. Please try again.")); // v332
    } finally {
      setIsSending(false);
    }
  };

  const updateStatus = async (newStatus) => {
    if (statusBusy || newStatus === selectedTicket.status) return; // v332
    setStatusBusy(true);
    try {
      await api.patch(`/admin/support/tickets/${encodeURIComponent(selectedTicket.ticket_id)}/status`, { status: newStatus });
      
      setSelectedTicket({ ...selectedTicket, status: newStatus });
      fetchTickets();
      toast.success("Status updated");
    } catch (err) {
      toast.error(calmError(err, "Couldn't update the status. Please try again.")); // v332
    } finally {
      setStatusBusy(false);
    }
  };

  const stats = {
    open: tickets?.filter(t => t.status === "OPEN").length,
    inProgress: tickets?.filter(t => t.status === "IN PROGRESS").length,
    // Session 58 (bug hunt): resolved TODAY (updated_at is set when the status changes), not created today.
    resolved: tickets?.filter(t => t.status === "RESOLVED" && new Date(t.updated_at || t.created_at).toDateString() === new Date().toDateString()).length,
  };

  // v332: first load shows "…" instead of a flash of 0 and "No tickets found".
  const firstLoad = loading && tickets.length === 0 && !ticketsLoadError;
  const n = (v) => (firstLoad ? "…" : v);

  if (selectedTicket) {
    const meta = selectedTicket.metadata || {};
    const orderId = selectedTicket.order_id || meta.order_id || (selectedTicket.page_context?.includes('/chat/') ? selectedTicket.page_context.replace('/chat/', '') : null);
    
    // Resolve fallback details
    let brandInfo = meta.brand || {};
    let creatorInfo = meta.creator || {};
    let campaignTitle = meta.campaign_title || selectedTicket.subject?.replace('Order Dispute: ', '') || 'Order Details';
    let dealAmount = meta.deal_amount;

    if (enrichedThread) {
      if (enrichedThread.brand) {
        brandInfo = {
          name: enrichedThread.brand.name || enrichedThread.brand.brand_name || brandInfo.name,
          email: enrichedThread.brand.email || brandInfo.email,
          phone: enrichedThread.brand.phone || enrichedThread.brand.phone_number || brandInfo.phone
        };
      }
      if (enrichedThread.creator) {
        creatorInfo = {
          name: enrichedThread.creator.name || enrichedThread.creator.full_name || creatorInfo.name,
          email: enrichedThread.creator.email || creatorInfo.email,
          phone: enrichedThread.creator.phone || enrichedThread.creator.phone_number || creatorInfo.phone
        };
      }
      if (enrichedThread.deal) {
         campaignTitle = enrichedThread.deal.campaign_title || campaignTitle;
         dealAmount = enrichedThread.deal.amount || enrichedThread.deal.agreed_amount || dealAmount;
      } else if (enrichedThread.amount_fixed) {
         dealAmount = enrichedThread.amount_fixed;
      }
    }

    return (
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden h-[calc(100dvh-300px)] md:h-[calc(100vh-180px)] min-h-[420px] flex flex-col shadow-lg">
        {/* Header */}
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-elevated)]">
          <div className="flex items-center space-x-3 min-w-0">
            <button onClick={() => setSelectedTicket(null)} aria-label="Back to tickets" className="p-2 hover:bg-gray-200 rounded-xl transition-colors cursor-pointer shrink-0">{/* v332: aria-label */}
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-extrabold text-gray-900 text-base break-words min-w-0">{selectedTicket.subject}</h2>{/* v332: long subjects wrap on phones */}
                <span className="text-xs font-mono font-bold text-[#7C3AED] bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                  #{selectedTicket.ticket_id}
                </span>
              </div>
              <div className="text-xs text-[#5F6672] mt-1 flex flex-wrap items-center gap-2">
                <span>Raised By: <strong>{selectedTicket.users?.name || selectedTicket.users?.email || "User"}</strong> ({selectedTicket.role})</span>
                <span>•</span>
                <span>Category: <strong>{categoryLabel(selectedTicket.category)}</strong></span>
                <span>•</span>
                <span>{selectedTicket.created_at ? new Date(selectedTicket.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : ''}{/* v330 */}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-gray-600">Status:</label>
            <select
              value={selectedTicket.status}
              onChange={(e) => updateStatus(e.target.value)}
              disabled={statusBusy} /* v332 */
              className="disabled:opacity-60 text-xs font-bold rounded-xl border border-gray-300 p-2 bg-white outline-none focus:border-[var(--violet)] focus:ring-1 focus:ring-[var(--violet)] cursor-pointer"
            >
              <option value="OPEN">🟡 Open</option>
              <option value="IN PROGRESS">🔵 In Progress</option>
              <option value="RESOLVED">🟢 Resolved</option>
            </select>
          </div>
        </div>

        {/* Order Dispute & Private Contact Details Panel */}
        {(orderId || dealAmount || brandInfo.email || creatorInfo.email) && (
          <div className="bg-indigo-50/60 border-b border-indigo-100 p-3.5 px-4 sm:px-6 max-h-[38vh] overflow-y-auto md:max-h-none">{/* v332: on phones this panel no longer squeezes the messages out of view */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#7C3AED]"></span>
                  🔒 Order Mediation Snapshot (Admin Confidential)
                </span>
              </div>
              {orderId && (
                <a
                  href={`/chat/${selectedTicket.thread_id || orderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-[#7C3AED] hover:text-indigo-800 bg-white border border-indigo-200 px-3 py-1 rounded-lg flex items-center gap-1 transition-all shadow-sm"
                >
                  Open Deal Chat ↗
                </a>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              {/* Order Info */}
              <div className="bg-white p-3 rounded-xl border border-indigo-100/80 shadow-xs">
                <span className="block text-[10px] uppercase font-bold text-[#5F6672]">Order / Escrow Info</span>
                <p className="font-bold text-gray-900 mt-0.5 truncate">{campaignTitle}</p>
                <div className="flex items-center justify-between mt-1 text-[11px]">
                  <span className="font-mono text-[#5F6672]">{orderId ? `ID: #${String(orderId).substring(0, 12)}` : ""}</span>{/* v332: no "#null" */}
                  {dealAmount ? (
                    <span className="font-extrabold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      ₹{Number(dealAmount).toLocaleString('en-IN')} Escrow
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Brand Contact Box */}
              <div className="bg-white p-3 rounded-xl border border-indigo-100/80 shadow-xs">
                <span className="block text-[10px] uppercase font-bold text-[#7C3AED]">Brand Contact (Private)</span>
                <p className="font-bold text-gray-900 mt-0.5 truncate">{brandInfo.name || "Brand User"}</p>
                <div className="mt-1 space-y-0.5 text-[11px] text-gray-600">
                  <p className="truncate">📧 {brandInfo.email || (selectedTicket.role === "brand" ? selectedTicket.users?.email : "") || "No email provided"}</p>{/* v332: a creator's email no longer shows as the brand's */}
                  <p className="truncate">📞 {brandInfo.phone || "No phone provided"}</p>
                </div>
              </div>

              {/* Creator Contact Box */}
              <div className="bg-white p-3 rounded-xl border border-indigo-100/80 shadow-xs">
                <span className="block text-[10px] uppercase font-bold text-[#7C3AED]">Creator Contact (Private)</span>
                <p className="font-bold text-gray-900 mt-0.5 truncate">{creatorInfo.name || "Creator User"}</p>
                <div className="mt-1 space-y-0.5 text-[11px] text-gray-600">
                  <p className="truncate">📧 {creatorInfo.email || "No email provided"}</p>
                  <p className="truncate">📞 {creatorInfo.phone || "No phone provided"}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[var(--bg-elevated)]/50">
          {/* v482: a call request has no message — the page was blank. Show who raised it and how to reach them. */}
          {(!messages || messages.length === 0) && (
            <div className="max-w-md mx-auto mt-6 bg-white border border-gray-200 rounded-2xl p-5 text-sm" data-testid="ticket-empty">
              <div className="font-bold text-gray-900">{selectedTicket.category === 'campaign_manager_call' ? 'They asked for a call' : 'No message written'}</div>
              <p className="text-xs text-[#5F6672] mt-1">{selectedTicket.description || (selectedTicket.category === 'campaign_manager_call' ? 'Call them, then reply here or mark it resolved.' : 'Reply below or reach them directly.')}</p>
              <div className="mt-3 space-y-1 text-xs text-gray-700">
                <div><b>{selectedTicket.users?.name || brandInfo.name || creatorInfo.name || 'User'}</b> · {selectedTicket.role}</div>
                {(selectedTicket.users?.email || brandInfo.email || creatorInfo.email) && <div>{selectedTicket.users?.email || brandInfo.email || creatorInfo.email}</div>}
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {(selectedTicket.users?.phone || brandInfo.phone || creatorInfo.phone) && <a href={`tel:${selectedTicket.users?.phone || brandInfo.phone || creatorInfo.phone}`} className="h-9 px-3 inline-flex items-center rounded-lg bg-[#7C3AED] text-white text-xs font-bold">Call {selectedTicket.users?.phone || brandInfo.phone || creatorInfo.phone}</a>}
                {(selectedTicket.users?.email || brandInfo.email || creatorInfo.email) && <a href={`mailto:${selectedTicket.users?.email || brandInfo.email || creatorInfo.email}`} className="h-9 px-3 inline-flex items-center rounded-lg border border-gray-200 text-xs font-bold">Email</a>}
              </div>
            </div>
          )}
          {messages?.map((msg, msgIdx) => {
            const isAdmin = msg.sender_type === "admin";
            const isAi = msg.sender_type === "ai";
            return (
              <div key={msg.message_id || msg.id || `msg-${msgIdx}`} className={`flex ${isAdmin ? "justify-end" : "justify-start"}`}>
                <div className={`p-4 rounded-2xl max-w-[85%] shadow-sm ${isAdmin ? "bg-[#7C3AED] text-white rounded-tr-none" : isAi ? "bg-[#F5F0FF] text-gray-800 border border-violet-100 rounded-tl-none" : "bg-white border border-gray-200 text-gray-900 rounded-tl-none"}`}>
                  <div className="flex justify-between items-center mb-1 gap-4">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isAdmin ? "text-indigo-300" : "text-[#5F6672]"}`}>
                      {isAdmin ? "Ybex team" : isAi ? "Eva (AI)" : (selectedTicket.users?.name || "User")}
                    </span>
                    <span className={`text-[10px] font-mono ${isAdmin ? "text-[#5F6672]" : "text-[#5F6672]"}`}>
                      {msg.created_at ? new Date(msg.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : ''}{/* v332: IST + date */}
                    </span>
                  </div>
                  <p className="text-xs whitespace-pre-wrap leading-relaxed font-sans">{msg.message}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Input */}
        <form onSubmit={handleReply} className="p-4 bg-white border-t border-gray-200 flex items-end space-x-2">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Write your reply — they also get it by email"
            className="flex-1 max-h-32 min-h-[44px] rounded-xl border border-gray-300 p-3 outline-none resize-none text-[16px] sm:text-xs focus:border-[var(--violet)] focus:ring-1 focus:ring-[var(--violet)]" /* v330: 16px on phones, no iOS zoom */
            rows="2"
          />
          <button
            type="submit"
            disabled={!reply.trim() || isSending}
            className="bg-[#7C3AED] hover:bg-[#6D28D9] text-white px-5 py-3 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer shadow-md"
          >
            <Send className="w-4 h-4" />
            <span>Send Reply</span>
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full animate-in fade-in duration-200">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-2">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight">Support Helpdesk</h2>
          <p className="text-sm text-[#5F6672] font-medium mt-1">Eva replies to every new ticket first. The ticket stays open for you.</p>
        </div>
        {evaPending > 0 && (
          <button type="button" onClick={runEva} disabled={evaBusy} data-testid="eva-answer-pending"
            className="h-10 px-4 rounded-xl bg-[#7C3AED] text-white text-sm font-bold disabled:opacity-60">
            {evaBusy ? "Eva is replying…" : `Let Eva reply to ${evaPending} unanswered`}
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-yellow-50 text-yellow-600 rounded-lg"><AlertCircle className="w-6 h-6" /></div>
          <div><p className="text-sm text-[#5F6672]">Open Tickets</p><p className="text-2xl font-bold">{n(stats.open)}</p></div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Clock3 className="w-6 h-6" /></div>
          <div><p className="text-sm text-[#5F6672]">In Progress</p><p className="text-2xl font-bold">{n(stats.inProgress)}</p></div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-green-50 text-green-600 rounded-lg"><CheckCircle className="w-6 h-6" /></div>
          <div><p className="text-sm text-[#5F6672]">Resolved Today</p><p className="text-2xl font-bold">{n(stats.resolved)}</p></div>
        </div>
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-[#F5F0FF] text-[#7C3AED] rounded-lg"><Clock className="w-6 h-6" /></div>
          <div><p className="text-sm text-[#5F6672]">Total tickets</p><p className="text-2xl font-bold">{n(tickets?.length || 0)}</p></div>{/* Session 58: was a made-up average */}
        </div>
      </div>

      {/* Kanban Board Tabs */}
      <div className="flex flex-col space-y-6">
        <div className="flex bg-[var(--bg-card)] border border-[var(--border-default)] p-1 rounded-2xl w-fit max-w-full overflow-x-auto shadow-sm">{/* v332: no overflow on 320px phones */}
          {['OPEN', 'IN PROGRESS', 'RESOLVED'].map(status => (
            <button
              key={status}
              onClick={() => setActiveTab(status)}
              className={`px-3 sm:px-6 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap shrink-0 ${
                activeTab === status
                  ? "bg-[var(--violet)] text-white shadow-md"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
              }`}
            >
              {STATUS_LABELS[status] || status}{/* v332 */}
              <span className={`px-2 py-0.5 rounded-full text-[10px] ${
                activeTab === status ? "bg-white/20 text-white" : "bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
              }`}>
                {n(tickets?.filter(t => t.status === status).length)}
              </span>
            </button>
          ))}
        </div>

        <div className="bg-[var(--bg-elevated)] rounded-xl p-4 border border-gray-200">
          {/* v482 (admin UX pass): an inbox list — one row per ticket, high priority first then oldest (was a card grid
              inside its own small scroll box, titles cut off) */}
          <div className="divide-y divide-gray-100 bg-white rounded-lg border border-gray-200 overflow-hidden" data-testid="helpdesk-list">
            {tickets?.filter(t => t.status === activeTab)
              .slice()
              .sort((a, b) => ((b.priority === 'HIGH') - (a.priority === 'HIGH')) || (activeTab === 'RESOLVED' ? new Date(b.created_at || 0) - new Date(a.created_at || 0) : new Date(a.created_at || 0) - new Date(b.created_at || 0)))
              .map(ticket => (
              <button
                type="button"
                key={ticket.ticket_id}
                onClick={() => setSelectedTicket(ticket)}
                className="w-full text-left px-4 py-3 hover:bg-[#F5F0FF] transition-colors flex items-center gap-4"
              >
                <span className={`shrink-0 text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${ticket.role === 'brand' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700'}`}>{ticket.role}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-gray-900 text-sm truncate">{ticket.subject}</span>
                  <span className="block text-xs text-[#5F6672] truncate">{ticket.users?.name || ticket.users?.email || "—"} · {categoryLabel(ticket.category)}</span>
                </span>
                {ticket.priority === 'HIGH' && <span className="shrink-0 text-[10px] uppercase font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded-full">High</span>}
                <span className="shrink-0 w-16 text-right text-xs text-[#5F6672]" title={ticket.created_at ? new Date(ticket.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''}>{ticketAge(ticket.created_at)}</span>
              </button>
            ))}
            {tickets?.filter(t => t.status === activeTab).length === 0 && (
              <div className="col-span-full py-12 text-center text-[#5F6672]">
                {/* v330 */}
                {firstLoad ? "Loading tickets…" : ticketsLoadError ? <span className="text-red-600">Could not load tickets. <button type="button" onClick={fetchTickets} className="underline font-semibold">Try again</button></span> : "No tickets found for this status."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
