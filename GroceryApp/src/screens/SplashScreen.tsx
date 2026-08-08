/**
 * SplashScreen — "3D Motion Graphics Splash".
 *
 * React Native port of the approved launch splash artifact
 * (splash-animation/index.html): a looping 4-scene glassmorphism motion
 * piece in a 450×800 design space, scaled to fit the device.
 *
 *   Scene 1 — VOICE:   smart speaker + live waveform morphs into a glass
 *                      list card with produce chips and check-offs.
 *   Scene 2 — PRIVACY: frosted shield + amber lock, shimmer sweep.
 *   Scene 3 — TRIP:    card/shield flip away in 3D (perspective rotateX),
 *                      map panel flips in; contours + route draw, pins drop.
 *   Scene 4 — LOGO:    grocery-bag tile elastic reveal, "PantryRun"
 *                      letter-staggered wordmark, tagline.
 *
 * Playback contract: the sequence LOOPS until the `canFinish` prop is true —
 * App.tsx keeps it false until init and first-run account creation (device
 * identity + family membership + recovery phrase) have settled, so a
 * first-time user watches the motion piece for the entire account-creation
 * flow. Exit happens at the next scene boundary (each scene is ~2.5–4s) via
 * an oat fade, so a returning user leaves after scene 1.
 *
 * Built with the RN Animated API (native driver for transforms/opacity) and
 * react-native-svg (JS driver for stroke-draw / motion-path props) — no
 * reanimated/lottie/GSAP dependencies. Honors reduce-motion by rendering the
 * resolved logo end-state.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// ─── Design tokens (from the splash artifact) ───────────────────────────────

const OAT = '#F1E7D6';
const OAT_DEEP = '#E6D7BF';
const TERRA = '#C4703F';
const TERRA_DEEP = '#A85730';
const SAGE = '#7C9A72';
const SAGE_DEEP = '#5F7F57';
const AMBER = '#E9A84F';
const AMBER_SOFT = '#F3C579';
const INK_SOFT = 'rgba(76,59,43,0.58)';
const SKEL = '#B7A48A';

const DESIGN_W = 450;
const DESIGN_H = 800;

/** Minimum on-screen time before an exit checkpoint may fire. */
const MIN_SPLASH_MS = 2600;

const SERIF = Platform.select({ ios: 'Georgia', default: 'serif' });

// ─── Waveform ────────────────────────────────────────────────────────────────

const NBARS = 21;
const barPeak = (i: number) =>
  Math.max(0.3, 1 - Math.abs(i - (NBARS - 1) / 2) / (NBARS * 0.72));

// ─── Route motion path (sampled cubic beziers from the artifact) ────────────

type Pt = [number, number];
const cubicPt = (p: Pt[], t: number): Pt => {
  const u = 1 - t;
  const x =
    u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
  const y =
    u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1];
  return [x, y];
};
const SEG1: Pt[] = [[70, 340], [110, 315], [130, 262], [190, 240]];
const SEG2: Pt[] = [[190, 240], [245, 220], [262, 176], [300, 140]];
const ROUTE_SAMPLES = 17;
const ROUTE_PTS: Pt[] = Array.from({ length: ROUTE_SAMPLES }, (_, i) => {
  const u = i / (ROUTE_SAMPLES - 1);
  return u <= 0.5 ? cubicPt(SEG1, u * 2) : cubicPt(SEG2, (u - 0.5) * 2);
});
const ROUTE_T = ROUTE_PTS.map((_, i) => i / (ROUTE_SAMPLES - 1));
const ROUTE_X = ROUTE_PTS.map((p) => p[0]);
const ROUTE_Y = ROUTE_PTS.map((p) => p[1]);
const ROUTE_LEN = ROUTE_PTS.reduce(
  (acc, p, i) => (i === 0 ? 0 : acc + Math.hypot(p[0] - ROUTE_PTS[i - 1][0], p[1] - ROUTE_PTS[i - 1][1])),
  0,
);

const ROUTE_D = 'M70 340 C110 315 130 262 190 240 C245 220 262 176 300 140';

// Contours: perimeter estimates for stroke-draw (exact length isn't critical).
const CONTOURS: Array<{ d: string; stroke: string; len: number }> = [
  { d: 'M42 210 C50 120 150 62 235 84 C320 106 352 190 330 268 C308 346 210 392 128 356 C58 325 36 288 42 210 Z', stroke: 'rgba(168,87,48,0.30)', len: 1010 },
  { d: 'M78 214 C86 148 158 100 228 116 C296 132 322 198 304 262 C286 326 206 360 142 332 C88 308 72 272 78 214 Z', stroke: 'rgba(95,127,87,0.32)', len: 745 },
  { d: 'M114 218 C120 172 168 136 220 148 C270 160 290 208 276 256 C262 304 200 330 152 308 C112 289 109 258 114 218 Z', stroke: 'rgba(168,87,48,0.28)', len: 560 },
  { d: 'M148 222 C152 192 182 168 216 176 C248 184 262 216 252 248 C242 280 198 296 168 280 C142 266 145 246 148 222 Z', stroke: 'rgba(95,127,87,0.30)', len: 355 },
  { d: 'M178 226 C180 208 196 194 214 199 C230 204 238 220 232 236 C226 252 202 260 188 250 C176 242 176 238 178 226 Z', stroke: 'rgba(168,87,48,0.26)', len: 190 },
];

