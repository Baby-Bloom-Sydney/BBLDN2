"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { InboxMessage, markAsRead, markAllAsRead } from "@/lib/actions/inbox";
import {
  Bell,
  Check,
  X,
  AlertTriangle,
  Loader2,
  Phone,
} from "lucide-react";

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function MessageItem({
  message,
  onMarkRead,
}: {
  message: InboxMessage;
  onMarkRead: (id: string) => void;
}) {
  const getIcon = () => {
    switch (message.type) {
      case "connection_confirmed":
        return <Check className="h-4 w-4 text-green-600" />;
      case "connection_declined":
        return <X className="h-4 w-4 text-red-500" />;
      case "connection_expired":
      case "connection_cancelled":
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      case "connection_request":
        return <Phone className="h-4 w-4 text-violet-500" />;
      default:
        return <Bell className="h-4 w-4 text-violet-500" />;
    }
  };

  return (
    <div
      onClick={() => !message.is_read && onMarkRead(message.id)}
      className={`flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors ${
        message.is_read
          ? "border-slate-100 bg-white"
          : "border-violet-200 bg-violet-50"
      }`}
    >
      <div className="mt-0.5 flex-shrink-0">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <p
          className={`text-sm ${
            message.is_read ? "text-slate-600" : "font-medium text-slate-900"
          }`}
        >
          {message.title}
        </p>
        {message.body && (
          <p className="mt-0.5 text-sm text-slate-500 line-clamp-2">
            {message.body}
          </p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          {formatDate(message.created_at)}
        </p>
      </div>
      {!message.is_read && (
        <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-violet-500" />
      )}
    </div>
  );
}

interface ParentInboxClientProps {
  messages: InboxMessage[];
}

export function ParentInboxClient({ messages }: ParentInboxClientProps) {
  const router = useRouter();
  const [markingAllRead, setMarkingAllRead] = useState(false);

  const unreadCount = messages.filter((m) => !m.is_read).length;

  const handleMarkRead = async (id: string) => {
    await markAsRead(id);
    router.refresh();
  };

  const handleMarkAllRead = async () => {
    setMarkingAllRead(true);
    await markAllAsRead();
    setMarkingAllRead(false);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      {unreadCount > 0 && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={markingAllRead}
          >
            {markingAllRead && (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            )}
            Mark all read
          </Button>
        </div>
      )}
      <div className="space-y-2">
        {messages.map((msg) => (
          <MessageItem
            key={msg.id}
            message={msg}
            onMarkRead={handleMarkRead}
          />
        ))}
      </div>
    </div>
  );
}
