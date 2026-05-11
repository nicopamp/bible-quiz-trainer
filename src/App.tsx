import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import './App.css'
import { actsKjv, chapterVerseCounts, type ScriptureVerse } from './data/actsKjv'
import {
  loadCloudProgress,
  saveCloudProgress,
  type Grade,
  type StoredProgress,
  type StudyMode,
  type VerseProgress,
} from './lib/cloudProgress'
import { isSupabaseConfigured, supabase } from './lib/supabase'

type LearnStage = 'read' | 'hide' | 'letters' | 'recite'
type LearnOrder = 'sequential' | 'random'
type QuizPhase = 'ready' | 'buzz' | 'answer' | 'review' | 'scored' | 'complete'
type QuizQuestionType = 'quotation' | 'completion' | 'reference'
type SyncStatus = 'local' | 'loading' | 'saved' | 'saving' | 'error'

type QuizQuestion = {
  id: string
  pointValue: 10 | 20 | 30
  type: QuizQuestionType
  verse: ScriptureVerse
  prompt: string
  expected: string
}

type QuizState = {
  questions: QuizQuestion[]
  currentIndex: number
  phase: QuizPhase
  secondsLeft: number
  score: number
  correct: number
  incorrect: number
  noResponses: number
}

const STORAGE_KEY = 'bible-quiz-acts-kjv-progress-v1'
const chapters = Array.from({ length: 9 }, (_, index) => index + 1)
const learnStages: Array<{ stage: LearnStage; label: string }> = [
  { stage: 'read', label: 'Read' },
  { stage: 'hide', label: 'Hide Words' },
  { stage: 'letters', label: 'First Letters' },
  { stage: 'recite', label: 'Recite' },
]
const quizPointValues: Array<10 | 20 | 30> = [
  10,
  10,
  10,
  10,
  10,
  10,
  10,
  10,
  20,
  20,
  20,
  20,
  20,
  20,
  20,
  20,
  20,
  30,
  30,
  30,
]
const grades: Array<{ grade: Grade; label: string; confidenceDelta: number; correct: boolean }> = [
  { grade: 'again', label: 'Again', confidenceDelta: -2, correct: false },
  { grade: 'hard', label: 'Hard', confidenceDelta: -1, correct: true },
  { grade: 'good', label: 'Good', confidenceDelta: 1, correct: true },
  { grade: 'easy', label: 'Easy', confidenceDelta: 2, correct: true },
]

const defaultProgress: StoredProgress = {
  selectedChapter: 1,
  mode: 'learn',
  verses: {},
}

function loadProgress(): StoredProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultProgress
    return { ...defaultProgress, ...JSON.parse(raw) }
  } catch {
    return defaultProgress
  }
}

function shuffle<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }
  return copy
}

function normalizeReference(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').replace(/^act/, 'acts')
}

function getVerseProgress(progress: StoredProgress, verseId: string): VerseProgress {
  return (
    progress.verses[verseId] ?? {
      confidence: 0,
      attempts: 0,
      correct: 0,
      streak: 0,
      lastReviewed: null,
      history: [],
    }
  )
}

function classify(confidence: number) {
  if (confidence >= 5) return 'mastered'
  if (confidence >= 2) return 'learning'
  return 'weak'
}

function firstWords(text: string, count: number) {
  return text.split(/\s+/).slice(0, count).join(' ')
}

function remainingAfterCue(text: string, cue: string) {
  return text.startsWith(cue) ? text.slice(cue.length).trimStart() : text
}

function makeQuizQuestion(pointValue: 10 | 20 | 30, verse: ScriptureVerse, index: number): QuizQuestion {
  if (pointValue === 10) {
    return {
      id: `quiz-${index}-${verse.id}`,
      pointValue,
      type: 'quotation',
      verse,
      prompt: `Question number ${index + 1} for 10 points. Quotation Question. Quote verse ${verse.verse} from Acts chapter ${verse.chapter}.`,
      expected: verse.text,
    }
  }

  if (pointValue === 20) {
    const cue = firstWords(verse.text, Math.min(5, verse.text.split(/\s+/).length))
    return {
      id: `quiz-${index}-${verse.id}`,
      pointValue,
      type: 'completion',
      verse,
      prompt: `Question number ${index + 1} for 20 points. Quotation Completion Question. Finish this verse, quote, "${cue}"`,
      expected: remainingAfterCue(verse.text, cue),
    }
  }

  return {
    id: `quiz-${index}-${verse.id}`,
    pointValue,
    type: 'reference',
    verse,
    prompt: `Question number ${index + 1} for 30 points. Give the complete reference for this verse.`,
    expected: verse.reference,
  }
}

function buildQuizRound(verses: ScriptureVerse[]) {
  const verseQueue = shuffle(verses)
  return shuffle(quizPointValues).map((pointValue, index) => {
    const verse = verseQueue[index % verseQueue.length]
    return makeQuizQuestion(pointValue, verse, index)
  })
}

function createQuizState(verses: ScriptureVerse[]): QuizState {
  return {
    questions: buildQuizRound(verses),
    currentIndex: 0,
    phase: 'ready',
    secondsLeft: 5,
    score: 0,
    correct: 0,
    incorrect: 0,
    noResponses: 0,
  }
}

