import { isImageFile, isVideoFile } from './content';

/** 720p display bounds (1280×720 landscape, 720×1280 portrait). */
export const DISPLAY_MAX_WIDTH = 1280;
export const DISPLAY_MAX_HEIGHT = 720;

export function fit720pBounds(
  width: number,
  height: number,
): { width: number; height: number; scale: number } {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1, scale: 1 };
  }
  const scale = Math.min(1, DISPLAY_MAX_WIDTH / width, DISPLAY_MAX_HEIGHT / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

function loadVideoMetadata(video: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    video.preload = 'metadata';
    video.playsInline = true;
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Could not read video metadata.'));
    video.src = url;
  });
}

export async function prepareImageForLibrary(file: Blob): Promise<Blob> {
  if (!file.type.startsWith('image/')) return file;

  const bitmap = await createImageBitmap(file);
  try {
    const { width, height, scale } = fit720pBounds(bitmap.width, bitmap.height);
    if (scale >= 1) return file;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const mimeType = file.type.includes('png') ? 'image/png' : 'image/jpeg';
    const quality = mimeType === 'image/png' ? undefined : 0.84;
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((result) => resolve(result), mimeType, quality);
    });
    return blob ?? file;
  } finally {
    bitmap.close();
  }
}

async function transcodeVideoTo720p(
  file: Blob,
  targetWidth: number,
  targetHeight: number,
): Promise<Blob | null> {
  if (typeof MediaRecorder === 'undefined') return null;

  const mimeCandidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mimeType) return null;

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.playsInline = true;
  video.muted = false;

  try {
    await loadVideoMetadata(video, url);

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const canvasStream = canvas.captureStream(30);
    const sourceStream = typeof video.captureStream === 'function' ? video.captureStream() : null;
    const audioTracks = sourceStream?.getAudioTracks() ?? [];
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 1_500_000,
      audioBitsPerSecond: 128_000,
    });

    const chunks: BlobPart[] = [];

    return await new Promise<Blob | null>((resolve) => {
      let stopped = false;
      const stopRecording = () => {
        if (stopped) return;
        stopped = true;
        if (recorder.state !== 'inactive') recorder.stop();
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        const type = mimeType.split(';')[0] ?? 'video/mp4';
        resolve(chunks.length > 0 ? new Blob(chunks, { type }) : null);
      };
      recorder.onerror = () => resolve(null);

      video.onended = stopRecording;
      recorder.start(200);

      const draw = () => {
        if (stopped) return;
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
        if (!video.ended && !video.paused) requestAnimationFrame(draw);
      };

      video.onplay = () => draw();
      void video.play().catch(() => resolve(null));

      const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 + 2000 : 120_000;
      window.setTimeout(stopRecording, durationMs);
    });
  } catch {
    return null;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function prepareVideoForLibrary(
  file: Blob,
  onProgress?: (message: string) => void,
): Promise<Blob> {
  if (!file.type.startsWith('video/')) return file;

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.playsInline = true;

  try {
    await loadVideoMetadata(video, url);
    const { width, height, scale } = fit720pBounds(video.videoWidth, video.videoHeight);
    if (scale >= 1) return file;

    onProgress?.('Optimizing video to 720p…');
    const optimized = await transcodeVideoTo720p(file, width, height);
    if (!optimized) return file;

    // Bluesky publishing requires MP4 — keep the original when we cannot produce one.
    if (file.type.includes('mp4') && !optimized.type.includes('mp4')) {
      return file;
    }

    return optimized.size > 0 && optimized.size < file.size ? optimized : file;
  } catch {
    return file;
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function prepareMediaForLibrary(
  file: Blob,
  fileName?: string,
  onProgress?: (message: string) => void,
): Promise<Blob> {
  const name = fileName ?? (file instanceof File ? file.name : undefined);
  if (isImageFile(file, name)) return prepareImageForLibrary(file);
  if (isVideoFile(file, name)) return prepareVideoForLibrary(file, onProgress);
  return file;
}
