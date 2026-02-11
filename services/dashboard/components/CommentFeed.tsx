'use client';

import { useState } from 'react';

interface Comment {
  id: string;
  ig_comment_id: string;
  author_name: string;
  text: string;
  intent: string;
  reply_text: string | null;
  reply_status: 'auto' | 'drafted' | 'pending' | 'sent' | 'skipped';
  created_at: string;
}

interface CommentFeedProps {
  comments: Comment[];
  onApprove?: (id: string, editedReply: string) => void;
  onReject?: (id: string) => void;
}

const intentBadge: Record<string, string> = {
  praise: 'bg-green-100 text-green-700',
  question: 'bg-blue-100 text-blue-700',
  complaint: 'bg-red-100 text-red-700',
  spam: 'bg-gray-100 text-gray-700',
  lead: 'bg-purple-100 text-purple-700',
  neutral: 'bg-gray-50 text-gray-600',
};

const statusBadge: Record<string, string> = {
  auto: 'bg-green-50 text-green-600',
  drafted: 'bg-yellow-50 text-yellow-600',
  pending: 'bg-orange-50 text-orange-600',
  sent: 'bg-green-50 text-green-600',
  skipped: 'bg-gray-50 text-gray-400',
};

export function CommentFeed({ comments, onApprove, onReject }: CommentFeedProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  if (!comments || comments.length === 0) {
    return <div className="border rounded-lg p-8 text-center text-gray-400">No comments yet</div>;
  }

  return (
    <div className="space-y-3">
      {comments.map((comment) => (
        <div key={comment.id} className="border rounded-lg p-4 bg-white">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">@{comment.author_name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${intentBadge[comment.intent] || ''}`}>
                {comment.intent}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge[comment.reply_status] || ''}`}>
                {comment.reply_status}
              </span>
              <span className="text-xs text-gray-400">
                {new Date(comment.created_at).toLocaleString()}
              </span>
            </div>
          </div>

          <p className="text-sm mb-2">{comment.text}</p>

          {comment.reply_text && (
            <div className="bg-gray-50 rounded p-2 mt-2">
              <p className="text-xs text-gray-400 mb-1">AI Reply:</p>
              {editingId === comment.id ? (
                <textarea
                  className="w-full text-sm border rounded p-2"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={3}
                />
              ) : (
                <p className="text-sm">{comment.reply_text}</p>
              )}
            </div>
          )}

          {comment.reply_status === 'drafted' && onApprove && onReject && (
            <div className="flex gap-2 mt-3">
              {editingId === comment.id ? (
                <>
                  <button
                    onClick={() => { onApprove(comment.id, editText); setEditingId(null); }}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Send
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => onApprove(comment.id, comment.reply_text || '')}
                    className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => { setEditingId(comment.id); setEditText(comment.reply_text || ''); }}
                    className="px-3 py-1 text-sm border rounded hover:bg-gray-50"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onReject(comment.id)}
                    className="px-3 py-1 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50"
                  >
                    Reject
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
