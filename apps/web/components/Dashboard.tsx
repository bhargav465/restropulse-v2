import React, { useState, useEffect } from 'react';
import { TrendingUp, ArrowRight, Calendar, Tag, UtensilsCrossed, BarChart3, RefreshCw, Image as ImageIcon, Film, Layers, Video } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { ViewState, Restaurant, Post } from '@restropulse/shared';
import { postsAPI, restaurantAPI } from '../api';

interface DashboardProps {
    setView?: (view: ViewState) => void;
    restaurantData: Restaurant;
    userName?: string;
}

const Dashboard: React.FC<DashboardProps> = ({ setView, restaurantData, userName }) => {
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [analyticsData, setAnalyticsData] = useState<{ name: string; posts: number }[]>([]);
    const [contentMix, setContentMix] = useState<{ type: string; count: number }[]>([]);
    const [totalPublished, setTotalPublished] = useState(0);

    const loadData = async () => {
        try {
            const postsData = await postsAPI.getAll();
            setPosts(postsData);

            if (restaurantData.id) {
                try {
                    const analytics = await restaurantAPI.getAnalytics(restaurantData.id);
                    const chartData = [...analytics.postsPerWeek]
                        .reverse()
                        .map(w => ({ name: `Week ${w.week}`, posts: w.posts }));
                    setAnalyticsData(chartData);
                    setContentMix(analytics.contentMix || []);
                    setTotalPublished(analytics.contentMix?.reduce((sum, item) => sum + item.count, 0) || 0);
                } catch {
                    // Analytics may be empty for new restaurants
                }
            }
        } catch (error) {
            console.error('Failed to load dashboard data:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [restaurantData.id]);

    const pendingCount = posts.filter(p => p.status === 'PENDING_APPROVAL' || p.status === 'CHANGES_REQUESTED').length;
    const nextScheduled = posts.find(p => p.status === 'SCHEDULED');

    const [pullStartY, setPullStartY] = useState<number | null>(null);
    const [pullDistance, setPullDistance] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);

    useEffect(() => {
        const handleTouchStart = (e: TouchEvent) => {
            if (window.scrollY === 0) {
                setPullStartY(e.touches[0].clientY);
            }
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (pullStartY !== null && window.scrollY === 0) {
                const distance = e.touches[0].clientY - pullStartY;
                if (distance > 0) {
                    setPullDistance(Math.min(distance, 100));
                }
            }
        };

        const handleTouchEnd = () => {
            if (pullDistance > 60) {
                setIsRefreshing(true);
                loadData().finally(() => {
                    setIsRefreshing(false);
                    setPullDistance(0);
                });
            } else {
                setPullDistance(0);
            }
            setPullStartY(null);
        };

        document.addEventListener('touchstart', handleTouchStart, { passive: true });
        document.addEventListener('touchmove', handleTouchMove, { passive: true });
        document.addEventListener('touchend', handleTouchEnd);

        return () => {
            document.removeEventListener('touchstart', handleTouchStart);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleTouchEnd);
        };
    }, [pullStartY, pullDistance]);

    const activeOffers = restaurantData.activeOffers || [];
    const chefSpecials = restaurantData.chefSpecials || [];

    return (
        <div className="p-4 space-y-6 relative">

            {/* Pull-to-Refresh Indicator */}
            {pullDistance > 0 && (
                <div
                    className="absolute top-0 left-0 right-0 flex justify-center transition-opacity z-50"
                    style={{
                        transform: `translateY(${pullDistance - 60}px)`,
                        opacity: Math.min(pullDistance / 60, 1)
                    }}
                >
                    <div className="bg-white rounded-full p-2 shadow-lg">
                        <RefreshCw
                            size={20}
                            className={`text-orange-600 ${isRefreshing ? 'animate-spin' : ''}`}
                            style={{ transform: `rotate(${pullDistance * 3.6}deg)` }}
                        />
                    </div>
                </div>
            )}

            {/* Welcome Header */}
            <div className="mb-2">
                <p className="text-slate-500 text-sm font-medium">Welcome</p>
                <h1 className="text-2xl font-bold text-slate-800">{userName?.split(' ')[0] || 'there'}</h1>
            </div>

            {/* Action Required Banner */}
            {pendingCount > 0 && (
                <button
                    onClick={() => setView && setView('STUDIO')}
                    className="w-full bg-gradient-to-r from-orange-500 to-red-500 rounded-2xl p-4 text-white shadow-lg shadow-orange-500/20 flex items-center justify-between transition-all active:scale-[0.97] active:shadow-xl"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm">
                            <span className="font-bold text-lg">{pendingCount}</span>
                        </div>
                        <div className="text-left">
                            <p className="font-bold text-sm">Posts Need Review</p>
                            <p className="text-orange-100 text-xs">Review pending content</p>
                        </div>
                    </div>
                    <ArrowRight size={20} className="text-white/80" />
                </button>
            )}

            {/* Up Next (Scheduled) */}
            <div className="space-y-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <Calendar size={18} className="text-orange-500" />
                    Up Next
                </h3>
                {nextScheduled ? (
                    <div
                        onClick={() => setView && setView('STUDIO')}
                        className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-4 cursor-pointer active:scale-[0.97] active:shadow-md transition-all hover:border-orange-200"
                    >
                        <img
                            src={nextScheduled.thumbnail}
                            alt="Next Post"
                            className="w-16 h-16 rounded-lg object-cover bg-slate-100 animate-pulse"
                            loading="lazy"
                            onLoad={(e) => e.currentTarget.classList.remove('animate-pulse')}
                        />
                        <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full">
                                    APPROVED
                                </span>
                                <span className="text-xs text-slate-400 flex items-center gap-1">
                                    {new Date(nextScheduled.scheduledFor!).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}
                                </span>
                            </div>
                            <p className="text-sm text-slate-700 line-clamp-1 font-medium">{nextScheduled.caption}</p>
                            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                Scheduled for {nextScheduled.platforms.length > 1 ? 'Instagram & Facebook' : nextScheduled.platforms[0].charAt(0) + nextScheduled.platforms[0].slice(1).toLowerCase()}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm text-center">
                        <Calendar size={28} className="text-slate-300 mx-auto mb-2" />
                        <p className="text-slate-500 text-sm font-medium">No upcoming posts scheduled</p>
                        <p className="text-slate-400 text-xs mt-1">Approved posts will appear here</p>
                    </div>
                )}
            </div>

            {/* Live Context Snapshot */}
            {((activeOffers && activeOffers.length > 0) || (chefSpecials && chefSpecials.length > 0)) && (
                <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-bold text-[10px] uppercase tracking-wider text-slate-500">Live on Profile</h3>
                        <button onClick={() => setView && setView('INPUTS')} className="text-xs font-bold text-orange-600 hover:text-orange-500">Edit</button>
                    </div>
                    <div className="space-y-4">
                        {activeOffers.slice(0, 1).map((offer, i) => (
                            <div key={`offer-${i}`} className="flex items-start gap-3">
                                <div className="p-2 bg-slate-100 rounded-lg shrink-0 mt-0.5">
                                    <Tag size={16} className="text-purple-500" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs text-slate-500 font-bold mb-1">Active Offer</p>
                                    <p className="font-medium text-sm leading-snug text-slate-800">{offer}</p>
                                </div>
                            </div>
                        ))}
                        {chefSpecials.slice(0, 1).map((special, i) => (
                            <div key={`special-${i}`} className="flex items-start gap-3">
                                <div className="p-2 bg-slate-100 rounded-lg shrink-0 mt-0.5">
                                    <UtensilsCrossed size={16} className="text-orange-500" />
                                </div>
                                <div className="flex-1">
                                    <p className="text-xs text-slate-500 font-bold mb-1">Chef's Special</p>
                                    <p className="font-medium text-sm leading-snug text-slate-800">{special}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Content Overview */}
            <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                    <div>
                        <h3 className="font-bold text-slate-800 flex items-center gap-2">
                            <BarChart3 size={18} className="text-orange-500" />
                            Content Overview
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">Publishing activity</p>
                    </div>
                    {totalPublished > 0 && (
                        <div className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg text-[10px] font-bold">
                            {totalPublished} total
                        </div>
                    )}
                </div>

                {/* Content type breakdown */}
                {contentMix.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2 mb-5">
                        {(() => {
                            const typeConfig: Record<string, { icon: React.ElementType; label: string; color: string; bg: string }> = {
                                IMAGE: { icon: ImageIcon, label: 'Posts', color: 'text-blue-600', bg: 'bg-blue-50' },
                                REEL: { icon: Film, label: 'Reels', color: 'text-purple-600', bg: 'bg-purple-50' },
                                CAROUSEL: { icon: Layers, label: 'Carousels', color: 'text-orange-600', bg: 'bg-orange-50' },
                                VIDEO: { icon: Video, label: 'Videos', color: 'text-green-600', bg: 'bg-green-50' },
                                STORY: { icon: Film, label: 'Stories', color: 'text-pink-600', bg: 'bg-pink-50' },
                            };
                            return contentMix.map(item => {
                                const config = typeConfig[item.type] || { icon: ImageIcon, label: item.type, color: 'text-slate-600', bg: 'bg-slate-50' };
                                const Icon = config.icon;
                                return (
                                    <div key={item.type} className={`${config.bg} rounded-xl p-3 flex items-center gap-3`}>
                                        <Icon size={16} className={config.color} />
                                        <div>
                                            <p className="text-lg font-bold text-slate-800">{item.count}</p>
                                            <p className="text-[10px] text-slate-500 font-medium">{config.label}</p>
                                        </div>
                                    </div>
                                );
                            });
                        })()}
                    </div>
                ) : (
                    <div className="text-center py-4 mb-5">
                        <p className="text-sm text-slate-400">No content published yet</p>
                    </div>
                )}

                {/* Weekly trend (mini chart) */}
                {analyticsData.length > 0 && (
                    <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Weekly Trend</p>
                        <div className="h-24 w-full">
                            <ResponsiveContainer width="100%" height={96}>
                                <AreaChart data={analyticsData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorOverview" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f97316" stopOpacity={0.1} />
                                            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <Tooltip
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px -2px rgb(0 0 0 / 0.1)', fontSize: '12px', color: '#334155' }}
                                        itemStyle={{ color: '#ea580c', fontWeight: 'bold' }}
                                    />
                                    <XAxis dataKey="name" hide />
                                    <YAxis hide />
                                    <Area
                                        type="monotone"
                                        dataKey="posts"
                                        stroke="#f97316"
                                        strokeWidth={2}
                                        fillOpacity={1}
                                        fill="url(#colorOverview)"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}
            </div>

            <div className="h-12"></div>
        </div>
    );
};

export default Dashboard;