import React, { useState, useEffect, useRef } from 'react';
import { Calendar, CheckCircle, MessageCircle, RefreshCw, Send, Edit, Clock, Lock, Undo2, AlertTriangle, FileText, Image as ImageIcon, MoreHorizontal, CheckSquare, Square, AlertCircle, ChevronDown, LockKeyhole, History, Sparkles, Phone, Film, CircleDashed, Layers, Play, Video, ChevronLeft, ChevronRight, Pause, ScanEye, CalendarClock, Archive, X, Plus, PenTool } from 'lucide-react';
import {
    Post,
    Restaurant,
    computePostApprovalDeadline,
    isPostPastApprovalDeadline
} from '@restropulse/shared';
import { postsAPI, restaurantAPI } from '../api';
import { browserEvents } from '@restropulse/telemetry/browser';
import { ActionNotice } from './ActionNotice';

// Constants for Feedback configuration
const FEEDBACK_CATEGORIES = [
    { id: 'Caption', icon: FileText, label: 'Caption', question: "What's the issue with the text?" },
    { id: 'Media', icon: ImageIcon, label: 'Media', question: "What's wrong with the visual?" },
    { id: 'Timing', icon: Clock, label: 'Timing', question: "When should this go out?" },
    { id: 'Other', icon: MoreHorizontal, label: 'Other', question: "Any other details?" }
];

const QUICK_OPTIONS: Record<string, string[]> = {
    Caption: ["Too long", "Too short", "Check spelling", "Wrong tone", "Add emojis", "Remove emojis", "Hard to read", "Add hashtags", "Inaccurate info", "Not engaging"],
    Media: ["Blurry/Low Quality", "Wrong item/dish", "Bad lighting", "Crop/Framing issue", "Branding missing", "Prefer Video", "Prefer Image", "Old content", "Distracting background"],
    Timing: ["Post Sooner", "Post Later", "Weekend Only", "Weekdays Only", "Morning Slot", "Lunch Slot", "Dinner Slot", "Specific Date"],
    Other: ["Check Pricing", "Wrong Location", "Tag Partner", "Link in Bio", "Regulatory Issue", "Competitor visible", "Music Choice", "Add Logo"]
};

import { WhatsAppIcon } from './BrandIcons';

// Helper to parse feedback string (JSON or Plain Text)
interface FeedbackData {
    tags: string[];
    details: Record<string, string>;
    note: string;
    resolution?: string;
}

const parseFeedback = (feedbackStr?: string): FeedbackData => {
    if (!feedbackStr) return { tags: [], details: {}, note: '', resolution: '' };
    try {
        // Attempt to parse structured JSON
        const parsed = JSON.parse(feedbackStr);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tags)) {
            return {
                tags: parsed.tags || [],
                details: parsed.details || {},
                note: parsed.note || '',
                resolution: parsed.resolution || ''
            };
        }
        throw new Error("Legacy format");
    } catch (e) {
        // Fallback for plain text
        return { tags: ['Other'], details: { 'Other': feedbackStr }, note: '', resolution: '' };
    }
};

// Helper to split notes into chronological parts
const getFeedbackSequence = (fullNote: string, resolution?: string) => {
    // Split by the delimiter set in submitFeedback
    const parts = fullNote ? fullNote.split(/\n\n\[Update\]:\s*/) : [];
    return {
        original: parts[0] || "",
        update: parts.length > 1 ? parts[1] : "",
        resolution: resolution || ""
    };
};

