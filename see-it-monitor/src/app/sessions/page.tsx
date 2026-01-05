import { listSessions } from '@/lib/gcs';
import { formatTimeAgo, getStepLabel, getStatusColor, truncateShop, formatDuration } from '@/lib/utils';
import Link from 'next/link';
import Image from 'next/image';

export const dynamic = 'force-dynamic'; // Force dynamic rendering since we need GCS access
export const revalidate = 30;

export default async function SessionsPage() {
    const sessions = await listSessions({ limit: 50 });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Sessions</h1>
                <div className="text-sm text-secondary">
                    {sessions.length} sessions
                </div>
            </div>

            <div className="card divide-y divide-gray-100">
                {sessions.map((session) => {
                    const statusColors = getStatusColor(session.status);
                    return (
                        <Link
                            key={session.sessionId}
                            href={`/sessions/${session.sessionId}`}
                            className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors"
                        >
                            {/* Thumbnail */}
                            <div className="w-20 h-14 rounded-xl bg-gray-100 relative flex-shrink-0 overflow-hidden">
                                {session.latestImageUrl ? (
                                    <Image
                                        src={session.latestImageUrl}
                                        alt="Session"
                                        fill
                                        className="object-cover"
                                        unoptimized
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex items-center justify-center text-gray-300">
                                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                )}
                            </div>

                            {/* Details */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-3">
                                    <span className="font-medium">{truncateShop(session.shop)}</span>
                                    <span className={`badge ${statusColors.bg} ${statusColors.text}`}>
                                        {session.status}
                                    </span>
                                </div>
                                <div className="text-sm text-secondary mt-1">
                                    {session.stepsCompleted} steps
                                    {session.currentStep && ` · ${getStepLabel(session.currentStep)}`}
                                    {session.productTitle && ` · ${session.productTitle}`}
                                </div>
                                <div className="text-xs text-gray-400 mt-1">
                                    {session.device && `${session.device} · `}
                                    {session.browser && `${session.browser}`}
                                </div>
                            </div>

                            {/* Time */}
                            <div className="text-right text-sm text-secondary flex-shrink-0">
                                {formatTimeAgo(session.updatedAt)}
                            </div>
                        </Link>
                    );
                })}

                {sessions.length === 0 && (
                    <div className="p-12 text-center text-secondary">
                        No sessions found
                    </div>
                )}
            </div>
        </div>
    );
}
