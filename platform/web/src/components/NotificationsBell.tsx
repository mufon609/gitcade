"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

interface Notif {
  id: string;
  type: string;
  message: string;
  gameSlug: string | null;
  proposalId: string | null;
  readAt: string | null;
  createdAt: string;
}

/** In-app notification bell (v1: no email). Polls /api/notifications; shows an unread
 *  badge; dropdown lists recent proposal events on games you belong to. */
export function NotificationsBell() {
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      const data = await res.json();
      if (data.ok) {
        setItems(data.notifications);
        setUnread(data.unread);
      }
    } catch {
      /* transient */
    }
  };

  useEffect(() => {
    if (status !== "authenticated") return;
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [status]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (status !== "authenticated") return null;

  const markAllRead = async () => {
    await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    setUnread(0);
    setItems((xs) => xs.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className="gc-btn relative"
        onClick={() => {
          setOpen((o) => !o);
          if (!open && unread > 0) void markAllRead();
        }}
        aria-label="Notifications"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-arcade-bad px-1 text-[10px] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 rounded-md border border-arcade-edge bg-arcade-panel p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-bold text-arcade-mute">Notifications</span>
          </div>
          {items.length === 0 ? (
            <p className="px-2 py-3 text-xs text-arcade-mute">Nothing yet. Join a game&apos;s community to follow it.</p>
          ) : (
            <ul className="max-h-96 overflow-auto">
              {items.map((n) => {
                const href = n.proposalId && n.gameSlug ? `/games/${n.gameSlug}/proposals/${n.proposalId}` : n.gameSlug ? `/games/${n.gameSlug}` : "#";
                return (
                  <li key={n.id}>
                    <Link
                      href={href}
                      className="block rounded px-2 py-2 text-xs no-underline hover:bg-black/30"
                      onClick={() => setOpen(false)}
                    >
                      <span className={n.readAt ? "text-arcade-mute" : "text-arcade-ink"}>{n.message}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
