import React, { useState } from "react";
import { Check, User, Shield, FileText, CheckCircle2, Clock, Copy, Pencil } from "lucide-react";
import CreatorProfileEditModal from "../CreatorProfileEditModal"; // v419


// Session 49 (clean-up): moved out of UserEnforcementPanel.jsx word for word (one section of the page).
// Everything it needs comes in as props; no logic, text or server call changed.
export default function BasicDetailsCard(props) {
  const { canRemoveAdmin, copiedPass, handleCopy, handleResetPassword, handleSecretPasswordTrigger, isFullAdmin, isKycApproved, isKycPending, isTargetAdmin, profile, revealedPassword, setActiveTab, setRevealedPassword, user, onEdited } = props;
  // v419 (Ravi: "approve ke baad bhi admin se creator ki details / photo edit ho sake"): Edit opens the same editor the
  // Unclaimed list uses (PATCH /admin/creators/:id) — name, photo, phone, bio, city, niche, rates, Instagram…
  const [editing, setEditing] = useState(false);
  const role0 = String(user?.role || "").toLowerCase();
  const isBrandUser = ["brand", "agency", "talent_manager"].includes(role0); // v451: a brand with an Instagram is still a brand
  const isCreator = role0 === "creator" || (!isBrandUser && Boolean(profile?.instagram_handle));
  return (
    <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-sm">
           <div className="flex flex-wrap items-center justify-between gap-3 mb-4">{/* v332: title + buttons wrap on phones */}
             <h3 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
               <User size={18} className="text-[#7C3AED]" /> Basic Account Information
             </h3>
             <div className="flex flex-wrap items-center gap-2">
               {isCreator && !isTargetAdmin && (
                 <button type="button" onClick={() => setEditing(true)} data-testid="admin-edit-creator"
                   className="px-3 py-1.5 bg-[#F5F0FF] hover:bg-violet-100 border border-violet-200 text-[#6D28D9] rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer">
                   <Pencil size={13} /> Edit profile
                 </button>
               )}
               {canRemoveAdmin && (
                 <button
                   onClick={() => setActiveTab('admin-delete')}
                   data-testid="admin-delete-wipe"
                   className="px-3 py-1.5 mr-1 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                 >
                   Delete / Wipe Account
                 </button>
               )}
               {isTargetAdmin && isFullAdmin && (
                 <button 
                   onClick={handleResetPassword}
                   className="px-3 py-1.5 mr-2 bg-white text-gray-700 hover:text-gray-900 border border-gray-200 hover:border-gray-300 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                 >
                   Reset Password
                 </button>
               )}
               {isTargetAdmin ? (
                 <span className="px-3 py-1 bg-[#F5F0FF] text-[#6D28D9] border border-violet-200 rounded-full text-xs font-extrabold flex items-center gap-1.5 shadow-xs">
                   <Shield size={13} className="text-[#7C3AED]" /> {user.team_role === 'sub_admin' ? 'Sub-Admin (Staff)' : 'Super Admin (Full Access)'}
                 </span>
               ) : isKycApproved ? (
                 <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-extrabold flex items-center gap-1.5 shadow-xs">
                   <CheckCircle2 size={13} className="text-emerald-600" /> KYC Verified
                 </span>
               ) : isKycPending ? (
                 <span className="px-3 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full text-xs font-extrabold flex items-center gap-1.5 shadow-xs">
                   <Clock size={13} className="text-amber-600" /> KYC Pending
                 </span>
               ) : (
                 <span className="px-3 py-1 bg-gray-100 text-gray-600 border border-gray-200 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-xs">
                   <FileText size={13} className="text-[#5F6672]" /> No KYC
                 </span>
               )}
             </div>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <div>
                 <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">Email Address</div>
                 <div className="font-semibold text-gray-900 break-all">{user.email || profile?.email || profile?.contact_email || '—'}</div>{/* v332: long emails wrap */}
              </div>
              <div>
                 <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">Joined Date</div>
                 <div className="font-semibold text-gray-900">{user.created_at ? new Date(user.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) /* v330 */ : '—'}</div>
              </div>
              <div>
                 <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">Account Role</div>
                 <div className="font-semibold text-gray-900 capitalize flex items-center gap-2">
                   {user.role || '—'}{/* v332 */}
                   {(user.is_agency || profile?.is_agency) && (
                     <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 border border-violet-300 font-extrabold uppercase tracking-wider">
                       Agency
                     </span>
                   )}
                 </div>
              </div>

              {profile && profile.company_name ? (
                 <div onClick={handleSecretPasswordTrigger} className="cursor-pointer select-none">
                    <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">Company / Agency Name</div>
                    <div className="font-semibold text-gray-900">{profile.company_name}</div>
                 </div>
              ) : (
                 <div onClick={handleSecretPasswordTrigger} className="cursor-pointer select-none">
                    <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">Full Legal Name</div>
                    <div className="font-semibold text-gray-900">{user.name || '—'}</div>
                 </div>
              )}

              {user.phone && (
                 <div>
                    <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">Contact Mobile</div>
                    <div className="font-semibold text-gray-900">{user.phone}</div>
                 </div>
              )}

              {profile && profile.city && (
                 <div>
                    <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">Location</div>
                    <div className="font-semibold text-gray-900">{profile.city}{profile.state ? `, ${profile.state}` : ''}</div>
                 </div>
              )}

              {(() => {
                const rawIg = profile.instagram_handle || profile.instagram || '';
                const rawYt = profile.youtube || profile.youtube_url || '';
                const links = [];

                const addLink = (urlOrHandle, defaultType) => {
                  if (!urlOrHandle || typeof urlOrHandle !== 'string') return;
                  const clean = urlOrHandle.trim();
                  if (!clean) return;
                  const lower = clean.toLowerCase();
                  const isYt = lower.includes('youtube.com') || lower.includes('youtu.be');
                  const isIg = lower.includes('instagram.com') || lower.includes('instagr.am');
                  const type = isYt ? 'youtube' : (isIg ? 'instagram' : defaultType);
                  
                  let href = clean;
                  let display = clean;
                  if (type === 'instagram') {
                    const handleOnly = clean.replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, '').replace(/@/g, '').replace(/\/.*$/, '');
                    href = `https://instagram.com/${handleOnly}`;
                    display = `@${handleOnly}`;
                  } else if (type === 'youtube') {
                    href = clean.startsWith('http') ? clean : `https://${clean}`;
                    display = clean.replace(/^(https?:\/\/)?(www\.)?youtube\.com\//i, '');
                  }

                  if (!links.some(l => l.href === href || l.display === display)) {
                    links.push({ type, href, display });
                  }
                };

                addLink(rawIg, 'instagram');
                addLink(rawYt, 'youtube');

                return links.map((l, i) => (
                  <div key={i}>
                    <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">
                      {l.type === 'youtube' ? 'YouTube Channel' : 'Instagram Profile'}
                    </div>
                    <a 
                      href={l.href} 
                      target="_blank" 
                      rel="noreferrer" 
                      className={`font-semibold hover:underline flex items-center gap-1 ${l.type === 'youtube' ? 'text-red-600' : 'text-[#7C3AED]'}`}
                    >
                      {l.display}
                      {l.type === 'instagram' && (
                        <span className="text-[#5F6672] text-xs no-underline font-normal">
                          ({(Number(profile.instagram_followers || profile.followers_instagram || profile.followers || profile.follower_count) || 0).toLocaleString('en-IN') /* v330 / v451 brand followers */} followers)
                        </span>
                      )}
                    </a>
                  </div>
                ));
              })()}

              {isBrandUser && profile?.website && (
                 <div>
                    <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">Website</div>
                    <a href={/^https?:\/\//i.test(profile.website) ? profile.website : `https://${profile.website}`} target="_blank" rel="noreferrer" className="font-semibold text-[#7C3AED] hover:underline break-all">{profile.website}</a>
                 </div>
              )}
              {isBrandUser && profile?.gst_number && (
                 <div>
                    <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">GST number</div>
                    <div className="font-semibold text-gray-900 font-mono">{profile.gst_number}</div>
                 </div>
              )}

              {profile && profile.primary_niche && (
                 <div>
                    <div className="text-xs font-bold text-[#5F6672] uppercase tracking-widest mb-1">Primary Niche</div>
                    <div className="font-semibold text-gray-900">{profile.primary_niche}</div>
                 </div>
              )}

              {revealedPassword && (
                <div className="col-span-full bg-[#F5F0FF] border border-violet-200/80 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-2 animate-in fade-in duration-200">{/* v332: wraps on phones */}
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-extrabold text-violet-900 uppercase tracking-wider">Password:</span>
                    <span className="font-mono text-xs font-bold text-gray-900 bg-white px-2.5 py-1 rounded-lg border border-violet-100 select-all break-all">
                      {user.plain_password || '•••••••• (encrypted — reset to set a new one)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {user.plain_password && (
                      <button
                        type="button"
                        onClick={() => handleCopy(user.plain_password, 'Password')}
                        className="p-1.5 hover:bg-violet-100 rounded-lg text-[#6D28D9] transition-colors cursor-pointer"
                        title="Copy password"
                        aria-label="Copy password" /* v332 */
                      >
                        {copiedPass ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setRevealedPassword(false)}
                      className="text-xs font-extrabold text-[#7C3AED] hover:text-violet-900 px-2 py-1 rounded-lg hover:bg-violet-100 transition-colors cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
           </div>
          {editing && (
        <CreatorProfileEditModal
          creator={{ ...user, ...(profile || {}), user_id: user?.user_id || user?.id, email: user?.email, creator_profile: { ...(user?.creator_profile || {}), ...(profile || {}) } }}
          onClose={() => setEditing(false)}
          onSaveSuccess={() => { setEditing(false); onEdited?.(); }}
        />
      )}
    </div>
  );
}
