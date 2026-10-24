import React from 'react';
import { fin } from './format.js';

// Minimal SVG sparkline. `tone` colours the line by the net move unless forced.
export default function Spark({ data, width = 220, height = 46, fmt = (v) => v.toFixed(2), label }) {
  const v = (data || []).filter(fin);
  if (v.length < 2) {
    return (
      <div className="spark">
        <div className="spark-label">{label}</div>
        <div className="spark-empty">no data</div>
      </div>
    );
  }
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * width).toFixed(1)},${(height - 3 - ((y - min) / span) * (height - 6)).toFixed(1)}`).join(' ');
  const up = v[v.length - 1] >= v[0];
  return (
    <div className="spark">
      <div className="spark-label">
        <span>{label}</span>
        <b className={up ? 'pos' : 'neg'}>{fmt(v[v.length - 1])}</b>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke={up ? 'var(--green)' : 'var(--red)'} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}
