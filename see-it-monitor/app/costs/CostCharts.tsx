"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface CostChartsProps {
    providerData: { name: string; value: number }[];
    operationData: { name: string; value: number }[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];

export default function CostCharts({ providerData, operationData }: CostChartsProps) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card p-6">
                <h2 className="font-semibold mb-4">By Provider</h2>
                <div className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie
                                data={providerData}
                                dataKey="value"
                                nameKey="name"
                                cx="50%"
                                cy="50%"
                                outerRadius={80}
                            >
                                {providerData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                ))}
                            </Pie>
                            <Tooltip formatter={(value: number) => [`$${value.toFixed(4)}`, 'Cost']} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>
            </div>

            <div className="card p-6">
                <h2 className="font-semibold mb-4">By Operation</h2>
                <div className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={operationData}>
                            <XAxis dataKey="name" />
                            <YAxis />
                            <Tooltip formatter={(value: number) => [`$${value.toFixed(4)}`, 'Cost']} />
                            <Bar dataKey="value" fill="#3b82f6" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
