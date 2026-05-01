"use client";

/** Semi-circular 0–100 gauge with zone-colored track and needle. */
export function SentimentGauge({
  score,
  zoneColors,
  textColor
}: {
  score: number;
  zoneColors: { red: string; amber: string; grey: string; green: string; bright: string };
  textColor: string;
}) {
  const s = Math.max(0, Math.min(100, score));
  const cx = 100;
  const cy = 92;
  const r = 72;

  const angle = (v: number) => Math.PI * (1 - v / 100);

  const arc = (v0: number, v1: number) => {
    const a0 = angle(v0);
    const a1 = angle(v1);
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 0 ${x1} ${y1}`;
  };

  const needleA = angle(s);
  const nx = cx + (r - 10) * Math.cos(needleA);
  const ny = cy - (r - 10) * Math.sin(needleA);

  const bands: [number, number, string][] = [
    [0, 30, zoneColors.red],
    [30, 45, zoneColors.amber],
    [45, 55, zoneColors.grey],
    [55, 70, zoneColors.green],
    [70, 100.0001, zoneColors.bright]
  ];

  return (
    <svg width="200" height="118" viewBox="0 0 200 118" aria-hidden>
      {bands.map(([a, b, fill], i) => (
        <path key={i} d={arc(a, b)} fill="none" stroke={fill} strokeWidth={12} strokeLinecap="butt" />
      ))}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={textColor} strokeWidth={2.5} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill={textColor} />
      <text x={cx} y={cy + 28} textAnchor="middle" fill={textColor} fontSize="28" fontWeight={800}>
        {Math.round(s)}
      </text>
    </svg>
  );
}
