import { useRef, useCallback } from 'react';

interface HoverLoopVideoProps {
  src: string;
  className?: string;
  preload?: 'metadata' | 'none' | 'auto';
  /**
   * When true, only the first frame is shown and the clip never plays on hover.
   * Used in dense lists (e.g. the schedule) to keep the UI light — the browser
   * loads just enough metadata to render one frame instead of the whole video.
   */
  staticFrame?: boolean;
}

/** Shows the first frame until hovered, then plays muted on loop. */
export function HoverLoopVideo({
  src,
  className,
  preload = 'metadata',
  staticFrame = false,
}: HoverLoopVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);

  const showFirstFrame = useCallback(() => {
    const el = ref.current;
    if (!el || el.currentTime > 0) return;
    try {
      el.currentTime = 0.001;
    } catch {
      // ignore seek errors before metadata is ready
    }
  }, []);

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
    el.currentTime = 0.001;
  }

  if (staticFrame) {
    return (
      <video
        ref={ref}
        className={className}
        // The media fragment hints the browser to render the first frame
        // without downloading the full clip.
        src={`${src}#t=0.001`}
        preload="metadata"
        playsInline
        muted
        tabIndex={-1}
        onLoadedData={showFirstFrame}
      />
    );
  }

  return (
    <video
      ref={ref}
      className={className}
      src={src}
      preload={preload}
      playsInline
      muted
      onLoadedData={showFirstFrame}
      onMouseEnter={playLoop}
      onMouseLeave={pauseStatic}
    />
  );
}
