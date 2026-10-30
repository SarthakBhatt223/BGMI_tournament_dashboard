import { useState } from 'react';
import { useFirstLoadableImage } from '../hooks/useFirstLoadableImage.js';

// One persistent, original "battleground" atmosphere shown behind every display mode. Mounted once
// by DisplayView and never restarted on a mode change, so the motion is continuous and there is no
// jump when the display switches between ambient, standings and MVP.
//
// All motion is CSS (transform and opacity only, no JavaScript loops, no filters). Layers, back to
// front: base, topographic contours, distant ridges, glow (lights the ridges from behind the skyline), smoke, skyline, foreground silhouettes,
// parachutes, dust and embers, light sweep. Every animation ping-pongs (alternate + ease-in-out) or
// fades in and out at both ends, so loops never show a reset. See backdrop.css.
//
// Your own artwork is supported without code changes: public/media/backdrop.mp4 and/or
// public/media/backdrop.jpg. When one of them loads, the built-in skyline and silhouettes step
// aside (the glow, smoke and particles stay) so the two never fight. Leaderboard, MVP and
// elimination components never see any of this.
const WIDTH = 1920;
const HEIGHT = 1080;

// A smooth closed, slightly irregular loop around (cx, cy): one topographic contour line.
function contour(cx, cy, radius, seed) {
  const points = [];
  const steps = 90;
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const wobble = 1 + 0.12 * Math.sin(3 * angle + seed) + 0.07 * Math.sin(5 * angle + seed * 2.1) + 0.04 * Math.sin(9 * angle + seed * 0.7);
    points.push(`${(cx + Math.cos(angle) * radius * wobble).toFixed(1)},${(cy + Math.sin(angle) * radius * wobble * 0.78).toFixed(1)}`);
  }
  return `M${points.join('L')}Z`;
}

function buildContours() {
  const paths = [];
  for (let radius = 70; radius <= 430; radius += 60) paths.push(contour(330, 330, radius, 1.3));
  for (let radius = 60; radius <= 400; radius += 55) paths.push(contour(1600, 800, radius, 4.1));
  for (let radius = 90; radius <= 300; radius += 70) paths.push(contour(1000, 1000, radius, 2.2));
  return paths;
}

// A ridge line across the full width: a sum of sines, closed down to the bottom edge.
function ridge(baseY, amplitude, seed) {
  const points = [`0,${HEIGHT}`];
  for (let x = 0; x <= WIDTH; x += 40) {
    const y = baseY - amplitude * (0.55 * Math.sin(x / 260 + seed) + 0.3 * Math.sin(x / 110 + seed * 1.7) + 0.15 * Math.sin(x / 47 + seed * 0.4));
    points.push(`${x},${y.toFixed(1)}`);
  }
  points.push(`${WIDTH},${HEIGHT}`);
  return `M${points.join('L')}Z`;
}

const CONTOURS = buildContours();
const RIDGE_FAR = ridge(640, 70, 1.1);
const RIDGE_NEAR = ridge(760, 60, 3.4);

// Deterministic pseudo-random numbers so the particles are the same on every render.
function sequence(seed) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

// Sparse by design: 12 embers and 8 dust motes. Each rises slowly, drifts sideways and fades in
// and out, with a negative delay so the screen is already populated when the page opens.
function buildParticles() {
  const random = sequence(11);
  const embers = Array.from({ length: 12 }, (_, i) => ({
    key: `e${i}`,
    left: i % 2 === 0 ? 2 + random() * 16 : 82 + random() * 16, // side margins, away from the boards
    top: 70 + random() * 28,
    size: 3 + random() * 3,
    opacity: 0.45 + random() * 0.4,
    drift: (random() - 0.5) * 120,
    duration: 18 + random() * 14,
    delay: -random() * 30,
  }));
  const dust = Array.from({ length: 8 }, (_, i) => ({
    key: `d${i}`,
    left: 5 + random() * 90,
    top: 40 + random() * 55,
    size: 2 + random() * 2,
    opacity: 0.14 + random() * 0.16,
    drift: (random() - 0.5) * 220,
    duration: 28 + random() * 22,
    delay: -random() * 45,
  }));
  return { embers, dust };
}

const PARTICLES = buildParticles();

function Parachute() {
  return (
    <svg viewBox="-130 -160 260 360" aria-hidden="true">
      <path d="M-120 0 C-120 -100 -60 -150 0 -150 C60 -150 120 -100 120 0 C100 -22 80 -22 60 0 C40 -22 20 -22 0 0 C-20 -22 -40 -22 -60 0 C-80 -22 -100 -22 -120 0 Z" fill="#1d232b" stroke="#f47a28" strokeOpacity="0.35" strokeWidth="2" />
      <path d="M-120 0 L-12 150 M-60 0 L-8 150 M0 0 L0 150 M60 0 L8 150 M120 0 L12 150" stroke="#aeb5c1" strokeOpacity="0.35" strokeWidth="1.5" fill="none" />
      <rect x="-16" y="150" width="32" height="26" fill="#252a32" stroke="#f47a28" strokeOpacity="0.5" strokeWidth="2" />
    </svg>
  );
}

