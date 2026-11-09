import { useState } from 'react';
import { formatMoney, type Scenario } from '../domain/index';

export const scenarioColors = { promised: '#97a6a0', learned: '#237664', none: '#c1a174' };
export function shortDate(date: string) {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    new Date(date + 'T12:00:00Z'),
  );
}
export function CashChart({ scenarios, buffer }: { scenarios: Scenario[]; buffer: string }) {
  const [selected, setSelected] = useState(7);
  const values = scenarios.flatMap((s) => s.points.map((p) => Number(p.balance) / 1e6));
  const floor = Math.floor(Math.min(0, ...values) / 500) * 500;
  const ceiling = Math.ceil(Math.max(1000, ...values) / 500) * 500;
  const x = (index: number) => 62 + (index / 30) * 690;
  const y = (value: number) => 26 + ((ceiling - value) / (ceiling - floor)) * 225;
  const learned = scenarios.find((s) => s.id === 'learned')!;
  const ticks = Array.from({ length: 5 }, (_, i) => floor + ((ceiling - floor) / 4) * i);
  const path = (scenario: Scenario) =>
    scenario.points
      .map((point, i) => `${i ? 'L' : 'M'}${x(i)},${y(Number(point.balance) / 1e6)}`)
      .join(' ');
  return (
    <div className="cash-chart">
      <div className="chart-legend">
        {scenarios.map((s) => (
          <span key={s.id}>
            <i style={{ background: scenarioColors[s.id] }} />
            {s.label}
          </span>
        ))}
      </div>
      <div
        className="chart-viewport"
        tabIndex={0}
        aria-label="Cash forecast chart. Scroll horizontally on a small screen."
      >
        <svg
          viewBox="0 0 790 300"
          role="img"
          aria-label="Projected cash over the same 30 days. Learned dates are green, promised dates gray, no further income amber. A full data table is available below."
        >
          <defs>
            <clipPath id="plot">
              <rect x="62" y="10" width="690" height="245" />
            </clipPath>
          </defs>
          {ticks.map((value) => (
            <g key={value}>
              <line
                x1="62"
                x2="752"
                y1={y(value)}
                y2={y(value)}
                stroke="#e6eae4"
                strokeDasharray="3 5"
              />
              <text x="48" y={y(value) + 4} textAnchor="end" className="axis">
                {value < 0 ? '−' : ''}$
                {Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </text>
            </g>
          ))}
          <line
            x1="62"
            x2="752"
            y1={y(Number(buffer) / 1e6)}
            y2={y(Number(buffer) / 1e6)}
            stroke="#b78037"
            strokeDasharray="5 5"
          />
          <text x="750" y={y(Number(buffer) / 1e6) - 8} textAnchor="end" className="buffer-label">
            Your buffer {formatMoney(buffer, 0)}
          </text>
          <g clipPath="url(#plot)">
            <path
              d={`${path(learned)} L752,${y(floor)} L62,${y(floor)} Z`}
              fill="#e5eee7"
              opacity="0.65"
            />
            {scenarios
              .filter((s) => s.id !== 'learned')
              .map((s) => (
                <path
                  key={s.id}
                  d={path(s)}
                  fill="none"
                  stroke={scenarioColors[s.id]}
                  strokeWidth="2"
                  strokeDasharray={s.id === 'none' ? '4 6' : '7 5'}
                  strokeLinejoin="round"
                />
              ))}
            <path
              d={path(learned)}
              fill="none"
              stroke={scenarioColors.learned}
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <line
              x1={x(selected)}
              x2={x(selected)}
              y1="18"
              y2="252"
              stroke="#859b90"
              strokeDasharray="2 4"
            />
            {scenarios.map((s) => (
              <circle
                key={s.id}
                cx={x(selected)}
                cy={y(Number(s.points[selected]!.balance) / 1e6)}
                r="4"
                fill={scenarioColors[s.id]}
                stroke="white"
                strokeWidth="2"
              />
            ))}
          </g>
          {[0, 5, 10, 15, 20, 25, 30].map((i) => (
            <text key={i} x={x(i)} y="281" textAnchor="middle" className="axis">
              {shortDate(learned.points[i]!.date)}
            </text>
          ))}
        </svg>
      </div>
      <div className="chart-readout">
        <strong>{shortDate(learned.points[selected]!.date)}</strong>
        {scenarios.map((s) => (
          <span key={s.id} style={{ color: scenarioColors[s.id] }}>
            {s.label}: <b>{formatMoney(s.points[selected]!.balance)}</b>
          </span>
        ))}
      </div>
      <label className="chart-scrub">
        <span className="sr-only">Inspect forecast day</span>
        <input
          type="range"
          min="0"
          max="30"
          value={selected}
          onChange={(e) => setSelected(Number(e.target.value))}
        />
      </label>
      <details className="data-alternative">
        <summary>Read the daily cash table</summary>
        <div className="table-scroll">
          <table>
            <caption>
              USDC projections, {shortDate(learned.from)} to {shortDate(learned.through)}
            </caption>
            <thead>
              <tr>
                <th>Date</th>
                {scenarios.map((s) => (
                  <th key={s.id}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {learned.points.map((p, i) => (
                <tr key={p.date}>
                  <th>{shortDate(p.date)}</th>
                  {scenarios.map((s) => (
                    <td key={s.id}>{formatMoney(s.points[i]!.balance)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
