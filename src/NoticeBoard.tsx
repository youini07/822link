import { useState, useEffect } from 'react';
import { PenTool, MessageSquare, Trash2, Send, Edit2 } from 'lucide-react';
import Quill from 'quill';
import { useRef } from 'react';
import 'quill/dist/quill.snow.css';

interface Notice {
  id: number;
  title: string;
  content: string;
  author?: string;
  date: number;
  comments: Comment[];
}

interface Comment {
  id: number;
  author: string;
  content: string;
  date: number;
}

interface Props {
  userRole: 'admin' | 'user';
  username: string;
}

export function NoticeBoard({ userRole, username }: Props) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [isWriting, setIsWriting] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newComment, setNewComment] = useState<Record<number, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const quillInstance = useRef<any>(null);

  useEffect(() => {
    if (isWriting && editorRef.current && !quillInstance.current) {
      quillInstance.current = new Quill(editorRef.current, {
        theme: 'snow',
        modules: {
          toolbar: [
            ['bold', 'italic', 'underline', 'strike'],
            ['blockquote', 'code-block'],
            [{ 'header': 1 }, { 'header': 2 }],
            [{ 'list': 'ordered'}, { 'list': 'bullet' }],
            [{ 'color': [] }, { 'background': [] }],
            ['link', 'image'],
            ['clean']
          ]
        }
      });
      
      quillInstance.current.on('text-change', () => {
        setNewContent(quillInstance.current.root.innerHTML);
      });

      if (newContent) {
        quillInstance.current.root.innerHTML = newContent;
      }
    }
    if (!isWriting) {
      quillInstance.current = null;
    }
  }, [isWriting]);

  const API_URL = 'https://bandadmin-auth-server-production.up.railway.app/api';

  const fetchNotices = async () => {
    try {
      const token = localStorage.getItem('bandadmin_token');
      const res = await fetch(`${API_URL}/notices`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setNotices(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchNotices();
  }, []);

  
  useEffect(() => {
    if (quillInstance.current && isWriting) {
      if (quillInstance.current.root.innerHTML !== newContent) {
        quillInstance.current.root.innerHTML = newContent;
      }
    }
  }, [editingId]);

  const handlePost = async () => {
    if (!newTitle || !newContent) return window.electron ? window.electron.showMessageBox('제목과 내용을 입력해주세요.') : alert('제목과 내용을 입력해주세요.');
    setIsLoading(true);
    try {
      const token = localStorage.getItem('bandadmin_token');
      const url = editingId ? `${API_URL}/notices/${editingId}` : `${API_URL}/notices`;
      const method = editingId ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: newTitle, content: newContent })
      });
      if (res.ok) {
        await fetchNotices();
        setIsWriting(false);
        setEditingId(null);
        setNewTitle('');
        setNewContent('');
      } else {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `게시글 등록 실패 (상태: ${res.status})`;
        window.electron ? window.electron.showMessageBox(errorMsg) : alert(errorMsg);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('게시글을 삭제하시겠습니까?')) {
      try {
        const token = localStorage.getItem('bandadmin_token');
        const res = await fetch(`${API_URL}/notices/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          await fetchNotices();
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleComment = async (noticeId: number) => {
    const content = newComment[noticeId];
    if (!content) return;
    try {
      const token = localStorage.getItem('bandadmin_token');
      const res = await fetch(`${API_URL}/notices/${noticeId}/comments`, {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ content })
      });
      if (res.ok) {
        setNewComment(prev => ({ ...prev, [noticeId]: '' }));
        await fetchNotices();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (confirm('댓글을 삭제하시겠습니까?')) {
      try {
        const token = localStorage.getItem('bandadmin_token');
        const res = await fetch(`${API_URL}/comments/${commentId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          await fetchNotices();
        } else {
          const data = await res.json();
          window.electron ? window.electron.showMessageBox(data.error || '삭제 실패') : alert(data.error || '삭제 실패');
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  return (
    <div className="flex-1 bg-slate-900 p-6 overflow-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-white">공지사항 (게시판)</h2>
        {userRole === 'admin' && (
          <button 
            onClick={() => setIsWriting(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded flex items-center shadow-lg transition-colors"
          >
            <PenTool size={16} className="mr-2" /> 새 글 작성
          </button>
        )}
      </div>

      {isWriting && (
        <div className="bg-slate-800 rounded-xl p-6 shadow-xl border border-slate-700 mb-6">
          <input 
            type="text" 
            placeholder="제목을 입력하세요" 
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded p-3 text-white mb-4 text-lg font-medium"
          />
          <div className="bg-white text-black rounded mb-6" ref={editorRef}></div>
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={() => { setIsWriting(false); setEditingId(null); setNewTitle(''); setNewContent(''); }} className="px-4 py-2 text-slate-400 hover:text-white">취소</button>
            <button disabled={isLoading} onClick={handlePost} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded disabled:opacity-50">
              {isLoading ? '등록 중...' : '등록하기'}
            </button>
          </div>
        </div>
      )}

      {!isWriting && (
        <div className="space-y-4">
          {notices.length === 0 ? (
            <div className="text-center text-slate-500 py-10">등록된 공지사항이 없습니다.</div>
          ) : (
            notices.map(notice => (
              <div key={notice.id} className="bg-slate-800 rounded-xl p-6 shadow-lg border border-slate-700">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-white mb-1">{notice.title}</h3>
                    <div className="flex items-center text-xs text-slate-500 gap-2">
                      <span className="font-medium text-slate-400">{notice.author || '관리자'}</span>
                      <span>•</span>
                      <span>{new Date(notice.date).toLocaleString('ko-KR')}</span>
                    </div>
                  </div>
                  {userRole === 'admin' && (
                    <div className="flex gap-2">
                      <button onClick={() => { setEditingId(notice.id); setNewTitle(notice.title); setNewContent(notice.content); setIsWriting(true); }} className="text-slate-500 hover:text-blue-400 transition-colors">
                        <Edit2 size={18} />
                      </button>
                      <button onClick={() => handleDelete(notice.id)} className="text-slate-500 hover:text-red-400 transition-colors">
                        <Trash2 size={18} />
                      </button>
                    </div>
                  )}
                </div>
                <div className="text-slate-300 mb-6 border-b border-slate-700 pb-6 quill-content [&_img]:max-w-full [&_img]:rounded" dangerouslySetInnerHTML={{ __html: notice.content }} />
                
                {/* 댓글 영역 */}
                <div className="bg-slate-900/50 rounded-lg p-4">
                  <h4 className="text-sm font-bold text-slate-400 mb-3 flex items-center">
                    <MessageSquare size={14} className="mr-1" /> 댓글 {notice.comments ? notice.comments.length : 0}개
                  </h4>
                  
                  {/* 댓글 목록 */}
                  <div className="space-y-3 mb-4">
                    {(!notice.comments || notice.comments.length === 0) ? (
                      <p className="text-xs text-slate-500 text-center py-2">작성된 댓글이 없습니다.</p>
                    ) : (
                      notice.comments.map(c => (
                        <div key={c.id} className="flex justify-between items-start text-sm border-b border-slate-700/50 pb-2 last:border-0">
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-300 flex items-center gap-2">
                              {c.author}
                              <span className="text-[10px] text-slate-500 font-normal">{new Date(c.date).toLocaleString('ko-KR')}</span>
                            </span>
                            <span className="text-slate-400 mt-0.5">{c.content}</span>
                          </div>
                          {(userRole === 'admin' || c.author === username) && (
                            <button onClick={() => handleDeleteComment(c.id)} className="text-slate-500 hover:text-red-400 transition-colors mt-1">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>

                  {/* 댓글 입력란 */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newComment[notice.id] || ''}
                      onChange={e => setNewComment(prev => ({ ...prev, [notice.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') handleComment(notice.id); }}
                      placeholder="댓글을 입력하세요..."
                      className="flex-1 bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-white"
                    />
                    <button 
                      onClick={() => handleComment(notice.id)}
                      className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded transition-colors"
                    >
                      <Send size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
