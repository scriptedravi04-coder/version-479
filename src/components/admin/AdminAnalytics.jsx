import React, { useState, useEffect } from 'react';
import { formatAmount } from "../../utils/safeFormat";
import { Lightbulb, Users, Megaphone, Activity, Briefcase, UserPlus, ShieldCheck, AlertTriangle, HelpCircle, Landmark, Wallet, PercentCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import useGrowthReport from './growth/useGrowthReport';
import { Answers, Pulse, Alerts, RefreshButton } from './growth/Briefing';
import WherePanel from './growth/WherePanel';
import PeoplePanel from './growth/PeoplePanel';
import FunnelPanel from './growth/FunnelPanel';
import MoneyPanel, { InvestorPanel } from './growth/MoneyPanel';
import GrowPanel from './growth/GrowPanel';
import { AreaDemandAdminCard } from './CampaignValueAdminCard'; // v450 (v475: campaign value banner moved to Developer)
import { Shimmer } from '../common/ContentSkeletons';
import { ListSkeleton } from "../common/ContentSkeletons"; // v457: skeleton instead of "Loading…" text

// Session 46: tabs of the Growth Command Center. Anything else a card links to (payouts, KYC…)
// is another admin page and goes through onNavigate.
const GROWTH_TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'where', label: 'Where to advertise' },
  { key: 'people', label: 'People' },
  { key: 'funnel', label: 'Funnels' },
  { key: 'money', label: 'Money' },
  { key: 'grow', label: 'Growth ideas' },
  { key: 'investor', label: 'Investor view' }, // v481
];

