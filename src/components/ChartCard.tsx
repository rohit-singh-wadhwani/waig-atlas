import React, { useState } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip, Legend,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { Card, CardHeader, IconButton, Segmented } from './ui';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip, Legend);
ChartJS.defaults.font.family = 'Inter, ui-sans-serif, system-ui, sans-serif';
ChartJS.defaults.color = '#6b7280';

// Categorical order from the validated default palette; series 1 uses the brand teal.
export const SERIES = ['#316d6e', '#eb6834', '#2a78d6', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export type Series = { name: string; values: number[] };
type Mode = 'line' | 'area' | 'bars' | 'stacked' | 'donut';

export default function ChartCard({
  title, subtitle, labels, series, modes = ['line', 'area', 'bars'], initial, height = 280, valueFmt = (v: number) => v.toLocaleString('en-GB'), footer,
}: {
  title: string;
  subtitle?: string;
  labels: string[];
  series: Series[];
  modes?: Mode[];
  initial?: Mode;
  height?: number;
  valueFmt?: (v: number) => string;
  footer?: React.ReactNode;
}) {
  const [mode, setMode] = useState<Mode>(initial || modes[0]);
  const [table, setTable] = useState(false);
  const multi = series.length > 1;
  const allInt = series.every((s) => s.values.every((v) => !isFinite(v) || Number.isInteger(v)));

  const grid = { color: '#f1f2f4' };
  const common: any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: multi, position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, padding: 16 } },
      tooltip: { backgroundColor: '#111827', padding: 10, cornerRadius: 8, callbacks: { label: (c: any) => ` ${c.dataset.label}: ${valueFmt(c.parsed.y ?? c.parsed)}` } },
    },
    scales: {
      x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 16 } },
      y: { grid, border: { display: false }, beginAtZero: true, stacked: mode === 'stacked', ticks: { precision: allInt ? 0 : undefined, callback: (v: any) => valueFmt(Number(v)) } },
    },
  };
  if (mode === 'stacked') common.scales.x.stacked = true;

  const ds = series.map((s, i) => {
    const c = SERIES[i % SERIES.length];
    if (mode === 'bars' || mode === 'stacked')
      return { label: s.name, data: s.values, backgroundColor: c, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 28, borderColor: '#fff', borderWidth: mode === 'stacked' ? 1 : 0 };
    return {
      label: s.name, data: s.values, borderColor: c, borderWidth: 2, pointRadius: labels.length > 40 ? 0 : 3, pointHoverRadius: 5,
      pointBackgroundColor: c, tension: 0.25, fill: mode === 'area' ? 'origin' : false, backgroundColor: c + '22',
    };
  });

  const modeLabels: Record<Mode, string> = { line: 'Line', area: 'Area', bars: 'Bars', stacked: 'Stacked', donut: 'Donut' };

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle}
        right={
          <>
            {modes.length > 1 && <Segmented size="sm" value={mode} onChange={setMode} options={modes.map((m) => ({ value: m, label: modeLabels[m] }))} />}
            <IconButton icon="table" title={table ? 'Show chart' : 'Show table'} active={table} onClick={() => setTable(!table)} />
          </>
        }
      />
      {table ? (
        <div className="overflow-auto border border-gray-100 rounded-xl" style={{ maxHeight: height }}>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="text-left font-medium text-gray-600 px-3 py-2">Label</th>
                {series.map((s) => (
                  <th key={s.name} className="text-right font-medium text-gray-600 px-3 py-2">{s.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((l, i) => (
                <tr key={l + i} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 text-gray-700">{l}</td>
                  {series.map((s) => (
                    <td key={s.name} className="px-3 py-1.5 text-right tabular-nums">{valueFmt(s.values[i] ?? 0)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>
          {mode === 'donut' ? (
            <Doughnut
              data={{ labels, datasets: [{ data: series[0]?.values || [], backgroundColor: labels.map((_, i) => SERIES[i % SERIES.length]), borderColor: '#fff', borderWidth: 2 }] }}
              options={{ responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8 } } } }}
            />
          ) : mode === 'bars' || mode === 'stacked' ? (
            <Bar data={{ labels, datasets: ds as any }} options={common} />
          ) : (
            <Line data={{ labels, datasets: ds as any }} options={common} />
          )}
        </div>
      )}
      {footer && <div className="mt-3 text-sm text-gray-500">{footer}</div>}
    </Card>
  );
}
