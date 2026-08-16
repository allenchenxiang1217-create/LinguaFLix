/**
 * Deletion cascade — #1 生词删除 + #10 笔记/截图删除 + #7 合并后的出处级删除。
 *
 * 删除永远走这里，而不是直接调 store action，保证「清缓存」和「引用计数」一致：
 * - 删除生词时只清它自己（从快照 words[] 副本移除），同句其它生词的截图跳转不受影响；
 *   仅当快照里不再有任何生词时，其截图才成为孤儿缓存 → 一并清理（localStorage 缩略图 + 磁盘 PNG）。
 * - 删除截图（快照条目）时，从该截图保存的生词一并删除（它们依赖截图作为跳转锚点）。
 * - 删除笔记时，级联清理所有截图的缓存与全部生词。
 * - #7 合并后一个词可能跨多个截图/视频：删除只影响「该词在对应截图里的那条出处」，
 *   除非删到 0 条出处才把整个词删掉。
 */

import type { Note, SnapshotEntry, VocabWord } from '@shared/types'
import { useVocabularyStore, occurrencesOf } from '../stores/vocabularyStore'
import { useNoteStore } from '../stores/noteStore'
import { deleteSnapshotCache, findSnapshotFilePath } from './storage-service'

/**
 * #1 删除生词（整个词，无论有几条出处）：
 * 1. 从单词本（vocabularyStore.words）删除；
 * 2. 从它所有出处所在的快照 words[] 副本删除；
 * 3. 引用计数：快照内不再有生词时，删除它的截图缓存（缩略图 + 磁盘 PNG）。
 */
export async function deleteWordCompletely(word: { id: string; snapshotId: string; videoHash?: string }): Promise<void> {
  const target = useVocabularyStore.getState().words.find((w) => w.id === word.id)
  useVocabularyStore.getState().removeWord(word.id)

  const snapshotIds = new Set<string>()
  if (target) {
    for (const o of occurrencesOf(target)) if (o.snapshotId) snapshotIds.add(o.snapshotId)
  } else if (word.snapshotId) {
    snapshotIds.add(word.snapshotId)
  }

  for (const sid of snapshotIds) {
    const remaining = useNoteStore.getState().removeWordFromSnapshot(sid, word.id)
    if (remaining === 0) {
      // #7 同步删除：内存 noteStore 里取 filePath；若已退出视频（noteStore 清空），
      // 从持久化笔记本找回，确保磁盘 PNG 也被清掉，不累积成孤儿文件。
      const snap = useNoteStore.getState().getSnapshot(sid)
      const filePath = snap?.filePath || findSnapshotFilePath(word.videoHash ?? '', sid)
      await deleteSnapshotCache(sid, filePath)
    }
  }
}

/**
 * #7 内联删除：只删掉某个单词在「某张截图」里的那一条出处（不是整个词）。
 * 删到 0 条出处时整个词随之删除；该截图没有其它生词时清理孤儿截图缓存。
 */
export async function deleteWordOccurrenceFromSnapshot(word: VocabWord, snapshotId: string): Promise<void> {
  const occ = occurrencesOf(word).find((o) => o.snapshotId === snapshotId)
  useVocabularyStore.getState().removeWordOccurrence(word.id, snapshotId, occ?.videoTimestamp ?? word.videoTimestamp)
  const remaining = useNoteStore.getState().removeWordFromSnapshot(snapshotId, word.id)
  if (remaining === 0) {
    const snap = useNoteStore.getState().getSnapshot(snapshotId)
    const filePath = snap?.filePath || findSnapshotFilePath(word.videoHash ?? '', snapshotId)
    await deleteSnapshotCache(snapshotId, filePath)
  }
}

/**
 * #10 删除一个快照（截图条目）：
 * 1. 从笔记中移除快照；
 * 2. 清理它的截图缓存；
 * 3. 删除从该截图保存的每个生词在本截图里的那条出处（其它截图里的出处保留）。
 */
export async function deleteSnapshotCompletely(
  noteId: string,
  snapshot: SnapshotEntry,
): Promise<void> {
  useNoteStore.getState().removeSnapshot(noteId, snapshot.id)
  await deleteSnapshotCache(snapshot.id, snapshot.filePath)
  const toRemove = useVocabularyStore
    .getState()
    .words.filter((w) => occurrencesOf(w).some((o) => o.snapshotId === snapshot.id))
  for (const w of toRemove) {
    const occ = occurrencesOf(w).find((o) => o.snapshotId === snapshot.id)
    useVocabularyStore.getState().removeWordOccurrence(w.id, snapshot.id, occ?.videoTimestamp ?? 0)
  }
}

/**
 * #10 删除整本笔记：级联清理所有截图的缓存 + 该笔记下每个生词在本笔记截图里的出处。
 */
export async function deleteNoteCompletely(note: Note): Promise<void> {
  for (const snap of note.snapshots) {
    await deleteSnapshotCache(snap.id, snap.filePath)
  }
  const snapshotIds = new Set(note.snapshots.map((s) => s.id))
  const affected = useVocabularyStore
    .getState()
    .words.filter((w) => occurrencesOf(w).some((o) => snapshotIds.has(o.snapshotId)))
  for (const w of affected) {
    for (const o of occurrencesOf(w)) {
      if (snapshotIds.has(o.snapshotId)) {
        useVocabularyStore.getState().removeWordOccurrence(w.id, o.snapshotId, o.videoTimestamp)
      }
    }
  }
  useNoteStore.getState().deleteNote(note.id)
}