export default function AdminAnalytics({ onNavigate }) {
  const [stats, setStats] = useState({ 
     users: 0,
     creators: 0,
     brands: 0,
     campaigns: 0,
     live_campaigns: 0,
     collabs: 0
  });
  
  const [chartData, setChartData] = useState({
     revenue: [],
     users: []
  });

  const [todoStats, setTodoStats] = useState({
     kycPending: 0,
     waitlistPending: 0,
     campaignApprovals: 0,
     reportsPending: 0,
     ugcPending: 0,
     ticketsPending: 0,
     pitchesPending: 0,
     payoutRequests: 0,
     ugcRefunds: 0,
     referralWithdrawals: 0,
     totalTasks: 0
  });

  const [financeStats, setFinanceStats] = useState({
     liveValue: 0,
     escrowSecured: 0,
     commission: 0,
     liveCount: 0
  });

  const [loading, setLoading] = useState(true);
  const [statsError, setStatsError] = useState(false); // v332: a failed load showed all zeros and "Clear" as if real
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState('overview');
  const growth = useGrowthReport();
  const goTab = (t) => {
    if (GROWTH_TABS.some((x) => x.key === t)) { setTab(t); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (onNavigate) onNavigate(t);
  };
  const [days, setDays] = useState(7);
  const [showQueuesState, setShowQueuesState] = useState(false); // v481
  const [chartLoading, setChartLoading] = useState(false);

  useEffect(() => {
     const fetchData = async () => {
       setStatsError(false); // v332
       try {
         // v419 (admin cleanup): the Overview downloaded 7 full lists (KYC, waitlist, campaigns, reports, UGC,
         // pitches, tickets) only to count them. One small counts call answers all of it.
         const [statsRes, countsRes] = await Promise.all([
           api.get("admin/stats"),
           api.get("admin/pending-counts").catch(() => ({ data: {} }))
         ]);

         if (statsRes.data) {
           setStats(prev => ({...prev, ...statsRes.data}));
           setFinanceStats({
             liveValue: statsRes.data.liveValue || 0,
             escrowSecured: statsRes.data.escrowSecured || 0,
             commission: statsRes.data.platformRevenue || 0,
             liveCount: statsRes.data.live_campaigns || 0
           });
         }

         const counts = countsRes?.data || {};
         const kycPending = Number(counts.kyc) || 0;
         const waitlistPending = Number(counts.waitlist) || 0;
         const campaignApprovals = Number(counts.campaigns) || 0;
         const reportsPending = Number(counts.reports) || 0;
         const ugcPending = Number(counts.ugc_active) || 0;
         const ticketsPending = Number(counts.helpdesk) || 0;
         const pitchesPending = Number(counts.pitches) || 0;
         const payoutRequests = Number(counts.payout_requests) || 0;
         const ugcRefunds = Number(counts.ugc_refunds) || 0;
         const referralWithdrawals = Number(counts.referral_withdrawals) || 0;

         setTodoStats({
           kycPending,
           waitlistPending,
           campaignApprovals,
           reportsPending,
           ugcPending,
           ticketsPending,
           pitchesPending,
           payoutRequests,
           ugcRefunds,
           referralWithdrawals,
           totalTasks: kycPending + waitlistPending + campaignApprovals + reportsPending + ugcPending + ticketsPending + pitchesPending + payoutRequests + ugcRefunds + referralWithdrawals
         });

         // Financial metrics are now calculated on the backend

       } catch (error) {
         console.error("Error fetching analytics data:", error);
         setStatsError(true); // v332
       } finally {
         setLoading(false);
       }
     };
     
     fetchData();
  }, [reloadKey]); // v332: Try again re-runs the load

  useEffect(() => {
    const fetchChartData = async () => {
      setChartLoading(true);
      try {
        const chartRes = await api.get(`/admin/chart-data?days=${days}`);
        if (chartRes.data) {
          setChartData({
            revenue: chartRes.data.revenue || [],
            users: chartRes.data.users || []
          });
        }
      } catch (error) {
        console.error("Error fetching chart data:", error);
      } finally {
        setChartLoading(false);
      }
    };

    fetchChartData();
  }, [days]);

  const formatNumber = (num) => {
    if (num == null) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return num.toLocaleString('en-IN'); // v330: Indian grouping
  };

  const totalUsers = (stats.creators || 0) + (stats.brands || 0) || 1;
  const creatorPct = Math.round(((stats.creators || 0) / totalUsers) * 100);
  const brandPct = 100 - creatorPct;

  // v481: "1K" read as a rounded guess — the Overview shows exact counts.
  const exact = (n) => (Number(n) || 0).toLocaleString('en-IN');
  const [showQueues, setShowQueues] = [showQueuesState, setShowQueuesState];
  const periodGmv = chartData.revenue.reduce((a, r) => a + (Number(r.gmv) || 0), 0);
  const periodFee = chartData.revenue.reduce((a, r) => a + (Number(r.fee) || 0), 0);
  const periodSignups = chartData.users.reduce((a, r) => a + (Number(r.added) || 0), 0);
  const activity = growth.data?.people?.activity;
  const queues = [
    { key: 'payouts', title: 'Creator payouts', count: todoStats.payoutRequests, money: true, go: 'escrow&view=requests', desc: 'Creators asked to be paid. Check UPI / bank and mark paid with the UTR.', icon: <Wallet size={20} className="text-[#16A34A]" /> },
    { key: 'ugcRefunds', title: 'UGC refunds to send', count: todoStats.ugcRefunds, money: true, go: 'escrow&view=ugc_refunds', desc: 'Brand refunds to send by hand (cancelled or expired UGC orders).', icon: <Landmark size={20} className="text-[#0EA5E9]" /> },
    { key: 'referral', title: 'Referral withdrawals', count: todoStats.referralWithdrawals, money: true, go: 'settings&view=referrals', desc: 'Pay and add the UTR, or reject.', icon: <PercentCircle size={20} className="text-[#D946EF]" /> },
    { key: 'reports', title: 'Reports & disputes', count: todoStats.reportsPending, go: 'reports', desc: 'Flagged content and payment disagreements.', icon: <AlertTriangle size={20} className="text-[#EF4444]" /> },
    { key: 'kyc', title: 'KYC to check', count: todoStats.kycPending, go: 'verifications', desc: 'Creator and brand ID checks.', icon: <ShieldCheck size={20} className="text-[#3B82F6]" /> },
    { key: 'campaigns', title: 'Campaigns to approve', count: todoStats.campaignApprovals, go: 'campaigns', desc: 'Approve or reject briefs before they go live.', icon: <Megaphone size={20} className="text-[#F59E0B]" /> },
    { key: 'tickets', title: 'Support tickets', count: todoStats.ticketsPending, go: 'helpdesk', desc: 'Open questions from brands and creators.', icon: <HelpCircle size={20} className="text-[#EC4899]" /> },
    { key: 'ugc', title: 'UGC deliveries due', count: todoStats.ugcPending, go: 'ugc-orders', desc: 'Live UGC orders and their deadlines.', icon: <Activity size={20} className="text-[#10B981]" /> },
    { key: 'waitlist', title: 'Waitlist', count: todoStats.waitlistPending, go: 'waitlist', desc: 'Pending signups waiting for an invite.', icon: <UserPlus size={20} className="text-[#7C3AED]" /> },
    { key: 'pitches', title: 'Pitch leads', count: todoStats.pitchesPending, go: 'pitches', desc: 'Brand pitches and concierge leads.', icon: <Lightbulb size={20} className="text-[#7C3AED]" /> },
  ];
  const pendingQueues = queues.filter((q) => q.count > 0).sort((a, b) => (b.money ? 1 : 0) - (a.money ? 1 : 0) || b.count - a.count);

  if (loading) {
    return <div className="p-4"><ListSkeleton rows={5} label="Loading analytics" /></div>;
  }

  return (
    <div className="space-y-8 w-full pb-12 font-sans">
       
       <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-2">
         <div>
           <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight">Growth overview</h2>
           <p className="text-sm text-[#5F6672] font-medium mt-1">Where money comes from, where to advertise, and where people get stuck — from your live data.</p>
         </div>
         <RefreshButton loading={growth.loading} onClick={growth.reload} updatedAt={growth.data?.generatedAt} />
       </div>

       {growth.loading && !growth.data && (
         <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading growth numbers">
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><Shimmer className="h-32" /><Shimmer className="h-32" /><Shimmer className="h-32" /></div>
           <Shimmer className="h-40" />
         </div>
       )}
       {growth.error && (
         <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
           <span>{growth.error} The numbers below this box still work.</span>
           <button type="button" onClick={growth.reload} className="text-xs font-extrabold underline min-h-[32px] text-left">Try again</button>
         </div>
       )}

       <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist" aria-label="Overview sections">
         {GROWTH_TABS.map((t) => (
           <button
             key={t.key}
             type="button"
             role="tab"
             aria-selected={tab === t.key}
             onClick={() => setTab(t.key)}
             className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-bold min-h-[40px] border transition-colors ${tab === t.key ? 'bg-[#7C3AED] text-white border-[#7C3AED]' : 'bg-white text-gray-600 border-gray-200 hover:bg-[var(--bg-elevated)]'}`}
           >
             {t.label}
           </button>
         ))}
       </div>

       {tab !== 'overview' && !growth.data && !growth.loading && (
         <div className="rounded-2xl border border-dashed border-gray-200 bg-[var(--bg-elevated)] px-4 py-6 text-sm font-medium text-gray-600">This section needs the growth numbers, which could not be loaded. Use Refresh to try again.</div>
       )}
       {tab === 'where' && growth.data && <WherePanel report={growth.data} />}
       {tab === 'people' && growth.data && <PeoplePanel report={growth.data} onReminderSent={growth.reload} />}
       {tab === 'funnel' && growth.data && <FunnelPanel report={growth.data} />}
       {tab === 'money' && growth.data && <MoneyPanel report={growth.data} onNavigate={onNavigate} />}
       {tab === 'grow' && growth.data && <GrowPanel report={growth.data} />}
       {tab === 'investor' && growth.data && <InvestorPanel report={growth.data} />}

       {tab === 'overview' && (
       <div className="space-y-6" data-testid="overview-v481">
       {statsError && ( /* v332 */
         <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
           <span>Couldn't load the platform numbers, so the counts below may show 0.</span>
           <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="text-xs font-extrabold underline min-h-[32px] text-left">Try again</button>
         </div>
       )}

       {/* v481: today's work first — only what is waiting, loudest first */}
       <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm" data-testid="today-work">
         <div className="flex items-center justify-between gap-3 mb-3">
           <h3 className="text-base font-extrabold text-gray-900">Today's work</h3>
           <button type="button" onClick={() => setShowQueues((v) => !v)} className="text-xs font-bold text-[#7C3AED] hover:underline min-h-[32px]">{showQueues ? 'Hide all queues' : 'All queues'}</button>
         </div>
         {pendingQueues.length === 0 ? (
           <div className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 text-sm font-bold text-emerald-700">All clear — nothing is waiting on you.</div>
         ) : (
           <div className="flex flex-wrap gap-2">
             {pendingQueues.map((q) => (
               <button key={q.key} type="button" onClick={() => onNavigate && onNavigate(q.go)}
                 className={`inline-flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-bold border min-h-[44px] ${q.money ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                 <span className="text-lg font-black leading-none">{q.count}</span> {q.title} <span aria-hidden="true">→</span>
               </button>
             ))}
           </div>
         )}
       </div>

       {/* KPI row for the chosen period */}
       <div className="flex flex-wrap items-center justify-between gap-3">
         <h3 className="text-base font-extrabold text-gray-900">Last {days} days</h3>
         <div className="flex gap-1.5" role="group" aria-label="Period">
           {[7, 30, 90].map((d) => (
             <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
               className={`h-8 px-3 rounded-full text-xs font-bold border ${days === d ? 'bg-[#111827] text-white border-[#111827]' : 'bg-white text-gray-600 border-gray-200'}`}>{d} days</button>
           ))}
         </div>
       </div>
       <div className={`grid grid-cols-2 lg:grid-cols-6 gap-3 ${chartLoading ? 'opacity-60' : ''}`}>
         <Kpi label="Money paid in" value={`₹${formatAmount(periodGmv)}`} sub="test payments left out" />
         <Kpi label="Ybex fees" value={`₹${formatAmount(periodFee)}`} />
         <Kpi label="New signups" value={periodSignups.toLocaleString('en-IN')} />
         <Kpi label="Active users" value={activity?.available ? (activity.mau?.total ?? 0).toLocaleString('en-IN') : '—'} sub={activity?.available ? `${activity.dau?.total ?? 0} today · ${activity.wau?.total ?? 0} this week` : 'last 30 days'} />
         <Kpi label="Live campaigns" value={(stats.live_campaigns || 0).toLocaleString('en-IN')} sub={`₹${formatAmount(financeStats.liveValue)} budget`} />
         <Kpi label="Held for creators" value={`₹${formatAmount(financeStats.escrowSecured)}`} sub="paid in, not paid out" />
       </div>

       {growth.data && <Answers report={growth.data} goTab={goTab} />}

       <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
         {/* left: charts */}
         <div className="xl:col-span-3 space-y-6">
           <ChartCard title="Money paid in per day" empty={!chartLoading && !chartData.revenue.some((r) => r.gmv > 0)} emptyText={`No payments in the last ${days} days.`}>
             <BarChart data={chartData.revenue} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
               <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
               <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af', fontWeight: 600 }} dy={8} interval="preserveStartEnd" />
               <YAxis axisLine={false} tickLine={false} allowDecimals={false} width={48} domain={[0, (max) => Math.max(1000, max)]} tick={{ fontSize: 11, fill: '#9ca3af', fontWeight: 600 }} tickFormatter={(v) => (v >= 1000 ? `₹${Math.round(v / 1000)}k` : `₹${v}`)} />
               <Tooltip cursor={{ fill: '#f9fafb' }} formatter={(v, n) => [`₹${(Number(v) || 0).toLocaleString('en-IN')}`, n === 'fee' ? 'Ybex fee' : 'Paid in']} />
               <Bar dataKey="gmv" fill="#A78BFA" radius={[6, 6, 0, 0]} maxBarSize={36} />
             </BarChart>
           </ChartCard>
           <ChartCard title="New signups per day" empty={!chartLoading && !chartData.users.some((r) => r.added > 0)} emptyText={`No signups in the last ${days} days.`}>
             <BarChart data={chartData.users} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
               <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
               <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#9ca3af', fontWeight: 600 }} dy={8} interval="preserveStartEnd" />
               <YAxis axisLine={false} tickLine={false} allowDecimals={false} width={36} tick={{ fontSize: 11, fill: '#9ca3af', fontWeight: 600 }} />
               <Tooltip cursor={{ fill: '#f9fafb' }} formatter={(v) => [(Number(v) || 0).toLocaleString('en-IN'), 'Signups']} />
               <Bar dataKey="added" fill="#34D399" radius={[6, 6, 0, 0]} maxBarSize={36} />
             </BarChart>
           </ChartCard>
           {growth.data && <Pulse report={growth.data} />}
         </div>
         {/* right: what to do + top lists */}
         <div className="xl:col-span-2 space-y-6">
           {growth.data && <Alerts insights={growth.data.insights} goTab={goTab} />}
           {growth.data?.people?.topBrands?.length > 0 && (
             <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
               <h3 className="text-base font-extrabold text-gray-900 mb-3">Top paying brands</h3>
               <ul className="space-y-2">{growth.data.people.topBrands.slice(0, 5).map((b, i) => (
                 <li key={b.id || i} className="flex items-center justify-between text-sm"><span className="font-semibold text-gray-800 truncate">{b.name}</span><span className="font-bold">₹{formatAmount(b.total)}</span></li>
               ))}</ul>
             </div>
           )}
         </div>
       </div>

       {/* totals — exact numbers, one quiet row */}
       <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard title="Creators" value={exact(stats.creators)} icon={<Users size={20} className="text-[#7C3AED]" />} />
          <StatCard title="Brands" value={exact(stats.brands)} icon={<Briefcase size={20} className="text-[#7C3AED]" />} />
          <StatCard title="Campaigns" value={exact(stats.campaigns)} icon={<Megaphone size={20} className="text-[#7C3AED]" />} />
          <StatCard title="All accounts" value={exact(stats.users)} icon={<UserPlus size={20} className="text-[#7C3AED]" />} />
       </div>

       {showQueues && (
       <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm" data-testid="all-queues">
          <h3 className="text-lg font-extrabold text-gray-900 mb-4">All queues</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {queues.map((q) => (
              <ActionCard key={q.key} title={q.title} count={q.count} description={q.desc} icon={q.icon} onClick={() => onNavigate && onNavigate(q.go)} />
            ))}
          </div>
       </div>
       )}

       <AreaDemandAdminCard />{/* v450; v481: moved below the work */}
       </div>
       )}
    </div>
  );
}

