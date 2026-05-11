import type { SupabaseClient } from '@supabase/supabase-js'

export type StudyMode = 'learn' | 'reference' | 'verse' | 'review' | 'quiz'
export type Grade = 'again' | 'hard' | 'good' | 'easy'

export type VerseProgress = {
  confidence: number
  attempts: number
  correct: number
  streak: number
  lastReviewed: string | null
  history: Array<{
    grade: Grade
    at: string
  }>
}

export type StoredProgress = {
  selectedChapter: number
  mode: StudyMode
  verses: Record<string, VerseProgress>
}

type StudyStateRow = {
  selected_chapter: number | null
  mode: StudyMode | null
}

type VerseProgressRow = {
  verse_id: string
  confidence: number
  attempts: number
  correct: number
  streak: number
  last_reviewed: string | null
  history: Array<{ grade: Grade; at: string }> | null
}

export async function loadCloudProgress(
  client: SupabaseClient,
  userId: string,
  fallback: StoredProgress,
) {
  const [studyStateResult, verseProgressResult] = await Promise.all([
    client
      .from('study_state')
      .select('selected_chapter, mode')
      .eq('user_id', userId)
      .maybeSingle<StudyStateRow>(),
    client
      .from('verse_progress')
      .select('verse_id, confidence, attempts, correct, streak, last_reviewed, history')
      .eq('user_id', userId)
      .returns<VerseProgressRow[]>(),
  ])

  if (studyStateResult.error) throw studyStateResult.error
  if (verseProgressResult.error) throw verseProgressResult.error

  const verses = Object.fromEntries(
    (verseProgressResult.data ?? []).map((row) => [
      row.verse_id,
      {
        confidence: row.confidence,
        attempts: row.attempts,
        correct: row.correct,
        streak: row.streak,
        lastReviewed: row.last_reviewed,
        history: row.history ?? [],
      },
    ]),
  )

  return {
    selectedChapter: studyStateResult.data?.selected_chapter ?? fallback.selectedChapter,
    mode: studyStateResult.data?.mode ?? fallback.mode,
    verses,
  }
}

export async function saveCloudProgress(
  client: SupabaseClient,
  userId: string,
  progress: StoredProgress,
  deletedVerseIds: string[] = [],
) {
  const now = new Date().toISOString()

  const studyStateResult = await client.from('study_state').upsert({
    user_id: userId,
    selected_chapter: progress.selectedChapter,
    mode: progress.mode,
    updated_at: now,
  })

  if (studyStateResult.error) throw studyStateResult.error

  const rows = Object.entries(progress.verses).map(([verseId, verseProgress]) => ({
    user_id: userId,
    verse_id: verseId,
    confidence: verseProgress.confidence,
    attempts: verseProgress.attempts,
    correct: verseProgress.correct,
    streak: verseProgress.streak,
    last_reviewed: verseProgress.lastReviewed,
    history: verseProgress.history,
    updated_at: now,
  }))

  if (rows.length > 0) {
    const verseProgressResult = await client.from('verse_progress').upsert(rows)
    if (verseProgressResult.error) throw verseProgressResult.error
  }

  if (deletedVerseIds.length > 0) {
    const deleteResult = await client
      .from('verse_progress')
      .delete()
      .eq('user_id', userId)
      .in('verse_id', deletedVerseIds)

    if (deleteResult.error) throw deleteResult.error
  }
}
