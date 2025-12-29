
import React, { useState } from 'react';
import { Upload, Eraser, Loader2, Download, RotateCcw, Image as ImageIcon, CheckCircle2, Wand2 } from 'lucide-react';
import { AppStatus } from './types';
import Editor from './components/Editor';
import { cleanupImage } from './services/clipdrop';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setImageSrc(event.target?.result as string);
        setImageFile(file);
        setStatus(AppStatus.EDITING);
        setError(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleProcess = async (maskBlob: Blob) => {
    if (!imageFile) return;

    try {
      setStatus(AppStatus.PROCESSING);
      const resultBlob = await cleanupImage(imageFile, maskBlob);
      const url = URL.createObjectURL(resultBlob);
      setResultImage(url);
      setStatus(AppStatus.RESULT);
    } catch (err: any) {
      setError(err.message || 'Failed to process image. Please try again.');
      setStatus(AppStatus.EDITING);
    }
  };

  const reset = () => {
    setImageSrc(null);
    setImageFile(null);
    setResultImage(null);
    setStatus(AppStatus.IDLE);
    setError(null);
  };

  const downloadResult = () => {
    if (!resultImage) return;
    const link = document.createElement('a');
    link.href = resultImage;
    link.download = 'cleaned-image.png';
    link.click();
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-slate-950 py-10 px-4">
      <header className="text-center mb-8 flex flex-col items-center">
        <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-500/20 mb-4">
          <Wand2 className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-3xl font-black tracking-tight text-white uppercase">
          CleanUp <span className="text-indigo-500">Engine</span>
        </h1>
        <p className="mt-2 text-slate-400 max-w-md">
          Professional AI object removal tool. Paint, process, and perfect your shots.
        </p>
      </header>

      <main className="w-full max-w-5xl">
        {status === AppStatus.IDLE && (
          <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-16 shadow-2xl flex flex-col items-center justify-center text-center">
            <div className="border-2 border-dashed border-slate-700 rounded-3xl p-16 bg-slate-900 hover:bg-slate-800/50 hover:border-indigo-500 transition-all cursor-pointer group relative w-full max-w-xl">
              <input
                type="file"
                className="absolute inset-0 opacity-0 cursor-pointer"
                accept="image/*"
                onChange={handleFileChange}
              />
              <div className="bg-slate-800 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 group-hover:bg-indigo-600 transition-all">
                <Upload className="w-10 h-10 text-slate-400 group-hover:text-white transition-colors" />
              </div>
              <h3 className="text-white text-xl font-bold mb-2">Upload Source Image</h3>
              <p className="text-slate-500 font-medium">Click or drag a photo to begin cleaning</p>
              <div className="mt-8 flex gap-2 justify-center">
                {['JPG', 'PNG', 'WEBP'].map(type => (
                  <span key={type} className="px-3 py-1 bg-slate-800 rounded-md text-[10px] font-bold text-slate-400 tracking-widest">{type}</span>
                ))}
              </div>
            </div>
          </div>
        )}

        {status === AppStatus.EDITING && imageSrc && (
          <div className="animate-in fade-in duration-500 slide-in-from-bottom-4">
            {error && (
              <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm flex items-center gap-3">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                {error}
              </div>
            )}
            <Editor imageSrc={imageSrc} onProcess={handleProcess} />
            <div className="mt-6 flex justify-center">
               <button
                onClick={reset}
                className="text-slate-500 hover:text-white flex items-center gap-2 text-sm font-bold uppercase tracking-widest transition-colors"
              >
                <RotateCcw className="w-4 h-4" /> Cancel & New Image
              </button>
            </div>
          </div>
        )}

        {status === AppStatus.PROCESSING && (
          <div className="bg-slate-900 border border-slate-800 rounded-[2rem] p-32 flex flex-col items-center justify-center text-center shadow-2xl">
            <div className="relative mb-10">
              <div className="w-24 h-24 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Wand2 className="w-8 h-8 text-indigo-500 animate-pulse" />
              </div>
            </div>
            <h3 className="text-2xl font-black text-white uppercase tracking-tighter">Analyzing & Reconstructing</h3>
            <p className="mt-3 text-slate-400 font-medium max-w-xs mx-auto">Our AI is generating realistic textures to fill the missing spaces...</p>
          </div>
        )}

        {status === AppStatus.RESULT && resultImage && (
          <div className="animate-in zoom-in-95 duration-500">
            <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 shadow-2xl overflow-hidden">
              <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
                <div className="flex items-center gap-4">
                  <div className="bg-green-500/10 p-3 rounded-xl">
                    <CheckCircle2 className="w-6 h-6 text-green-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-black text-white uppercase tracking-tight">Cleanup Complete</h2>
                    <p className="text-slate-500 text-sm">Objects removed successfully.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setStatus(AppStatus.EDITING)}
                    className="px-6 py-3 bg-slate-800 text-white font-bold text-sm hover:bg-slate-700 rounded-xl transition-all flex items-center gap-2 border border-slate-700"
                  >
                    <RotateCcw className="w-4 h-4" /> Edit More
                  </button>
                   <button
                    onClick={reset}
                    className="px-6 py-3 bg-indigo-600/10 text-indigo-400 font-bold text-sm hover:bg-indigo-600 hover:text-white rounded-xl transition-all flex items-center gap-2"
                  >
                    <ImageIcon className="w-4 h-4" /> Start New
                  </button>
                </div>
              </div>

              <div className="rounded-2xl overflow-hidden shadow-2xl bg-black flex items-center justify-center group relative border border-slate-800">
                <img src={resultImage} alt="Result" className="max-w-full h-auto object-contain max-h-[70vh]" />
                <div className="absolute inset-0 bg-indigo-500/0 group-hover:bg-indigo-500/5 transition-all pointer-events-none" />
              </div>

              <div className="mt-10 flex justify-center">
                <button
                  onClick={downloadResult}
                  className="flex items-center gap-3 bg-white text-slate-950 px-12 py-5 rounded-2xl font-black text-lg hover:bg-indigo-50 transition-all shadow-[0_20px_40px_rgba(255,255,255,0.1)] hover:scale-105 active:scale-95"
                >
                  <Download className="w-6 h-6" />
                  Download Master Image
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-16 flex flex-col items-center gap-4">
        <div className="h-px w-20 bg-slate-800" />
        <p className="text-slate-600 text-xs font-bold uppercase tracking-[0.3em]">
          Clipdrop Intelligence Platform
        </p>
      </footer>
    </div>
  );
};

export default App;
