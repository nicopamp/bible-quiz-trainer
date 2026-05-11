import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { actsKjv, chapterVerseCounts, type ScriptureVerse } from './data/actsKjv'

type StudyMode = 'learn' | 'reference' | 'verse' | 'review'
type Grade = 'again' | 'hard' | 'good' | 'easy'
type LearnStage = 'read' | 'hide' | 'letters' | 'recite'
type LearnOrder = 'sequential' | 'random'

type VerseProgress = {
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

type StoredProgress = {
  selectedChapter: number
  mode: StudyMode
  verses: Record<string, VerseProgress>
}

const STORAGE_KEY = 'bible-quiz-acts-kjv-progress-v1'
const bibleGatewayKjvUrl = 'https://www.biblegateway.com/versions/King-James-Version-KJV-Bible/'
const chapters = Array.from({ length: 9 }, (_, index) => index + 1)
const learnStages: Array<{ stage: LearnStage; label: string }> = [
  { stage: 'read', label: 'Read' },
  { stage: 'hide', label: 'Hide Words' },
  { stage: 'letters', label: 'First Letters' },
  { stage: 'recite', label: 'Recite' },
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

function bibleGatewayPassageUrl(reference: string) {
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(reference)}&version=KJV`
}

function App() {
  const [progress, setProgress] = useState(loadProgress)
  const [learnIndex, setLearnIndex] = useState(0)
  const [learnOrder, setLearnOrder] = useState<LearnOrder>('sequential')
  const [learnQueue, setLearnQueue] = useState<string[]>([])
  const [queue, setQueue] = useState<string[]>([])
  const [activeVerseId, setActiveVerseId] = useState<string | null>(null)
  const [isRevealed, setIsRevealed] = useState(false)
  const [learnStage, setLearnStage] = useState<LearnStage>('read')
  const [referenceGuess, setReferenceGuess] = useState('')

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

  function updateProgress(updater: (current: StoredProgress) => StoredProgress) {
    setProgress((current) => updater(current))
  }

  function selectChapter(chapter: number) {
    const nextChapterVerses = actsKjv.filter((verse) => verse.chapter === chapter)
    updateProgress((current) => ({ ...current, selectedChapter: chapter }))
    setLearnIndex(0)
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
  }

  function selectMode(nextMode: StudyMode) {
    updateProgress((current) => ({ ...current, mode: nextMode }))
    setLearnIndex(0)
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
  }

  function selectLearnOrder(nextOrder: LearnOrder) {
    setLearnOrder(nextOrder)
    setLearnIndex(0)
    setLearnQueue([])
    setActiveVerseId(nextOrder === 'random' ? shuffle(chapterVerses)[0]?.id ?? null : null)
    setIsRevealed(false)
    setLearnStage('read')
    setReferenceGuess('')
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
    setLearnQueue(rest)
    setActiveVerseId(nextVerseId ?? chapterVerses[0]?.id ?? null)
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

  const activeProgress = activeVerse ? getVerseProgress(progress, activeVerse.id) : null
  const referenceMatches =
    activeVerse && normalizeReference(referenceGuess) === normalizeReference(activeVerse.reference)

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Study controls">
        <div className="brand-block">
          <span className="eyebrow">Acts 1-9 KJV</span>
          <h1>Bible Quiz Trainer</h1>
          <a className="source-link" href={bibleGatewayKjvUrl} target="_blank" rel="noreferrer">
            Bible Gateway KJV · Public Domain
          </a>
        </div>

        <section className="control-group guide-card" aria-labelledby="start-heading">
          <h2 id="start-heading">Start Here</h2>
          <ol>
            <li>Choose the chapter you are learning.</li>
            <li>Stay in Learn until every verse feels familiar.</li>
            <li>Use Reference Recall to answer from the reference.</li>
            <li>Use Review Next for weak or overdue verses.</li>
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
        <Dashboard dashboard={dashboard} onReview={startBestReview} />

        {activeVerse && (
          <article className="drill-panel">
            <div className="panel-topline">
              <span>{modeLabel(mode)}</span>
              <span>
                Confidence {activeProgress?.confidence ?? 0}/7
                {activeProgress ? ` · Streak ${activeProgress.streak}` : ''}
              </span>
            </div>
            <a
              className="passage-link"
              href={bibleGatewayPassageUrl(activeVerse.reference)}
              target="_blank"
              rel="noreferrer"
            >
              Open {activeVerse.reference} on Bible Gateway
            </a>

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
                stage={learnStage}
                onStageChange={setLearnStage}
                onOrderChange={selectLearnOrder}
                onReveal={() => setIsRevealed(true)}
                onPrevious={() => {
                  if (learnOrder === 'random') {
                    pickNextLearnVerse()
                  } else {
                    setLearnIndex((index) => Math.max(0, index - 1))
                  }
                  setIsRevealed(false)
                  setLearnStage('read')
                }}
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
      </section>
    </main>
  )
}

function modeLabel(mode: StudyMode) {
  if (mode === 'learn') return 'Learn Mode'
  if (mode === 'reference') return 'Reference Recall'
  if (mode === 'verse') return 'Verse to Reference'
  return 'Chapter Review'
}

function Dashboard({
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
        <span className="eyebrow">Dashboard</span>
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

function LearnCard({
  verse,
  index,
  total,
  isRevealed,
  order,
  stage,
  onStageChange,
  onOrderChange,
  onReveal,
  onPrevious,
  onNext,
}: {
  verse: ScriptureVerse
  index: number
  total: number
  isRevealed: boolean
  order: LearnOrder
  stage: LearnStage
  onStageChange: (stage: LearnStage) => void
  onOrderChange: (order: LearnOrder) => void
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
      <MemorizationText verse={verse} stage={stage} isRevealed={isRevealed} />
      <div className="action-row">
        <button
          type="button"
          className="secondary"
          onClick={onPrevious}
          disabled={order === 'sequential' && index === 0}
        >
          {order === 'random' ? 'Another Verse' : 'Previous'}
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