const PINS: Array<{ x: number; y: number; fill: string }> = [
  { x: 70, y: 340, fill: TERRA },
  { x: 190, y: 240, fill: SAGE },
  { x: 300, y: 140, fill: AMBER },
];

const TAGS: Array<{ x: number; y: number; label: string; sage?: boolean }> = [
  { x: 92, y: 288, label: 'SAVE $4.20' },
  { x: 212, y: 188, label: '−18% TODAY', sage: true },
  { x: 236, y: 88, label: '−12%' },
];

const WORDMARK: Array<{ ch: string; color: string }> = [
  ...'Pantry'.split('').map((ch) => ({ ch, color: TERRA })),
  ...'Run'.split('').map((ch) => ({ ch, color: SAGE_DEEP })),
];

// Chips fly in from the collapsing waveform — start offsets per chip.
const CHIP_FROM: Array<{ x: number; y: number; rot: string }> = [
  { x: 85, y: -70, rot: '-16deg' },
  { x: 121, y: -146, rot: '10deg' },
  { x: 157, y: -222, rot: '18deg' },
];
const LINE_WIDTHS: Array<[number, number]> = [[118, 74], [102, 88], [126, 64]];

// ─── SVG pieces (paths lifted from the artifact) ────────────────────────────

function ChipIcon({ kind }: { kind: 'avocado' | 'milk' | 'bread' }) {
  return (
    <Svg width={36} height={36} viewBox="0 0 48 48">
      {kind === 'avocado' && (
        <>
          <Path
            d="M24 5.5 C31 5.5 34.8 12.5 35.3 18.8 C35.8 25.6 38 28.6 38 32.8 C38 40 31.4 44 24 44 C16.6 44 10 40 10 32.8 C10 28.6 12.2 25.6 12.7 18.8 C13.2 12.5 17 5.5 24 5.5 Z"
            fill={SAGE} fillOpacity={0.72} stroke="rgba(255,255,255,0.7)" strokeWidth={1.4}
          />
          <Circle cx={24} cy={33} r={6.4} fill={AMBER} fillOpacity={0.9} stroke="rgba(255,255,255,0.65)" strokeWidth={1.2} />
          <Path d="M24 5.5 C24 2.8 26.6 1.2 29.4 2.2 C28 4.8 26 5.8 24 5.5 Z" fill={SAGE} opacity={0.85} />
          <Path d="M15.5 14 C13.8 20 13.6 25.5 14.6 29.5" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" opacity={0.55} />
        </>
      )}
      {kind === 'milk' && (
        <>
          <Path
            d="M17.5 13.5 L17.5 11.5 C17.5 9.8 18.6 8.8 20.2 8.8 L27.8 8.8 C29.4 8.8 30.5 9.8 30.5 11.5 L30.5 13.5 C32.8 15.6 34.3 18.6 34.3 21.8 L34.3 37.6 C34.3 40.8 32.2 42.8 29.3 42.8 L18.7 42.8 C15.8 42.8 13.7 40.8 13.7 37.6 L13.7 21.8 C13.7 18.6 15.2 15.6 17.5 13.5 Z"
            fill="rgba(255,255,255,0.65)" stroke="rgba(255,255,255,0.75)" strokeWidth={1.3}
          />
          <Rect x={18.4} y={4.4} width={11.2} height={5.6} rx={2.4} fill={TERRA} fillOpacity={0.62} stroke="rgba(255,255,255,0.6)" strokeWidth={1} />
          <Path d="M13.7 27.5 L34.3 27.5" stroke="rgba(124,154,114,0.45)" strokeWidth={1.4} />
          <Path d="M18.4 18.5 L18.4 36.5" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" opacity={0.6} />
        </>
      )}
      {kind === 'bread' && (
        <>
          <Path
            d="M8 25.5 C8 17 14.8 11 24 11 C33.2 11 40 17 40 25.5 L40 33.6 C40 36.8 37.9 38.8 35 38.8 L13 38.8 C10.1 38.8 8 36.8 8 33.6 Z"
            fill={AMBER} fillOpacity={0.78} stroke="rgba(255,255,255,0.65)" strokeWidth={1.3}
          />
          <Path d="M8 32.8 L40 32.8" stroke="rgba(168,87,48,0.35)" strokeWidth={1.4} />
          <Path d="M16.5 15.5 L20.5 21.5" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" opacity={0.75} />
          <Path d="M25.5 14.5 L29.5 20.5" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" opacity={0.75} />
        </>
      )}
    </Svg>
  );
}

const SHIELD_D =
  'M107 12 C134 29 161 36 186 39 C190 83 182 139 155 180 C138 205 121 220 107 228 C93 220 76 205 59 180 C32 139 24 83 28 39 C53 36 80 29 107 12 Z';

function ShieldSvg() {
  return (
    <Svg width={214} height={248} viewBox="0 0 214 248">
      <Defs>
        <LinearGradient id="gShield" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.6} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0.1} />
        </LinearGradient>
      </Defs>
      <Path d={SHIELD_D} fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} />
      <G scale={0.84} origin="107,120">
        <Path d={SHIELD_D} fill="url(#gShield)" stroke="rgba(255,255,255,0.75)" strokeWidth={1.4} />
      </G>
      <Path d="M52 60 C58 44 74 32 92 26" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.5} />
    </Svg>
  );
}

