'use client';

import { useState } from 'react';

interface QueueItem {
  id: string;
  type: 'comment' | 'dm';
  author_name: string;
  text: string;
  intent_or_category: string;
  reply_text: string;
  created_at: string;
}

interface ApprovalQueueProps {
  items: QueueItem[];
  onApprove: (id: string, type: string, editedReply: string) => void;
  onReject: (id: string, type: string) => void;
}

export function ApprovalQueue({ items, onApprove, onReject }: ApprovalQueueProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  if (!items || items.length === 0) {
    return (
      <div className="border rounded-lg p-8 text-center bg-white">
        <p className="text-gray-400">All caught up! No items pending approval.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Approval Queue</h3>
        <span className="text-sm text-gray-500">{items.length} pending</span>
      </div>

      {items.map((item) => (
        <div key={`${item.type}-${item.id}`} className="border rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                item.type === 'comment' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
              }`}>
                {item.type === 'comment' ? 'Comment' : 'DM'}
              </span>
              <span className="font-medium text-sm">@{item.author_name}</span>
              <span className="text-xs text-gray-400">{item.intent_or_category}</span>
            </div>
            <span className="text-xs text-gray-400">
              {new Date(item.created_at).toLocaleString()}
            </span>
          </div>

          <div className="mb-2">
            <p className="text-sm text-gray-600">Original: &quot;{item.text}&quot;</p>
          </div>

          <div className="bg-gray-50 rounded p-3 mb-3">
            <p className="text-xs text-gray-400 mb-1">Drafted Reply:</p>
            {editingId === item.id ? (
              <textarea
                className="w-full text-sm border rounded p-2 mt-1"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={3}
              />
            ) : (
              <p className="text-sm">{item.reply_text}</p>
            )}
          </div>

          <div className="flex gap-2">
            {editingId === item.id ? (
              <>
                <button
                  onClick={() => { onApprove(item.id, item.type, editText); setEditingId(null); }}
                  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Send Edited
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onApprove(item.id, item.type, item.reply_text)}
                  className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Approve & Send
                </button>
                <button
                  onClick={() => { setEditingId(item.id); setEditText(item.reply_text); }}
                  className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50"
                >
                  Edit
                </button>
                <button
                  onClick={() => onReject(item.id, item.type)}
                  className="px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50"
                >
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
