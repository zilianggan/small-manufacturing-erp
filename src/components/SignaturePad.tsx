import React, { useRef, useState, useEffect } from 'react';
import { RotateCcw, Paintbrush } from 'lucide-react';

interface SignaturePadProps {
  value?: string;
  onChange: (dataUrl: string) => void;
}

export default function SignaturePad({ value, onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(!!value);

  // Initialize canvas context style
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Scale for high DPI screens
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    ctx.strokeStyle = '#1e3a8a'; // Deep blue ink
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // If there is an existing signature, draw it on the canvas
    if (value) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = value;
    }
  }, [value]);

  const getCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    
    const rect = canvas.getBoundingClientRect();
    
    // Check if touch event
    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      const touch = e.touches[0];
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top
      };
    } else {
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    }
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasDrawn(true);
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    const canvas = canvasRef.current;
    if (canvas && hasDrawn) {
      // Save canvas state back to parent
      const dataUrl = canvas.toDataURL('image/png');
      onChange(dataUrl);
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    setHasDrawn(false);
    onChange('');
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-slate-500 font-sans">
        <span className="flex items-center space-x-1 font-semibold text-slate-700">
          <Paintbrush className="w-3.5 h-3.5 text-blue-500" />
          <span>Draw with Mouse or Touch Screen</span>
        </span>
        {hasDrawn && (
          <button
            type="button"
            onClick={clearCanvas}
            className="flex items-center space-x-0.5 text-red-600 hover:text-red-700 hover:bg-red-50 px-1 py-0.5 rounded transition-colors font-medium"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Drawing</span>
          </button>
        )}
      </div>

      <div className="relative border border-slate-200 rounded-lg bg-white overflow-hidden shadow-inner group">
        <canvas
          ref={canvasRef}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          className="w-full h-24 bg-slate-50/50 cursor-crosshair touch-none block"
          style={{ width: '100%', height: '96px' }}
        />
        
        {!hasDrawn && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-slate-400 font-sans text-[10px] italic select-none">
            Sign here using your pointer or finger
          </div>
        )}
      </div>
    </div>
  );
}
