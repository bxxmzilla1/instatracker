import { useRef } from 'react';

interface HoverLoopVideoProps {
  src: string;
  className?: string;
  preload?: 'metadata' | 'none' | 'auto';
}

/** Shows the first frame until hovered, then plays muted on loop. */
export function HoverLoopVideo({ src, className, preload = 'metadata' }: HoverLoopVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);

  function playLoop() {
    const el = ref.current;
    if (!el) return;
    el.loop = true;
    el.muted = true;
    void el.play().catch(() => {});
  }

  function pauseStatic() {
    const el = ref.current;
    if (!el) return;
    el.pause();
    el.currentTime = 0;
  }

  return (
    <video
      ref={ref}
      className={className}
      src={src}
      preload={preload}
      playsInline
      muted
      onMouseEnter={playLoop}
      onMouseLeave={pauseStatic}
    />
  );
}
