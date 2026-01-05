'use client';

import { useState, useRef } from 'react';
import { TEST_PRODUCTS } from '@/lib/products';

type Step = 'capture' | 'product' | 'generating' | 'select' | 'success' | 'adjust';

interface Variant {
  id: string;
  imageBase64: string | null;
  hint: string;
}

export default function Home() {
  const [step, setStep] = useState<Step>('capture');
  const [roomImage, setRoomImage] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<typeof TEST_PRODUCTS[0] | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [generating, setGenerating] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Handle file selection
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      setRoomImage(base64);
      setStep('product');
    };
    reader.readAsDataURL(file);
  };

  // Generate variants
  const generateVariants = async () => {
    if (!roomImage || !selectedProduct) return;
    
    setStep('generating');
    setGenerating(true);
    setError(null);

    try {
      // Strip data URL prefix to get just the base64
      const base64Data = roomImage.split(',')[1];

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomImageBase64: base64Data,
          productId: selectedProduct.id,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Generation failed');
      }

      const data = await res.json();
      setVariants(data.variants);
      setDuration(data.duration);
      setStep('select');

    } catch (err) {
      setError(String(err));
      setStep('product');
    } finally {
      setGenerating(false);
    }
  };

  // Handle variant selection
  const handleSelectVariant = (variant: Variant) => {
    setSelectedVariant(variant);
    setStep('success');
  };

  // Reset to start
  const reset = () => {
    setStep('capture');
    setRoomImage(null);
    setSelectedProduct(null);
    setVariants([]);
    setSelectedVariant(null);
    setDuration(null);
    setError(null);
  };

  return (
    <div className="min-h-screen p-4 max-w-md mx-auto">
      {/* Header */}
      <div className="text-center mb-6 pt-4">
        <h1 className="text-xl font-semibold text-neutral-800">See It 2</h1>
        <p className="text-sm text-neutral-500">Hero Shot Test</p>
      </div>

      {/* Step: Capture Room */}
      {step === 'capture' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-neutral-200">
            <h2 className="text-lg font-medium text-neutral-800 mb-4">
              Take a photo of your room
            </h2>
            
            <div className="space-y-3">
              {/* Camera */}
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="w-full py-4 bg-neutral-900 text-white rounded-xl font-medium hover:bg-neutral-800 transition"
              >
                📷 Take Photo
              </button>
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleImageSelect}
                className="hidden"
              />

              {/* Upload */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 bg-neutral-100 text-neutral-700 rounded-xl font-medium hover:bg-neutral-200 transition"
              >
                📁 Upload Photo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
            </div>
          </div>
        </div>
      )}

      {/* Step: Select Product */}
      {step === 'product' && (
        <div className="space-y-4">
          {/* Room preview */}
          {roomImage && (
            <div className="rounded-xl overflow-hidden shadow-sm">
              <img src={roomImage} alt="Your room" className="w-full h-48 object-cover" />
            </div>
          )}

          <div className="bg-white rounded-2xl p-4 shadow-sm border border-neutral-200">
            <h2 className="text-lg font-medium text-neutral-800 mb-3">
              Select a product
            </h2>
            
            <div className="space-y-2">
              {TEST_PRODUCTS.map((product) => (
                <button
                  key={product.id}
                  onClick={() => {
                    setSelectedProduct(product);
                    generateVariants();
                  }}
                  className={`w-full p-3 rounded-xl text-left transition border ${
                    selectedProduct?.id === product.id
                      ? 'border-neutral-900 bg-neutral-50'
                      : 'border-neutral-200 hover:border-neutral-300'
                  }`}
                >
                  <div className="font-medium text-neutral-800">{product.title}</div>
                  <div className="text-sm text-neutral-500">{product.type}</div>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">
              {error}
            </div>
          )}

          <button
            onClick={() => setStep('capture')}
            className="w-full py-3 text-neutral-500 text-sm"
          >
            ← Different photo
          </button>
        </div>
      )}

      {/* Step: Generating */}
      {step === 'generating' && (
        <div className="space-y-6">
          {roomImage && (
            <div className="rounded-xl overflow-hidden shadow-sm opacity-50">
              <img src={roomImage} alt="Your room" className="w-full h-48 object-cover" />
            </div>
          )}

          <div className="bg-white rounded-2xl p-8 shadow-sm border border-neutral-200 text-center">
            <div className="animate-pulse mb-4">
              <div className="w-16 h-16 bg-neutral-200 rounded-full mx-auto flex items-center justify-center">
                <span className="text-2xl">✨</span>
              </div>
            </div>
            <h2 className="text-lg font-medium text-neutral-800 mb-2">
              Creating 4 placements...
            </h2>
            <p className="text-sm text-neutral-500">
              Finding the best spots for your {selectedProduct?.title}
            </p>
            
            {/* Fun loading content */}
            <div className="mt-6 p-4 bg-neutral-50 rounded-xl">
              <p className="text-xs text-neutral-500 italic">
                "The best rooms are designed around how you actually live."
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step: Select Variant */}
      {step === 'select' && (
        <div className="space-y-4">
          <div className="text-center mb-2">
            <h2 className="text-lg font-medium text-neutral-800">
              Pick your favorite
            </h2>
            <p className="text-sm text-neutral-500">
              Generated in {((duration || 0) / 1000).toFixed(1)}s
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {variants.map((variant) => (
              <button
                key={variant.id}
                onClick={() => handleSelectVariant(variant)}
                className="rounded-xl overflow-hidden shadow-sm border-2 border-transparent hover:border-neutral-900 transition focus:outline-none focus:border-neutral-900"
              >
                {variant.imageBase64 ? (
                  <img
                    src={`data:image/png;base64,${variant.imageBase64}`}
                    alt={variant.hint}
                    className="w-full aspect-square object-cover"
                  />
                ) : (
                  <div className="w-full aspect-square bg-neutral-100 flex items-center justify-center">
                    <span className="text-neutral-400">Failed</span>
                  </div>
                )}
              </button>
            ))}
          </div>

          <button
            onClick={() => setStep('adjust')}
            className="w-full py-3 text-neutral-500 text-sm"
          >
            None of these work → Adjust manually
          </button>
        </div>
      )}

      {/* Step: Success */}
      {step === 'success' && selectedVariant && (
        <div className="space-y-4">
          <div className="rounded-xl overflow-hidden shadow-lg">
            {selectedVariant.imageBase64 && (
              <img
                src={`data:image/png;base64,${selectedVariant.imageBase64}`}
                alt="Your room with product"
                className="w-full"
              />
            )}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm border border-neutral-200 text-center">
            <h2 className="text-lg font-medium text-neutral-800 mb-1">
              Looks great! ✓
            </h2>
            <p className="text-sm text-neutral-500 mb-4">
              {selectedProduct?.title} in your space
            </p>

            <div className="space-y-2">
              <button
                onClick={reset}
                className="w-full py-3 bg-neutral-900 text-white rounded-xl font-medium"
              >
                Try another product
              </button>
              <button
                onClick={() => setStep('adjust')}
                className="w-full py-3 text-neutral-500 text-sm"
              >
                Adjust placement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step: Adjust (placeholder for detailed flow) */}
      {step === 'adjust' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-neutral-200 text-center">
            <div className="w-16 h-16 bg-neutral-100 rounded-full mx-auto flex items-center justify-center mb-4">
              <span className="text-2xl">🎯</span>
            </div>
            <h2 className="text-lg font-medium text-neutral-800 mb-2">
              Manual Placement
            </h2>
            <p className="text-sm text-neutral-500 mb-4">
              This is where the detailed flow would go:
            </p>
            <ul className="text-sm text-neutral-600 text-left space-y-2 mb-6">
              <li>• Drag to position product</li>
              <li>• Pinch to resize</li>
              <li>• Paint to remove objects</li>
              <li>• Re-generate with your placement</li>
            </ul>

            <button
              onClick={reset}
              className="w-full py-3 bg-neutral-100 text-neutral-700 rounded-xl font-medium"
            >
              ← Start over
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
