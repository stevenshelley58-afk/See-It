
import React, { useState } from 'react';
import { Upload, Download, RotateCcw, Image as ImageIcon, CheckCircle2, Wand2, Zap, BrainCircuit, Timer, Loader2 } from 'lucide-react';
import { AppStatus } from './types';
import Editor from './components/Editor';
import { cleanupImage } from './services/clipdrop';
import { cleanupImageGemini } from './services/gemini';

interface EngineResult {
  url: string | null;
  time: number | null;
  error: string | null;
}

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  
  const [clipdrop, setClipdrop] = useState<EngineResult>({ url: null, time: null, error: null });
  const [gemini, setGemini] = useState<EngineResult>({ url: null, time: null, error: null });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageSrc(event.target?.result as string);
        setImageFile(file);
        setStatus(AppStatus.EDITING);
        setClipdrop({ url: null, time: null, error: null });
        setGemini({ url: null, time: null, error: null });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProcess = async (maskBlob: Blob) => {
    if (!imageFile) return;
    setStatus(AppStatus.PROCESSING);

    // Run both in parallel
    const start = Date.now();

    const processClipdrop = async () => {
      const t0 = Date.now();
      try {
        const blob = await cleanupImage(imageFile, maskBlob);
        setClipdrop({ url: URL.createObjectURL(blob), time: (Date.now() - t0) / 1000, error: null });
      } catch (e: any) {
        setClipdrop(prev => ({ ...prev, error: e.message }));
      }
    };

    const processGemini = async () => {
      const t0 = Date.now();
      try {
        const blob = await cleanupImageGemini(imageFile, maskBlob);
        setGemini({ url: URL.createObjectURL(blob), time: (Date.now() - t0) / 1000, error: null });
      } catch (e: any) {
        setGemini(prev => ({ ...prev, error: e.message }));
      }
    };

    await Promise.all([processClipdrop(), processGemini()]);
    setStatus(AppStatus.RESULT);
  };

  const reset = () => {
    setImageSrc(null);
    setImageFile(null);
    setClipdrop({ url: null, time: null, error: null });
    setGemini({ url: null, time: null, error: null });
    setStatus(AppStatus.IDLE);
  };

  const download = (url: string, name: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name}-cleaned.png`;
    link.click();
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-slate-950 py-10 px-4">
      <header className="text-center mb-8 flex flex-col items-center">
        <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-500/20 mb-4 flex gap-2">
          <Wand2 className="w-6 h-6 text-white" />
          <div className="w-px h-6 bg-white/20" />
          <BrainCircuit className="w-6 h-6 text-white" />
        </div>
        <h1 className="text-3xl font-black tracking-tight text-white uppercase">
          Cleanup <span className="text-indigo-500">Benchmark</span>
        </h1>
        <p className="mt-2 text-slate-400 max-w-md text-sm font-medium">
          Compare Clipdrop vs Imagen 3 (Gemini) performance and quality side-by-side.
        </p>
      </header>

      <main className="w-full max-w-6xl">
        {status === AppStatus.IDLE && (
          <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-16 shadow-2xl flex flex-col items-center justify-center text-center">
            <div className="border-2 border-dashed border-slate-700 rounded-3xl p-16 bg-slate-900 hover:bg-slate-800/50 hover:border-indigo-500 transition-all cursor-pointer group relative w-full max-w-xl">
              <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" accept="image/*" onChange={handleFileChange} />
              <div className="bg-slate-800 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 group-hover:bg-indigo-600 transition-all">
                <Upload className="w-10 h-10 text-slate-400 group-hover:text-white transition-colors" />
              </div>
              <h3 className="text-white text-xl font-bold mb-2">Upload Reference Image</h3>
              <p className="text-slate-500 font-medium">Test removal quality across two state-of-the-art models</p>
            </div>
          </div>
        )}

        {status === AppStatus.EDITING && imageSrc && (
          <div className="animate-in fade-in duration-500 slide-in-from-bottom-4">
            <Editor imageSrc={imageSrc} onProcess={handleProcess} />
            <div className="mt-6 flex justify-center">
               <button onClick={reset} className="text-slate-500 hover:text-white flex items-center gap-2 text-xs font-black uppercase tracking-widest transition-colors">
                <RotateCcw className="w-3 h-3" /> Start Over
              </button>
            </div>
          </div>
        )}

        {status === AppStatus.PROCESSING && (
          <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-32 flex flex-col items-center justify-center text-center shadow-2xl">
            <div className="flex gap-8 mb-10">
              <div className="relative">
                <div className="w-20 h-20 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin" />
                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-indigo-400">CD</div>
              </div>
              <div className="relative">
                <div className="w-20 h-20 border-4 border-cyan-500/10 border-t-cyan-500 rounded-full animate-spin [animation-delay:-0.5s]" />
                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-black text-cyan-400">GEM</div>
              </div>
            </div>
            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Dual Engine Reconstruction</h3>
            <p className="mt-3 text-slate-400 font-medium max-w-xs mx-auto">Running parallel cleanup requests to Clipdrop and Gemini Flash Image...</p>
          </div>
        )}

        {status === AppStatus.RESULT && (
          <div className="animate-in zoom-in-95 duration-500 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* CLIPDROP COLUMN */}
              <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-6 shadow-2xl overflow-hidden flex flex-col">
                <div className="flex justify-between items-center mb-4 px-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-indigo-500/20 p-2 rounded-lg">
                      <Zap className="w-4 h-4 text-indigo-400" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase tracking-widest">Clipdrop</h4>
                      <p className="text-[10px] text-slate-500 font-bold">Standard Cleanup API</p>
                    </div>
                  </div>
                  {clipdrop.time && (
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 rounded-full border border-slate-700">
                      <Timer className="w-3 h-3 text-slate-400" />
                      <span className="text-[10px] font-black text-white">{clipdrop.time.toFixed(2)}s</span>
                    </div>
                  )}
                </div>
                
                <div className="flex-1 bg-black rounded-2xl overflow-hidden border border-slate-800 relative group aspect-video flex items-center justify-center">
                  {clipdrop.error ? (
                    <div className="text-red-400 text-xs p-4 text-center">{clipdrop.error}</div>
                  ) : clipdrop.url ? (
                    <img src={clipdrop.url} alt="Clipdrop Result" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <Loader2 className="animate-spin text-slate-700" />
                  )}
                </div>

                <button 
                  onClick={() => clipdrop.url && download(clipdrop.url, 'clipdrop')}
                  disabled={!clipdrop.url}
                  className="mt-4 w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> Download Result
                </button>
              </div>

              {/* GEMINI COLUMN */}
              <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-6 shadow-2xl overflow-hidden flex flex-col">
                 <div className="flex justify-between items-center mb-4 px-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-cyan-500/20 p-2 rounded-lg">
                      <BrainCircuit className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase tracking-widest">Imagen (Gemini)</h4>
                      <p className="text-[10px] text-slate-500 font-bold">2.5 Flash Image Generative</p>
                    </div>
                  </div>
                  {gemini.time && (
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-slate-800 rounded-full border border-slate-700">
                      <Timer className="w-3 h-3 text-slate-400" />
                      <span className="text-[10px] font-black text-white">{gemini.time.toFixed(2)}s</span>
                    </div>
                  )}
                </div>

                <div className="flex-1 bg-black rounded-2xl overflow-hidden border border-slate-800 relative group aspect-video flex items-center justify-center">
                  {gemini.error ? (
                    <div className="text-red-400 text-xs p-4 text-center">{gemini.error}</div>
                  ) : gemini.url ? (
                    <img src={gemini.url} alt="Gemini Result" className="max-w-full max-h-full object-contain" />
                  ) : (
                    <Loader2 className="animate-spin text-slate-700" />
                  )}
                </div>

                <button 
                  onClick={() => gemini.url && download(gemini.url, 'gemini')}
                  disabled={!gemini.url}
                  className="mt-4 w-full py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> Download Result
                </button>
              </div>

            </div>

            <div className="flex justify-center gap-4">
              <button onClick={() => setStatus(AppStatus.EDITING)} className="px-8 py-4 bg-slate-800 text-white font-bold text-sm hover:bg-slate-700 rounded-2xl transition-all flex items-center gap-2 border border-slate-700">
                <RotateCcw className="w-4 h-4" /> Edit Again
              </button>
              <button onClick={reset} className="px-8 py-4 bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-500 rounded-2xl transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20">
                <ImageIcon className="w-4 h-4" /> New Benchmark
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-16 flex flex-col items-center gap-4">
        <div className="h-px w-20 bg-slate-800" />
        <p className="text-slate-600 text-[10px] font-black uppercase tracking-[0.4em]">
          Engine Comparison Hub
        </p>
      </footer>
    </div>
  );
};

export default App;
