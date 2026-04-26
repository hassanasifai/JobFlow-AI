// src/lib/motion.ts
// Shared motion vocabulary — every animated component imports presets from
// here so we never re-invent spring stiffness or fade durations across
// pages. One source of truth = one feel across the whole app.

import type { Transition, Variants } from 'motion/react';

/* ── Springs ────────────────────────────────────────────────────────── */

/** Default spring — snappy, no overshoot. Use for entrances and reorders. */
export const spring: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 32,
  mass: 0.7,
};

/** Bouncier spring — for emphasis (button presses, dialog opens). */
export const springBouncy: Transition = {
  type: 'spring',
  stiffness: 420,
  damping: 18,
  mass: 0.5,
};

/** Slow spring — for ambient/decorative motion (sidebar collapses, drawers). */
export const springSlow: Transition = {
  type: 'spring',
  stiffness: 180,
  damping: 28,
};

/* ── Fade + slide variants ─────────────────────────────────────────── */

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: spring },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25, ease: [0.2, 0.7, 0.2, 1] } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: spring },
};

export const slideRight: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: spring },
};

/* ── Stagger containers ────────────────────────────────────────────── */

/** Wrap a list-of-children with this to stagger their `fadeUp` reveals. */
export const stagger: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

export const staggerSlow: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.09, delayChildren: 0.08 },
  },
};

/* ── Page transitions ─────────────────────────────────────────────── */

/** Used by <PageTransition> to fade between routes. */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.2, 0.7, 0.2, 1] } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } },
};

/* ── Hover + tap interactions ─────────────────────────────────────── */

/** Subtle lift on hover — paired with a shadow boost in CSS. */
export const hoverLift = { y: -2, transition: spring } as const;

/** Tap feedback for buttons — pushed in slightly. */
export const tapPress = { scale: 0.97 } as const;

/* ── Score / metric reveal ────────────────────────────────────────── */

/** SVG arc fill animation — used by ScoreRing. */
export const arcFill = {
  initial: { pathLength: 0, opacity: 0.6 },
  animate: (target: number) => ({
    pathLength: target,
    opacity: 1,
    transition: { duration: 1.1, ease: [0.4, 0, 0.2, 1] },
  }),
};

/* ── Dialog / sheet entrance ──────────────────────────────────────── */

export const dialogIn: Variants = {
  hidden: { opacity: 0, y: 12, scale: 0.97 },
  visible: { opacity: 1, y: 0, scale: 1, transition: springBouncy },
  exit: { opacity: 0, scale: 0.98, transition: { duration: 0.15 } },
};
