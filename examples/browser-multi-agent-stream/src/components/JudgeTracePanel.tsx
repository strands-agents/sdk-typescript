import type { JudgeTraceData } from '../lib/judgeTrace'

interface JudgeTracePanelProps {
  trace: JudgeTraceData
}

function formatScore(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(0)}`
}

export default function JudgeTracePanel({ trace }: JudgeTracePanelProps): JSX.Element {
  return (
    <div className="judge-trace-block">
      <p className="judge-trace-objective">{trace.objective}</p>

      <div className="judge-trace-stage">
        <div className="judge-trace-stage-header">
          <span className="judge-step">1</span>
          <strong>Builder Draft</strong>
        </div>
        <pre>{trace.candidateAnswer}</pre>
      </div>

      <div className="judge-trace-stage">
        <div className="judge-trace-stage-header">
          <span className="judge-step">2</span>
          <strong>Judge Critique</strong>
          <span className={`judge-verdict-badge verdict-${trace.review.verdict.toLowerCase()}`}>
            {trace.review.verdict}
          </span>
        </div>
        <div className="judge-score-row">
          <span>Overall: {formatScore(trace.review.overallScore)}</span>
          <span>Confidence: {formatScore(trace.confidence)}</span>
        </div>
        <table className="history-table compact judge-dimension-table">
          <thead>
            <tr>
              <th>Correctness</th>
              <th>Completeness</th>
              <th>Clarity</th>
              <th>Constraint</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{formatScore(trace.review.dimensionScores.correctness)}</td>
              <td>{formatScore(trace.review.dimensionScores.completeness)}</td>
              <td>{formatScore(trace.review.dimensionScores.clarity)}</td>
              <td>{formatScore(trace.review.dimensionScores.constraintCompliance)}</td>
            </tr>
          </tbody>
        </table>
        <p className="judge-rationale">{trace.review.rationale}</p>
        {trace.review.criticalIssues.length > 0 && (
          <>
            <h4 className="judge-subheading">Critical Issues</h4>
            <ul className="judge-list">
              {trace.review.criticalIssues.map((issue, i) => (
                <li key={`issue-${i}`}>{issue}</li>
              ))}
            </ul>
          </>
        )}
        {trace.review.recommendedEdits.length > 0 && (
          <>
            <h4 className="judge-subheading">Recommended Edits</h4>
            <ul className="judge-list">
              {trace.review.recommendedEdits.map((edit, i) => (
                <li key={`edit-${i}`}>{edit}</li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="judge-trace-stage">
        <div className="judge-trace-stage-header">
          <span className="judge-step">3</span>
          <strong>Revised Answer</strong>
        </div>
        <pre>{trace.revisedAnswer}</pre>
      </div>

      {trace.actionsTaken.length > 0 && (
        <div className="judge-actions">
          <h4 className="judge-subheading">Actions Taken</h4>
          <ul className="judge-list">
            {trace.actionsTaken.map((action, i) => (
              <li key={`action-${i}`}>{action}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
