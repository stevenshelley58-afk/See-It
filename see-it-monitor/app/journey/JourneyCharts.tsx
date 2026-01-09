"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface FunnelItem {
    step: string;
    count: number;
    percentage: number;
}

interface JourneyChartsProps {
    funnelData: FunnelItem[];
}

export default function JourneyCharts({ funnelData }: JourneyChartsProps) {
    return (
        <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelData}>
                    <XAxis dataKey="step" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#3b82f6" />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
