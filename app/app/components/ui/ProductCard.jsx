/**
 * ProductCard - Card displaying a product with thumbnail and status
 * Mobile-first responsive design
 */
import { useState, useCallback } from 'react';
import { useFetcher } from '@remix-run/react';
import { StatusBadge } from './StatusBadge';
import { Button } from './Button';

export function ProductCard({ 
  product, 
  asset, 
  status, 
  isBusy,
  onPrepare,
  onAdjust,
  onRedo,
  onRetry,
  onManual,
  hasMulti,
  onImageSelect,
  onShowToast
}) {
  const isReady = status === "ready";
  const isFailed = status === "failed";
  
  // Instructions editing state
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState(asset?.renderInstructions || "");
  const instructionsFetcher = useFetcher();
  
  const hasInstructions = Boolean(asset?.renderInstructions?.trim());
  const isSaving = instructionsFetcher.state !== "idle";
  
  const handleSaveInstructions = useCallback(() => {
    const productId = product.id.split('/').pop();
    const fd = new FormData();
    fd.append("productId", productId);
    fd.append("instructions", instructions);
    instructionsFetcher.submit(fd, { method: "post", action: "/api/products/update-instructions" });
  }, [product.id, instructions, instructionsFetcher]);
  
  // Update local state when asset changes
  const currentInstructions = asset?.renderInstructions || "";
  if (currentInstructions !== instructions && !showInstructions) {
    setInstructions(currentInstructions);
  }
  
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="aspect-square bg-neutral-50 relative overflow-hidden">
        {product.featuredImage ? (
          <img 
            src={product.featuredImage.url} 
            alt={product.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-neutral-400">
            No image
          </div>
        )}
      </div>
      <div className="p-3 md:p-4">
        <div className="flex items-start justify-between gap-2 mb-2 md:mb-3">
          <h3 className="font-medium text-neutral-900 text-sm leading-tight line-clamp-1 min-w-0 flex-1">
            {product.title}
          </h3>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Instructions indicator */}
            <button
              onClick={() => setShowInstructions(!showInstructions)}
              className={`p-1 rounded transition-colors ${
                hasInstructions 
                  ? 'text-blue-600 hover:bg-blue-50' 
                  : 'text-neutral-400 hover:bg-neutral-100'
              }`}
              title={hasInstructions ? "Edit custom instructions" : "Add custom instructions"}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            {/* Status badge */}
            <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs ${
              isReady ? 'bg-emerald-50 text-emerald-700' :
              isFailed ? 'bg-red-50 text-red-700' :
              isBusy ? 'bg-amber-50 text-amber-700' :
              'bg-neutral-100 text-neutral-500'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${
                isReady ? 'bg-emerald-500' :
                isFailed ? 'bg-red-500' :
                isBusy ? 'bg-amber-500' :
                'bg-neutral-400'
              }`} />
              <span className="hidden sm:inline">{status || 'unprepared'}</span>
            </div>
          </div>
        </div>
        
        {/* Instructions panel */}
        {showInstructions && (
          <div className="mb-3 p-2 bg-neutral-50 rounded-lg border border-neutral-200">
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              Custom AI Instructions
            </label>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g., This is a velvet sofa - emphasize soft texture and luxury feel..."
              className="w-full text-xs p-2 border border-neutral-200 rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => {
                  setShowInstructions(false);
                  setInstructions(asset?.renderInstructions || "");
                }}
                className="text-xs px-2 py-1 text-neutral-600 hover:text-neutral-900"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveInstructions}
                disabled={isSaving}
                className="text-xs px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
        
        <div className="flex gap-2">
          {product.featuredImage ? (
            <>
              {isReady && (
                <>
                  <Button 
                    size="sm" 
                    variant="secondary" 
                    className="flex-1"
                    onClick={() => onAdjust(product)}
                  >
                    Adjust
                  </Button>
                  <Button 
                    size="sm" 
                    variant="secondary" 
                    className="flex-1"
                    onClick={() => hasMulti ? onImageSelect(product) : onRedo(product)}
                    disabled={isBusy}
                  >
                    Redo
                  </Button>
                </>
              )}
              {isFailed && (
                <>
                  <Button 
                    size="sm" 
                    variant="primary" 
                    className="flex-1"
                    onClick={() => hasMulti ? onImageSelect(product) : onRetry(product)}
                    disabled={isBusy}
                  >
                    Retry
                  </Button>
                  <Button 
                    size="sm" 
                    variant="secondary" 
                    className="flex-1"
                    onClick={() => onManual(product)}
                  >
                    Manual
                  </Button>
                </>
              )}
              {!isReady && !isFailed && (
                <Button 
                  size="sm" 
                  variant="primary" 
                  className="flex-1"
                  onClick={() => hasMulti ? onImageSelect(product) : onPrepare(product)}
                  disabled={isBusy}
                >
                  {isBusy ? 'Processing...' : hasMulti ? 'Choose' : 'Prepare'}
                </Button>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

