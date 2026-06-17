import { useCallback, useEffect, useRef, useState } from 'react';

const OUTPUT_SIZE = 1000;
const VIEWPORT_SIZE = 320;

interface Props {
  file: File;
  title?: string;
  onConfirm: (blob: Blob) => void;
  onCancel: () => void;
}

function clampOffsets(
  offsetX: number,
  offsetY: number,
  imgW: number,
  imgH: number,
  coverScale: number,
  zoom: number,
): { x: number; y: number } {
  const totalScale = coverScale * zoom;
  const drawW = imgW * totalScale;
  const drawH = imgH * totalScale;
  const minX = Math.min(0, VIEWPORT_SIZE - drawW);
  const minY = Math.min(0, VIEWPORT_SIZE - drawH);
  return {
    x: Math.min(0, Math.max(minX, offsetX)),
    y: Math.min(0, Math.max(minY, offsetY)),
  };
}

export function SquareImageCropModal({
  file,
  title = 'Crop profile picture',
  onConfirm,
  onCancel,
}: Props) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const coverScale =
    imgSize.w > 0 && imgSize.h > 0
      ? Math.max(VIEWPORT_SIZE / imgSize.w, VIEWPORT_SIZE / imgSize.h)
      : 1;

  const applyOffset = useCallback(
    (x: number, y: number) => {
      if (!imgSize.w || !imgSize.h) return;
      setOffset(clampOffsets(x, y, imgSize.w, imgSize.h, coverScale, zoom));
    },
    [imgSize, coverScale, zoom],
  );

  useEffect(() => {
    if (!imgSize.w || !imgSize.h) return;
    setOffset((prev) => clampOffsets(prev.x, prev.y, imgSize.w, imgSize.h, coverScale, zoom));
  }, [zoom, imgSize, coverScale]);

  function onImageLoad(img: HTMLImageElement) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    setImgSize({ w, h });
    const cs = Math.max(VIEWPORT_SIZE / w, VIEWPORT_SIZE / h);
    const drawW = w * cs;
    const drawH = h * cs;
    setOffset({
      x: (VIEWPORT_SIZE - drawW) / 2,
      y: (VIEWPORT_SIZE - drawH) / 2,
    });
    setZoom(1);
  }

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    applyOffset(dragStart.current.ox + dx, dragStart.current.oy + dy);
  }

  function onPointerUp(e: React.PointerEvent) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  }

  async function handleConfirm() {
    const img = imageRef.current;
    if (!img || !imgSize.w || !imgSize.h) return;
    setSaving(true);
    try {
      const totalScale = coverScale * zoom;
      const srcX = -offset.x / totalScale;
      const srcY = -offset.y / totalScale;
      const srcSize = VIEWPORT_SIZE / totalScale;

      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not prepare crop.');
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Could not export crop.'))),
          'image/jpeg',
          0.92,
        );
      });
      onConfirm(blob);
    } finally {
      setSaving(false);
    }
  }

  const totalScale = coverScale * zoom;
  const drawW = imgSize.w * totalScale;
  const drawH = imgSize.h * totalScale;
  const drawX = offset.x;
  const drawY = offset.y;

  return (
    <div className="modal" onClick={onCancel}>
      <div className="modal__card modal__card--fit image-crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h3>{title}</h3>
          <button type="button" className="modal__close" onClick={onCancel} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="cred-note">Drag to reposition. Use the slider to zoom. The square area is what will be saved.</p>

        <div
          className="image-crop-modal__viewport"
          style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {imageUrl && (
            <img
              ref={imageRef}
              className="image-crop-modal__image"
              src={imageUrl}
              alt=""
              draggable={false}
              style={{
                width: drawW || undefined,
                height: drawH || undefined,
                left: drawX,
                top: drawY,
              }}
              onLoad={(e) => onImageLoad(e.currentTarget)}
            />
          )}
          <div className="image-crop-modal__frame" aria-hidden />
        </div>

        <label className="image-crop-modal__zoom">
          <span>Zoom</span>
          <input
            type="range"
            min={1}
            max={3}
            step={0.01}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>

        <div className="schedule-modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" onClick={() => void handleConfirm()} disabled={saving || !imgSize.w}>
            {saving ? 'Saving…' : 'Add to library'}
          </button>
        </div>
      </div>
    </div>
  );
}