function CoolingTower({ x, width, height }) {
  const waist = width * 0.68;
  const inset = (width - waist) / 2;
  const top = HEIGHT - height;
  return (
    <path
      d={`M${x} ${HEIGHT} C${x + inset * 0.2} ${HEIGHT - height * 0.35} ${x + inset} ${HEIGHT - height * 0.7} ${x + inset} ${top + 0.25 * height} C${x + inset * 0.9} ${top + 0.1 * height} ${x + inset * 0.7} ${top + 6} ${x + inset * 0.2} ${top} L${x + width - inset * 0.2} ${top} C${x + width - inset * 0.7} ${top + 6} ${x + width - inset * 0.9} ${top + 0.1 * height} ${x + width - inset} ${top + 0.25 * height} C${x + width - inset} ${HEIGHT - height * 0.7} ${x + width - inset * 0.2} ${HEIGHT - height * 0.35} ${x + width} ${HEIGHT} Z`}
      fill="#0b0d10"
    />
  );
}

function SkylineSide() {
  return (
    <g>
      <CoolingTower x={40} width={210} height={360} />
      <CoolingTower x={250} width={170} height={270} />
      <path d="M0 1080 L0 860 L50 860 L50 830 L120 830 L120 1080 Z" fill="#0b0d10" />
      <path d="M420 1080 L420 930 L470 915 L470 890 L560 890 L560 1080 Z" fill="#0b0d10" />
    </g>
  );
}

export default function TacticalBackdrop() {
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const photo = useFirstLoadableImage(['/media/backdrop.jpg']);
  const custom = videoReady || photo !== null;

  return (
    <div className={`tactical-backdrop${custom ? ' has-custom-art' : ''}`} aria-hidden="true">
      <div className="bd-base" />

      {/* Your own artwork (optional). Hidden until it loads. */}
      {!videoFailed && (
        <video
          className={`bd-custom bd-custom-video${videoReady ? ' is-ready' : ''}`}
          src="/media/backdrop.mp4"
          autoPlay
          loop
          muted
          playsInline
          onLoadedData={() => setVideoReady(true)}
          onError={() => setVideoFailed(true)}
        />
      )}
      {photo && <div className="bd-custom bd-custom-photo is-ready" style={{ backgroundImage: `url(${photo})` }} />}

      {/* The camera layer scales extremely slowly; everything inside it also has its own drift. */}
      <div className="bd-camera">
        <div className="bd-layer bd-contours">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMid slice">
            <g fill="none" stroke="#ffffff" strokeOpacity="0.055" strokeWidth="1.2" strokeLinejoin="round">
              {CONTOURS.map((d) => <path key={d} d={d} />)}
            </g>
            <g transform="translate(1710 250)" fill="none" stroke="#f47a28" strokeOpacity="0.28" strokeWidth="1.5">
              <circle r="120" />
              <circle r="80" strokeOpacity="0.2" />
              <circle r="6" />
              <path d="M-150 0H-100M100 0H150M0 -150V-100M0 100V150" strokeWidth="2" />
            </g>
          </svg>
        </div>

        <div className="bd-layer bd-far bd-silhouette">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMax slice">
            <path d={RIDGE_FAR} fill="#12161c" />
            <path d={RIDGE_NEAR} fill="#0e1217" />
          </svg>
        </div>

        <div className="bd-layer bd-glow bd-glow-a" />
        <div className="bd-layer bd-glow bd-glow-b" />

        <div className="bd-layer bd-smoke bd-smoke-a" />
        <div className="bd-layer bd-smoke bd-smoke-b" />

        <div className="bd-layer bd-mid bd-silhouette">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMax slice">
            <SkylineSide />
            <g transform={`translate(${WIDTH} 0) scale(-1 1)`}><SkylineSide /></g>
          </svg>
        </div>

        <div className="bd-layer bd-smoke bd-smoke-c" />

        <div className="bd-layer bd-fore bd-silhouette">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMidYMax slice">
            <path d="M0 1080 L0 990 L70 975 L110 995 L190 960 L260 985 L340 1080 Z" fill="#07090b" />
            <path d="M1920 1080 L1920 985 L1840 965 L1790 990 L1700 955 L1620 985 L1560 1080 Z" fill="#07090b" />
            <path d="M120 1080 L152 800 L184 1080 M126 1010 L178 1010 M134 940 L170 940 M144 870 L160 870 M80 840 L224 840 M100 872 L204 872" stroke="#07090b" strokeWidth="6" fill="none" />
            <path d="M1736 1080 L1768 780 L1800 1080 M1742 1010 L1794 1010 M1750 940 L1786 940 M1760 870 L1776 870 M1696 820 L1840 820 M1716 852 L1820 852" stroke="#07090b" strokeWidth="6" fill="none" />
          </svg>
        </div>

        <div className="bd-chute bd-chute-a bd-silhouette"><Parachute /></div>
        <div className="bd-chute bd-chute-b bd-silhouette"><Parachute /></div>
      </div>

      <div className="bd-particles">
        {PARTICLES.dust.map((p) => (
          <i
            key={p.key}
            className="bd-dust"
            style={{ left: `${p.left}%`, top: `${p.top}%`, width: p.size, height: p.size, '--o': p.opacity, '--dx': `${p.drift}px`, animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }}
          />
        ))}
        {PARTICLES.embers.map((p) => (
          <i
            key={p.key}
            className="bd-ember"
            style={{ left: `${p.left}%`, top: `${p.top}%`, width: p.size, height: p.size, '--o': p.opacity, '--dx': `${p.drift}px`, animationDuration: `${p.duration}s`, animationDelay: `${p.delay}s` }}
          />
        ))}
      </div>

      <div className="bd-sweep" />
    </div>
  );
}
