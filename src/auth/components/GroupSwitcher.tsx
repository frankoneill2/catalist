// Group switcher: dropdown in the top bar that lists every group the
// user belongs to and lets them switch between them. Hidden entirely when
// the user has exactly one group.
//
// Also exposes a small "Manage groups" panel for create/rename/leave.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { User } from 'firebase/auth';
import {
  type Group,
  watchMyGroups,
  createGroup,
  renameGroup,
  removeMember,
  listGroupMembers,
  type GroupMember,
} from '../groups';
import { resolveDisplayNames } from '../users';
import {
  getCurrentGroupId,
  setCurrentGroupId,
  subscribe as subscribeGroup,
} from '../groupContext';
import {
  type Invite,
  watchGroupInvites,
} from '../invites';
import {
  type JoinRequest,
  approveJoinRequest,
  denyJoinRequest,
  deleteJoinRequest,
  watchGroupJoinRequests,
} from '../joinRequests';
import { InviteDialog } from './InviteDialog';

interface Props {
  user: User;
}

export const GroupSwitcher: React.FC<Props> = ({ user }) => {
  const [groups, setGroups] = useState<Group[]>([]);
  const [currentId, setCurrentIdState] = useState<string | null>(getCurrentGroupId());
  const [open, setOpen] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // Live group list. Snapshot errors (typically rules denials during a
  // brief window where ensureDefaultGroup is still racing) get surfaced as
  // a visible affordance instead of silently rendering nothing.
  useEffect(() => {
    setGroupsError(null);
    let unsub: (() => void) | undefined;
    try {
      unsub = watchMyGroups(user.uid, (next) => {
        setGroupsError(null);
        setGroups(next);
      });
    } catch (err) {
      console.error('[GroupSwitcher] watchMyGroups failed', err);
      setGroupsError((err as Error).message || 'Could not load workspaces');
    }
    return () => { if (unsub) unsub(); };
  }, [user.uid]);

  // React to selection changes coming from elsewhere (e.g. group created).
  useEffect(() => {
    return subscribeGroup((id) => setCurrentIdState(id));
  }, []);

  // If the current group disappears (left, deleted), fall back to the first
  // available one.
  //
  // Important: only intervene when `currentId` is actually set to something
  // that's no longer present. If `currentId` is `null` we're either pre-
  // gate (AuthGate hasn't yet read the persisted group and called
  // setCurrentGroupId) or genuinely groupless. Racing the AuthGate here is
  // what caused workspace switches to land back in the wrong workspace —
  // the gate would be parked on the PIN prompt, this useEffect would fire
  // and overwrite the persisted choice with `groups[0].id`, and the gate's
  // post-PIN read would then pick that overwritten value.
  useEffect(() => {
    if (groups.length === 0) return;
    if (!currentId) return;
    if (groups.find((g) => g.id === currentId)) return;
    setCurrentGroupId(groups[0].id);
  }, [groups, currentId]);

  // When the dropdown opens, capture the trigger's viewport position so the
  // portaled menu can be placed under it with `position: fixed`. (The menu
  // is rendered to document.body to escape the topbar's stacking context.)
  useEffect(() => {
    if (!open) { setMenuPos(null); return; }
    const measure = () => {
      const el = wrapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 6, left: rect.left });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  // Click-away to close the menu. The portaled menu is outside `wrapRef`'s
  // DOM subtree, so we additionally allow clicks inside `.gs-menu` itself.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current && wrapRef.current.contains(target)) return;
      if ((target as HTMLElement).closest && (target as HTMLElement).closest('.gs-menu')) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = useMemo(
    () => groups.find((g) => g.id === currentId) ?? null,
    [groups, currentId]
  );

  // The switcher always renders something so the user can always find the
  // manage UI. Three states for the trigger:
  //   * 0 groups (or groups query errored) — "Set up workspace" button.
  //   * 1 group — workspace name pill with a "Manage" affordance.
  //   * 2+ groups — full dropdown.
  //
  // The manage modal is rendered ALONGSIDE the trigger (in a stable React
  // tree position) so transitioning from one trigger state to another while
  // the modal is open doesn't unmount + remount the modal — its local state
  // (success message, in-flight invite, typed-but-not-saved name) survives
  // the moment a new workspace appears in the live listener feed.

  let trigger: React.ReactNode;
  if (groups.length === 0) {
    trigger = (
      <button
        className="gs-mini-btn gs-mini-btn-empty"
        type="button"
        onClick={() => setShowManage(true)}
        title={groupsError ? `Workspace error: ${groupsError}` : 'Set up your first workspace'}
      >
        <svg width="14" height="14" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
          <polygon points="17 15 17 8 15 8 15 15 8 15 8 17 15 17 15 24 17 24 17 17 24 17 24 15"/>
        </svg>
        <span>Set up workspace</span>
      </button>
    );
  } else if (groups.length === 1) {
    trigger = (
      <>
        <span className="gs-prefix">Workspace</span>
        <button
          className="gs-mini-btn"
          type="button"
          onClick={() => setShowManage(true)}
          title={`Manage workspaces (current: ${groups[0].name})`}
          aria-label={`Manage workspaces (current: ${groups[0].name})`}
        >
          <span>{groups[0].name}</span>
          <span className="gs-mini-divider" aria-hidden="true">·</span>
          <span className="gs-mini-action">Manage</span>
          <svg className="gs-cog" width="14" height="14" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
            <path d="M27,16.76c0-.25,0-.5,0-.76s0-.51,0-.76l1.92-1.41a.49.49,0,0,0,.12-.61L27.18,9.79a.5.5,0,0,0-.6-.22L24.39,10.43a8,8,0,0,0-1.31-.76L22.79,7.39a.5.5,0,0,0-.5-.39h-3.6a.5.5,0,0,0-.5.39l-.29,2.28a8,8,0,0,0-1.31.76l-2.19-.86a.5.5,0,0,0-.6.22L11.91,13.22a.49.49,0,0,0,.12.61L14,15.24c0,.25,0,.5,0,.76s0,.51,0,.76L12,18.17a.49.49,0,0,0-.12.61l1.84,3.42a.5.5,0,0,0,.6.22l2.19-.86a8,8,0,0,0,1.31.76l.29,2.28a.5.5,0,0,0,.5.39h3.6a.5.5,0,0,0,.5-.39l.29-2.28a8,8,0,0,0,1.31-.76l2.19.86a.5.5,0,0,0,.6-.22l1.84-3.42a.49.49,0,0,0-.12-.61ZM20.5,19.5A3.5,3.5,0,1,1,24,16,3.5,3.5,0,0,1,20.5,19.5Z" transform="translate(-0.5 0)"/>
          </svg>
        </button>
      </>
    );
  } else {
    trigger = (
      <div className="gs-wrap" ref={wrapRef}>
        <span className="gs-prefix">Workspace</span>
        <button
          className="gs-pill"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          title="Switch workspace"
        >
          <span className="gs-label">{current?.name ?? 'Pick workspace'}</span>
          <svg className="gs-chev" width="12" height="12" viewBox="0 0 32 32" fill="currentColor" aria-hidden="true">
            <polygon points="16 22 6 12 7.4 10.6 16 19.2 24.6 10.6 26 12" />
          </svg>
        </button>
        {open && menuPos
          ? createPortal(
              <div
                className="gs-menu gs-menu-portaled"
                role="listbox"
                style={{ top: menuPos.top, left: menuPos.left }}
              >
                {groups.map((g) => (
                  <button
                    key={g.id}
                    className={`gs-item${g.id === currentId ? ' is-current' : ''}`}
                    type="button"
                    role="option"
                    aria-selected={g.id === currentId}
                    onClick={() => { setCurrentGroupId(g.id); setOpen(false); }}
                  >
                    <span className="gs-item-name">{g.name}</span>
                    {g.id === currentId ? <span className="gs-item-tick">✓</span> : null}
                  </button>
                ))}
                <div className="gs-menu-sep" />
                <button
                  className="gs-item gs-item-action"
                  type="button"
                  onClick={() => { setOpen(false); setShowManage(true); }}
                >
                  Manage workspaces…
                </button>
              </div>,
              document.body
            )
          : null}
      </div>
    );
  }

  return (
    <>
      {trigger}
      {showManage ? (
        <ManageGroupsModal
          user={user}
          groups={groups}
          onClose={() => setShowManage(false)}
        />
      ) : null}
    </>
  );
};

// ---------------------------------------------------------------------------
// Manage modal — create new, rename, leave, list members. Lightweight; this
// is not the final hospital-grade admin UI, just enough to work with multiple
// groups.

interface ManageProps {
  user: User;
  groups: Group[];
  onClose: () => void;
}

const ManageGroupsModal: React.FC<ManageProps> = (props) => {
  // Portal to body so the modal escapes the topbar's stacking context. The
  // topbar uses `backdrop-filter`, which establishes a new stacking context
  // and traps any `position:fixed` children at the topbar's effective z-index
  // (40) instead of letting them float above the page. Without this portal
  // the modal renders behind everything in the page that has z-index > 40.
  return createPortal(<ManageGroupsModalInner {...props} />, document.body);
};

const ManageGroupsModalInner: React.FC<ManageProps> = ({ user, groups, onClose }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  // Which group's InviteDialog (QR + link) is currently open. The dialog is
  // a separate overlay layered above this modal so the QR can take centre
  // stage on mobile without the workspace list crowding it.
  const [inviteForGroup, setInviteForGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<Record<string, GroupMember[]>>({});
  const [invites, setInvites] = useState<Record<string, Invite[]>>({});
  // Pending join requests, per group the current user admins. Live-updated
  // via watchGroupJoinRequests so newly-arrived requests appear without
  // closing/re-opening the modal.
  const [joinRequests, setJoinRequests] = useState<Record<string, JoinRequest[]>>({});
  // uid → displayName resolved from /users/{uid}. Populated on modal open
  // for every member of every visible group so the per-group list can show
  // names instead of opaque uids.
  const [displayNames, setDisplayNames] = useState<Map<string, string>>(new Map());

  // Load member lists lazily once the modal is open. Both the per-group
  // /members/ subcollection (for role + joinedAt metadata) and the union of
  // every memberUid across every group (for name resolution).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, GroupMember[]> = {};
      for (const g of groups) {
        try {
          next[g.id] = await listGroupMembers(g.id);
        } catch {
          next[g.id] = [];
        }
      }
      if (!cancelled) setMembers(next);
      // Now resolve display names for every uid we'll need to render. The
      // source of truth is `memberUids` on the group doc — that's what
      // gates access; the subcollection is supplementary metadata.
      const allUids = new Set<string>();
      for (const g of groups) for (const u of g.memberUids) allUids.add(u);
      const map = await resolveDisplayNames(Array.from(allUids));
      if (!cancelled) setDisplayNames(map);
    })();
    return () => { cancelled = true; };
  }, [groups]);

  // Live-listen to each group's invite list so revokes/accepts reflect
  // immediately. Only watch groups the user is admin of — non-admins
  // can't read the invite collection anyway, so the snapshot would error.
  useEffect(() => {
    const unsubs: Array<() => void> = [];
    for (const g of groups) {
      if (!g.adminUids.includes(user.uid)) continue;
      unsubs.push(watchGroupInvites(g.id, (rows) => {
        setInvites((prev) => ({ ...prev, [g.id]: rows }));
      }));
      unsubs.push(watchGroupJoinRequests(g.id, (rows) => {
        setJoinRequests((prev) => ({ ...prev, [g.id]: rows }));
      }));
    }
    return () => { unsubs.forEach((u) => u()); };
  }, [groups, user.uid]);

  async function handleApproveRequest(req: JoinRequest) {
    setBusy(`approve-${req.uid}`); setError(null); setInfo(null);
    try {
      await approveJoinRequest(req);
      const who = req.displayName || req.email || 'New member';
      const where = groups.find((g) => g.id === req.groupId)?.name || 'workspace';
      // Slightly more emphatic copy than the previous one-liner — admins
      // told us it wasn't obvious that anything had happened. Pair this
      // with the new-member-side approval banner (PendingJoinNotice) and
      // both ends of the handshake now get a clear acknowledgement.
      setInfo(`✓ ${who} is now a member of "${where}". They'll see a notification on their end.`);
    } catch (err) {
      setError((err as Error).message || 'Could not approve.');
    } finally {
      setBusy(null);
    }
  }

  async function handleDenyRequest(req: JoinRequest) {
    if (!window.confirm(`Decline ${req.displayName || req.email || 'this request'}?`)) return;
    setBusy(`deny-${req.uid}`); setError(null); setInfo(null);
    try {
      await denyJoinRequest(req);
      // Cleanup the doc so it doesn't linger in the admin's panel.
      await deleteJoinRequest(req.groupId, req.uid).catch(() => { /* best effort */ });
      setInfo('Request declined.');
    } catch (err) {
      setError((err as Error).message || 'Could not deny.');
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) { setError('Workspace name is required'); return; }
    setBusy('create'); setError(null); setInfo(null);
    // First-time users with no workspace yet should land inside the one
    // they just created (otherwise the app stays in its "no workspace"
    // empty state). Everyone else stays in their current workspace and
    // sees the new one appear in the list — auto-switching there would
    // trigger a full page reload (see script.js's group:changed handler)
    // and the user loses their place mid-task.
    const shouldAutoSwitch = groups.length === 0;
    try {
      const id = await createGroup(user.uid, name);
      if (shouldAutoSwitch) {
        setCurrentGroupId(id);
      }
      setNewName('');
      setInfo(
        shouldAutoSwitch
          ? `Created “${name}” and switched into it.`
          : `Created “${name}”. It's listed above — click “Switch to this” when you're ready to move into it.`
      );
    } catch (e) {
      setError((e as Error).message || 'Failed to create workspace');
    } finally {
      setBusy(null);
    }
  }

  async function handleRename(g: Group) {
    const next = window.prompt('Rename workspace', g.name);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === g.name) return;
    setBusy(`rename-${g.id}`); setError(null); setInfo(null);
    try {
      await renameGroup(g.id, trimmed);
      setInfo(`Renamed to “${trimmed}”.`);
    } catch (e) {
      setError((e as Error).message || 'Failed to rename workspace');
    } finally {
      setBusy(null);
    }
  }

  async function handleLeave(g: Group) {
    if (g.ownerUid === user.uid && g.memberUids.length > 1) {
      setError('Owners cannot leave a workspace they share with others. Transfer ownership first (coming in a later phase).');
      return;
    }
    const ok = window.confirm(`Leave “${g.name}”? You'll lose access to its cases.`);
    if (!ok) return;
    setBusy(`leave-${g.id}`); setError(null); setInfo(null);
    try {
      await removeMember(g.id, user.uid);
      setInfo(`Left “${g.name}”.`);
    } catch (e) {
      setError((e as Error).message || 'Failed to leave workspace');
    } finally {
      setBusy(null);
    }
  }

  // Owner-only: remove another member from a workspace. Enforced in two
  // layers — this UI gate (button only renders for the owner), and the
  // Firestore rule on /groups/{id} which restricts membership-removal
  // updates to ownerUid. Phase 7 will add a Cloud Function on top for
  // step-up re-auth and tighter audit; that's an enhancement, not a fix.
  async function handleKick(g: Group, uid: string) {
    if (g.ownerUid !== user.uid) return;
    if (uid === user.uid || uid === g.ownerUid) return;
    const who = displayNames.get(uid) || 'this member';
    const ok = window.confirm(`Remove ${who} from “${g.name}”? They'll lose access to its cases immediately.`);
    if (!ok) return;
    setBusy(`kick-${g.id}-${uid}`); setError(null); setInfo(null);
    try {
      await removeMember(g.id, uid);
      setInfo(`Removed ${who} from “${g.name}”.`);
    } catch (e) {
      setError((e as Error).message || 'Failed to remove member');
    } finally {
      setBusy(null);
    }
  }


  const activeGroupId = getCurrentGroupId();
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;

  return (
    <div className="gs-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="gs-modal" onClick={(e) => e.stopPropagation()}>
        <header className="gs-modal-header">
          <h2>Manage workspaces</h2>
          <button className="gs-close" type="button" onClick={onClose} aria-label="Close">×</button>
        </header>

        <p className="gs-active-banner">
          <span className="gs-active-label">Currently viewing:</span>{' '}
          <strong>{activeGroup ? activeGroup.name : (activeGroupId ? '(loading…)' : 'no workspace selected')}</strong>
          <span className="gs-active-hint">— new patients you create from the table go into this workspace.</span>
        </p>

        {error ? <p className="gs-error" role="alert">{error}</p> : null}
        {info ? <p className="gs-info">{info}</p> : null}

        <section className="gs-section">
          <h3>Your workspaces ({groups.length})</h3>
          {groups.length === 0 ? (
            <p className="gs-paragraph gs-meta">
              No workspaces found. If you just created one, give it a moment and re-open this dialog —
              the live listener should pick it up automatically.
            </p>
          ) : null}
          <ul className="gs-list">
            {groups.map((g) => (
              <li key={g.id} className={`gs-row${g.id === activeGroupId ? ' gs-row-active' : ''}`}>
                <div className="gs-row-main">
                  <strong>
                    {g.name}
                    {g.id === activeGroupId ? <span className="gs-active-tag">Active</span> : null}
                  </strong>
                  <span className="gs-meta">
                    {g.ownerUid === user.uid ? 'Owner' : g.adminUids.includes(user.uid) ? 'Admin' : 'Member'}
                    {' · '}
                    {g.memberUids.length} member{g.memberUids.length === 1 ? '' : 's'}
                  </span>
                  <ul className="gs-members">
                    {g.memberUids.map((uid) => {
                      const role: GroupMember['role'] =
                        uid === g.ownerUid ? 'owner'
                        : g.adminUids.includes(uid) ? 'admin'
                        : 'member';
                      const name = displayNames.get(uid);
                      const isMe = uid === user.uid;
                      const canKick = g.ownerUid === user.uid && uid !== g.ownerUid;
                      return (
                        <li key={uid} className="gs-member-row">
                          <span className="gs-member-name">
                            {name || (isMe ? 'You' : '(unknown user)')}
                            {isMe && name ? <span className="gs-member-you"> · you</span> : null}
                          </span>
                          <span className={`gs-member-role gs-member-role-${role}`}>
                            {role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : 'Member'}
                          </span>
                          {canKick ? (
                            <button
                              type="button"
                              className="gs-member-kick"
                              disabled={busy !== null}
                              onClick={() => handleKick(g, uid)}
                              aria-label={`Remove ${name || 'member'} from ${g.name}`}
                              title="Remove from workspace"
                            >
                              {busy === `kick-${g.id}-${uid}` ? 'Removing…' : 'Remove'}
                            </button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div className="gs-row-actions">
                  {g.id !== activeGroupId ? (
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => { setCurrentGroupId(g.id); setInfo(`Switching to "${g.name}"…`); }}
                    >
                      Switch to this
                    </button>
                  ) : null}
                  <button type="button" disabled={busy !== null} onClick={() => handleRename(g)}>Rename</button>
                  {g.adminUids.includes(user.uid) ? (
                    <button
                      type="button"
                      className="gs-invite-btn"
                      disabled={busy !== null}
                      onClick={() => setInviteForGroup(g)}
                    >
                      Invite member
                    </button>
                  ) : null}
                  <button type="button" disabled={busy !== null} onClick={() => handleLeave(g)}>Leave</button>
                </div>
                {/* Pending invites for this workspace are surfaced inline so
                    the admin can revoke older ones without opening the
                    invite dialog. The dialog itself shows the same list
                    plus controls for the freshly-created invite. */}
                {invites[g.id] && invites[g.id].some((i) => i.status === 'pending') ? (
                  <div className="gs-invite-summary">
                    <span className="gs-meta">
                      {invites[g.id].filter((i) => i.status === 'pending').length} pending invite
                      {invites[g.id].filter((i) => i.status === 'pending').length === 1 ? '' : 's'}
                    </span>
                  </div>
                ) : null}
                {/* Pending join requests need admin review before the
                    requester gets any access. The list lives directly
                    under the row (not behind a click) so unfamiliar
                    names show up clearly. */}
                {g.adminUids.includes(user.uid) && joinRequests[g.id] && joinRequests[g.id].length > 0 ? (
                  <div className="gs-join-requests">
                    <div className="gs-join-requests-header">
                      Join requests ({joinRequests[g.id].length})
                    </div>
                    <ul>
                      {joinRequests[g.id].map((req) => (
                        <li key={req.uid} className="gs-join-request">
                          <div className="gs-join-request-main">
                            <strong>{req.displayName || '(no name)'}</strong>
                            <span className="gs-meta">{req.email || '(no email)'}</span>
                          </div>
                          <div className="gs-join-request-actions">
                            <button
                              type="button"
                              className="gs-approve-btn"
                              disabled={busy !== null}
                              onClick={() => handleApproveRequest(req)}
                            >
                              {busy === `approve-${req.uid}` ? 'Approving…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              disabled={busy !== null}
                              onClick={() => handleDenyRequest(req)}
                            >
                              {busy === `deny-${req.uid}` ? 'Denying…' : 'Deny'}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        <section className="gs-section">
          <h3>Create a new workspace</h3>
          <div className="gs-create">
            <input
              type="text"
              value={newName}
              placeholder="e.g. Geriatrics Ward 4"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
            <button type="button" disabled={busy !== null} onClick={handleCreate}>
              {busy === 'create' ? 'Creating…' : 'Create'}
            </button>
          </div>
        </section>

        <footer className="gs-modal-footer">
          <button type="button" onClick={onClose}>Done</button>
        </footer>
      </div>
      {inviteForGroup ? (
        <InviteDialog group={inviteForGroup} onClose={() => setInviteForGroup(null)} />
      ) : null}
    </div>
  );
};