function LockSvg() {
  // Lock group from the shield artwork, in the same 214×248 coordinate space.
  return (
    <Svg width={214} height={248} viewBox="0 0 214 248">
      <Path d="M88 118 L88 102 C88 88 126 88 126 102 L126 118" fill="none" stroke={AMBER} strokeWidth={7} strokeLinecap="round" />
      <Rect x={79} y={112} width={56} height={44} rx={12} fill="rgba(255,255,255,0.7)" stroke="rgba(255,255,255,0.8)" strokeWidth={1.3} />
      <Circle cx={107} cy={130} r={5} fill={TERRA_DEEP} opacity={0.85} />
      <Path d="M107 133 L107 142" stroke={TERRA_DEEP} strokeWidth={4} strokeLinecap="round" opacity={0.85} />
      <Path d="M87 120 L87 148" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" opacity={0.55} />
    </Svg>
  );
}

function PinSvg({ fill }: { fill: string }) {
  return (
    <Svg width={40} height={52} viewBox="0 0 40 52">
      <Path
        d="M20 2 C29 2 36 9 36 18 C36 30 20 50 20 50 C20 50 4 30 4 18 C4 9 11 2 20 2 Z"
        fill="rgba(255,255,255,0.4)" stroke="rgba(255,255,255,0.8)" strokeWidth={1.4}
      />
      <Circle cx={20} cy={18} r={6.2} fill={fill} opacity={0.92} />
    </Svg>
  );
}

function LogoBagSvg() {
  return (
    <Svg width={148} height={148} viewBox="0 0 96 96">
      <Defs>
        <LinearGradient id="lgSage" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.8} />
          <Stop offset="0.55" stopColor="#A8C29C" stopOpacity={0.55} />
          <Stop offset="1" stopColor={SAGE} stopOpacity={0.6} />
        </LinearGradient>
        <LinearGradient id="lgAmber" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFF6E3" stopOpacity={0.9} />
          <Stop offset="1" stopColor={AMBER} stopOpacity={0.75} />
        </LinearGradient>
      </Defs>
      <Path d="M40 33 C30 21 28 10 33.5 5 C40.5 8 44.5 20 44 33 Z" fill="url(#lgSage)" stroke="rgba(255,255,255,0.7)" strokeWidth={1.2} />
      <Path d="M56 33 C66 21 68 10 62.5 5 C55.5 8 51.5 20 52 33 Z" fill="url(#lgSage)" stroke="rgba(255,255,255,0.7)" strokeWidth={1.2} />
      <Path
        d="M28 35 L68 35 C70.2 35 71.8 36.7 71.4 38.9 L66.8 74.6 C66.3 78.4 63.2 81 59.4 81 L36.6 81 C32.8 81 29.7 78.4 29.2 74.6 L24.6 38.9 C24.2 36.7 25.8 35 28 35 Z"
        fill="url(#lgSage)" stroke="rgba(255,255,255,0.75)" strokeWidth={1.4}
      />
      <Path d="M26.5 43.5 L69.5 43.5" stroke="rgba(255,255,255,0.6)" strokeWidth={1.4} />
      <Circle cx={48} cy={60} r={9.5} fill="url(#lgAmber)" stroke="rgba(255,255,255,0.7)" strokeWidth={1.2} />
      <Circle cx={48} cy={61.5} r={3.4} fill={TERRA_DEEP} opacity={0.8} />
      <Path d="M32 50 L32 72" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" opacity={0.5} />
      <Path d="M76 20 L76 28 M72 24 L80 24" stroke={AMBER} strokeWidth={2.4} strokeLinecap="round" opacity={0.9} />
      <Path d="M22 14 L22 20 M19 17 L25 17" stroke={AMBER_SOFT} strokeWidth={2} strokeLinecap="round" opacity={0.8} />
    </Svg>
  );
}

/** Vertical white gradient band used for the shimmer/sheen sweeps. */
function GradientBand({ width, height, id }: { width: number; height: number; id: string }) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
          <Stop offset="0.5" stopColor="#FFFFFF" stopOpacity={0.6} />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

