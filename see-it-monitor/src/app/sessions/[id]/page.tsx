import { deriveSessionsFromAnalytics, getSession, getSignedUrl } from '@/lib/gcs';
import { formatDate, formatDuration, getStepLabel, getStatusColor, truncateShop } from '@/lib/utils';
import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';

export const revalidate = 30;

interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function SessionDetailPage({ params }: PageProps) {
    const { id } = await params;
    const session = await getSession(id);

    if (!session) {
        // Fall back to analytics-derived session details when session meta logs aren't present.
        const derived = await deriveSessionsFromAnalytics({ lookbackMs: 7 * 24 * 60 * 60 * 1000 });
        const s = derived.sessions.find((x) => x.sessionId === id);
        if (!s) notFound();

        const statusColors = getStatusColor(s.status);

        return (
            <div className="space-y-8">
                <div className="flex items-center gap-4">
                    <Link href="/sessions" className="text-secondary hover:text-primary transition-colors">
                        ← Back
                    </Link>
                </div>

                <div className="card p-6 space-y-4">
                    <div className="flex items-start justify-between">
                        <div>
                            <h1 className="text-xl font-semibold">Session {s.sessionId.slice(0, 8)}...</h1>
                            <div className="text-secondary mt-1">
                                <Link href={`/merchants/${encodeURIComponent(s.shopDomain)}`} className="hover:underline">
                                    {s.shopDomain}
                                </Link>
                                {s.deviceType && ` · ${s.deviceType}`}
                                {s.browser && ` · ${s.browser}`}
                            </div>
                            <div className="text-sm text-gray-400 mt-2">
                                Started: {formatDate(s.startedAt)}
                                {s.endedAt && ` · Ended: ${formatDate(s.endedAt)}`}
                            </div>
                        </div>
                        <span className={`badge ${statusColors.bg} ${statusColors.text}`}>
                            {s.status}
                        </span>
                    </div>

                    <div className="pt-4 border-t border-gray-100 text-sm text-secondary">
                        <div>Source: analytics events (GCS)</div>
                        <div>Current step: {s.currentStep || '—'}</div>
                        <div>Steps completed: {s.stepsCompleted}</div>
                        <div>Last update: {formatDate(s.updatedAt)}</div>
                    </div>
                </div>
            </div>
        );
    }

    const statusColors = getStatusColor(session.status);

    // Generate signed URLs for all step images
    const stepImages: Record<string, string> = {};
    for (const step of session.steps) {
        const file = step.file || step.files?.[0];
        if (file) {
            stepImages[step.step] = await getSignedUrl(`sessions/${id}/${file}`);
        }
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/sessions" className="text-secondary hover:text-primary transition-colors">
                    ← Back
                </Link>
            </div>

            {/* Session Info Card */}
            <div className="card p-6 space-y-4">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-xl font-semibold">Session {session.sessionId.slice(0, 8)}...</h1>
                        <div className="text-secondary mt-1">
                            <Link href={`/shops/${encodeURIComponent(session.shop)}`} className="hover:underline">
                                {session.shop}
                            </Link>
                            {session.device && ` · ${session.device}`}
                            {session.browser && ` · ${session.browser}`}
                            {session.platform && ` · ${session.platform}`}
                        </div>
                        <div className="text-sm text-gray-400 mt-2">
                            Started: {formatDate(session.startedAt)}
                            {session.totalDurationMs && ` · Duration: ${formatDuration(session.totalDurationMs)}`}
                        </div>
                    </div>
                    <span className={`badge ${statusColors.bg} ${statusColors.text}`}>
                        {session.status}
                    </span>
                </div>

                {/* Product Info */}
                {session.product && (
                    <div className="pt-4 border-t border-gray-100">
                        <div className="text-sm text-secondary">Product</div>
                        <div className="font-medium">{session.product.title || 'Unknown'}</div>
                    </div>
                )}

                {/* Error Info */}
                {session.failureReason && (
                    <div className="pt-4 border-t border-gray-100">
                        <div className="text-sm text-red-600">Failed at: {session.failedAt}</div>
                        <div className="font-medium text-red-700">{session.failureReason}</div>
                    </div>
                )}
            </div>

            {/* Timeline */}
            <div className="card p-6">
                <h2 className="font-semibold mb-6">Timeline</h2>
                <div className="timeline mb-6">
                    {(['room', 'mask', 'inpaint', 'placement', 'final'] as const).map((stepName, idx) => {
                        const step = session.steps.find(s => s.step === stepName);
                        const isCompleted = step?.status === 'success';
                        const isFailed = step?.status === 'failed';

                        return (
                            <div key={stepName} className="flex flex-col items-center">
                                <div
                                    className={`timeline-node ${isCompleted ? 'completed' : ''} ${isFailed ? 'failed' : ''}`}
                                >
                                    {isCompleted ? '✓' : isFailed ? '✗' : idx + 1}
                                </div>
                                <div className="text-xs mt-2 text-secondary">{getStepLabel(stepName)}</div>
                                {step && (
                                    <div className="text-xs text-gray-400">
                                        {step.sincePrevMs ? `+${formatDuration(step.sincePrevMs)}` : '0:00'}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Step Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {session.steps.map((step) => (
                    <div key={step.step} className="card overflow-hidden">
                        {/* Step Image */}
                        <div className="aspect-video bg-gray-100 relative">
                            {stepImages[step.step] ? (
                                <Image
                                    src={stepImages[step.step]}
                                    alt={getStepLabel(step.step)}
                                    fill
                                    className="object-cover"
                                    unoptimized
                                />
                            ) : (
                                <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                                    No image
                                </div>
                            )}
                        </div>

                        {/* Step Info */}
                        <div className="p-4 space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="font-medium">{getStepLabel(step.step)}</span>
                                <span className={`badge ${step.status === 'success' ? 'badge-success' : 'badge-error'}`}>
                                    {step.status}
                                </span>
                            </div>

                            <div className="text-sm text-secondary space-y-1">
                                <div>Time: {formatDuration(step.sinceStartMs)}</div>
                                {step.processingTimeMs && (
                                    <div>Processing: {formatDuration(step.processingTimeMs)}</div>
                                )}
                                {step.model && <div>Model: {step.model}</div>}
                            </div>

                            {step.error && (
                                <div className="text-sm text-red-600 mt-2">
                                    <div className="font-medium">{step.error.code}</div>
                                    <div className="text-xs">{step.error.message}</div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* Raw JSON */}
            <details className="card p-4">
                <summary className="cursor-pointer text-secondary hover:text-primary">
                    View Raw JSON
                </summary>
                <pre className="mt-4 p-4 bg-gray-50 rounded-xl text-xs overflow-auto">
                    {JSON.stringify(session, null, 2)}
                </pre>
            </details>
        </div>
    );
}
