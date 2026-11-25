import React from "react";
import { MobileScreen } from "./brandMobileUi";
import AccountPanel from "../../../account/AccountPanel";
import { BlockedPeopleList } from "../../../safety/BlockUserButton"; // v451 (BRD §8c): moved here from Help

// Screen — Account (brand mobile). Login details, devices & sessions, privacy & terms, delete account, blocked people
// (v451: "Legal & account" — Help no longer carries these).
export default function AccountScreen({ onBack, onOpen, onDeleted }) {
  return (
    <MobileScreen title="Legal & account" onBack={onBack}>
      <AccountPanel onOpen={onOpen} onDeleted={onDeleted} />
      <div className="px-4 pb-8"><BlockedPeopleList /></div>
    </MobileScreen>
  );
}
