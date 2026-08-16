import { useState } from 'react'
import { useNoteStore } from '../../stores/noteStore'
import { usePlayerStore } from '../../stores/playerStore'
import { useAppStore } from '../../stores/appStore'
import { useReviewStore } from '../../stores/reviewStore'
import { useSettingsStore, formatShortcutKey } from '../../stores/settingsStore'
import { NoteSnapshotCard } from './NoteSnapshotCard'
import { VocabularyNotebook } from './VocabularyNotebook'
import { deleteNoteCompletely } from '../../services/deletion'
import { BookOpen, Notebook, Plus, ChevronDown, Trash2, AlertCircle, BookMarked } from 'lucide-react'
import { useI18n } from '../../i18n/useI18n'

export function NotesPanel() {
  const tab = useNoteStore((s) => s.sidebarTab)
  const setTab = useNoteStore((s) => s.setSidebarTab)
  const notes = useNoteStore((s) => s.notes)
  const activeNoteId = useNoteStore((s) => s.activeNoteId)
  const setActiveNote = useNoteStore((s) => s.setActiveNote)
  const createNote = useNoteStore((s) => s.createNote)
  const videoHash = usePlayerStore((s) => s.videoHash)
  const screenshotKey = useSettingsStore((s) => s.shortcuts.takeScreenshot)
  const [noteSelectorOpen, setNoteSelectorOpen] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const { t } = useI18n()

  const activeNote = notes.find((n) => n.id === activeNoteId)

  const handleCreateNote = () => {
    if (!videoHash) return
    createNote(videoHash)
    setNoteSelectorOpen(false)
  }

  // #4 快捷跳转生词本：记录返回上下文，回到 Dashboard 后直接落到「单词本」视图。
  const goToWordbook = () => {
    useReviewStore.getState().setReturnToReview(true)
    useAppStore.getState().setAppPhase('dashboard')
  }

  const handleDeleteNote = (noteId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (deleteConfirmId === noteId) {
      setDeleteConfirmId(null)
      // #10 级联：清理所有截图的缓存 + 该笔记保存的生词，再删笔记。
      const note = notes.find((n) => n.id === noteId)
      if (note) {
        const isLast = notes.length === 1
        deleteNoteCompletely(note)
        // 删掉最后一本笔记后自动新建一本，保证当前视频的截图/笔记入口始终可用。
        if (isLast && videoHash) createNote(videoHash)
      }
    } else {
      setDeleteConfirmId(noteId)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab selector */}
      <div className="flex items-center gap-0 px-2 py-2 border-b border-border/30">
        <button
          onClick={() => setTab('notes')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[0.6875rem] font-semibold rounded-lg transition-all duration-200 cursor-pointer
            ${tab === 'notes' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <Notebook size={12} />
          {t('layout.notes')}
        </button>
        <button
          onClick={() => setTab('vocab')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[0.6875rem] font-semibold rounded-lg transition-all duration-200 cursor-pointer
            ${tab === 'vocab' ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
        >
          <BookOpen size={12} />
          {t('layout.vocab')}
        </button>
        <button
          onClick={goToWordbook}
          title={t('notes.goToWordbook')}
          className="ml-auto flex items-center gap-1 px-2.5 py-1.5 text-[0.6875rem] font-semibold rounded-lg
                     text-primary hover:bg-primary/10 transition-all duration-200 cursor-pointer"
        >
          <BookMarked size={12} />
          {t('notes.goToWordbook')}
        </button>
      </div>

      {/* Tab content */}
      {tab === 'notes' ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Note selector */}
          {notes.length > 0 && (
            <div className="px-3 py-2 border-b border-border/20">
              <button
                onClick={() => setNoteSelectorOpen(!noteSelectorOpen)}
                className="flex items-center justify-between w-full px-2.5 py-1.5 text-xs rounded-lg
                           bg-secondary/30 hover:bg-secondary/50 transition-colors cursor-pointer"
              >
                <span className="font-medium text-foreground/80 truncate">
                  {activeNote?.title || t('notes.selectNote')}
                </span>
                <ChevronDown size={12} className={`text-muted-foreground transition-transform ${noteSelectorOpen ? 'rotate-180' : ''}`} />
              </button>

              {noteSelectorOpen && (
                <div className="mt-1 space-y-0.5">
                  {notes.map((note) => (
                    <div
                      key={note.id}
                      className="flex items-center group/note"
                    >
                      <button
                        onClick={() => { setActiveNote(note.id); setNoteSelectorOpen(false); setDeleteConfirmId(null) }}
                        className={`flex-1 text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors cursor-pointer
                          ${note.id === activeNoteId ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/30'}`}
                      >
                        <span className="font-medium">{note.title}</span>
                        <span className="ml-2 text-[0.625rem] text-muted-foreground/50">
                          {t('notes.snaps', { n: note.snapshots.length })}
                        </span>
                      </button>
                      {/* Delete button — always available (#10: 单本笔记也可删除) */}
                      <button
                        onClick={(e) => handleDeleteNote(note.id, e)}
                        className={`p-1 rounded-md transition-all duration-200 cursor-pointer
                          ${deleteConfirmId === note.id
                            ? 'bg-destructive/15 text-destructive'
                            : 'text-muted-foreground/0 group-hover/note:text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive'
                          }`}
                        title={deleteConfirmId === note.id ? t('notes.confirmDelete') : t('notes.deleteNote')}
                      >
                        {deleteConfirmId === note.id ? (
                          <AlertCircle size={11} />
                        ) : (
                          <Trash2 size={11} />
                        )}
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={handleCreateNote}
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg
                               text-muted-foreground hover:bg-secondary/30 transition-colors cursor-pointer"
                  >
                    <Plus size={11} /> {t('notes.newNote')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Snapshots list */}
          <div className="flex-1 overflow-y-auto">
            {!activeNote || activeNote.snapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center mb-3">
                  <Notebook size={20} className="text-muted-foreground/30" />
                </div>
                <p className="text-xs font-medium text-muted-foreground">{t('notes.noSnapshots')}</p>
                <p className="text-[0.625rem] text-muted-foreground/40 mt-1 leading-relaxed max-w-[180px]">
                  {t('notes.pressToCapture', { key: formatShortcutKey(screenshotKey) })}
                </p>
              </div>
            ) : (
              <div className="p-2 space-y-2">
                {activeNote.snapshots.map((snap) => (
                  <NoteSnapshotCard key={snap.id} snapshot={snap} noteId={activeNote.id} />
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <VocabularyNotebook currentVideoHash={videoHash ?? undefined} />
        </div>
      )}
    </div>
  )
}