function StatCard({ title, value, icon }) {
   return (
      <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm flex items-center gap-4 hover:shadow-md transition-shadow">
         <div className="w-14 h-14 rounded-2xl bg-[#F3E8FF] flex items-center justify-center shrink-0">
           {icon}
         </div>
         <div>
           <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">{title}</div>
           <div className="font-extrabold text-3xl text-gray-900">{value}</div>
         </div>
      </div>
   );
}

function PipelineBox({ label, value, sub, active, color }) {
   const colorMap = {
     purple: 'bg-[#F3E8FF] border-[#DDD6FE] text-[#7C3AED] label-[#9333EA]',
     gray: 'bg-[var(--bg-elevated)] border-gray-100 text-gray-800 label-gray-500',
     blue: 'bg-blue-50 border-blue-100 text-blue-800 label-blue-500',
     emerald: 'bg-emerald-50 border-emerald-100 text-emerald-800 label-emerald-500',
   };

   const theme = colorMap[color] || colorMap.gray;
   const bgBorder = theme.split(' ').slice(0, 2).join(' ');
   const valColor = theme.split(' ')[2];
   const labelColor = theme.split(' ')[3]?.replace('label-', 'text-') || 'text-[#5F6672]';

   return (
      <div className={`p-5 rounded-2xl border flex flex-col justify-center ${bgBorder}`}>
         <div className={`text-3xl font-extrabold mb-1 ${valColor}`}>{value}</div>
         <div className={`text-sm font-bold ${labelColor}`}>{label}</div>
         <div className="text-[10px] text-[#5F6672] uppercase tracking-widest mt-2 font-semibold">{sub}</div>
      </div>
   );
}

