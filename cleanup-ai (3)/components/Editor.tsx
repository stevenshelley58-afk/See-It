
import React, { useRef, useEffect, useState } from 'react';
import { Undo2, Trash2, Send, Info } from 'lucide-react';

interface EditorProps {
  imageSrc: string;
  onProcess: (maskBlob: Blob) => void;
}

interface Stroke {
  points: { x: number; y: number }[];
  brushSize: number;
}

const Editor: React.FC<EditorProps> = ({ imageSrc, onProcess }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const visualCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(50);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number }[]>([]);
  const [imgElement, setImgElement] = useState<HTMLImageElement | null>(null);
  const [dimensions, setDimensions] = useState({ uiW: 0, uiH: 0, natW: 0, natH: 0 });

  useEffect(() => {
    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      if (!containerRef.current) return;
      const maxWidth = containerRef.current.clientWidth - 80;
      const maxHeight = window.innerHeight * 0.6;
      
      let scale = maxWidth / img.naturalWidth;
      if (img.naturalHeight * scale > maxHeight) {
        scale = maxHeight / img.naturalHeight;
      }

      const uiW = img.naturalWidth * scale;
      const uiH = img.naturalHeight * scale;

      setImgElement(img);
      setDimensions({ uiW, uiH, natW: img.naturalWidth, natH: img.naturalHeight });
      setStrokes([]);
    };
  }, [imageSrc]);

  useEffect(() => {
    if (!imgElement || !visualCanvasRef.current || !maskCanvasRef.current) return;

    const vCtx = visualCanvasRef.current.getContext('2d');
    const mCtx = maskCanvasRef.current.getContext('2d');
    if (!vCtx || !mCtx) return;

    vCtx.canvas.width = dimensions.uiW;
    vCtx.canvas.height = dimensions.uiH;
    vCtx.drawImage(imgElement, 0, 0, dimensions.uiW, dimensions.uiH);

    mCtx.canvas.width = dimensions.natW;
    mCtx.canvas.height = dimensions.natH;
    mCtx.fillStyle = 'black';
    mCtx.fillRect(0, 0, dimensions.natW, dimensions.natH);

    const scale = dimensions.natW / dimensions.uiW;

    const allStrokes = [...strokes];
    if (currentStroke.length > 0) {
      allStrokes.push({ points: currentStroke, brushSize });
    }

    allStrokes.forEach(stroke => {
      // VISUAL: Cyan highlighter on screen
      vCtx.strokeStyle = 'rgba(6, 182, 212, 0.6)';
      vCtx.lineCap = 'round';
      vCtx.lineJoin = 'round';
      vCtx.lineWidth = stroke.brushSize;

      // MASK: Pure hard white for the AI (Crucial for removal vs blur)
      mCtx.strokeStyle = 'white';
      mCtx.lineCap = 'round';
      mCtx.lineJoin = 'round';
      mCtx.lineWidth = stroke.brushSize * scale;

      if (stroke.points.length > 0) {
        vCtx.beginPath();
        mCtx.beginPath();
        vCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
        mCtx.moveTo(stroke.points[0].x * scale, stroke.points[0].y * scale);
        
        stroke.points.forEach(p => {
          vCtx.lineTo(p.x, p.y);
          mCtx.lineTo(p.x * scale, p.y * scale);
        });
        
        vCtx.stroke();
        mCtx.stroke();
      }
    });
  }, [strokes, currentStroke, dimensions, imgElement, brushSize]);

  const getCoords = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = visualCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height)
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    setIsDrawing(true);
    setCurrentStroke([getCoords(e)]);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    const newPoint = getCoords(e);
    setCurrentStroke(prev => [...prev, newPoint]);
  };

  const stopDrawing = () => {
    if (isDrawing && currentStroke.length > 0) {
      setStrokes(prev => [...prev, { points: currentStroke, brushSize }]);
    }
    setIsDrawing(false);
    setCurrentStroke([]);
  };

  const handleProcessClick = () => {
    if (!maskCanvasRef.current || strokes.length === 0) return;
    maskCanvasRef.current.toBlob((blob) => {
      if (blob) onProcess(blob);
    }, 'image/png');
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 rounded-[2rem] overflow-hidden border border-slate-800 shadow-2xl">
      {/* Utility Bar */}
      <div className="bg-slate-800/40 px-6 py-4 flex justify-between items-center border-b border-slate-800">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setStrokes(prev => prev.slice(0, -1))} 
            disabled={strokes.length === 0}
            className="p-2.5 bg-slate-800 text-slate-400 hover:text-white rounded-xl disabled:opacity-20 transition-all border border-slate-700"
          >
            <Undo2 size={18} />
          </button>
          <button 
            onClick={() => setStrokes([])} 
            disabled={strokes.length === 0}
            className="p-2.5 bg-slate-800 text-slate-400 hover:text-red-400 rounded-xl disabled:opacity-20 transition-all border border-slate-700"
          >
            <Trash2 size={18} />
          </button>
        </div>
        
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
          Full Resolution Engine
        </div>

        <div className="hidden sm:flex items-center gap-3 bg-indigo-500/10 px-3 py-1.5 rounded-lg border border-indigo-500/20">
          <Info size={14} className="text-indigo-400" />
          <span className="text-[10px] text-indigo-300 font-bold uppercase">Pro Tip: Include Shadows</span>
        </div>
      </div>

      {/* Workspace Area */}
      <div 
        ref={containerRef}
        className="relative flex-1 bg-slate-950 p-12 flex items-center justify-center overflow-hidden min-h-[550px]"
        onMouseDown={startDrawing}
        onMouseMove={draw}
        onMouseUp={stopDrawing}
        onMouseLeave={stopDrawing}
        onTouchStart={startDrawing}
        onTouchMove={draw}
        onTouchEnd={stopDrawing}
      >
        <div className="relative group p-0.5 bg-cyan-500/30 rounded-sm border border-cyan-500/40 shadow-[0_0_50px_rgba(6,182,212,0.15)] transition-all">
          
          {/* Reference Cyan Handles */}
          {/* Corners */}
          <div className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full z-20 shadow-lg cursor-nw-resize" />
          <div className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full z-20 shadow-lg cursor-ne-resize" />
          <div className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full z-20 shadow-lg cursor-sw-resize" />
          <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-white border-2 border-cyan-500 rounded-full z-20 shadow-lg cursor-se-resize" />
          
          {/* Centers */}
          <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-4 h-2.5 bg-white border-2 border-cyan-500 rounded-full z-20 shadow-lg cursor-w-resize" />
          <div className="absolute top-1/2 -right-1.5 -translate-y-1/2 w-4 h-2.5 bg-white border-2 border-cyan-500 rounded-full z-20 shadow-lg cursor-e-resize" />
          <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-2.5 h-4 bg-white border-2 border-cyan-500 rounded-full z-20 shadow-lg cursor-n-resize" />
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-2.5 h-4 bg-white border-2 border-cyan-500 rounded-full z-20 shadow-lg cursor-s-resize" />

          {/* Top Rotation Handle */}
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 flex flex-col items-center">
            <div className="w-0.5 h-6 bg-cyan-500/50" />
            <div className="w-8 h-8 bg-white border-2 border-cyan-500 rounded-full flex items-center justify-center shadow-xl cursor-grab active:cursor-grabbing">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-slate-700">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
              </svg>
            </div>
          </div>

          <canvas 
            ref={visualCanvasRef} 
            className="block shadow-2xl cursor-crosshair touch-none bg-black rounded-sm"
          />
        </div>
        <canvas ref={maskCanvasRef} className="hidden" />
      </div>

      {/* Control Panel */}
      <div className="bg-slate-800 p-8 flex flex-col md:flex-row items-center justify-between gap-8 border-t border-slate-700">
        <div className="flex flex-col gap-4 w-full md:w-auto">
          <div className="flex justify-between items-center px-1">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Brush Thickness</span>
            <span className="text-xs font-bold text-cyan-400">{brushSize}px</span>
          </div>
          <div className="flex items-center gap-5">
             <input 
              type="range" 
              min="10" 
              max="200" 
              value={brushSize} 
              onChange={(e) => setBrushSize(parseInt(e.target.value))}
              className="w-full md:w-64 h-2 bg-slate-700 rounded-full appearance-none cursor-pointer accent-cyan-500 hover:accent-cyan-400 transition-all"
            />
            <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-700 flex items-center justify-center">
              <div 
                className="bg-cyan-500 rounded-full shadow-[0_0_15px_rgba(6,182,212,0.5)] transition-all duration-100" 
                style={{ width: `${Math.max(4, brushSize / 4)}px`, height: `${Math.max(4, brushSize / 4)}px` }}
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleProcessClick}
          disabled={strokes.length === 0}
          className="w-full md:w-auto group relative flex items-center justify-center gap-3 bg-white text-slate-950 px-12 py-5 rounded-2xl font-black text-lg hover:bg-cyan-50 disabled:bg-slate-700 disabled:text-slate-500 transition-all shadow-xl active:scale-95"
        >
          <Send className="w-6 h-6 group-hover:translate-x-1 transition-transform" />
          Remove Objects
          {strokes.length > 0 && (
            <span className="absolute -top-2 -right-2 bg-cyan-500 text-white text-[10px] w-6 h-6 flex items-center justify-center rounded-full shadow-lg border-2 border-slate-800">
              {strokes.length}
            </span>
          )}
        </button>
      </div>
    </div>
  );
};

export default Editor;