const formatFeedbackDisplay = (feedbackStr?: string) => {
    const data = parseFeedback(feedbackStr);
    if (!data.tags.length && !data.note && !data.resolution) return null;

    const { original, update, resolution } = getFeedbackSequence(data.note, data.resolution);

    return (
        <div className="space-y-2 w-full">
            <div className="flex flex-wrap gap-2">
                {data.tags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-white/60 border border-current opacity-70 rounded-md text-[10px] font-bold uppercase tracking-wide">
                        {tag}
                    </span>
                ))}
            </div>
            <div className="space-y-1">
                {Object.entries(data.details).map(([key, val]) => val ? (
                    <div key={key} className="text-xs break-words">
                        <span className="font-bold opacity-90">{key}:</span> <span className="opacity-80">{val}</span>
                    </div>
                ) : null)}

                {/* 1. Original Feedback */}
                {original && (
                    <div className="text-xs pt-2 border-t border-black/5 mt-1 whitespace-pre-wrap break-words">
                        <span className="font-bold opacity-90 mr-1">Feedback:</span>
                        <span className="opacity-80">{original}</span>
                    </div>
                )}

                {/* 2. Resolution (Addressed) */}
                {resolution && (
                    <div className="text-xs pt-2 mt-2 border-t border-black/5 flex gap-2 items-start text-emerald-700 bg-emerald-50 -mx-2 px-2 py-1.5 rounded-md">
                        <CheckCircle size={14} className="shrink-0 mt-0.5 text-emerald-600" />
                        <div className="flex-1">
                            <span className="font-bold mr-1 text-emerald-800">Addressed:</span>
                            <span className="text-emerald-800">{resolution}</span>
                        </div>
                    </div>
                )}

                {/* 3. New Request (Update) */}
                {update && (
                    <div className="text-xs pt-2 border-t border-black/5 mt-1 whitespace-pre-wrap break-words">
                        <span className="font-bold opacity-90 mr-1">Feedback:</span>
                        <span className="opacity-80">{update}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

function formatPostCountdown(deadline: Date, now: Date): string {
    const diffMs = deadline.getTime() - now.getTime();
    if (diffMs <= 0) return 'Feedback window closed';
    const minutes = Math.floor(diffMs / 60000);
    if (minutes < 60) return `Feedback closes in ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        const m = minutes % 60;
        return m > 0 ? `Feedback closes in ${hours}h ${m}m` : `Feedback closes in ${hours}h`;
    }
    const days = Math.floor(hours / 24);
    const h = hours % 24;
    return h > 0 ? `Feedback closes in ${days}d ${h}h` : `Feedback closes in ${days}d`;
}

interface PostCardProps {
    post: Post;
    tab: 'REVIEW' | 'SCHEDULED' | 'HISTORY';
    onApprove: (id: string) => void;
    onFeedback: (id: string, type: 'EDIT' | 'REVERT') => void;
    approving?: string | null;
    instagramConnected?: boolean;
    now: Date;
    postApprovalBufferMins?: number;
}

const PostCard: React.FC<PostCardProps> = ({ post, tab, onApprove, onFeedback, approving, instagramConnected = true, now, postApprovalBufferMins }) => {
    // Local state for Carousel
    const [currentSlide, setCurrentSlide] = useState(0);
    const [touchStart, setTouchStart] = useState<number | null>(null);
    const [touchEnd, setTouchEnd] = useState<number | null>(null);

    // Local state for Video
    const [isPlaying, setIsPlaying] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);

    // Calculate time diff for Scheduled posts
    let hoursRemaining = 0;
    if (post.scheduledFor) {
        hoursRemaining = (new Date(post.scheduledFor).getTime() - Date.now()) / (1000 * 60 * 60);
    }

    const isLocked = hoursRemaining <= 3;
    const isPendingReview = post.status === 'PENDING_APPROVAL' || post.status === 'CHANGES_REQUESTED';
    const bufferHours = (postApprovalBufferMins ?? 120) / 60;
    const postDeadline = isPendingReview ? computePostApprovalDeadline(post, bufferHours) : null;
    const feedbackLocked = isPendingReview && postDeadline !== null && isPostPastApprovalDeadline(post, now, bufferHours);
    const isVertical = post.type === 'STORY' || post.type === 'REEL';
    // Only render as video player when a videoUrl is actually present.
    // STORY posts generated by the placeholder engine use image thumbnails
    // (no videoUrl), so they should render as images, not broken video players.
    const isVideoContent = (post.type === 'VIDEO' || post.type === 'REEL' || post.type === 'STORY') && !!post.videoUrl;
    const isCarousel = post.type === 'CAROUSEL' && post.mediaUrls && post.mediaUrls.length > 0;

    // Carousel Handlers
    const nextSlide = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!post.mediaUrls) return;
        setCurrentSlide(curr => (curr + 1) % post.mediaUrls!.length);
    };

    const prevSlide = (e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (!post.mediaUrls) return;
        setCurrentSlide(curr => (curr === 0 ? post.mediaUrls!.length - 1 : curr - 1));
    };

    // Swipe Logic
    const minSwipeDistance = 50;
    const onTouchStart = (e: React.TouchEvent) => {
        setTouchEnd(null);
        setTouchStart(e.targetTouches[0].clientX);
    };
    const onTouchMove = (e: React.TouchEvent) => setTouchEnd(e.targetTouches[0].clientX);
    const onTouchEnd = () => {
        if (!touchStart || !touchEnd) return;
        const distance = touchStart - touchEnd;
        const isLeftSwipe = distance > minSwipeDistance;
        const isRightSwipe = distance < -minSwipeDistance;
        if (isLeftSwipe) nextSlide();
        if (isRightSwipe) prevSlide();
    };

    // Video Handlers
    const togglePlay = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!videoRef.current) return;

        if (isPlaying) {
            videoRef.current.pause();
            setIsPlaying(false);
        } else {
            try {
                await videoRef.current.play();
                setIsPlaying(true);
            } catch (err) {
                console.error("Failed to play video:", err);
            }
        }
    };

    const getTypeIcon = () => {
        switch (post.type) {
            case 'REEL': return <Film size={12} />;
            case 'STORY': return <CircleDashed size={12} />;
            case 'CAROUSEL': return <Layers size={12} />;
            case 'VIDEO': return <Video size={12} />;
            default: return <ImageIcon size={12} />;
        }
    };

    const renderMedia = () => {
        // 0. Content still being generated — show a loading skeleton
        if (post.status === 'PENDING_CONTENT') {
            const aspectClass = post.type === 'REEL' || post.type === 'STORY' ? 'aspect-[4/5]' : 'h-64';
            return (
                <div className={`relative w-full ${aspectClass} bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center`}>
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                        <Sparkles size={20} className="animate-pulse" />
                        <span className="text-xs font-medium">Generating content...</span>
                    </div>
                </div>
            );
        }

        // 1. Video Content (Reels, Stories, Video Posts)
        if (isVideoContent) {
            return (
                <div className={`relative w-full ${isVertical ? 'aspect-[4/5]' : 'h-64'} bg-black group-hover:bg-slate-900 transition-colors`}>
                    {!isPlaying && (
                        <img
                            src={post.thumbnail}
                            alt="Video Thumbnail"
                            className={`w-full h-full object-cover animate-pulse ${post.status === 'MISSED_DEADLINE' ? 'grayscale' : ''}`}
                            loading="lazy"
                            onLoad={(e) => e.currentTarget.classList.remove('animate-pulse')}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        />
                    )}
                    {/* Video Element */}
                    <video
                        ref={videoRef}
                        src={post.videoUrl}
                        className={`w-full h-full object-cover absolute inset-0 ${!isPlaying ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
                        playsInline
                        loop
                        onEnded={() => setIsPlaying(false)}
                        preload="metadata"
                    />

                    {/* Play/Pause Overlay */}
                    <div
                        onClick={togglePlay}
                        className="absolute inset-0 flex items-center justify-center bg-black/10 hover:bg-black/20 transition-colors cursor-pointer z-10"
                    >
                        <div className={`w-12 h-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center transition-transform active:scale-95 ${isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100'}`}>
                            {isPlaying ? <Pause size={24} className="fill-white text-white" /> : <Play size={24} className="fill-white text-white ml-1" />}
                        </div>
                    </div>

                    {/* Duration Badge */}
                    {post.duration && (
                        <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md text-[10px] font-bold text-white flex items-center gap-1 z-20 pointer-events-none">
                            <Play size={8} fill="currentColor" />
                            {post.duration}
                        </div>
                    )}
                </div>
            );
        }

        // 2. Carousel Content
        if (isCarousel) {
            return (
                <div
                    className={`relative w-full ${isVertical ? 'aspect-[4/5]' : 'h-64'} bg-slate-100 touch-pan-y`}
                    onTouchStart={onTouchStart}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                >
                    <img
                        src={post.mediaUrls![currentSlide]}
                        alt={`Slide ${currentSlide + 1}`}
                        className={`w-full h-full object-cover transition-opacity duration-300 animate-pulse ${post.status === 'MISSED_DEADLINE' ? 'grayscale' : ''}`}
                        loading="lazy"
                        onLoad={(e) => e.currentTarget.classList.remove('animate-pulse')}
                    />

                    {/* Navigation Arrows (Desktop mostly) */}
                    <button
                        type="button"
                        onClick={prevSlide}
                        aria-label="Previous slide"
                        title="Previous slide"
                        className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/20 hover:bg-black/40 text-white p-1.5 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
                    >
                        <ChevronLeft size={16} />
                    </button>
                    <button
                        type="button"
                        onClick={nextSlide}
                        aria-label="Next slide"
                        title="Next slide"
                        className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/20 hover:bg-black/40 text-white p-1.5 rounded-full backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
                    >
                        <ChevronRight size={16} />
                    </button>

                    {/* Dots Indicator */}
                    <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-1.5 z-20">
                        {post.mediaUrls!.map((_, idx) => (
                            <div
                                key={idx}
                                className={`w-1.5 h-1.5 rounded-full shadow-sm transition-all ${idx === currentSlide ? 'bg-white w-3' : 'bg-white/50'}`}
                            />
                        ))}
                    </div>

                    {/* Slide Counter Badge */}
                    <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md text-[10px] font-bold text-white z-20 pointer-events-none">
                        {currentSlide + 1}/{post.mediaUrls!.length}
                    </div>
                </div>
            );
        }

        // 3. Standard Image
        return (
            <div className={`relative w-full ${isVertical ? 'aspect-[4/5]' : 'h-64'}`}>
                <img
                    src={post.thumbnail}
                    alt="Post"
                    className={`w-full h-full object-cover animate-pulse ${post.status === 'MISSED_DEADLINE' ? 'grayscale' : ''}`}
                    loading="lazy"
                    onLoad={(e) => e.currentTarget.classList.remove('animate-pulse')}
                />
            </div>
        );
    };

    return (
        <div className={`bg-white rounded-3xl overflow-hidden shadow-sm border mb-6 group transition-all hover:shadow-md active:scale-[0.99] ${post.status === 'MISSED_DEADLINE' ? 'border-red-100 opacity-90' : 'border-slate-100'}`}>

            {/* Media Rendering */}
            <div className="relative">
                {renderMedia()}

                {/* Type & Platform Badge */}
                <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-extrabold text-slate-800 shadow-sm tracking-wide uppercase flex items-center gap-1.5 z-20 pointer-events-none">
                    {getTypeIcon()}
                    <span>{post.type}</span>
                    <span className="w-px h-3 bg-slate-300 mx-0.5"></span>
                    <span>{post.platforms.join('+')}</span>
                </div>

                {/* Status Overlay for Scheduled */}
                {tab === 'SCHEDULED' && (
                    <div className={`absolute bottom-4 left-4 backdrop-blur-md text-white px-3 py-1.5 rounded-full text-xs font-bold shadow-sm flex items-center gap-1.5 z-20 ${isLocked ? 'bg-slate-700/90' : 'bg-green-500/90'}`}>
                        {isLocked ? (
                            <><Lock size={14} className="stroke-white" /> Locked for Publishing</>
                        ) : (
                            <><CheckCircle size={14} className="stroke-white" /> Ready to Post</>
                        )}
                    </div>
                )}

                {/* Status Overlay for Generating (caption + initial media) */}
                {post.status === 'PENDING_CONTENT' && (
                    <div className="absolute bottom-4 left-4 bg-violet-500/90 backdrop-blur-md text-white px-3 py-1.5 rounded-full text-xs font-bold shadow-sm flex items-center gap-1.5 z-20">
                        <Sparkles size={14} /> Generating
                    </div>
                )}

                {/* Status Overlay for Generating Media (caption ready, video in flight) */}
                {post.status === 'PENDING_MEDIA' && (
                    <div className="absolute bottom-4 left-4 bg-violet-500/90 backdrop-blur-md text-white px-3 py-1.5 rounded-full text-xs font-bold shadow-sm flex items-center gap-1.5 z-20">
                        <Sparkles size={14} className="animate-pulse" /> Generating media
                    </div>
                )}

                {/* Status Overlay for Changes Requested */}
                {post.status === 'CHANGES_REQUESTED' && tab === 'REVIEW' && (
                    <div className="absolute bottom-4 left-4 bg-orange-500/90 backdrop-blur-md text-white px-3 py-1.5 rounded-full text-xs font-bold shadow-sm flex items-center gap-1.5 z-20">
                        <RefreshCw size={14} className="stroke-white" /> Changes Requested
                    </div>
                )}

                {/* Status Overlay for Missed Deadline / Publish Failed */}
                {post.status === 'MISSED_DEADLINE' && (
                    <div className="absolute bottom-4 left-4 bg-red-500/90 backdrop-blur-md text-white px-3 py-1.5 rounded-full text-xs font-bold shadow-sm flex items-center gap-1.5 z-20">
                        <AlertTriangle size={14} className="stroke-white" /> {post.publishError ? 'Publish Failed' : 'Missed Deadline'}
                    </div>
                )}
            </div>

            <div className="p-5 space-y-4">
                {/* Date Header */}
                <div className="flex items-center justify-between">
                    <div className={`flex items-center gap-2 text-xs font-bold uppercase tracking-wider ${post.status === 'MISSED_DEADLINE' ? 'text-red-400' : 'text-slate-500'}`}>
                        <Calendar size={14} className={`${post.status === 'MISSED_DEADLINE' ? 'text-red-400' : 'text-orange-500'} mb-0.5`} />
                        <span>
                            {new Date(post.scheduledFor || post.postedAt || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            <span className="mx-1">•</span>
                            {new Date(post.scheduledFor || post.postedAt || Date.now()).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                        </span>
                    </div>
                </div>

                {/* Caption */}
                <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-wrap font-medium">
                    {post.status === 'PENDING_CONTENT'
                        ? <span className="text-slate-400 italic">Caption will appear here once generated...</span>
                        : post.caption}
                </p>

                {/* Feedback Section (Review & Scheduled Tabs) */}
                {post.feedback && (tab === 'REVIEW' || tab === 'SCHEDULED' || post.status === 'MISSED_DEADLINE') && (
                    <div className={`p-4 rounded-2xl flex gap-3 items-start border ${post.status === 'MISSED_DEADLINE' ? 'bg-red-50 border-red-100 text-red-900' :
                        tab === 'SCHEDULED' ? 'bg-slate-50 border-slate-100 text-slate-700' :
                            'bg-orange-50 border-orange-100 text-orange-900'
                        }`}>
                        <MessageCircle size={16} className={`mt-0.5 shrink-0 ${post.status === 'MISSED_DEADLINE' ? 'text-red-600' :
                            tab === 'SCHEDULED' ? 'text-slate-400' :
                                'text-orange-600'
                            }`} />
                        <div className="flex-1 min-w-0">
                            <span className={`text-xs font-bold block mb-2 ${post.status === 'MISSED_DEADLINE' ? 'text-red-700' :
                                tab === 'SCHEDULED' ? 'text-slate-500' :
                                    'text-orange-700'
                                }`}>Feedback History:</span>
                            {formatFeedbackDisplay(post.feedback)}
                        </div>
                    </div>
                )}

                {/* Actions - Review Tab */}
                {tab === 'REVIEW' && (
                    <>
                        {postDeadline && (
                            <div
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold ${feedbackLocked ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}
                                aria-label={feedbackLocked ? 'Feedback window closed' : 'Time remaining to request changes'}
                            >
                                {feedbackLocked ? <Lock size={12} /> : <Clock size={12} />}
                                <span>{formatPostCountdown(postDeadline, now)}</span>
                            </div>
                        )}
                        {post.status === 'CHANGES_REQUESTED' ? (
                            <div className="mt-3 flex items-center justify-between bg-orange-50/50 p-3 rounded-xl border border-orange-100/50">
                                <div className="flex items-center gap-2 text-orange-700">
                                    <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse"></div>
                                    <span className="text-xs font-bold">Revision in progress</span>
                                </div>

                                <div className="flex items-center gap-4">
                                    {feedbackLocked ? (
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                                            <Lock size={12} /> Feedback Closed
                                        </span>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => onFeedback(post.id, 'EDIT')}
                                            className="text-[10px] font-bold text-slate-400 hover:text-orange-600 uppercase tracking-wide transition-colors"
                                        >
                                            Add Note
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onApprove(post.id)}
                                        disabled={approving === post.id || !instagramConnected}
                                        className={`text-[10px] font-bold uppercase tracking-wide transition-colors ${!instagramConnected ? 'text-slate-300 cursor-not-allowed' : approving === post.id ? 'text-slate-300 cursor-wait' : 'text-slate-400 hover:text-green-600'}`}
                                        title={!instagramConnected ? 'Connect Instagram first' : undefined}
                                    >
                                        {approving === post.id ? 'Approving...' : 'Approve'}
                                    </button>
                                </div>
                            </div>
                        ) : feedbackLocked ? (
                            // Deadline passed — no action needed. Deadline processor
                            // will auto-advance to SCHEDULED on the next cron tick.
                            <div className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 text-sm font-medium mt-2">
                                <LockKeyhole size={15} />
                                <span>Feedback closed · Scheduling automatically</span>
                            </div>
                        ) : isPendingReview ? (
                            <div className="grid grid-cols-2 gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => onFeedback(post.id, 'EDIT')}
                                    className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 active:scale-[0.98] transition-all"
                                >
                                    <Edit size={16} /> Request Edit
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onApprove(post.id)}
                                    disabled={approving === post.id || !instagramConnected}
                                    className={`flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-sm transition-all ${!instagramConnected ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : approving === post.id ? 'bg-orange-400 text-white/80 cursor-wait' : 'bg-orange-600 text-white shadow-lg shadow-orange-600/20 hover:bg-orange-700 active:scale-[0.98]'}`}
                                    title={!instagramConnected ? 'Connect Instagram first' : undefined}
                                >
                                    {approving === post.id ? (
                                        <><RefreshCw size={16} className="animate-spin" /> Approving...</>
                                    ) : (
                                        <><CheckCircle size={16} /> Approve</>
                                    )}
                                </button>
                            </div>
                        ) : null}
                    </>
                )}

                {/* Actions - Scheduled Tab */}
                {tab === 'SCHEDULED' && (
                    <div className="pt-3 border-t border-slate-50">
                        {isLocked ? (
                            <div className="flex items-center justify-center gap-2 text-xs text-slate-400 italic bg-slate-50 py-3 rounded-xl">
                                <Lock size={14} />
                                Publishing soon. Changes locked.
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onFeedback(post.id, 'REVERT');
                                }}
                                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 active:scale-[0.98] transition-all"
                            >
                                <Undo2 size={14} /> Revert to Review
                            </button>
                        )}
                    </div>
                )}

                {/* Footer - History Tab */}
                {tab === 'HISTORY' && (
                    <div className="pt-3 flex justify-between items-center border-t border-slate-50">
                        {post.status === 'MISSED_DEADLINE' ? (
                            <div className="w-full text-center text-xs text-red-500 font-bold bg-red-50 py-2 px-3 rounded-lg">
                                {post.publishError ? (
                                    <>
                                        <span className="block">Publish Failed</span>
                                        <span className="block text-[10px] font-medium text-red-400 mt-1 truncate" title={post.publishError}>{post.publishError}</span>
                                    </>
                                ) : (
                                    'Not Approved in Time'
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center gap-4 text-slate-500 text-xs font-bold">
                                    <span className="flex items-center gap-1">❤️ {post.stats?.likes || 0}</span>
                                    <span className="flex items-center gap-1">💬 {post.stats?.comments || 0}</span>
                                </div>
                                <span className="text-xs text-green-600 font-bold flex items-center gap-1 bg-green-50 px-2 py-1 rounded-lg">
                                    <Send size={12} /> Published
                                </span>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

interface ContentStudioProps {
    onCreatePost?: () => void;
    refreshKey?: number;
    instagramConnected?: boolean;
    onConnectInstagram?: () => void;
    postApprovalBufferMins?: number;
    instagramEnabled?: boolean;
    facebookEnabled?: boolean;
}

const ContentStudio: React.FC<ContentStudioProps> = ({ onCreatePost, refreshKey, instagramConnected = false, onConnectInstagram, postApprovalBufferMins, instagramEnabled = true, facebookEnabled = true }) => {
    type TabType = 'REVIEW' | 'SCHEDULED' | 'HISTORY';
    const [activeTab, setActiveTab] = useState<TabType>('REVIEW');
    const [posts, setPosts] = useState<Post[]>([]);
    const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
    const [loading, setLoading] = useState(true);
    const [notice, setNotice] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        // Tick at 1/12 of the buffer, capped at 10 s min and 60 s max, so the
        // countdown stays accurate whether the buffer is 2 minutes or 2 hours.
        const bufferMs = (postApprovalBufferMins ?? 120) * 60 * 1000;
        const tickMs = Math.min(60_000, Math.max(10_000, bufferMs / 12));
        const interval = setInterval(() => setNow(new Date()), tickMs);
        return () => clearInterval(interval);
    }, [postApprovalBufferMins]);

    // Auto-dismiss notice
    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(null), 4000);
        return () => clearTimeout(timer);
    }, [notice]);

    const loadPosts = async () => {
        try {
            const postsData = await postsAPI.getAll();
            setPosts(postsData);
        } catch (error) {
            console.error('Failed to load posts:', error);
        }
    };

    useEffect(() => {
        const loadData = async () => {
            try {
                const [postsData, restaurantData] = await Promise.all([
                    postsAPI.getAll(),
                    restaurantAPI.get(localStorage.getItem('rp_restaurant_id') || '')
                ]);
                setPosts(postsData);
                setRestaurant(restaurantData);
            } catch (error) {
                console.error('Failed to load content studio data:', error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    // Refresh posts when refreshKey changes (triggered by parent after adhoc post creation)
    useEffect(() => {
        if (refreshKey && refreshKey > 0) {
            loadPosts();
            setActiveTab('REVIEW');
        }
    }, [refreshKey]);

    // Poll every 5 s while any post is mid-transition so the card moves
    // to the correct section without the user needing to reload:
    //   PENDING_CONTENT      → content-engine filling caption + media
    //   past approval deadline → deadline-processor advancing to SCHEDULED
    //   SCHEDULED past due    → publisher cron advancing to POSTED
    //   PUBLISHING            → publisher finishing (→ POSTED or MISSED_DEADLINE in History)
    useEffect(() => {
        const now = new Date();
        const bufferHours = (postApprovalBufferMins ?? 120) / 60;
        const hasChangingPosts = posts.some(p =>
            p.status === 'PENDING_CONTENT' ||
            p.status === 'PUBLISHING' ||
            ((p.status === 'PENDING_APPROVAL' || p.status === 'CHANGES_REQUESTED') &&
             isPostPastApprovalDeadline(p, now, bufferHours)) ||
            (p.status === 'SCHEDULED' && p.scheduledFor &&
             new Date(p.scheduledFor).getTime() <= now.getTime())
        );
        if (!hasChangingPosts) return;
        const id = setTimeout(loadPosts, 5_000);
        return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [posts, postApprovalBufferMins]);

    // Feedback Modal State
    const [feedbackState, setFeedbackState] = useState<{
        isOpen: boolean;
        postId: string | null;
        type: 'EDIT' | 'REVERT';
        warning?: string | null;
        isReadOnly?: boolean;
        isLimitReached?: boolean;
    }>({ isOpen: false, postId: null, type: 'EDIT' });

    // Active Tab for Feedback
    const [activeFeedbackTab, setActiveFeedbackTab] = useState<string>('Caption');

    // Drag to Close State
    const [dragOffset, setDragOffset] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const startY = useRef(0);
    const modalContentRef = useRef<HTMLDivElement>(null);

    // Form State
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [tagDetails, setTagDetails] = useState<Record<string, string>>({});
    const [generalNote, setGeneralNote] = useState("");
    const [previousNote, setPreviousNote] = useState("");
    const [previousResolution, setPreviousResolution] = useState("");

    // History Handling for Modal (Back Button Support)
    useEffect(() => {
        const handlePopState = (event: PopStateEvent) => {
            if (feedbackState.isOpen) {
                setFeedbackState(prev => ({ ...prev, isOpen: false }));
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [feedbackState.isOpen]);

    // Escape key to dismiss feedback modal
    useEffect(() => {
        if (!feedbackState.isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeFeedbackModal(); };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [feedbackState.isOpen]);

    const closeFeedbackModal = () => {
        // Manual close should trigger history back to keep sync
        if (feedbackState.isOpen) {
            window.history.back();
        }
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        // Only enable drag if we are at the top of the scroll container
        if (modalContentRef.current) {
            const scrollTop = modalContentRef.current.scrollTop;
            if (scrollTop > 0) return;
        }

        setIsDragging(true);
        startY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        if (!isDragging) return;
        const currentY = e.touches[0].clientY;
        const diff = currentY - startY.current;

        // Only allow dragging down
        if (diff > 0) {
            setDragOffset(diff);
            // Prevent scrolling while dragging
            if (e.cancelable) e.preventDefault();
        }
    };

    const handleTouchEnd = () => {
        setIsDragging(false);
        if (dragOffset > 100) { // Threshold to close
            closeFeedbackModal();
        } else {
            setDragOffset(0); // Snap back
        }
    };

    const openFeedbackModal = (id: string, type: 'EDIT' | 'REVERT') => {
        const post = posts.find(p => p.id === id);
        const previousData = parseFeedback(post?.feedback);

        const hasHistory = !!post?.feedback;
        const isReadOnly = hasHistory;

        const updateCount = (previousData.note.match(/\[Update\]:/g) || []).length;
        const isLimitReached = isReadOnly && updateCount >= 1;

        setFeedbackState({ isOpen: true, postId: id, type, warning: null, isReadOnly, isLimitReached });
        setDragOffset(0); // Reset drag state
        setActiveFeedbackTab('Caption'); // Reset tab

        window.history.pushState({ modal: 'feedback', postId: id }, '', '#feedback');

        setSelectedTags(previousData.tags);
        setTagDetails(previousData.details);

        if (isReadOnly) {
            setPreviousNote(previousData.note);
            setPreviousResolution(previousData.resolution || "");
            setGeneralNote("");
        } else {
            setPreviousNote("");
            setPreviousResolution("");
            setGeneralNote(previousData.note);
        }
    };

    // Simulation: Check for missed deadlines on mount
    useEffect(() => {
        setPosts(currentPosts => {
            const now = Date.now();
            return currentPosts.map(post => {
                const isPending = post.status === 'PENDING_APPROVAL' || post.status === 'CHANGES_REQUESTED';
                if (isPending && post.scheduledFor && new Date(post.scheduledFor).getTime() < now) {
                    return { ...post, status: 'MISSED_DEADLINE' };
                }
                return post;
            });
        });
    }, []);

    const reviewPosts = posts.filter(p => p.status === 'PENDING_APPROVAL' || p.status === 'CHANGES_REQUESTED' || p.status === 'PENDING_CONTENT' || p.status === 'PENDING_MEDIA');
    const scheduledPosts = posts.filter(p => p.status === 'SCHEDULED');
    const historyPosts = posts.filter(p => p.status === 'POSTED' || p.status === 'MISSED_DEADLINE');

    const displayPosts = activeTab === 'REVIEW' ? reviewPosts : activeTab === 'SCHEDULED' ? scheduledPosts : historyPosts;

    const [approving, setApproving] = useState<string | null>(null);

    const handleApprove = async (id: string) => {
        if (approving) return; // Prevent double-clicks
        setApproving(id);

        try {
            const post = posts.find(p => p.id === id);
            const updateData: Partial<Post> = {
                status: 'SCHEDULED',
                // If no scheduledFor set (e.g. adhoc posts), schedule for now so publishing cron picks it up
                ...(!post?.scheduledFor ? { scheduledFor: new Date().toISOString() } : {})
            };

            // Persist to backend first, then update UI with the real response
            const updatedPost = await postsAPI.update(id, updateData);
            setPosts(prev => prev.map(p => p.id === id ? updatedPost : p));
            browserEvents.postCreated(post?.type || 'unknown');
        } catch (err) {
            console.error('Failed to approve post:', err);
        } finally {
            setApproving(null);
        }
    };

    // Improved Logic: Toggling a chip also ensures the parent category is selected
    const toggleDetailOption = (category: string, option: string) => {
        if (feedbackState.isReadOnly) return;

        const currentVal = tagDetails[category] || "";
        const currentOptions = currentVal ? currentVal.split(', ').filter(Boolean) : [];
        let newOptions;

        if (currentOptions.includes(option)) {
            newOptions = currentOptions.filter(o => o !== option);
        } else {
            newOptions = [...currentOptions, option];
        }

        // 1. Update Details string
        const newDetailString = newOptions.join(', ');
        setTagDetails(prev => ({ ...prev, [category]: newDetailString }));

        // 2. Automatically sync 'selectedTags'
        setSelectedTags(prev => {
            if (newOptions.length > 0 && !prev.includes(category)) {
                return [...prev, category]; // Add category if it has options
            } else if (newOptions.length === 0 && prev.includes(category)) {
                return prev.filter(t => t !== category); // Remove category if empty
            }
            return prev;
        });

        if (feedbackState.warning) setFeedbackState(prev => ({ ...prev, warning: null }));
    };

    const submitFeedback = (ignoreWarning = false) => {
        if (!feedbackState.postId) return;

        // Validation Logic
        if (selectedTags.length === 0) {
            setFeedbackState(prev => ({ ...prev, warning: "Please select at least one issue or add a note." }));
            return;
        }

        if (feedbackState.type === 'REVERT' && feedbackState.isReadOnly && generalNote.trim().length === 0) {
            setFeedbackState(prev => ({ ...prev, warning: "Please add a note explaining why you are reverting this post so the team knows what to fix." }));
            return;
        }

        // Check if chips are missing for a selected category, but allow General Note to override
        if (!feedbackState.isReadOnly) {
            const missingDetails = selectedTags.filter(tag => {
                const hasChips = tagDetails[tag] && tagDetails[tag].length > 0;
                return !hasChips;
            });
            const hasGeneralContext = generalNote.trim().length > 5;

            // Only warn if they selected a tab but picked no chips AND wrote no note
            if (missingDetails.length > 0 && !hasGeneralContext && !ignoreWarning) {
                // If we are here, it means they manually selected a category via some other means (if we had checkboxes), 
                // OR they cleared all chips but the state didn't sync (which my new toggleDetailOption prevents).
                // However, safe guard:
                setFeedbackState(prev => ({
                    ...prev,
                    warning: `Please select specific issues for ${missingDetails[0]} or add a General Comment.`
                }));
                return;
            }
        }

        // State Update Logic
        let finalNote = generalNote;
        if (feedbackState.isReadOnly && previousNote && generalNote) {
            finalNote = `${previousNote}\n\n[Update]: ${generalNote}`;
        } else if (feedbackState.isReadOnly && previousNote) {
            finalNote = previousNote;
        }

        const currentPost = posts.find(p => p.id === feedbackState.postId);
        const currentFeedbackData = parseFeedback(currentPost?.feedback);

        const feedbackPayload: FeedbackData = {
            tags: selectedTags,
            details: tagDetails,
            note: finalNote,
            resolution: currentFeedbackData.resolution
        };

        const feedbackString = JSON.stringify(feedbackPayload);

        // API Call
        postsAPI.update(feedbackState.postId!, {
            status: 'CHANGES_REQUESTED',
            feedback: feedbackString
        }).catch(err => console.error("Failed to update post:", err));

        setPosts(prev => prev.map(p => p.id === feedbackState.postId ? {
            ...p,
            status: 'CHANGES_REQUESTED',
            feedback: feedbackString
        } : p));

        if (feedbackState.type === 'REVERT') {
            setNotice({ message: 'Post moved back to Review.', type: 'success' });
        }

        // Hard Close: Immediately update state to closed, then sync history
        setFeedbackState(prev => ({ ...prev, isOpen: false }));

        // Only pop history if it matches our modal state to avoid navigating back too far
        if (window.history.state?.modal === 'feedback') {
            window.history.back();
        }
    };

    const contactAccountManager = () => {
        const managerName = restaurant?.accountManager?.name || 'Account Manager';
        const managerPhone = restaurant?.accountManager?.phone || '';
        const restaurantName = restaurant?.name || 'Restaurant';
        const message = `Hi ${managerName.split(' ')[0]}, regarding Post #${feedbackState.postId} for ${restaurantName}. I have some more complex feedback and have reached the revision limit. Previous context: ${previousNote.substring(0, 100)}...`;
        const url = `https://wa.me/${managerPhone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(message)}`;
        window.open(url, '_blank');
    };

    const modalHistorySequence = getFeedbackSequence(previousNote, previousResolution);

    // Helper for active tab question
    const activeCategoryData = FEEDBACK_CATEGORIES.find(c => c.id === activeFeedbackTab);

    const TABS = [
        { id: 'REVIEW' as const, label: 'Review', icon: ScanEye, count: reviewPosts.length, color: 'text-orange-600', desc: 'Pending Approval' },
        { id: 'SCHEDULED' as const, label: 'Scheduled', icon: CalendarClock, count: scheduledPosts.length, color: 'text-green-600', desc: 'Ready to Post' },
        { id: 'HISTORY' as const, label: 'History', icon: Archive, count: 0, color: 'text-slate-600', desc: 'Past Content' },
    ];

    const activeTabData = TABS.find(t => t.id === activeTab) || TABS[0];

    if (loading) {
        return (
            <div className="p-4 space-y-4">
                <div className="bg-slate-200/60 p-1 rounded-2xl h-12 animate-pulse" />
                {[1, 2].map(i => <div key={i} className="bg-slate-100 rounded-3xl h-64 animate-pulse" />)}
            </div>
        );
    }

    return (
        <div className="p-4 min-h-full relative">

            {/* 1. Tab Navigation */}
            <div className="sticky top-0 z-30 bg-[#f8fafc]/95 backdrop-blur-sm">
                <div className="flex border-b border-slate-200">
                    {TABS.map((tab) => {
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                type="button"
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-xs font-bold transition-all relative ${isActive ? 'text-slate-800' : 'text-slate-400 hover:text-slate-500'}`}
                            >
                                <tab.icon size={15} className={isActive ? tab.color : ''} />
                                <span>{tab.label}</span>
                                {tab.count > 0 && (
                                    <span className={`px-1.5 py-0.5 rounded-md text-[9px] ${isActive ? (tab.id === 'REVIEW' ? 'bg-orange-100 text-orange-700' : 'bg-green-100 text-green-700') : 'bg-slate-200 text-slate-500'}`}>
                                        {tab.count}
                                    </span>
                                )}
                                {isActive && (
                                    <div className={`absolute bottom-0 left-3 right-3 h-0.5 rounded-full ${tab.id === 'REVIEW' ? 'bg-orange-500' : tab.id === 'SCHEDULED' ? 'bg-green-500' : 'bg-slate-500'}`}></div>
                                )}
                            </button>
                        );
                    })}
                </div>

                <div className="flex items-center justify-center py-3 gap-2">
                    <span className="text-xs font-medium text-slate-500">
                        {activeTabData.id === 'REVIEW'
                            ? (reviewPosts.length > 0 ? `${reviewPosts.length} posts need your approval` : 'All caught up!')
                            : activeTabData.id === 'SCHEDULED'
                                ? (scheduledPosts.length > 0 ? `${scheduledPosts.length} posts queued for publishing` : 'Queue is empty')
                                : 'View performance of past posts'
                        }
                    </span>
                </div>
            </div>

            {instagramEnabled && !instagramConnected && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between gap-3">
                    <p className="text-xs text-amber-800 font-medium">Connect Instagram to approve and publish posts.</p>
                    {onConnectInstagram && (
                        <button onClick={onConnectInstagram} className="shrink-0 px-3 py-1.5 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 transition-colors">
                            Connect
                        </button>
                    )}
                </div>
            )}

            {notice && (
                <div className="mb-4">
                    <ActionNotice
                        message={notice.message}
                        type={notice.type}
                    />
                </div>
            )}

            {/* Content List */}
            <div className="space-y-4">
                {displayPosts.length > 0 ? (
                    displayPosts.map(post => (
                        <PostCard
                            key={post.id}
                            post={post}
                            tab={activeTab}
                            onApprove={handleApprove}
                            onFeedback={openFeedbackModal}
                            approving={approving}
                            instagramConnected={instagramConnected}
                            now={now}
                            postApprovalBufferMins={postApprovalBufferMins}
                        />
                    ))
                ) : posts.length === 0 && onCreatePost ? (
                    <div className="flex flex-col items-center justify-center py-20">
                        <div className="w-20 h-20 bg-orange-50 rounded-full flex items-center justify-center mb-4 border border-orange-100">
                            <PenTool size={32} className="text-orange-400" />
                        </div>
                        <p className="font-bold text-slate-700 text-lg">Create your first post</p>
                        <p className="text-sm text-slate-500 mt-1 max-w-[260px] text-center">
                            Describe your idea and our team will craft the perfect content.
                        </p>
                        <button
                            onClick={onCreatePost}
                            className="mt-6 px-6 py-3 bg-orange-600 text-white rounded-xl font-semibold text-sm hover:bg-orange-700 transition-colors active:scale-[0.97]"
                        >
                            Create Post
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4 border border-slate-100">
                            {activeTab === 'REVIEW' ? <CheckCircle size={32} className="text-slate-300" /> :
                                activeTab === 'SCHEDULED' ? <Calendar size={32} className="text-slate-300" /> :
                                    <Clock size={32} className="text-slate-300" />}
                        </div>
                        <p className="font-medium text-slate-600">No posts in {activeTab.toLowerCase()}</p>
                        <p className="text-xs text-slate-400 mt-1 max-w-[200px] text-center">
                            {activeTab === 'REVIEW' ? "You're all caught up! No posts pending approval." :
                                activeTab === 'SCHEDULED' ? "Approve posts in the Review tab to see them here." :
                                    "Your published history will appear here."}
                        </p>
                    </div>
                )}
            </div>

            {/* Swipeable Bottom Sheet */}
            {feedbackState.isOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    {/* Click outside to close */}
                    <div className="absolute inset-0" onClick={closeFeedbackModal}></div>

                    <div
                        className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl animate-in slide-in-from-bottom duration-300 flex flex-col relative z-10 transition-transform"
                        style={{
                            transform: isDragging ? `translateY(${dragOffset}px)` : 'translateY(0)',
                            maxHeight: '90vh'
                        }}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                    >
                        {/* Drag Handle Area */}
                        <div
                            className="w-full flex items-center justify-center pt-4 pb-2"
                        >
                            <div className="w-12 h-1.5 bg-slate-200 rounded-full"></div>
                        </div>

                        <div
                            ref={modalContentRef}
                            className="p-6 pt-2 overflow-y-auto no-scrollbar"
                        >
                            <div className="flex justify-between items-center mb-4 shrink-0">
                                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                    {feedbackState.isLimitReached ? <span className="text-red-500">Max Revisions Reached</span> :
                                        feedbackState.isReadOnly
                                            ? <><History size={18} /> Review Notes</>
                                            : <><Sparkles size={18} className="text-orange-500" /> Refine Content</>
                                    }
                                </h3>
                            </div>

                            {feedbackState.isLimitReached ? (
                                <div className="text-center py-6">
                                    <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                        <Phone size={32} className="text-orange-600" />
                                    </div>
                                    <h4 className="text-lg font-bold text-slate-800 mb-2">Let's chat directly!</h4>
                                    <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                                        To ensure we get this perfect without delaying your schedule, please speak directly with your Account Manager after 2 rounds of feedback.
                                    </p>

                                    {modalHistorySequence.original && (
                                        <div className="bg-slate-50 p-4 rounded-xl text-left mb-4 border border-slate-100 max-h-40 overflow-y-auto no-scrollbar">
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Round 1:</p>
                                            <p className="text-xs text-slate-600 whitespace-pre-wrap break-words">{modalHistorySequence.original}</p>
                                        </div>
                                    )}

                                    {modalHistorySequence.resolution && (
                                        <div className="bg-emerald-50 p-4 rounded-xl text-left mb-4 border border-emerald-100 max-h-40 overflow-y-auto no-scrollbar">
                                            <div className="flex items-center gap-2 mb-1">
                                                <CheckCircle size={12} className="text-emerald-600" />
                                                <p className="text-xs font-bold text-emerald-600 uppercase tracking-wide">Action Taken:</p>
                                            </div>
                                            <p className="text-xs text-emerald-800 whitespace-pre-wrap break-words">{modalHistorySequence.resolution}</p>
                                        </div>
                                    )}

                                    {modalHistorySequence.update && (
                                        <div className="bg-orange-50 p-4 rounded-xl text-left mb-6 border border-orange-100 max-h-40 overflow-y-auto no-scrollbar">
                                            <p className="text-xs font-bold text-orange-400 uppercase tracking-wide mb-1">Round 2:</p>
                                            <p className="text-xs text-slate-600 whitespace-pre-wrap break-words">{modalHistorySequence.update}</p>
                                        </div>
                                    )}

                                    <button
                                        type="button"
                                        onClick={contactAccountManager}
                                        className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white font-bold py-3.5 rounded-xl shadow-md shadow-green-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2.5"
                                    >
                                        <WhatsAppIcon size={20} />
                                        <span>Chat with {restaurant?.accountManager?.name.split(' ')[0] || 'Manager'}</span>
                                    </button>
                                    <p className="text-[10px] text-slate-400 font-medium mt-3">
                                        Direct Priority Support Channel
                                    </p>
                                </div>
                            ) : (
                                <>
                                    {!feedbackState.isReadOnly && (
                                        <div className="mb-6">
                                            {/* 1. Category Tabs */}
                                            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                                                {FEEDBACK_CATEGORIES.map(category => {
                                                    const isActive = activeFeedbackTab === category.id;
                                                    const hasSelections = selectedTags.includes(category.id);
                                                    return (
                                                        <button
                                                            type="button"
                                                            key={category.id}
                                                            onClick={() => setActiveFeedbackTab(category.id)}
                                                            className={`
                                                        flex items-center gap-2 px-4 py-2.5 rounded-full text-xs font-bold whitespace-nowrap transition-all border
                                                        ${isActive
                                                                    ? 'bg-slate-800 text-white border-slate-800 shadow-md transform scale-105'
                                                                    : hasSelections
                                                                        ? 'bg-orange-50 text-orange-700 border-orange-200'
                                                                        : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                                                }
                                                    `}
                                                        >
                                                            <category.icon size={14} />
                                                            {category.label}
                                                            {hasSelections && !isActive && <div className="w-1.5 h-1.5 bg-orange-500 rounded-full"></div>}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* 2. Chip Grid for Active Category */}
                                            <div className="mt-4 animate-in fade-in slide-in-from-right-4 duration-300" key={activeFeedbackTab}>
                                                <p className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                                                    {activeCategoryData?.question}
                                                </p>
                                                <div className="flex flex-wrap gap-2">
                                                    {QUICK_OPTIONS[activeFeedbackTab].map((option) => {
                                                        const isSelected = (tagDetails[activeFeedbackTab] || '').split(', ').includes(option);
                                                        return (
                                                            <button
                                                                type="button"
                                                                key={option}
                                                                onClick={() => toggleDetailOption(activeFeedbackTab, option)}
                                                                className={`
                                                            px-3 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95
                                                            ${isSelected
                                                                        ? 'bg-orange-500 border-orange-500 text-white shadow-md shadow-orange-500/20'
                                                                        : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
                                                                    }
                                                        `}
                                                            >
                                                                {option}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Read-Only History View (Standard List) */}
                                    {feedbackState.isReadOnly && (
                                        <div className="space-y-4 mb-6">
                                            {/* Show existing feedback nicely without tabs */}
                                            {FEEDBACK_CATEGORIES.filter(c => selectedTags.includes(c.id)).map(cat => (
                                                <div key={cat.id} className="bg-slate-50 border border-slate-100 p-3 rounded-xl">
                                                    <div className="flex items-center gap-2 mb-2 text-slate-500">
                                                        <cat.icon size={14} />
                                                        <span className="text-xs font-bold uppercase">{cat.label}</span>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {(tagDetails[cat.id] || '').split(', ').filter(Boolean).map(opt => (
                                                            <span key={opt} className="px-2 py-1 bg-white border border-slate-200 rounded-md text-[10px] font-bold text-slate-700">
                                                                {opt}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}

                                            {modalHistorySequence.original && (
                                                <div className="mt-6 animate-in fade-in duration-300">
                                                    <div className="flex justify-end mb-2">
                                                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Round 1</span>
                                                    </div>
                                                    <div className="flex gap-3 justify-end">
                                                        <div className="max-w-[85%] bg-blue-50 border border-blue-100 rounded-2xl rounded-tr-sm p-3 text-sm text-slate-700 whitespace-pre-wrap break-words shadow-sm">
                                                            {modalHistorySequence.original}
                                                        </div>
                                                        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center shrink-0">
                                                            <span className="text-xs font-bold text-slate-500">You</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {modalHistorySequence.resolution && (
                                                <div className="mt-4 animate-in fade-in duration-300">
                                                    <div className="flex justify-start mb-2">
                                                        <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Action Taken</span>
                                                    </div>
                                                    <div className="flex gap-3 justify-start">
                                                        <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                                                            <Sparkles size={14} className="text-emerald-600" />
                                                        </div>
                                                        <div className="max-w-[85%] bg-emerald-50 border border-emerald-100 rounded-2xl rounded-tl-sm p-3 text-sm text-slate-700 whitespace-pre-wrap break-words shadow-sm">
                                                            {modalHistorySequence.resolution}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {modalHistorySequence.update && (
                                                <div className="mt-6 animate-in fade-in duration-300">
                                                    <div className="flex justify-end mb-2">
                                                        <span className="text-[10px] text-orange-400 font-bold uppercase tracking-wider">Round 2</span>
                                                    </div>
                                                    <div className="flex gap-3 justify-end">
                                                        <div className="max-w-[85%] bg-orange-50 border border-orange-100 rounded-2xl rounded-tr-sm p-3 text-sm text-slate-700 whitespace-pre-wrap break-words shadow-sm">
                                                            {modalHistorySequence.update}
                                                        </div>
                                                        <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                                                            <span className="text-xs font-bold text-orange-600">You</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="mt-2 mb-4 pt-4 border-t border-slate-100">
                                        <label className="block text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                                            {feedbackState.isReadOnly ? 'Add New Note' : 'General Comments'}
                                        </label>
                                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 focus-within:bg-white focus-within:border-orange-500 focus-within:ring-1 focus-within:ring-orange-500 transition-all shadow-sm relative">
                                            <textarea
                                                rows={3}
                                                maxLength={120}
                                                className="w-full bg-transparent border-none p-0 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:ring-0 outline-none resize-none leading-relaxed pb-4"
                                                placeholder={feedbackState.isReadOnly ? "Type new feedback here..." : "Any additional context..."}
                                                value={generalNote}
                                                onChange={(e) => setGeneralNote(e.target.value)}
                                            ></textarea>
                                            <div className={`text-[10px] font-bold transition-colors absolute bottom-2 right-4 ${generalNote.length >= 110 ? 'text-orange-500' : 'text-slate-300'}`}>
                                                {generalNote.length}/120
                                            </div>
                                        </div>
                                    </div>

                                    <div className="shrink-0 space-y-3 pb-safe">
                                        {feedbackState.warning && (
                                            <div className="bg-orange-50 border border-orange-100 p-3 rounded-xl flex gap-3 items-start animate-in fade-in slide-in-from-bottom-2">
                                                <AlertCircle size={20} className="text-orange-500 shrink-0 mt-0.5" />
                                                <p className="text-xs text-orange-800 font-medium leading-relaxed">{feedbackState.warning}</p>
                                            </div>
                                        )}

                                        <button
                                            type="button"
                                            onClick={() => submitFeedback(!!feedbackState.warning)}
                                            className={`w-full font-bold py-3.5 rounded-2xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${feedbackState.warning ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-slate-900 hover:bg-slate-800 text-white'}`}
                                        >
                                            {feedbackState.warning ? 'I understand, Submit Anyway' : (feedbackState.isReadOnly ? <><Send size={18} /> Add Note</> : <><RefreshCw size={18} /> Submit Revision</>)}
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="h-12"></div>
        </div>
    );
};

export default ContentStudio;