function Kpi({ label, value, sub }) {
   return (
      <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm min-w-0">
         <div className="text-[11px] font-bold text-[#5F6672]">{label}</div>
         <div className="font-extrabold text-xl text-gray-900 mt-1 truncate">{value}</div>
         {sub && <div className="text-[11px] text-[#5F6672] mt-0.5 truncate">{sub}</div>}
      </div>
   );
}

function ChartCard({ title, empty, emptyText, children }) {
   return (
      <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-sm">
         <h3 className="font-extrabold text-gray-900 text-base mb-3">{title}</h3>
         <div className="relative h-[220px] w-full">
            {empty && <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-[#5F6672] pointer-events-none z-10">{emptyText}</div>}
            <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
         </div>
      </div>
   );
}

// v481: emphasis was upside down — pending cards looked faded, "Clear" ones colourful.
function ActionCard({ title, count, description, icon, onClick }) {
   const isAlerted = count > 0;
   return (
      <div
         onClick={onClick}
         role="button" tabIndex={0}
         onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick && onClick(); } }}
         className={`p-4 rounded-2xl border transition-all cursor-pointer flex gap-3 items-start ${isAlerted ? 'bg-white border-rose-200 shadow-sm hover:border-rose-300' : 'bg-[var(--bg-elevated)] border-gray-100 opacity-60 hover:opacity-100'}`}
      >
         <div className="p-2.5 bg-white border border-gray-100 rounded-xl shrink-0">{icon}</div>
         <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
               <h4 className="font-extrabold text-gray-900 text-sm truncate">{title}</h4>
               <span className={`text-xs font-black px-2.5 py-1 rounded-full shrink-0 ${isAlerted ? 'bg-rose-600 text-white' : 'bg-gray-100 text-[#5F6672]'}`}>{isAlerted ? `${count} waiting` : 'Clear'}</span>
            </div>
            <p className="text-xs text-[#5F6672] font-medium mt-1 leading-relaxed">{description}</p>
         </div>
      </div>
   );
}