function App() {
  const [progress, setProgress] = useState(loadProgress)
  const [session, setSession] = useState<Session | null>(null)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(
    isSupabaseConfigured ? 'loading' : 'local',
  )
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)
  const [isCloudReady, setIsCloudReady] = useState(false)
  const skipNextCloudSave = useRef(false)
  const [learnIndex, setLearnIndex] = useState(0)
  const [learnOrder, setLearnOrder] = useState<LearnOrder>('sequential')
  const [learnHistory, setLearnHistory] = useState<string[]>([])
  const [learnQueue, setLearnQueue] = useState<string[]>([])
  const [queue, setQueue] = useState<string[]>([])
  const [activeVerseId, setActiveVerseId] = useState<string | null>(null)
  const [isRevealed, setIsRevealed] = useState(false)
  const [learnStage, setLearnStage] = useState<LearnStage>('read')
  const [referenceGuess, setReferenceGuess] = useState('')
  const [quizState, setQuizState] = useState<QuizState | null>(null)

  const selectedChapter = progress.selectedChapter
  const mode = progress.mode

  const chapterVerses = useMemo(
    () => actsKjv.filter((verse) => verse.chapter === selectedChapter),
    [selectedChapter],
  )

  const activeVerse = useMemo(() => {
    if (mode === 'learn' && learnOrder === 'random') {
      return actsKjv.find((verse) => verse.id === activeVerseId) ?? chapterVerses[0]
    }
    if (mode === 'learn') return chapterVerses[learnIndex] ?? chapterVerses[0]
    return actsKjv.find((verse) => verse.id === activeVerseId) ?? chapterVerses[0]
  }, [activeVerseId, chapterVerses, learnIndex, learnOrder, mode])

  const dashboard = useMemo(() => {
    return chapters.map((chapter) => {
      const verses = actsKjv.filter((verse) => verse.chapter === chapter)
      const counts = verses.reduce(
        (acc, verse) => {
          const status = classify(getVerseProgress(progress, verse.id).confidence)
          acc[status] += 1
          return acc
        },
        { mastered: 0, learning: 0, weak: 0 },
      )
      return {
        chapter,
        total: verses.length,
        ...counts,
        percent: Math.round(((counts.mastered + counts.learning * 0.5) / verses.length) * 100),
      }
    })
  }, [progress])

  const nextReviewVerseId = useMemo(() => {
    const scored = chapterVerses.map((verse) => {
      const verseProgress = getVerseProgress(progress, verse.id)
      const lastReviewed = verseProgress.lastReviewed
        ? new Date(verseProgress.lastReviewed).getTime()
        : 0
      return {
        verse,
        score: verseProgress.confidence * 10000000000000 + lastReviewed,
      }
    })
    return scored.sort((a, b) => a.score - b.score)[0]?.verse.id ?? chapterVerses[0]?.id
  }, [chapterVerses, progress])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress))
  }, [progress])

  useEffect(() => {
    if (!supabase) return

    let isMounted = true

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return
      if (error) {
        setSyncStatus('error')
        setAuthError(error.message)
        return
      }
      setSession(data.session)
      if (!data.session) setSyncStatus('local')
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthError(null)
      setAuthNotice(null)
      setIsCloudReady(false)
      setSyncStatus(nextSession ? 'loading' : 'local')
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!supabase || !session?.user.id) return

    let isMounted = true
    const client = supabase
    const userId = session.user.id

    loadCloudProgress(client, userId, progress)
      .then((cloudProgress) => {
        if (!isMounted) return
        const hasCloudProgress =
          Object.keys(cloudProgress.verses).length > 0 ||
          cloudProgress.selectedChapter !== defaultProgress.selectedChapter ||
          cloudProgress.mode !== defaultProgress.mode

        if (hasCloudProgress) {
          skipNextCloudSave.current = true
          setProgress({ ...progress, ...cloudProgress })
          setIsCloudReady(true)
          setSyncStatus('saved')
          return
        }

        setSyncStatus('saving')
        return saveCloudProgress(client, userId, progress).then(() => {
          if (isMounted) setIsCloudReady(true)
          if (isMounted) setSyncStatus('saved')
        })
      })
      .then(() => {
        if (!isMounted) return
        setIsCloudReady(true)
        setSyncStatus('saved')
      })
      .catch((error: Error) => {
        if (!isMounted) return
        setSyncStatus('error')
        setAuthError(error.message)
      })

    return () => {
      isMounted = false
    }
    // Load once when a user signs in. Progress changes are handled by the save effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])

  useEffect(() => {
    if (!supabase || !session?.user.id || !isCloudReady) return
    const client = supabase
    const userId = session.user.id

    if (skipNextCloudSave.current) {
      skipNextCloudSave.current = false
      return
    }

    const timeout = window.setTimeout(() => {
      setSyncStatus('saving')
      saveCloudProgress(client, userId, progress)
        .then(() => setSyncStatus('saved'))
        .catch((error: Error) => {
          setSyncStatus('error')
          setAuthError(error.message)
        })
    }, 650)

    return () => window.clearTimeout(timeout)
  }, [isCloudReady, progress, session?.user.id])

  useEffect(() => {
    if (!quizState || !['buzz', 'answer'].includes(quizState.phase)) return

    const timer = window.setTimeout(() => {
      setQuizState((current) => {
        if (!current || !['buzz', 'answer'].includes(current.phase)) return current
        if (current.secondsLeft > 1) return { ...current, secondsLeft: current.secondsLeft - 1 }
        if (current.phase === 'buzz') {
          return { ...current, secondsLeft: 0, phase: 'scored', noResponses: current.noResponses + 1 }
        }
        return {
          ...current,
          secondsLeft: 0,
          phase: 'scored',
          score: current.score - current.questions[current.currentIndex].pointValue / 2,
          incorrect: current.incorrect + 1,
        }
      })
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [quizState])

  function updateProgress(updater: (current: StoredProgress) => StoredProgress) {
    setProgress((current) => updater(current))
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return

    setAuthError(null)
    setAuthNotice(null)
    setSyncStatus('loading')

    const { data, error } =
      authMode === 'sign-in'
        ? await supabase.auth.signInWithPassword({
            email: authEmail,
            password: authPassword,
          })
        : await supabase.auth.signUp({
            email: authEmail,
            password: authPassword,
          })

    if (error) {
      setSyncStatus(session ? 'error' : 'local')
      setAuthError(error.message)
      return
    }

    if (authMode === 'sign-up' && !data.session) {
      setSyncStatus('local')
      setAuthNotice('Check your email to confirm the account, then sign in here.')
    }
  }

  async function signOut() {
    if (!supabase) return
    const { error } = await supabase.auth.signOut()
    if (error) {
      setSyncStatus('error')
      setAuthError(error.message)
      return
    }
    setSession(null)
    setIsCloudReady(false)
    setSyncStatus('local')
  }

  async function importLocalProgress() {
    if (!supabase || !session?.user.id) return
    setAuthError(null)
    setSyncStatus('saving')
    try {
      await saveCloudProgress(supabase, session.user.id, progress)
      setIsCloudReady(true)
      setSyncStatus('saved')
    } catch (error) {
      setSyncStatus('error')
      setAuthError(error instanceof Error ? error.message : 'Could not import local progress.')
    }
  }

  function selectChapter(chapter: number) {
    const nextChapterVerses = actsKjv.filter((verse) => verse.chapter === chapter)
    updateProgress((current) => ({ ...current, selectedChapter: chapter }))
    setLearnIndex(0)
    setLearnHistory([])
    setLearnQueue([])
    setQueue([])
    setActiveVerseId(
      mode === 'learn' && learnOrder === 'sequential'
        ? null
        : (shuffle(nextChapterVerses)[0]?.id ?? null),
    )
    setIsRevealed(false)
    setLearnStage('read')
    setReferenceGuess('')
    setQuizState(mode === 'quiz' ? createQuizState(nextChapterVerses) : null)
  }

  function selectMode(nextMode: StudyMode) {
    updateProgress((current) => ({ ...current, mode: nextMode }))
    setLearnIndex(0)
    setLearnHistory([])
    setLearnQueue([])
    setQueue([])
    setActiveVerseId(
      nextMode === 'learn' && learnOrder === 'sequential'
        ? null
        : (buildQueue(nextMode)[0] ?? null),
    )
    setIsRevealed(false)
    setLearnStage('read')
    setReferenceGuess('')
    setQuizState(nextMode === 'quiz' ? createQuizState(chapterVerses) : null)
  }

  function selectLearnOrder(nextOrder: LearnOrder) {
    if (nextOrder === learnOrder) return
    const currentVerse = activeVerse ?? chapterVerses[learnIndex] ?? chapterVerses[0]
    setLearnOrder(nextOrder)
    setLearnQueue([])
    if (nextOrder === 'random') {
      setActiveVerseId(currentVerse?.id ?? null)
      return
    }
    setLearnIndex(Math.max(0, chapterVerses.findIndex((verse) => verse.id === currentVerse?.id)))
    setActiveVerseId(null)
  }

  function buildQueue(targetMode = mode) {
    if (targetMode === 'review') {
      return shuffle(
        [...chapterVerses].sort((a, b) => {
          const aProgress = getVerseProgress(progress, a.id)
          const bProgress = getVerseProgress(progress, b.id)
          return aProgress.confidence - bProgress.confidence
        }),
      ).map((verse) => verse.id)
    }

    return shuffle(chapterVerses).map((verse) => verse.id)
  }

  function pickNextVerse(preferredQueue = queue) {
    const nextQueue = preferredQueue.length > 0 ? [...preferredQueue] : buildQueue()
    const [nextVerseId, ...remaining] = nextQueue
    setQueue(remaining)
    setActiveVerseId(nextVerseId ?? chapterVerses[0]?.id ?? null)
    setIsRevealed(false)
    setLearnStage('read')
    setReferenceGuess('')
  }

  function pickNextLearnVerse(preferredQueue = learnQueue) {
    const remainingQueue =
      preferredQueue.length > 0
        ? [...preferredQueue]
        : shuffle(chapterVerses.filter((verse) => verse.id !== activeVerseId)).map(
            (verse) => verse.id,
          )
    const [nextVerseId, ...rest] = remainingQueue
    if (activeVerseId) {
      setLearnHistory((current) => [...current.slice(-24), activeVerseId])
    }
    setLearnQueue(rest)
    setActiveVerseId(nextVerseId ?? chapterVerses[0]?.id ?? null)
    setIsRevealed(false)
    setLearnStage('read')
  }

  function goToLearnVerse(verseId: string) {
    const targetIndex = chapterVerses.findIndex((verse) => verse.id === verseId)
    if (targetIndex < 0) return
    if (learnOrder === 'random' && activeVerseId && activeVerseId !== verseId) {
      setLearnHistory((current) => [...current.slice(-24), activeVerseId])
    }
    if (learnOrder === 'random') {
      setActiveVerseId(verseId)
    } else {
      setLearnIndex(targetIndex)
    }
    setIsRevealed(false)
    setLearnStage('read')
  }

  function goToPreviousLearnVerse() {
    if (learnOrder === 'random') {
      const previousVerseId = learnHistory[learnHistory.length - 1]
      if (!previousVerseId) return
      setLearnHistory((current) => current.slice(0, -1))
      setActiveVerseId(previousVerseId)
      setIsRevealed(false)
      setLearnStage('read')
      return
    }
    setLearnIndex((index) => Math.max(0, index - 1))
    setIsRevealed(false)
    setLearnStage('read')
  }

  function gradeVerse(verseId: string, grade: Grade) {
    const gradeConfig = grades.find((item) => item.grade === grade)
    if (!gradeConfig) return

    updateProgress((current) => {
      const currentVerse = getVerseProgress(current, verseId)
      const nextConfidence = Math.max(
        0,
        Math.min(7, currentVerse.confidence + gradeConfig.confidenceDelta),
      )
      return {
        ...current,
        verses: {
          ...current.verses,
          [verseId]: {
            confidence: nextConfidence,
            attempts: currentVerse.attempts + 1,
            correct: currentVerse.correct + (gradeConfig.correct ? 1 : 0),
            streak: gradeConfig.correct ? currentVerse.streak + 1 : 0,
            lastReviewed: new Date().toISOString(),
            history: [...currentVerse.history.slice(-19), { grade, at: new Date().toISOString() }],
          },
        },
      }
    })

    if (mode === 'learn') {
      if (learnOrder === 'random') {
        pickNextLearnVerse()
      } else {
        setLearnIndex((index) => Math.min(index + 1, chapterVerses.length - 1))
      }
      setIsRevealed(false)
      setLearnStage('read')
      return
    }

    pickNextVerse()
  }

  function resetChapter() {
    const chapterIds = new Set(chapterVerses.map((verse) => verse.id))
    updateProgress((current) => ({
      ...current,
      verses: Object.fromEntries(
        Object.entries(current.verses).filter(([verseId]) => !chapterIds.has(verseId)),
      ),
    }))
  }

  function startBestReview() {
    selectMode('review')
    setQueue([nextReviewVerseId])
    setActiveVerseId(nextReviewVerseId)
    setIsRevealed(false)
  }

  function restartQuizRound() {
    setQuizState(createQuizState(chapterVerses))
  }

  function startQuizQuestion() {
    setQuizState((current) =>
      current ? { ...current, phase: 'buzz', secondsLeft: 5 } : createQuizState(chapterVerses),
    )
  }

  function buzzIn() {
    setQuizState((current) =>
      current ? { ...current, phase: 'answer', secondsLeft: 30 } : current,
    )
  }

  function revealQuizAnswer() {
    setQuizState((current) => (current ? { ...current, phase: 'review' } : current))
  }

  function scoreQuizQuestion(isCorrect: boolean) {
    setQuizState((current) => {
      if (!current) return current
      const question = current.questions[current.currentIndex]
      const nextCorrect = current.correct + (isCorrect ? 1 : 0)
      const quizOutBonus = isCorrect && nextCorrect === 5 ? 20 : 0
      return {
        ...current,
        phase: 'scored',
        score:
          current.score + (isCorrect ? question.pointValue + quizOutBonus : -question.pointValue / 2),
        correct: nextCorrect,
        incorrect: current.incorrect + (isCorrect ? 0 : 1),
      }
    })
  }

  function nextQuizQuestion() {
    setQuizState((current) => {
      if (!current) return current
      const nextIndex = current.currentIndex + 1
      if (nextIndex >= current.questions.length) {
        return { ...current, phase: 'complete' }
      }
      return { ...current, currentIndex: nextIndex, phase: 'ready', secondsLeft: 5 }
    })
  }

  const activeProgress = activeVerse ? getVerseProgress(progress, activeVerse.id) : null
  const referenceMatches =
    activeVerse && normalizeReference(referenceGuess) === normalizeReference(activeVerse.reference)

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Study controls">
        <div className="brand-block">
          <span className="eyebrow">Acts 1-9 KJV</span>
          <h1>Bible Quiz Trainer</h1>
        </div>

        <AccountPanel
          isConfigured={isSupabaseConfigured}
          email={session?.user.email ?? null}
          authEmail={authEmail}
          authPassword={authPassword}
          authMode={authMode}
          syncStatus={syncStatus}
          error={authError}
          notice={authNotice}
          onAuthEmailChange={setAuthEmail}
          onAuthPasswordChange={setAuthPassword}
          onAuthModeChange={setAuthMode}
          onSubmit={submitAuth}
          onSignOut={signOut}
          onImport={importLocalProgress}
        />

        <section className="control-group guide-card" aria-labelledby="start-heading">
          <h2 id="start-heading">Start Here</h2>
          <ol>
            <li>Choose the chapter you are learning.</li>
            <li>Stay in Learn until every verse feels familiar.</li>
            <li>Use Reference Recall to answer from the reference.</li>
            <li>Use Quiz Prep for a timed 20-question round.</li>
          </ol>
        </section>

        <section className="control-group" aria-labelledby="chapter-heading">
          <h2 id="chapter-heading">Chapter</h2>
          <div className="chapter-grid">
            {chapters.map((chapter) => (
              <button
                type="button"
                className={chapter === selectedChapter ? 'selected' : ''}
                onClick={() => selectChapter(chapter)}
                key={chapter}
              >
                {chapter}
              </button>
            ))}
          </div>
        </section>

        <section className="control-group" aria-labelledby="mode-heading">
          <h2 id="mode-heading">Mode</h2>
          <div className="mode-list">
            {[
              ['learn', 'Learn the verse'],
              ['reference', 'Reference recall'],
              ['verse', 'Find the reference'],
              ['review', 'Review weak verses'],
              ['quiz', 'Quiz prep round'],
            ].map(([value, label]) => (
              <button
                type="button"
                className={mode === value ? 'selected' : ''}
                onClick={() => selectMode(value as StudyMode)}
                key={value}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="control-group">
          <h2>Quick Stats</h2>
          <dl className="stats-list">
            <div>
              <dt>Verses</dt>
              <dd>{chapterVerseCounts[selectedChapter]}</dd>
            </div>
            <div>
              <dt>Mastered</dt>
              <dd>{dashboard.find((item) => item.chapter === selectedChapter)?.mastered ?? 0}</dd>
            </div>
            <div>
              <dt>Weak</dt>
              <dd>{dashboard.find((item) => item.chapter === selectedChapter)?.weak ?? 0}</dd>
            </div>
          </dl>
          <button type="button" className="secondary full-width" onClick={resetChapter}>
            Reset Chapter
          </button>
        </section>
      </aside>

      <section className="study-area" aria-live="polite">
        {mode === 'quiz' && (
          <QuizPrepCard
            state={quizState ?? createQuizState(chapterVerses)}
            onStart={startQuizQuestion}
            onBuzz={buzzIn}
            onReveal={revealQuizAnswer}
            onScore={scoreQuizQuestion}
            onNext={nextQuizQuestion}
            onRestart={restartQuizRound}
          />
        )}

        {mode !== 'quiz' && activeVerse && (
          <article className="drill-panel">
            <div className="panel-topline">
              <span>{modeLabel(mode)}</span>
              <span>
                Confidence {activeProgress?.confidence ?? 0}/7
                {activeProgress ? ` · Streak ${activeProgress.streak}` : ''}
              </span>
            </div>
            {mode === 'learn' && (
              <LearnCard
                verse={activeVerse}
                index={
                  learnOrder === 'random'
                    ? chapterVerses.findIndex((verse) => verse.id === activeVerse.id)
                    : learnIndex
                }
                total={chapterVerses.length}
                isRevealed={isRevealed}
                order={learnOrder}
                verses={chapterVerses}
                canGoPrevious={learnOrder === 'sequential' ? learnIndex > 0 : learnHistory.length > 0}
                stage={learnStage}
                onStageChange={setLearnStage}
                onOrderChange={selectLearnOrder}
                onSelectVerse={goToLearnVerse}
                onReveal={() => setIsRevealed(true)}
                onPrevious={goToPreviousLearnVerse}
                onNext={() => {
                  if (learnOrder === 'random') {
                    pickNextLearnVerse()
                  } else {
                    setLearnIndex((index) => Math.min(chapterVerses.length - 1, index + 1))
                  }
                  setIsRevealed(false)
                  setLearnStage('read')
                }}
              />
            )}

            {mode === 'reference' && (
              <ReferenceRecallCard
                verse={activeVerse}
                isRevealed={isRevealed}
                onReveal={() => setIsRevealed(true)}
                onSkip={() => pickNextVerse()}
              />
            )}

            {mode === 'verse' && (
              <VerseReferenceCard
                verse={activeVerse}
                guess={referenceGuess}
                isRevealed={isRevealed}
                isMatch={referenceMatches}
                onGuess={setReferenceGuess}
                onReveal={() => setIsRevealed(true)}
                onSkip={() => pickNextVerse()}
              />
            )}

            {mode === 'review' && (
              <ReviewCard
                verse={activeVerse}
                isRevealed={isRevealed}
                onReveal={() => setIsRevealed(true)}
                onSkip={() => pickNextVerse()}
              />
            )}

            {((mode === 'learn' && learnStage === 'recite' && isRevealed) ||
              (mode !== 'learn' && isRevealed)) && (
              <GradeControls onGrade={(grade) => gradeVerse(activeVerse.id, grade)} />
            )}
          </article>
        )}

        <ChapterProgress dashboard={dashboard} onReview={startBestReview} />
      </section>
    </main>
  )
}

function AccountPanel({
  isConfigured,
  email,
  authEmail,
  authPassword,
  authMode,
  syncStatus,
  error,
  notice,
  onAuthEmailChange,
  onAuthPasswordChange,
  onAuthModeChange,
  onSubmit,
  onSignOut,
  onImport,
}: {
  isConfigured: boolean
  email: string | null
  authEmail: string
  authPassword: string
  authMode: 'sign-in' | 'sign-up'
  syncStatus: SyncStatus
  error: string | null
  notice: string | null
  onAuthEmailChange: (value: string) => void
  onAuthPasswordChange: (value: string) => void
  onAuthModeChange: (value: 'sign-in' | 'sign-up') => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSignOut: () => void
  onImport: () => void
}) {
  return (
    <section className="control-group account-panel" aria-labelledby="account-heading">
      <div className="account-heading-row">
        <h2 id="account-heading">Account</h2>
        <span className={`sync-pill ${syncStatus}`}>{syncLabel(syncStatus)}</span>
      </div>

      {!isConfigured && (
        <p className="account-note">
          Local progress is enabled. Add Supabase environment variables to turn on multi-device
          sync.
        </p>
      )}

      {isConfigured && email && (
        <>
          <p className="account-note">
            Signed in as <strong>{email}</strong>
          </p>
          <div className="account-actions">
            <button type="button" className="secondary" onClick={onImport}>
              Save This Browser
            </button>
            <button type="button" className="secondary" onClick={onSignOut}>
              Sign Out
            </button>
          </div>
        </>
      )}

      {isConfigured && !email && (
        <form className="auth-form" onSubmit={onSubmit}>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={authEmail}
              onChange={(event) => onAuthEmailChange(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            <span>Password</span>
            <input
              type="password"
              value={authPassword}
              onChange={(event) => onAuthPasswordChange(event.target.value)}
              autoComplete={authMode === 'sign-in' ? 'current-password' : 'new-password'}
              minLength={6}
              required
            />
          </label>
          <button type="submit" className="primary full-width">
            {authMode === 'sign-in' ? 'Sign In' : 'Create Account'}
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => onAuthModeChange(authMode === 'sign-in' ? 'sign-up' : 'sign-in')}
          >
            {authMode === 'sign-in' ? 'Create a new account' : 'Use an existing account'}
          </button>
        </form>
      )}

      {error && <p className="account-error">{error}</p>}
      {notice && <p className="account-notice">{notice}</p>}
    </section>
  )
}

function syncLabel(status: SyncStatus) {
  if (status === 'loading') return 'Loading'
  if (status === 'saving') return 'Saving'
  if (status === 'saved') return 'Saved'
  if (status === 'error') return 'Check Sync'
  return 'Local'
}

function modeLabel(mode: StudyMode) {
  if (mode === 'learn') return 'Learn Mode'
  if (mode === 'reference') return 'Reference Recall'
  if (mode === 'verse') return 'Verse to Reference'
  if (mode === 'quiz') return 'Quiz Prep'
  return 'Chapter Review'
}

function ChapterProgress({
  dashboard,
  onReview,
}: {
  dashboard: Array<{
    chapter: number
    total: number
    mastered: number
    learning: number
    weak: number
    percent: number
  }>
  onReview: () => void
}) {
  return (
    <section className="dashboard" aria-label="Chapter progress">
      <div>
        <h2>Chapter progress</h2>
        <p className="section-help">
          Begin with Learn, then let Review Next pull the verse that needs the most attention.
        </p>
      </div>
      <button type="button" className="primary" onClick={onReview}>
        Review Next
      </button>
      <div className="progress-grid">
        {dashboard.map((item) => (
          <div className="progress-card" key={item.chapter}>
            <div className="progress-card-header">
              <strong>Acts {item.chapter}</strong>
              <span>{item.percent}%</span>
            </div>
            <div className="progress-track" aria-hidden="true">
              <span style={{ width: `${item.percent}%` }} />
            </div>
            <p>
              {item.mastered} mastered · {item.learning} learning · {item.weak} weak
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function QuizPrepCard({
  state,
  onStart,
  onBuzz,
  onReveal,
  onScore,
  onNext,
  onRestart,
}: {
  state: QuizState
  onStart: () => void
  onBuzz: () => void
  onReveal: () => void
  onScore: (isCorrect: boolean) => void
  onNext: () => void
  onRestart: () => void
}) {
  const question = state.questions[state.currentIndex]
  const isOut = state.correct >= 5 || state.incorrect >= 3
  const statusText =
    state.correct >= 5
      ? 'Quizzed out forward: five correct, plus 20 bonus points in a real match.'
      : state.incorrect >= 3
        ? 'Quizzed out backward: three incorrect in a real match.'
        : 'Rulebook rhythm: 5 seconds to buzz, then 30 seconds to answer.'

  return (
    <article className="drill-panel quiz-panel">
      <div className="panel-topline">
        <span>Quiz Prep</span>
        <span>
          Question {Math.min(state.currentIndex + 1, state.questions.length)} of{' '}
          {state.questions.length}
        </span>
      </div>

      <div className="quiz-scoreboard">
        <div>
          <span>Score</span>
          <strong>{state.score}</strong>
        </div>
        <div>
          <span>Correct</span>
          <strong>{state.correct}/5</strong>
        </div>
        <div>
          <span>Incorrect</span>
          <strong>{state.incorrect}/3</strong>
        </div>
        <div>
          <span>No Response</span>
          <strong>{state.noResponses}</strong>
        </div>
      </div>

      <p className={isOut ? 'quiz-status warning' : 'quiz-status'}>{statusText}</p>

      {state.phase !== 'complete' ? (
        <>
          <div className="quiz-question">
            <span>{question.pointValue} points · {quizTypeLabel(question.type)}</span>
            <p>{question.prompt}</p>
          </div>

          {state.phase === 'ready' && (
            <div className="action-row">
              <button type="button" className="primary" onClick={onStart}>
                Read Question
              </button>
              <button type="button" className="secondary" onClick={onRestart}>
                New Round
              </button>
            </div>
          )}

          {state.phase === 'buzz' && (
            <>
              <TimerBar secondsLeft={state.secondsLeft} total={5} label="Buzz window" />
              <div className="action-row">
                <button type="button" className="primary" onClick={onBuzz}>
                  Buzz In
                </button>
              </div>
            </>
          )}

          {state.phase === 'answer' && (
            <>
              <TimerBar secondsLeft={state.secondsLeft} total={30} label="Answer window" />
              <p className="recall-instruction">
                Give the completion and answer aloud. For quotation questions, use perfect wording.
              </p>
              <div className="action-row">
                <button type="button" className="primary" onClick={onReveal}>
                  Reveal Answer
                </button>
              </div>
            </>
          )}

          {(state.phase === 'review' || state.phase === 'scored') && (
            <>
              <div className="answer-key">
                <span>Expected answer</span>
                <p>{question.expected}</p>
                {question.type !== 'reference' && <small>{question.verse.reference}</small>}
              </div>
              <div className="action-row">
                {state.phase === 'review' && (
                  <>
                    <button type="button" className="primary" onClick={() => onScore(true)}>
                      Mark Correct
                    </button>
                    <button type="button" className="secondary" onClick={() => onScore(false)}>
                      Mark Incorrect
                    </button>
                  </>
                )}
                <button type="button" className="secondary" onClick={onNext}>
                  Next Question
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="quiz-complete">
          <strong>Round complete</strong>
          <p>
            Final score: {state.score}. Correct: {state.correct}. Incorrect: {state.incorrect}. No
            response: {state.noResponses}.
          </p>
          <button type="button" className="primary" onClick={onRestart}>
            Start New Round
          </button>
        </div>
      )}
    </article>
  )
}

function quizTypeLabel(type: QuizQuestionType) {
  if (type === 'quotation') return 'Quotation Question'
  if (type === 'completion') return 'Quotation Completion'
  return 'Complete Reference'
}

function TimerBar({
  secondsLeft,
  total,
  label,
}: {
  secondsLeft: number
  total: number
  label: string
}) {
  return (
    <div className="timer-block">
      <div>
        <span>{label}</span>
        <strong>{secondsLeft}s</strong>
      </div>
      <div className="timer-track" aria-hidden="true">
        <span style={{ width: `${Math.max(0, (secondsLeft / total) * 100)}%` }} />
      </div>
    </div>
  )
}

function LearnCard({
  verse,
  index,
  total,
  isRevealed,
  order,
  verses,
  canGoPrevious,
  stage,
  onStageChange,
  onOrderChange,
  onSelectVerse,
  onReveal,
  onPrevious,
  onNext,
}: {
  verse: ScriptureVerse
  index: number
  total: number
  isRevealed: boolean
  order: LearnOrder
  verses: ScriptureVerse[]
  canGoPrevious: boolean
  stage: LearnStage
  onStageChange: (stage: LearnStage) => void
  onOrderChange: (order: LearnOrder) => void
  onSelectVerse: (verseId: string) => void
  onReveal: () => void
  onPrevious: () => void
  onNext: () => void
}) {
  return (
    <>
      <div className="prompt-row">
        <span className="prompt-label">Learn verse {index + 1} of {total}</span>
        <strong className="reference">{verse.reference}</strong>
      </div>
      <div className="learn-guide">
        <p>
          Work left to right: read the verse several times, remove supports, recite it aloud from
          the reference, then reveal and grade your recall.
        </p>
        <div className="learn-order" aria-label="Learning order">
          <span>Verse order</span>
          <div>
            <button
              type="button"
              className={order === 'sequential' ? 'selected' : ''}
              onClick={() => onOrderChange('sequential')}
            >
              In Order
            </button>
            <button
              type="button"
              className={order === 'random' ? 'selected' : ''}
              onClick={() => onOrderChange('random')}
            >
              Random
            </button>
          </div>
        </div>
        <div className="stage-row" aria-label="Learning steps">
          {learnStages.map((item) => (
            <button
              type="button"
              className={stage === item.stage ? 'selected' : ''}
              onClick={() => onStageChange(item.stage)}
              key={item.stage}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="verse-navigator" aria-label="Jump to a verse in this chapter">
        <div>
          <span>Jump to verse</span>
          <strong>{verse.reference}</strong>
        </div>
        <div className="verse-jump-grid">
          {verses.map((item) => (
            <button
              type="button"
              className={item.id === verse.id ? 'selected' : ''}
              onClick={() => onSelectVerse(item.id)}
              key={item.id}
              title={item.reference}
            >
              {item.verse}
            </button>
          ))}
        </div>
      </div>
      <MemorizationText verse={verse} stage={stage} isRevealed={isRevealed} />
      <div className="action-row">
        <button
          type="button"
          className="secondary"
          onClick={onPrevious}
          disabled={!canGoPrevious}
        >
          Previous
        </button>
        {stage !== 'recite' ? (
          <button
            type="button"
            className="primary"
            onClick={() => onStageChange(nextLearnStage(stage))}
          >
            Next Step
          </button>
        ) : (
          <button type="button" className="primary" onClick={onReveal}>
            Reveal and Grade
          </button>
        )}
        <button
          type="button"
          className="secondary"
          onClick={onNext}
          disabled={order === 'sequential' && index === total - 1}
        >
          {order === 'random' ? 'Shuffle Next' : 'Next'}
        </button>
      </div>
    </>
  )
}

function nextLearnStage(stage: LearnStage): LearnStage {
  if (stage === 'read') return 'hide'
  if (stage === 'hide') return 'letters'
  return 'recite'
}

function MemorizationText({
  verse,
  stage,
  isRevealed,
}: {
  verse: ScriptureVerse
  stage: LearnStage
  isRevealed: boolean
}) {
  if (stage === 'read' || isRevealed) {
    return <p className="scripture-text visible">{verse.text}</p>
  }

  if (stage === 'hide') {
    return (
      <p className="scripture-text visible study-prompt">
        {verse.text.split(/(\s+)/).map((part, index) => {
          if (/^\s+$/.test(part)) return part
          return index % 4 === 0 ? <span className="word-blank" key={`${part}-${index}`} /> : part
        })}
      </p>
    )
  }

  if (stage === 'letters') {
    return (
      <p className="scripture-text visible study-prompt">
        {verse.text.split(/\s+/).map((word, index) => (
          <span className="first-letter" key={`${word}-${index}`}>
            {word[0]}
          </span>
        ))}
      </p>
    )
  }

  return (
    <div className="recite-card">
      <strong>{verse.reference}</strong>
      <p>Look away from the text and recite the whole verse aloud from this reference.</p>
    </div>
  )
}

function ReferenceRecallCard({
  verse,
  isRevealed,
  onReveal,
  onSkip,
}: {
  verse: ScriptureVerse
  isRevealed: boolean
  onReveal: () => void
  onSkip: () => void
}) {
  return (
    <>
      <div className="prompt-row centered">
        <span className="prompt-label">Recall this verse</span>
        <strong className="reference large">{verse.reference}</strong>
      </div>
      <VerseText verse={verse} isVisible={isRevealed} />
      <div className="action-row">
        <button type="button" className="primary" onClick={onReveal}>
          Reveal Verse
        </button>
        <button type="button" className="secondary" onClick={onSkip}>
          Skip
        </button>
      </div>
    </>
  )
}

function VerseReferenceCard({
  verse,
  guess,
  isRevealed,
  isMatch,
  onGuess,
  onReveal,
  onSkip,
}: {
  verse: ScriptureVerse
  guess: string
  isRevealed: boolean
  isMatch: boolean
  onGuess: (value: string) => void
  onReveal: () => void
  onSkip: () => void
}) {
  return (
    <>
      <p className="scripture-text visible">{verse.text}</p>
      <label className="answer-field">
        <span>Reference</span>
        <input
          value={guess}
          onChange={(event) => onGuess(event.target.value)}
          placeholder="Acts 2:38"
          autoComplete="off"
        />
      </label>
      {guess && !isRevealed && (
        <p className={isMatch ? 'answer-status correct' : 'answer-status'}>
          {isMatch ? 'Match' : 'Keep checking the reference'}
        </p>
      )}
      {isRevealed && <strong className="reference revealed-reference">{verse.reference}</strong>}
      <div className="action-row">
        <button type="button" className="primary" onClick={onReveal}>
          Reveal Reference
        </button>
        <button type="button" className="secondary" onClick={onSkip}>
          Skip
        </button>
      </div>
    </>
  )
}

function ReviewCard({
  verse,
  isRevealed,
  onReveal,
  onSkip,
}: {
  verse: ScriptureVerse
  isRevealed: boolean
  onReveal: () => void
  onSkip: () => void
}) {
  return (
    <>
      <div className="prompt-row centered">
        <span className="prompt-label">Priority review</span>
        <strong className="reference large">{verse.reference}</strong>
      </div>
      <VerseText verse={verse} isVisible={isRevealed} />
      <div className="action-row">
        <button type="button" className="primary" onClick={onReveal}>
          Reveal Verse
        </button>
        <button type="button" className="secondary" onClick={onSkip}>
          Skip
        </button>
      </div>
    </>
  )
}

function VerseText({ verse, isVisible }: { verse: ScriptureVerse; isVisible: boolean }) {
  return (
    <p className={isVisible ? 'scripture-text visible' : 'scripture-text hidden'}>
      {isVisible ? verse.text : 'Say the verse aloud, then reveal it when you are ready.'}
    </p>
  )
}

function GradeControls({ onGrade }: { onGrade: (grade: Grade) => void }) {
  return (
    <div className="grade-row" aria-label="Grade recall">
      {grades.map((item) => (
        <button type="button" key={item.grade} onClick={() => onGrade(item.grade)}>
          {item.label}
        </button>
      ))}
    </div>
  )
}

export default App
