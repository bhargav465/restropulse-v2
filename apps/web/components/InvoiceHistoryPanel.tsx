import React, { useState } from 'react';
import { ArrowLeft, FileText, Zap, Download } from 'lucide-react';
import type { Invoice } from '@restropulse/shared';

export function formatPaise(paise: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(paise / 100);
}

function formatBillingPeriod(invoice: Invoice): string {
    if (invoice.type === 'SUBSCRIPTION' && invoice.billingPeriodStart && invoice.billingPeriodEnd) {
        const start = new Date(invoice.billingPeriodStart).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const end = new Date(invoice.billingPeriodEnd).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
        return `${start} – ${end}`;
    }
    return new Date(invoice.paidAt || invoice.createdAt || '').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

type Filter = 'all' | 'subscription' | 'credit';

interface YearGroup {
    year: number;
    items: Invoice[];
}

function groupByYear(invoices: Invoice[]): YearGroup[] {
    const map = new Map<number, Invoice[]>();
    for (const inv of invoices) {
        const year = new Date(inv.paidAt || inv.createdAt || '').getFullYear();
        if (!map.has(year)) map.set(year, []);
        map.get(year)!.push(inv);
    }
    return Array.from(map.entries())
        .map(([year, items]) => ({ year, items }))
        .sort((a, b) => b.year - a.year);
}

const PAGE_SIZE = 10;

interface InvoiceHistoryPanelProps {
    invoices: Invoice[];
    onClose: () => void;
}

const InvoiceHistoryPanel: React.FC<InvoiceHistoryPanelProps> = ({ invoices, onClose }) => {
    const [filter, setFilter] = useState<Filter>('all');
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

    const filtered = invoices.filter(inv => {
        if (filter === 'subscription') return inv.type === 'SUBSCRIPTION';
        if (filter === 'credit') return inv.type === 'CREDIT_PURCHASE';
        return true;
    });

    const groups = groupByYear(filtered);
    const multiYear = groups.length > 1;

    const allItems = groups.flatMap(g => g.items);
    const visibleItems = allItems.slice(0, visibleCount);
    const hasMore = visibleCount < allItems.length;

    const handleFilterChange = (f: Filter) => {
        setFilter(f);
        setVisibleCount(PAGE_SIZE);
    };

    const renderRow = (invoice: Invoice) => (
        <div key={invoice.id} className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
                <div className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center ${invoice.type === 'SUBSCRIPTION' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'}`}>
                    {invoice.type === 'SUBSCRIPTION' ? <FileText size={18} /> : <Zap size={18} />}
                </div>
                <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-700 truncate">{invoice.description}</p>
                    <p className="text-xs text-slate-500">{formatBillingPeriod(invoice)}</p>
                </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-3">
                <span className="text-sm font-bold text-slate-800">{formatPaise(invoice.amountPaise)}</span>
                {invoice.pdfUrl && (
                    <a
                        href={invoice.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-8 h-8 bg-slate-100 text-slate-500 hover:text-slate-700 rounded-lg flex items-center justify-center"
                        title="Download Invoice"
                    >
                        <Download size={15} />
                    </a>
                )}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-slate-50 z-50 flex flex-col">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-4 bg-white border-b border-slate-100 shrink-0">
                <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 active:bg-slate-200 transition-colors">
                    <ArrowLeft size={20} className="text-slate-600" />
                </button>
                <h2 className="text-base font-bold text-slate-800 flex-1">Billing History</h2>
                <span className="text-xs font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-full">
                    {filtered.length}
                </span>
            </div>

            {/* Filter tabs */}
            <div className="flex gap-1 px-4 py-3 bg-white border-b border-slate-100 shrink-0">
                {([['all', 'All'], ['subscription', 'Plans'], ['credit', 'Credits']] as [Filter, string][]).map(([val, label]) => (
                    <button
                        key={val}
                        onClick={() => handleFilterChange(val)}
                        className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-colors ${filter === val ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 gap-2">
                        <FileText size={32} className="text-slate-200" />
                        <p className="text-sm text-slate-400">No invoices</p>
                    </div>
                ) : multiYear ? (
                    groups.map(group => {
                        const groupVisible = visibleItems.filter(inv =>
                            new Date(inv.paidAt || inv.createdAt || '').getFullYear() === group.year
                        );
                        if (groupVisible.length === 0) return null;
                        return (
                            <div key={group.year}>
                                <div className="px-4 py-2 bg-slate-100">
                                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{group.year}</span>
                                </div>
                                <div className="bg-white divide-y divide-slate-50">
                                    {groupVisible.map(renderRow)}
                                </div>
                            </div>
                        );
                    })
                ) : (
                    <div className="bg-white divide-y divide-slate-50 mx-0">
                        {visibleItems.map(renderRow)}
                    </div>
                )}

                {hasMore && (
                    <div className="p-4">
                        <button
                            onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
                            className="w-full py-3 rounded-2xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors"
                        >
                            Show more ({allItems.length - visibleCount} remaining)
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default InvoiceHistoryPanel;