function Orb({ size, color, id }: { size: number; color: string; id: string }) {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={id} cx="0.45" cy="0.45" r="0.5">
          <Stop offset="0" stopColor={color} stopOpacity={0.55} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id})`} />
    </Svg>
  );
}

function Backdrop() {
  return (
    <Svg width={DESIGN_W} height={DESIGN_H} style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={OAT} />
          <Stop offset="1" stopColor={OAT_DEEP} />
        </LinearGradient>
        <RadialGradient id="leak" cx="0.16" cy="0.06" r="0.65">
          <Stop offset="0" stopColor={AMBER_SOFT} stopOpacity={0.5} />
          <Stop offset="1" stopColor={AMBER_SOFT} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id="vig" cx="0.5" cy="0.5" r="0.72">
          <Stop offset="0.62" stopColor="#4A301A" stopOpacity={0} />
          <Stop offset="1" stopColor="#4A301A" stopOpacity={0.22} />
        </RadialGradient>
      </Defs>
      <Rect width={DESIGN_W} height={DESIGN_H} fill="url(#bg)" />
      <Rect width={DESIGN_W} height={DESIGN_H} fill="url(#leak)" />
      <Rect width={DESIGN_W} height={DESIGN_H} fill="url(#vig)" />
    </Svg>
  );
}

// ─── Animation helpers ──────────────────────────────────────────────────────

const tm = (
  v: Animated.Value,
  toValue: number,
  duration: number,
  easing = Easing.out(Easing.cubic),
  useNativeDriver = true,
) => Animated.timing(v, { toValue, duration, easing, useNativeDriver });

const sp = (v: Animated.Value, toValue: number, friction = 6, tension = 60, useNativeDriver = true) =>
  Animated.spring(v, { toValue, friction, tension, useNativeDriver });

const at = (ms: number, anim: Animated.CompositeAnimation) =>
  Animated.sequence([Animated.delay(ms), anim]);

const inv = (v: Animated.Value) =>
  v.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

// ─── Component ──────────────────────────────────────────────────────────────

export interface SplashScreenProps {
  onFinish: () => void;
  /**
   * While false, the motion sequence loops (first-run account creation still
   * in flight). Once true, the splash exits at the next scene boundary.
   */
  canFinish?: boolean;
}

export default function SplashScreen({ onFinish, canFinish = true }: SplashScreenProps) {
  const { width, height } = useWindowDimensions();
  const scale = Math.min(width / DESIGN_W, height / DESIGN_H);

  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null);

  const aliveRef = useRef(true);
  const startedRef = useRef(false);
  const mountedAtRef = useRef(Date.now());
  const canFinishRef = useRef(canFinish);
  canFinishRef.current = canFinish;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;
  const runningRef = useRef<Animated.CompositeAnimation | null>(null);
  const loopsRef = useRef<Animated.CompositeAnimation[]>([]);

  // All timeline values in one bag so reset/cleanup can iterate them.
  const v = useRef({
    speaker: new Animated.Value(0),
    glowPulse: new Animated.Value(0),
    barsOp: new Animated.Value(0),
    bars: Array.from({ length: NBARS }, () => new Animated.Value(0)),
    card: new Animated.Value(0),
    cardDim: new Animated.Value(0),
    chips: Array.from({ length: 3 }, () => new Animated.Value(0)),
    lines: Array.from({ length: 6 }, () => new Animated.Value(0)),
    checks: Array.from({ length: 3 }, () => new Animated.Value(0)),
    cap1: new Animated.Value(0),
    cap2: new Animated.Value(0),
    cap3: new Animated.Value(0),
    shield: new Animated.Value(0),
    lock: new Animated.Value(0),
    shimmer: new Animated.Value(0),
    flipOut: new Animated.Value(0),
    map: new Animated.Value(0),
    contours: CONTOURS.map(() => new Animated.Value(0)), // JS driver (svg props)
    route: new Animated.Value(0), // JS driver
    travelerT: new Animated.Value(0), // JS driver
    travelerOp: new Animated.Value(0), // JS driver
    pins: Array.from({ length: 3 }, () => new Animated.Value(0)),
    tags: Array.from({ length: 3 }, () => new Animated.Value(0)),
    mapOut: new Animated.Value(0),
    logo: new Animated.Value(0),
    letters: WORDMARK.map(() => new Animated.Value(0)),
    tagline: new Animated.Value(0),
    sheen: new Animated.Value(0),
    orb1: new Animated.Value(0),
    orb2: new Animated.Value(0),
    orb3: new Animated.Value(0),
    fader: new Animated.Value(0),
  }).current;

  const resetAll = () => {
    const scalars: Animated.Value[] = [
      v.speaker, v.barsOp, v.card, v.cardDim, v.cap1, v.cap2, v.cap3,
      v.shield, v.lock, v.shimmer, v.flipOut, v.map, v.route,
      v.travelerT, v.travelerOp, v.mapOut, v.logo, v.tagline, v.sheen,
    ];
    scalars.forEach((val) => val.setValue(0));
    [...v.bars, ...v.chips, ...v.lines, ...v.checks, ...v.contours, ...v.pins, ...v.tags, ...v.letters]
      .forEach((val) => val.setValue(0));
  };

  const play = (anim: Animated.CompositeAnimation) => {
    runningRef.current = anim;
    return new Promise<void>((resolve) => anim.start(() => resolve()));
  };

  // ── Waveform loops (started/stopped around scene 1) ──
  const waveLoopsRef = useRef<Animated.CompositeAnimation[]>([]);
  const startWave = () => {
    waveLoopsRef.current = v.bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay((i * 29) % 180),
          tm(bar, 1, 240 + ((i * 37) % 160), Easing.inOut(Easing.sin)),
          tm(bar, 0.25, 260 + ((i * 53) % 140), Easing.inOut(Easing.sin)),
        ]),
      ),
    );
    waveLoopsRef.current.forEach((l) => l.start());
  };
  const stopWave = () => {
    waveLoopsRef.current.forEach((l) => l.stop());
    waveLoopsRef.current = [];
  };

  // ── Scenes (compressed timeline of the artifact) ──

  const scene1 = async () => {
    startWave();
    const glow = Animated.loop(
      Animated.sequence([
        tm(v.glowPulse, 1, 550, Easing.inOut(Easing.sin)),
        tm(v.glowPulse, 0, 550, Easing.inOut(Easing.sin)),
      ]),
      { iterations: 2 },
    );
    glow.start();
    loopsRef.current.push(glow);
    await play(
      Animated.parallel([
        at(50, sp(v.speaker, 1, 4, 40)),
        at(300, tm(v.barsOp, 1, 300)),
        at(500, tm(v.cap1, 1, 500)),
        at(1800, tm(v.barsOp, 0, 320, Easing.in(Easing.quad))),
        at(1900, tm(v.speaker, 0, 380, Easing.in(Easing.quad))),
        at(1800, sp(v.card, 1, 6, 46)),
        at(2050, sp(v.chips[0], 1, 5, 90)),
        at(2170, sp(v.chips[1], 1, 5, 90)),
        at(2290, sp(v.chips[2], 1, 5, 90)),
        at(2450, Animated.stagger(70, v.lines.map((l) => tm(l, 1, 420)))),
        at(2550, Animated.stagger(90, v.checks.map((c) => sp(c, 1, 4, 120)))),
        at(2650, tm(v.cap1, 0, 380)),
      ]),
    );
    stopWave();
  };

  const scene2 = () =>
    play(
      Animated.parallel([
        tm(v.cardDim, 1, 500),
        at(80, sp(v.shield, 1, 4, 30)),
        at(250, tm(v.cap2, 1, 500)),
        at(560, sp(v.lock, 1, 4, 120)),
        at(1150, tm(v.shimmer, 1, 950, Easing.inOut(Easing.quad))),
        at(2000, tm(v.cap2, 0, 380)),
      ]),
    );

  const scene3 = () =>
    play(
      Animated.parallel([
        tm(v.flipOut, 1, 620, Easing.in(Easing.quad)),
        at(220, tm(v.map, 1, 780, Easing.out(Easing.cubic))),
        at(420, tm(v.cap3, 1, 500)),
        at(620, Animated.stagger(110, v.contours.map((c) =>
          tm(c, 1, 850, Easing.inOut(Easing.quad), false)))),
        at(760, Animated.stagger(150, v.pins.map((p) => sp(p, 1, 4.5, 110)))),
        at(1100, tm(v.route, 1, 1150, Easing.inOut(Easing.quad), false)),
        at(1200, Animated.stagger(140, v.tags.map((t) => sp(t, 1, 4.5, 110)))),
        at(1350, tm(v.travelerOp, 1, 200, Easing.linear, false)),
        at(1350, tm(v.travelerT, 1, 1500, Easing.inOut(Easing.quad), false)),
        at(2850, tm(v.travelerOp, 0, 260, Easing.linear, false)),
        at(2850, tm(v.cap3, 0, 380)),
      ]),
    );

  const scene4 = () =>
    play(
      Animated.parallel([
        Animated.stagger(50, [...v.pins, ...v.tags].map((p) => tm(p, 0, 480, Easing.in(Easing.cubic)))),
        at(100, tm(v.mapOut, 1, 620, Easing.in(Easing.quad))),
        at(380, sp(v.logo, 1, 4, 26)),
        at(700, Animated.stagger(50, v.letters.map((l) => sp(l, 1, 5, 110)))),
        at(1100, tm(v.sheen, 1, 820, Easing.inOut(Easing.quad))),
        at(1250, tm(v.tagline, 1, 650)),
        at(1900, Animated.delay(900)), // logo hold
      ]),
    );

  const fadeOutAndFinish = async () => {
    await play(tm(v.fader, 1, 420, Easing.inOut(Easing.quad)));
    if (aliveRef.current) onFinishRef.current();
  };

  const loopReset = () =>
    // Brief oat fade between loop iterations (mirrors the artifact's #fader).
    play(
      Animated.sequence([
        tm(v.fader, 1, 420, Easing.inOut(Easing.quad)),
        tm(v.fader, 0, 480, Easing.inOut(Easing.quad)),
      ]),
    );

  /** Exit checkpoint — leave the loop once App.tsx says init/signup settled. */
  const shouldExit = () =>
    canFinishRef.current && Date.now() - mountedAtRef.current >= MIN_SPLASH_MS;

  const runTimeline = async () => {
    // Ambient orbs drift for the whole splash lifetime.
    const ambient = [
      [v.orb1, 9000], [v.orb2, 11000], [v.orb3, 10000],
    ].map(([val, dur]) =>
      Animated.loop(
        Animated.sequence([
          tm(val as Animated.Value, 1, dur as number, Easing.inOut(Easing.sin)),
          tm(val as Animated.Value, 0, dur as number, Easing.inOut(Easing.sin)),
        ]),
      ),
    );
    ambient.forEach((a) => a.start());
    loopsRef.current.push(...ambient);

    while (aliveRef.current) {
      await scene1();
      if (!aliveRef.current) return;
      if (shouldExit()) return fadeOutAndFinish();
      await scene2();
      if (!aliveRef.current) return;
      if (shouldExit()) return fadeOutAndFinish();
      await scene3();
      if (!aliveRef.current) return;
      if (shouldExit()) return fadeOutAndFinish();
      await scene4();
      if (!aliveRef.current) return;
      if (shouldExit()) return fadeOutAndFinish();
      // Sign-up still in progress — fade to oat and replay from scene 1.
      await loopReset();
      if (!aliveRef.current) return;
      resetAll();
    }
  };

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((rm) => { if (!cancelled) setReducedMotion(rm); })
      .catch(() => { if (!cancelled) setReducedMotion(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (reducedMotion === null || startedRef.current) return;
    startedRef.current = true;
    if (reducedMotion) return; // static end-state; exit handled below
    runTimeline();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  // Reduced motion: show the resolved logo state, exit as soon as allowed.
  useEffect(() => {
    if (reducedMotion !== true) return;
    [v.logo, v.tagline, ...v.letters].forEach((val) => val.setValue(1));
    if (!canFinish) return;
    const t = setTimeout(() => {
      if (aliveRef.current) onFinishRef.current();
    }, Math.max(0, MIN_SPLASH_MS - (Date.now() - mountedAtRef.current)));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion, canFinish]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      runningRef.current?.stop();
      loopsRef.current.forEach((l) => l.stop());
      stopWave();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Derived animated styles ──────────────────────────────────────────────

  const perspective = 1300;

  const orbDrift = (val: Animated.Value, dx: number, dy: number) => ({
    transform: [
      { translateX: val.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
      { translateY: val.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
    ],
  });

  const cardOpacity = Animated.multiply(v.card, inv(v.flipOut));
  const shieldOpacity = Animated.multiply(v.shield, inv(v.flipOut));
  const mapOpacity = Animated.multiply(v.map, inv(v.mapOut));

  const flipOutRot = v.flipOut.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-84deg'] });
  const mapInRot = v.map.interpolate({ inputRange: [0, 1], outputRange: ['82deg', '0deg'] });

  const travelerCx = v.travelerT.interpolate({ inputRange: ROUTE_T, outputRange: ROUTE_X });
  const travelerCy = v.travelerT.interpolate({ inputRange: ROUTE_T, outputRange: ROUTE_Y });

  const captionStyle = (val: Animated.Value) => ({
    opacity: val,
    transform: [{ translateY: val.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  });

  return (
    <View style={styles.root}>
      <View
        style={{
          width: DESIGN_W,
          height: DESIGN_H,
          transform: [{ scale }],
        }}
      >
        <Backdrop />

        {/* Ambient orbs */}
        <Animated.View style={[styles.orb, { left: -70, top: -60 }, orbDrift(v.orb1, 34, 26)]} pointerEvents="none">
          <Orb size={280} color={AMBER_SOFT} id="o1" />
        </Animated.View>
        <Animated.View style={[styles.orb, { right: -80, bottom: -40 }, orbDrift(v.orb2, -28, -22)]} pointerEvents="none">
          <Orb size={230} color={SAGE} id="o2" />
        </Animated.View>
        <Animated.View style={[styles.orb, { right: -40, top: 60 }, orbDrift(v.orb3, -20, 30)]} pointerEvents="none">
          <Orb size={200} color={TERRA} id="o3" />
        </Animated.View>

        {/* ── Scene 1 — voice ── */}
        <Animated.View
          style={[
            styles.speaker,
            {
              opacity: v.speaker,
              transform: [
                { translateY: v.speaker.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
                { scale: v.speaker.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }) },
              ],
            },
          ]}
        >
          <Animated.View
            style={[
              styles.spGlow,
              {
                opacity: v.glowPulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.95] }),
                transform: [{ scale: v.glowPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) }],
              },
            ]}
          />
          <View style={styles.spBody}>
            <View style={styles.spSheen} />
            <View style={styles.spBtn}>
              <View style={styles.spBtnLed} />
            </View>
          </View>
        </Animated.View>

        <Animated.View style={[styles.wave, { opacity: v.barsOp }]}>
          {v.bars.map((bar, i) => (
            <Animated.View
              key={i}
              style={[
                styles.wbar,
                {
                  transform: [
                    {
                      scaleY: bar.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.06, barPeak(i)],
                      }),
                    },
                  ],
                },
              ]}
            />
          ))}
        </Animated.View>

        {/* Glass list card */}
        <Animated.View
          style={[
            styles.listCard,
            {
              opacity: Animated.multiply(
                cardOpacity,
                v.cardDim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] }),
              ),
              transform: [
                { perspective },
                { translateY: v.card.interpolate({ inputRange: [0, 1], outputRange: [120, 0] }) },
                { rotateX: flipOutRot },
                { scale: v.card.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
              ],
            },
          ]}
        >
          {(['avocado', 'milk', 'bread'] as const).map((kind, r) => (
            <View key={kind} style={styles.lrow}>
              <Animated.View
                style={[
                  styles.chip,
                  {
                    opacity: v.chips[r],
                    transform: [
                      { translateX: v.chips[r].interpolate({ inputRange: [0, 1], outputRange: [CHIP_FROM[r].x, 0] }) },
                      { translateY: v.chips[r].interpolate({ inputRange: [0, 1], outputRange: [CHIP_FROM[r].y, 0] }) },
                      { rotate: v.chips[r].interpolate({ inputRange: [0, 1], outputRange: [CHIP_FROM[r].rot, '0deg'] }) },
                      { scale: v.chips[r].interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) },
                    ],
                  },
                ]}
              >
                <ChipIcon kind={kind} />
              </Animated.View>
              <View style={styles.llines}>
                {[0, 1].map((li) => (
                  <Animated.View
                    key={li}
                    style={[
                      styles.lline,
                      li === 1 && styles.llineSub,
                      {
                        width: LINE_WIDTHS[r][li],
                        transform: [{ scaleX: v.lines[r * 2 + li] }],
                      },
                    ]}
                  />
                ))}
              </View>
              <Animated.View
                style={[
                  styles.lcheck,
                  {
                    opacity: v.checks[r],
                    transform: [{ scale: v.checks[r].interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
                  },
                ]}
              >
                <Svg width={11} height={11} viewBox="0 0 12 12">
                  <Path d="M2 6.4 L4.8 9 L10 3.2" fill="none" stroke={SAGE_DEEP} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </Svg>
              </Animated.View>
            </View>
          ))}
          {/* Shimmer sweep (scene 2) */}
          <Animated.View
            style={[
              styles.shimmerBand,
              {
                opacity: v.shimmer.interpolate({ inputRange: [0, 0.05, 0.95, 1], outputRange: [0, 1, 1, 0] }),
                transform: [
                  { translateX: v.shimmer.interpolate({ inputRange: [0, 1], outputRange: [-220, 480] }) },
                  { skewX: '-14deg' },
                ],
              },
            ]}
            pointerEvents="none"
          >
            <GradientBand width={130} height={264} id="shimCard" />
          </Animated.View>
        </Animated.View>

        {/* ── Scene 2 — privacy shield ── */}
        <Animated.View
          style={[
            styles.shieldWrap,
            {
              opacity: shieldOpacity,
              transform: [
                { perspective },
                { rotateX: flipOutRot },
                { scale: v.shield.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
                { rotate: v.shield.interpolate({ inputRange: [0, 1], outputRange: ['-9deg', '0deg'] }) },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <ShieldSvg />
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              {
                opacity: v.lock,
                transform: [{ scale: v.lock.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) }],
              },
            ]}
          >
            <LockSvg />
          </Animated.View>
        </Animated.View>

        {/* ── Scene 3 — trip optimizer map ── */}
        <Animated.View
          style={[
            styles.mapPanel,
            {
              opacity: mapOpacity,
              transform: [
                { perspective },
                { rotateX: mapInRot },
                { translateY: v.mapOut.interpolate({ inputRange: [0, 1], outputRange: [0, -26] }) },
                { scale: v.mapOut.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] }) },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <Svg width={380} height={460} viewBox="0 0 380 460" style={StyleSheet.absoluteFill}>
            {CONTOURS.map((c, i) => (
              <AnimatedPath
                key={i}
                d={c.d}
                fill="none"
                stroke={c.stroke}
                strokeWidth={1.6}
                strokeDasharray={`${c.len}`}
                strokeDashoffset={v.contours[i].interpolate({ inputRange: [0, 1], outputRange: [c.len, 0] })}
              />
            ))}
            <Path d={ROUTE_D} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth={9} strokeLinecap="round" />
            <AnimatedPath
              d={ROUTE_D}
              fill="none"
              stroke={SAGE_DEEP}
              strokeWidth={4.5}
              strokeLinecap="round"
              strokeDasharray={`${ROUTE_LEN}`}
              strokeDashoffset={v.route.interpolate({ inputRange: [0, 1], outputRange: [ROUTE_LEN, 0] })}
            />
            <AnimatedCircle
              cx={travelerCx}
              cy={travelerCy}
              r={7}
              fill={AMBER_SOFT}
              stroke={AMBER}
              strokeWidth={3}
              opacity={v.travelerOp}
            />
          </Svg>
          {PINS.map((pin, i) => (
            <Animated.View
              key={i}
              style={[
                styles.pin,
                {
                  left: pin.x - 20,
                  top: pin.y - 50,
                  opacity: v.pins[i],
                  transform: [
                    { translateY: v.pins[i].interpolate({ inputRange: [0, 1], outputRange: [-48, 0] }) },
                    { scale: v.pins[i].interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) },
                  ],
                },
              ]}
            >
              <PinSvg fill={pin.fill} />
            </Animated.View>
          ))}
          {TAGS.map((tag, i) => (
            <Animated.View
              key={i}
              style={[
                styles.tag,
                tag.sage && styles.tagSage,
                {
                  left: tag.x,
                  top: tag.y,
                  opacity: v.tags[i],
                  transform: [
                    { translateY: v.tags[i].interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                    { scale: v.tags[i].interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) },
                  ],
                },
              ]}
            >
              <Text style={[styles.tagText, tag.sage && styles.tagTextSage]}>{tag.label}</Text>
            </Animated.View>
          ))}
        </Animated.View>

        {/* ── Scene 4 — logo reveal ── */}
        <Animated.View
          style={[
            styles.logoTile,
            {
              opacity: v.logo,
              transform: [
                { scale: v.logo.interpolate({ inputRange: [0, 1], outputRange: [1.65, 1] }) },
                { rotate: v.logo.interpolate({ inputRange: [0, 1], outputRange: ['9deg', '0deg'] }) },
              ],
            },
          ]}
          pointerEvents="none"
        >
          <LogoBagSvg />
          <Animated.View
            style={[
              styles.tileSweep,
              {
                opacity: v.sheen.interpolate({ inputRange: [0, 0.05, 0.95, 1], outputRange: [0, 1, 1, 0] }),
                transform: [
                  { translateX: v.sheen.interpolate({ inputRange: [0, 1], outputRange: [-180, 340] }) },
                  { skewX: '-16deg' },
                ],
              },
            ]}
          >
            <GradientBand width={60} height={148} id="shimTile" />
          </Animated.View>
        </Animated.View>

        <View style={styles.wordmark} pointerEvents="none">
          {WORDMARK.map((l, i) => (
            <Animated.Text
              key={i}
              style={[
                styles.wm,
                {
                  color: l.color,
                  opacity: v.letters[i],
                  transform: [{ translateY: v.letters[i].interpolate({ inputRange: [0, 1], outputRange: [34, 0] }) }],
                },
              ]}
            >
              {l.ch}
            </Animated.Text>
          ))}
        </View>
        <Animated.Text style={[styles.tagline, captionStyle(v.tagline)]}>
          SMART FAMILY GROCERY LIST
        </Animated.Text>

        {/* Captions */}
        <Animated.Text style={[styles.caption, captionStyle(v.cap1)]}>VOICE-FIRST LISTS</Animated.Text>
        <Animated.View style={[styles.caption, styles.captionRow, captionStyle(v.cap2)]}>
          <Text style={styles.captionText}>PRIVATE BY DESIGN</Text>
          <View style={styles.capDot} />
          <Text style={styles.captionText}>ON-DEVICE</Text>
        </Animated.View>
        <Animated.Text style={[styles.caption, captionStyle(v.cap3)]}>SMART TRIP OPTIMIZER</Animated.Text>

        {/* Loop/exit fader */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: OAT, opacity: v.fader }]}
          pointerEvents="none"
        />
      </View>
    </View>
  );
}

// ─── Styles (450×800 design-space coordinates from the artifact) ────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: OAT,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  orb: { position: 'absolute' },

  // Scene 1 — speaker
  speaker: { position: 'absolute', left: 150, top: 330, width: 150, height: 110 },
  spGlow: {
    position: 'absolute',
    left: -12,
    top: 78,
    width: 174,
    height: 44,
    borderRadius: 87,
    backgroundColor: 'rgba(233,168,79,0.45)',
  },
  spBody: {
    position: 'absolute',
    left: 0,
    top: 8,
    width: 150,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#F3E8D3',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.8)',
    shadowColor: '#6E4C2D',
    shadowOpacity: 0.35,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 14 },
    elevation: 8,
    alignItems: 'center',
  },
  spSheen: {
    position: 'absolute',
    left: 14,
    top: 6,
    width: 122,
    height: 34,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  spBtn: {
    position: 'absolute',
    left: 62,
    top: 22,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#EFE3CB',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  spBtnLed: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AMBER,
    shadowColor: AMBER,
    shadowOpacity: 0.9,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },

  // Scene 1 — waveform
  wave: {
    position: 'absolute',
    left: 75,
    top: 236,
    width: 300,
    height: 96,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  wbar: {
    width: 5,
    height: 88,
    borderRadius: 3,
    backgroundColor: AMBER,
    shadowColor: AMBER,
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },

  // Scene 1 — glass list card
  listCard: {
    position: 'absolute',
    left: 50,
    top: 296,
    width: 350,
    height: 264,
    borderRadius: 30,
    padding: 26,
    backgroundColor: 'rgba(255,255,255,0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: '#784A28',
    shadowOpacity: 0.28,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 24 },
    elevation: 10,
    overflow: 'hidden',
  },
  lrow: { flexDirection: 'row', alignItems: 'center', height: 64, marginBottom: 12 },
  chip: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.38)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    shadowColor: '#784A28',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  llines: { marginLeft: 18, flex: 1 },
  lline: {
    height: 10,
    borderRadius: 5,
    backgroundColor: SKEL,
    opacity: 0.5,
    transformOrigin: 'left',
  },
  llineSub: { marginTop: 9, height: 8, opacity: 0.35 },
  lcheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginLeft: 10,
    backgroundColor: 'rgba(255,255,255,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shimmerBand: { position: 'absolute', top: 0, bottom: 0, width: 130 },

  // Scene 2 — shield
  shieldWrap: { position: 'absolute', left: 118, top: 300, width: 214, height: 248 },

  // Scene 3 — map
  mapPanel: {
    position: 'absolute',
    left: 35,
    top: 170,
    width: 380,
    height: 460,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.32)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    shadowColor: '#784A28',
    shadowOpacity: 0.28,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 24 },
    elevation: 10,
    overflow: 'hidden',
  },
  pin: { position: 'absolute', width: 40, height: 52 },
  tag: {
    position: 'absolute',
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(255,236,222,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(196,112,63,0.45)',
  },
  tagSage: {
    backgroundColor: 'rgba(232,242,226,0.5)',
    borderColor: 'rgba(95,127,87,0.45)',
  },
  tagText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, color: TERRA_DEEP },
  tagTextSage: { color: SAGE_DEEP },

  // Scene 4 — logo
  logoTile: {
    position: 'absolute',
    left: 151,
    top: 296,
    width: 148,
    height: 148,
    borderRadius: 42,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#604226',
    shadowOpacity: 0.32,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 30 },
    elevation: 12,
    overflow: 'hidden',
  },
  tileSweep: { position: 'absolute', top: 0, bottom: 0, width: 60 },
  wordmark: {
    position: 'absolute',
    left: 0,
    top: 478,
    width: DESIGN_W,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  wm: {
    fontFamily: SERIF,
    fontWeight: '600',
    fontSize: 42,
    lineHeight: 54,
  },
  tagline: {
    position: 'absolute',
    left: 0,
    top: 552,
    width: DESIGN_W,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 4,
    color: INK_SOFT,
  },

  // Captions
  caption: {
    position: 'absolute',
    left: 0,
    top: 706,
    width: DESIGN_W,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 3.8,
    color: INK_SOFT,
  },
  captionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  captionText: { fontSize: 12, fontWeight: '500', letterSpacing: 3.8, color: INK_SOFT },
  capDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: AMBER,
    marginHorizontal: 12,
    shadowColor: AMBER,
    shadowOpacity: 0.8,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
});
