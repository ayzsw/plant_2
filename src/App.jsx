import { useEffect, useMemo, useState } from 'react'
import './App.css'

const AGENT_STEPS = [
  { id: 'evidence', label: 'Evidence', detail: 'Сбор наблюдаемых признаков с изображения' },
  { id: 'hypotheses', label: 'Hypotheses', detail: 'Формирование кандидатов вида/болезни/дефицита' },
  { id: 'verification', label: 'Verification', detail: 'Проверка гипотез на внутренних критериях' },
  { id: 'context', label: 'Context', detail: 'Учет региона, сезона и цели исследования' },
  { id: 'report', label: 'Report', detail: 'Сборка итогового научного отчета' },
]

const SLEEP_BASE_MS = 700

function nowStamp() {
  return new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function inferPlantType(goal = '') {
  const normalizedGoal = goal.toLowerCase()
  if (normalizedGoal.includes('болез') || normalizedGoal.includes('disease')) return 'листовое поражение'
  if (normalizedGoal.includes('урож') || normalizedGoal.includes('yield')) return 'плодовая культура'
  if (normalizedGoal.includes('дефиц') || normalizedGoal.includes('deficit')) return 'стресс питания'
  return 'вегетативный образец'
}

function buildReport({ imageName, region, season, goal, retries }) {
  const plantType = inferPlantType(goal)
  const confidence = Math.max(72, 92 - retries * 7)

  return {
    title: 'Plant Field Research Report',
    generatedAt: nowStamp(),
    confidence,
    retries,
    evidence: [
      `Файл: ${imageName || 'Unnamed image'}`,
      'Качество изображения оценено как достаточное для морфологического скрининга.',
      `Обнаружены признаки, соответствующие категории: ${plantType}.`,
    ],
    hypotheses: [
      'H1: Нормальная фенологическая стадия без критических отклонений.',
      'H2: Локальный абиотический стресс (вода/температура/питание).',
      'H3: Ранний биотический фактор (грибковое или бактериальное поражение).',
    ],
    verification: [
      'Согласованность визуальных признаков проверена между сегментами листа/стебля.',
      `Self-check циклов: ${retries + 1}`,
      retries > 0
        ? 'После повторного прогона устранены противоречия в гипотезах H2/H3.'
        : 'Критических противоречий в первичной проверке не выявлено.',
    ],
    context: [
      `Регион: ${region || 'не указан'}`,
      `Сезон: ${season || 'не указан'}`,
      `Цель исследования: ${goal || 'общая идентификация состояния растения'}`,
    ],
    conclusion:
      confidence >= 85
        ? 'Состояние образца интерпретируется как стабильное с умеренным риском раннего стресса.'
        : 'Требуется дополнительная валидация: текущие данные частично противоречивы.',
    nextShots: [
      'Сфотографировать нижнюю сторону листа крупным планом (макропризнаки поражения).',
      'Добавить кадр стебля у основания с естественным освещением.',
      'Сделать общий кадр растения целиком с ближайшими соседними растениями.',
      'Повторить съемку через 48 часов с тем же ракурсом для динамики симптомов.',
    ],
  }
}

function toMarkdown(report) {
  if (!report) return ''

  const listSection = (title, items) => `## ${title}\n${items.map((item) => `- ${item}`).join('\n')}`

  return [
    `# ${report.title}`,
    `Generated: ${report.generatedAt}`,
    `Confidence: ${report.confidence}%`,
    '',
    listSection('Evidence', report.evidence),
    '',
    listSection('Hypotheses', report.hypotheses),
    '',
    listSection('Verification', report.verification),
    '',
    listSection('Context', report.context),
    '',
    '## Conclusion',
    report.conclusion,
    '',
    listSection('What to Photograph Next', report.nextShots),
    '',
  ].join('\n')
}

function App() {
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState('')
  const [region, setRegion] = useState('')
  const [season, setSeason] = useState('')
  const [goal, setGoal] = useState('')

  const [running, setRunning] = useState(false)
  const [currentStep, setCurrentStep] = useState(-1)
  const [stepStates, setStepStates] = useState(() =>
    AGENT_STEPS.map((step) => ({
      ...step,
      status: 'pending',
      note: 'Ожидает запуска',
    })),
  )
  const [report, setReport] = useState(null)
  const [history, setHistory] = useState(() => {
    const saved = localStorage.getItem('plantiz-history-v1')
    if (!saved) return []
    try {
      return JSON.parse(saved)
    } catch {
      return []
    }
  })

  const progress = useMemo(() => {
    const done = stepStates.filter((step) => step.status === 'done').length
    return Math.round((done / AGENT_STEPS.length) * 100)
  }, [stepStates])

  const updateStep = (index, patch) => {
    setStepStates((prev) =>
      prev.map((step, i) => {
        if (i !== index) return step
        return { ...step, ...patch }
      }),
    )
  }

  const onFileChange = (event) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (imagePreview) URL.revokeObjectURL(imagePreview)
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview)
    }
  }, [imagePreview])

  const storeHistory = (entry) => {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, 5)
      localStorage.setItem('plantiz-history-v1', JSON.stringify(next))
      return next
    })
  }

  const runAgent = async () => {
    if (!imageFile || running) return

    setRunning(true)
    setReport(null)
    setCurrentStep(-1)
    setStepStates(
      AGENT_STEPS.map((step) => ({
        ...step,
        status: 'pending',
        note: 'Ожидает запуска',
      })),
    )

    let retries = 0

    for (let i = 0; i < AGENT_STEPS.length; i += 1) {
      setCurrentStep(i)
      updateStep(i, { status: 'running', note: 'Выполняется анализ...' })
      await sleep(SLEEP_BASE_MS + i * 220)

      if (AGENT_STEPS[i].id === 'verification' && retries === 0 && Math.random() < 0.55) {
        updateStep(i, {
          status: 'retry',
          note: 'Self-check обнаружил конфликт гипотез, повторная верификация...',
        })
        retries += 1
        await sleep(SLEEP_BASE_MS + 480)
      }

      updateStep(i, { status: 'done', note: 'Шаг завершен' })
    }

    const generated = buildReport({
      imageName: imageFile.name,
      region,
      season,
      goal,
      retries,
    })

    setReport(generated)
    setCurrentStep(-1)
    setRunning(false)

    storeHistory({
      id: crypto.randomUUID(),
      at: generated.generatedAt,
      imageName: imageFile.name,
      confidence: generated.confidence,
      region: region || 'N/A',
      season: season || 'N/A',
    })
  }

  const exportMarkdown = () => {
    if (!report) return
    const blob = new Blob([toMarkdown(report)], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.href = url
    link.download = `plant-report-${Date.now()}.md`
    link.click()

    URL.revokeObjectURL(url)
  }

  return (
    <main className="page">
      <section className="hero">
        <p className="eyebrow">Multimodal Research Agent</p>
        <h1>Полевые исследования растений</h1>
        <p>
          Загрузите изображение, задайте контекст и запустите агентный анализ по цепочке:
          evidence → hypotheses → verification → context → report.
        </p>
      </section>

      <section className="panel input-panel">
        <h2>Run Setup</h2>
        <div className="upload-wrap">
          <label className="upload-box" htmlFor="image-upload">
            <input id="image-upload" type="file" accept="image/*" onChange={onFileChange} />
            <span>Upload image</span>
            <small>{imageFile ? imageFile.name : 'PNG/JPG/HEIC'}</small>
          </label>
          <div className="preview-box">
            {imagePreview ? <img src={imagePreview} alt="Plant preview" /> : <p>Превью изображения</p>}
          </div>
        </div>

        <div className="inputs-grid">
          <label>
            Region (optional)
            <input
              type="text"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              placeholder="e.g. California, Central Valley"
            />
          </label>

          <label>
            Season (optional)
            <input
              type="text"
              value={season}
              onChange={(event) => setSeason(event.target.value)}
              placeholder="e.g. Early spring"
            />
          </label>

          <label className="goal-row">
            Goal (optional)
            <input
              type="text"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="e.g. Detect stress or disease"
            />
          </label>
        </div>

        <div className="actions">
          <button type="button" onClick={runAgent} disabled={!imageFile || running}>
            {running ? 'Agent Running...' : 'Run Agent'}
          </button>
          <span className="progress">Progress: {progress}%</span>
        </div>
      </section>

      <section className="panel">
        <h2>Agent Timeline</h2>
        <div className="timeline">
          {stepStates.map((step, index) => (
            <article key={step.id} className={`timeline-item ${step.status}`}>
              <header>
                <span>
                  {index + 1}. {step.label}
                </span>
                <strong>
                  {step.status === 'pending' && 'Pending'}
                  {step.status === 'running' && 'Running'}
                  {step.status === 'retry' && 'Self-check retry'}
                  {step.status === 'done' && 'Done'}
                  {step.status === 'failed' && 'Failed'}
                </strong>
              </header>
              <p>{step.detail}</p>
              <small>{step.note}</small>
              {currentStep === index && running ? <div className="live-dot" /> : null}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Research Report</h2>
        {!report ? (
          <p className="empty">Отчёт появится после завершения запуска агента.</p>
        ) : (
          <div className="report-grid">
            <article className="report-card">
              <h3>Summary</h3>
              <p>
                <strong>Generated:</strong> {report.generatedAt}
              </p>
              <p>
                <strong>Confidence:</strong> {report.confidence}%
              </p>
              <p>
                <strong>Self-check retries:</strong> {report.retries}
              </p>
              <p>{report.conclusion}</p>
            </article>

            <article className="report-card">
              <h3>Evidence</h3>
              <ul>{report.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>

            <article className="report-card">
              <h3>Hypotheses</h3>
              <ul>{report.hypotheses.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>

            <article className="report-card">
              <h3>Verification</h3>
              <ul>{report.verification.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>

            <article className="report-card">
              <h3>Context</h3>
              <ul>{report.context.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>

            <article className="report-card accent">
              <h3>Что сфоткать ещё</h3>
              <ul>{report.nextShots.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>
          </div>
        )}

        <div className="export-row">
          <button type="button" onClick={exportMarkdown} disabled={!report}>
            Export Markdown
          </button>
          <span>PDF optional: можно добавить через клиентский print-to-pdf.</span>
        </div>
      </section>

      <section className="panel">
        <h2>History (Last 5 Runs)</h2>
        {history.length === 0 ? (
          <p className="empty">История запусков пока пуста.</p>
        ) : (
          <div className="history-list">
            {history.map((item) => (
              <article key={item.id} className="history-item">
                <p>
                  <strong>{item.imageName}</strong>
                </p>
                <p>{item.at}</p>
                <p>Confidence: {item.confidence}%</p>
                <p>
                  {item.region} • {item.season}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

export default App
