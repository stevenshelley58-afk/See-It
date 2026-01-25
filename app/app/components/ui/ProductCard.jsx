/**
 * ProductCard - Card displaying a product with thumbnail and status
 * Mobile-first responsive design
 *
 * Note: Legacy instructions editing feature removed - renderInstructions field
 * no longer exists in the canonical pipeline schema.
 */
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
