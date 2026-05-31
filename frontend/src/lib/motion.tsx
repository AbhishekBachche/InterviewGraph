import { motion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";

const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

type MotionPageProps = HTMLMotionProps<"div"> & {
  children: ReactNode;
};

/** Page content enter animation — respects reduced motion via Framer. */
export function MotionPage({ children, className, ...props }: MotionPageProps) {
  return (
    <motion.div
      className={className}
      variants={fadeUp}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export function MotionFade({ children, className, ...props }: MotionPageProps) {
  return (
    <motion.div
      className={className}
      variants={fade}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.2 }}
      {...props}
    >
      {children}
    </motion.div>
  );
}

export { motion };
