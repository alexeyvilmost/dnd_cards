/** A compact faceted d20 that presents an already committed result. It never
 * generates randomness; the in-place tumble is presentation only. */
export default function CommittedD20({value, rolling, discarded = false}: {
  value: number;
  rolling: boolean;
  discarded?: boolean;
}) {
  return <div className={`committed-die${rolling ? ' is-rolling' : ''}${discarded ? ' is-discarded' : ''}`}
    role="img" aria-label={rolling ? 'Бросок к20' : `к20: ${value}${discarded ? ' — отброшено' : ''}`}>
    <div className="committed-die-tumble" aria-hidden="true">
      <svg className="committed-die-solid" viewBox="0 0 100 100">
        <path className="committed-die-shell" d="M50 3 91 24 96 66 70 94 30 94 4 66 9 24Z" />
        <path className="committed-die-facet is-top" d="M9 24 50 3 70 28 50 40Z" />
        <path className="committed-die-facet is-left" d="M9 24 50 40 30 94 4 66Z" />
        <path className="committed-die-facet is-right" d="M91 24 96 66 70 94 50 40 70 28Z" />
        <path className="committed-die-facet is-bottom" d="M30 94 50 40 70 94Z" />
        <path className="committed-die-lines" d="M9 24 70 28 96 66M4 66 50 40 91 24M30 94 9 24M70 94 91 24M50 3 50 40" />
        <circle cx="50" cy="47" r="19" />
        <text x="50" y="55" textAnchor="middle">{value}</text>
      </svg>
    </div>
  </div>;
}
