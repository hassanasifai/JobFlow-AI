'use client';

// PageTransition — wraps page content with a soft fade/slide on mount.
// Keyed by the current route so navigating between pages re-runs the
// animation, giving the dashboard a "considered" feel without being slow.

import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { pageTransition } from '@/lib/motion';

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial="hidden"
        animate="visible"
        exit="exit"
        variants={pageTransition}
        className="relative z-10"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
