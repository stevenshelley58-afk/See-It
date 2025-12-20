import React, { useState, useRef } from 'react';

const SeeIt = ({ product, onClose }) => {
  const [screen, setScreen] = useState(1);
  const [roomImage, setRoomImage] = useState(null);
  const [productPosition, setProductPosition] = useState({ x: 50, y: 40 });
  const [productScale, setProductScale] = useState(1);
  const [saveRoom, setSaveRoom] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [resultImage, setResultImage] = useState(null);
  const canvasRef = useRef(null);

  // Mock product if not provided
  const productData = product || {
    name: 'Vintage Mirror',
    price: '$1,000',
    image: '/product-image.jpg'
  };

  // Handle file upload
  const handleUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setRoomImage(e.target.result);
        setScreen(2);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle generate
  const handleGenerate = async () => {
    setIsGenerating(true);
    // Simulate API call
    setTimeout(() => {
      setResultImage(roomImage);
      setIsGenerating(false);
      setScreen(4);
    }, 3000);
  };

  // Icons
  const CloseIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
    </svg>
  );

  const BackIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
    </svg>
  );

  const CameraIcon = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"/>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"/>
    </svg>
  );

  const CheckIcon = () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
    </svg>
  );

  // Screen 1: Entry
  const EntryScreen = () => (
    <div className="h-full flex flex-col bg-white">
      {/* Header with dark gradient */}
      <div className="bg-gradient-to-b from-neutral-800 via-neutral-700 to-neutral-100 pt-4 pb-8 px-5 rounded-b-3xl">
        <div className="flex items-center justify-between mb-6">
          <button 
            onClick={onClose}
            className="text-neutral-400 active:opacity-70"
          >
            <CloseIcon />
          </button>
          <span className="text-neutral-400 text-xs tracking-wider uppercase font-medium">Preview</span>
          <div className="w-5" />
        </div>

        {/* Product Card */}
        <div className="bg-white rounded-2xl overflow-hidden shadow-lg mx-2">
          <div className="h-32 bg-gradient-to-b from-amber-50 to-amber-100/50 flex items-center justify-center p-4">
            {productData.image ? (
              <img 
                src={productData.image} 
                alt={productData.name}
                className="h-24 w-auto object-contain"
              />
            ) : (
              <div className="w-20 h-24 bg-amber-300 rounded-xl shadow-md" />
            )}
          </div>
        </div>
      </div>

      {/* Product Info */}
      <div className="px-5 pt-4 text-center">
        <p className="text-neutral-900 font-semibold text-lg">{productData.name}</p>
        <p className="text-neutral-400 text-sm">{productData.price}</p>
      </div>

      {/* Content */}
      <div className="flex-1 px-5 py-6 flex flex-col">
        <h1 className="text-xl font-bold text-neutral-900 tracking-tight mb-1">
          See it in your space
        </h1>
        <p className="text-neutral-400 text-sm mb-6">
          Snap a photo of your room.
        </p>

        {/* Take Photo Button */}
        <label className="w-full bg-neutral-900 text-white py-4 rounded-full text-base font-medium flex items-center justify-center gap-2 active:scale-98 active:opacity-90 cursor-pointer mb-4 shadow-lg">
          <CameraIcon />
          Take Photo
          <input 
            type="file" 
            accept="image/*" 
            capture="environment"
            onChange={handleUpload}
            className="hidden"
          />
        </label>

        {/* Secondary Buttons - Outlined pills */}
        <div className="flex gap-3 justify-center">
          <label className="px-8 py-2.5 bg-white border-2 border-neutral-200 text-neutral-700 rounded-full text-sm font-medium text-center active:opacity-80 cursor-pointer hover:border-neutral-300 transition-colors">
            Upload
            <input 
              type="file" 
              accept="image/*"
              onChange={handleUpload}
              className="hidden"
            />
          </label>
          <button 
            onClick={() => {/* Load saved rooms */}}
            className="px-8 py-2.5 bg-white border-2 border-neutral-200 text-neutral-700 rounded-full text-sm font-medium active:opacity-80 hover:border-neutral-300 transition-colors"
          >
            Saved
          </button>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="px-5 pb-6 text-center">
        <p className="text-neutral-900 font-semibold text-sm">1. Entry</p>
        <p className="text-neutral-400 text-xs">Choose how to add room</p>
      </div>
    </div>
  );

  // Screen 2: Prepare Room
  const PrepareRoomScreen = () => (
    <div className="h-full flex flex-col bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3">
        <button 
          onClick={() => setScreen(1)}
          className="text-neutral-400 active:opacity-70 flex items-center gap-1"
        >
          <BackIcon />
          <span className="text-sm">Back</span>
        </button>
        <span className="text-neutral-400 text-xs tracking-wider uppercase">Prepare</span>
        <button 
          onClick={onClose}
          className="text-neutral-400 active:opacity-70"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Room Image */}
      <div className="mx-4 mt-2 flex-1 rounded-2xl overflow-hidden relative bg-neutral-200">
        {roomImage && (
          <img 
            src={roomImage} 
            alt="Your room"
            className="w-full h-full object-cover"
          />
        )}
        {/* Canvas for painting would go here */}
        <canvas 
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
        />
      </div>

      {/* Controls */}
      <div className="px-5 py-4">
        <p className="text-neutral-500 text-sm mb-3">
          Paint over anything to remove, or skip.
        </p>

        {/* Paint Tools */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex items-center gap-2 flex-1">
            <div className="w-8 h-8 rounded-full border-2 border-violet-400 flex items-center justify-center">
              <div className="w-4 h-4 bg-violet-400 rounded-full" />
            </div>
            <span className="text-neutral-500 text-xs">Paint to remove</span>
          </div>
          <button className="px-3 py-1.5 bg-neutral-100 text-neutral-500 rounded-lg text-xs font-medium active:opacity-80">
            Undo
          </button>
          <button className="px-3 py-1.5 bg-neutral-100 text-neutral-500 rounded-lg text-xs font-medium active:opacity-80">
            Clear
          </button>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button className="flex-1 bg-neutral-100 text-neutral-600 py-3 rounded-xl text-sm font-medium active:opacity-80">
            Remove
          </button>
          <button 
            onClick={() => setScreen(3)}
            className="flex-1 bg-neutral-900 text-white py-3 rounded-xl text-sm font-medium active:scale-98 active:opacity-90"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );

  // Screen 3: Position Product
  const PositionScreen = () => (
    <div className="h-full flex flex-col bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3">
        <button 
          onClick={() => setScreen(2)}
          className="text-neutral-400 active:opacity-70 flex items-center gap-1"
        >
          <BackIcon />
          <span className="text-sm">Back</span>
        </button>
        <span className="text-neutral-400 text-xs tracking-wider uppercase">Position</span>
        <button 
          onClick={onClose}
          className="text-neutral-400 active:opacity-70"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Room with Product */}
      <div className="mx-4 mt-2 flex-1 rounded-2xl overflow-hidden relative bg-neutral-200">
        {roomImage && (
          <img 
            src={roomImage} 
            alt="Your room"
            className="w-full h-full object-cover"
          />
        )}
        
        {/* Product Overlay - Draggable */}
        <div 
          className="absolute cursor-move"
          style={{
            left: `${productPosition.x}%`,
            top: `${productPosition.y}%`,
            transform: `translate(-50%, -50%) scale(${productScale})`
          }}
        >
          {productData.image ? (
            <img 
              src={productData.image}
              alt={productData.name}
              className="w-24 h-auto drop-shadow-2xl"
              style={{ filter: 'drop-shadow(0 25px 50px rgba(0,0,0,0.3))' }}
            />
          ) : (
            <div className="w-20 h-32 bg-amber-400 rounded-lg shadow-2xl" />
          )}
        </div>

        {/* Instruction Pill */}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-sm">
          <p className="text-neutral-600 text-xs font-medium">
            Drag to move · Pinch to resize
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="px-5 py-4">
        {/* Save Room Toggle */}
        <label className="flex items-center justify-between py-2 mb-3 cursor-pointer">
          <span className="text-neutral-500 text-sm">Save room for later</span>
          <div 
            className={`w-11 h-6 rounded-full relative transition-colors ${
              saveRoom ? 'bg-neutral-900' : 'bg-neutral-200'
            }`}
            onClick={() => setSaveRoom(!saveRoom)}
          >
            <div 
              className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-all ${
                saveRoom ? 'right-0.5' : 'left-0.5'
              }`}
            />
          </div>
        </label>

        {/* Generate Button */}
        <button 
          onClick={handleGenerate}
          disabled={isGenerating}
          className="w-full bg-neutral-900 text-white py-4 rounded-xl text-base font-medium active:scale-98 active:opacity-90 disabled:opacity-50"
        >
          {isGenerating ? 'Generating...' : 'Generate'}
        </button>
      </div>
    </div>
  );

  // Screen 4: Result
  const ResultScreen = () => (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3">
        <button 
          onClick={() => setScreen(3)}
          className="text-neutral-400 active:opacity-70 flex items-center gap-1"
        >
          <BackIcon />
          <span className="text-sm">Adjust</span>
        </button>
        <span className="text-neutral-400 text-xs tracking-wider uppercase">Result</span>
        <button 
          onClick={onClose}
          className="text-neutral-400 active:opacity-70"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Result Image */}
      <div className="mx-4 mt-2 flex-1 rounded-2xl overflow-hidden relative bg-neutral-200">
        {resultImage && (
          <img 
            src={resultImage} 
            alt="Result"
            className="w-full h-full object-cover"
          />
        )}
        
        {/* Product in result */}
        <div 
          className="absolute"
          style={{
            left: `${productPosition.x}%`,
            top: `${productPosition.y}%`,
            transform: `translate(-50%, -50%) scale(${productScale})`
          }}
        >
          {productData.image ? (
            <img 
              src={productData.image}
              alt={productData.name}
              className="w-24 h-auto drop-shadow-2xl"
              style={{ filter: 'drop-shadow(0 25px 50px rgba(0,0,0,0.3))' }}
            />
          ) : (
            <div className="w-20 h-32 bg-amber-400 rounded-lg shadow-2xl" />
          )}
        </div>

        {/* Success Badge */}
        <div className="absolute top-3 right-3 bg-green-500 text-white text-xs font-medium px-3 py-1.5 rounded-full flex items-center gap-1">
          <CheckIcon />
          Complete
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-4">
        <button className="w-full bg-neutral-900 text-white py-4 rounded-xl text-base font-medium active:scale-98 active:opacity-90 mb-2">
          Share
        </button>
        <div className="flex gap-2">
          <button 
            onClick={() => setScreen(3)}
            className="flex-1 bg-neutral-100 text-neutral-600 py-3 rounded-xl text-sm font-medium active:opacity-80"
          >
            Adjust
          </button>
          <button 
            onClick={() => {
              setRoomImage(null);
              setScreen(1);
            }}
            className="flex-1 bg-neutral-100 text-neutral-600 py-3 rounded-xl text-sm font-medium active:opacity-80"
          >
            New Room
          </button>
        </div>
      </div>
    </div>
  );

  // Loading Screen
  const LoadingScreen = () => (
    <div className="h-full flex flex-col items-center justify-center bg-neutral-900">
      <div className="w-16 h-16 border-2 border-neutral-700 border-t-white rounded-full animate-spin mb-6" />
      <p className="text-white text-lg mb-2">Generating...</p>
      <p className="text-neutral-500 text-sm">This takes about 15 seconds</p>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-white z-50">
      <div className="h-full max-w-md mx-auto">
        {isGenerating ? (
          <LoadingScreen />
        ) : (
          <>
            {screen === 1 && <EntryScreen />}
            {screen === 2 && <PrepareRoomScreen />}
            {screen === 3 && <PositionScreen />}
            {screen === 4 && <ResultScreen />}
          </>
        )}
      </div>
    </div>
  );
};

export default SeeIt;


/*
USAGE:

import SeeIt from './SeeIt';

function ProductPage() {
  const [showSeeIt, setShowSeeIt] = useState(false);
  
  const product = {
    name: 'Vintage Mirror',
    price: '$1,000',
    image: '/path/to/product.jpg'
  };

  return (
    <div>
      <button onClick={() => setShowSeeIt(true)}>
        See it in your room
      </button>
      
      {showSeeIt && (
        <SeeIt 
          product={product}
          onClose={() => setShowSeeIt(false)}
        />
      )}
    </div>
  );
}

TAILWIND CONFIG - Add these if not present:

module.exports = {
  theme: {
    extend: {
      scale: {
        '98': '0.98',
      }
    }
  }
}

*/
