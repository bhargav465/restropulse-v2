import React, { useState, useEffect } from 'react';
import { Camera, UtensilsCrossed, Tag, FileText, UploadCloud, X, ChevronRight, Trash2, CalendarCheck, CheckCircle, Plus } from 'lucide-react';
import { Restaurant } from '@restropulse/shared';
import { restaurantAPI } from '../api';
import { ActionNotice } from './ActionNotice';
import ConfirmDialog from './ConfirmDialog';

interface InputsProps {
    restaurantData: Restaurant;
    onRefresh: () => Promise<void>;
}

// Updated Modal to Bottom Sheet
const Modal = ({ title, onClose, children }: any) => {
    // Handle back button closing
    useEffect(() => {
        const handlePopState = () => onClose();
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [onClose]);

    // Escape key to dismiss
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose(); };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Manual close handler to sync history
    const handleClose = () => {
        window.history.back();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            {/* Backdrop click to close */}
            <div className="absolute inset-0" onClick={handleClose}></div>

            <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom duration-300 relative z-10">
                {/* Drag Handle */}
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 shrink-0 sm:hidden"></div>

                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-slate-800">{title}</h3>
                </div>
                {children}
            </div>
        </div>
    );
};

// ... [ActionButton Component remains unchanged] ...
const ActionButton = ({ icon: Icon, title, desc, id, color, isFull, isDisabled, onClick }: any) => {
    return (
        <button
            onClick={onClick}
            disabled={isDisabled}
            className={`relative w-full text-left p-5 rounded-3xl border flex items-center gap-4 transition-all group
            ${isDisabled
                    ? 'bg-slate-50 border-slate-100 cursor-not-allowed'
                    : 'bg-white border-slate-100 shadow-sm hover:shadow-md active:scale-[0.98]'
                }
            ${isFull ? 'opacity-80' : ''}
          `}
        >
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-colors ${isDisabled ? 'bg-slate-200' : color}`}>
                <Icon size={26} className={isDisabled ? 'text-slate-400' : 'text-white'} />
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                    <h3 className={`font-bold text-lg truncate ${isDisabled ? 'text-slate-400' : 'text-slate-800 group-hover:text-orange-600 transition-colors'}`}>{title}</h3>
                    {isFull && <span className="shrink-0 text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">Full (3/3)</span>}
                    {isDisabled && <span className="shrink-0 text-[10px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full uppercase tracking-wider font-bold">Coming Soon</span>}
                </div>
                <p className={`text-xs leading-relaxed font-medium truncate ${isDisabled ? 'text-slate-400' : 'text-slate-500'}`}>{desc}</p>
            </div>
            {!isDisabled && (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${isFull ? 'bg-slate-100' : 'bg-slate-50 group-hover:bg-slate-100'}`}>
                    {isFull ? <X size={16} className="text-slate-400" /> : <Plus size={18} className="text-slate-400 group-hover:text-slate-600" />}
                </div>
            )}
        </button>
    );
};

const Inputs: React.FC<InputsProps> = ({ restaurantData, onRefresh }) => {
    const [activeModal, setActiveModal] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<{ type: 'OFFER' | 'SPECIAL'; index: number } | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);

    // Auto-dismiss notice
    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(null), 6000);
        return () => clearTimeout(timer);
    }, [notice]);

    // Form Inputs State
    const [offerInput, setOfferInput] = useState("");
    const [specialInput, setSpecialInput] = useState("");

    const closeModal = () => {
        setActiveModal(null);
        setSelectedFile(null);
    };

    const handleAdd = async (type: 'OFFER' | 'SPECIAL' | 'MENU', value?: string) => {
        setLoading(true);
        try {
            if (type === 'OFFER' && value) {
                await restaurantAPI.updateOffers(restaurantData.id, 'ADD', value);
            }
            if (type === 'SPECIAL' && value) {
                await restaurantAPI.updateSpecials(restaurantData.id, 'ADD', value);
            }
            if (type === 'MENU') {
                await restaurantAPI.updateMenu(restaurantData.id);
            }

            await onRefresh();
            window.history.back();
            setOfferInput("");
            setSpecialInput("");
        } catch (error) {
            console.error('Failed to update:', error);
            setNotice({ message: 'Something went wrong. Please try again or contact your account manager.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (type: 'OFFER' | 'SPECIAL', index: number) => {
        setLoading(true);
        try {
            if (type === 'OFFER') {
                await restaurantAPI.updateOffers(restaurantData.id, 'DELETE', index);
            } else {
                await restaurantAPI.updateSpecials(restaurantData.id, 'DELETE', index);
            }
            await onRefresh();
        } catch (error) {
            console.error('Failed to delete:', error);
            setNotice({ message: 'Something went wrong. Please try again or contact your account manager.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    const openActionModal = (id: string) => {
        if (id === 'offers' && (restaurantData.activeOffers?.length || 0) >= 3) {
            setNotice({ message: 'You can have up to 3 active offers. Remove one first.', type: 'error' });
            return;
        }
        if (id === 'special' && (restaurantData.chefSpecials?.length || 0) >= 3) {
            setNotice({ message: 'You can have up to 3 chef\'s specials. Remove one first.', type: 'error' });
            return;
        }
        setActiveModal(id);
        window.history.pushState({ modal: id }, '', `#${id}`);
    };

    const activeOffers = restaurantData.activeOffers || [];
    const chefSpecials = restaurantData.chefSpecials || [];
    const menuUpdated = restaurantData.menuLastUpdated;

    return (
        <div className="p-4 space-y-8">
            {notice && (
                <ActionNotice
                    message={notice.message}
                    type={notice.type}
                />
            )}

            <div className="bg-white border border-slate-200 rounded-3xl p-6">
                <h2 className="text-2xl font-bold mb-2 text-slate-800">Update Us</h2>
                <p className="text-slate-500 text-sm font-medium">Keep your AI content engine smart by sharing the latest updates from your restaurant.</p>
            </div>

            <div className="grid grid-cols-1 gap-4">
                <ActionButton
                    id="offers"
                    title="Upcoming Offers"
                    desc="Planning a discount? Let us know."
                    icon={Tag}
                    color="bg-purple-500 shadow-lg shadow-purple-500/20"
                    isFull={activeOffers.length >= 3}
                    onClick={() => openActionModal('offers')}
                />
                <ActionButton
                    id="special"
                    title="Chef's Specials"
                    desc="Highlight this weekend's star dish."
                    icon={UtensilsCrossed}
                    color="bg-orange-500 shadow-lg shadow-orange-500/20"
                    isFull={chefSpecials.length >= 3}
                    onClick={() => openActionModal('special')}
                />
                <ActionButton
                    id="menu"
                    title="Update Menu"
                    desc="New season, new menu? Upload it."
                    icon={FileText}
                    color="bg-blue-500 shadow-lg shadow-blue-500/20"
                    isFull={false}
                    onClick={() => { setActiveModal('menu'); window.history.pushState({ modal: 'menu' }, '', '#menu'); }}
                />
                <ActionButton
                    id="moment"
                    title="Captured Moments"
                    desc="Upload raw photos. We'll edit them."
                    icon={Camera}
                    color="bg-pink-500 shadow-lg shadow-pink-500/20"
                    isFull={false}
                    isDisabled={true}
                    onClick={() => { }}
                />
            </div>

            {/* Active Context Section */}
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center gap-2 mb-4 px-1">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Active Context</h2>
                </div>

                <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden divide-y divide-slate-50">

                    {/* Active Offers */}
                    <div className="p-4 flex items-start gap-4">
                        <div className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${activeOffers.length > 0 ? 'bg-purple-100 text-purple-600' : 'bg-slate-100 text-slate-400'}`}>
                            <Tag size={18} />
                        </div>
                        <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Current Offers</p>
                                {activeOffers.length > 0 && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full text-slate-500 font-bold">{activeOffers.length}/3</span>}
                            </div>

                            {activeOffers.length > 0 ? (
                                <div className="space-y-3 mt-2">
                                    {activeOffers.map((offer, index) => (
                                        <div key={index} className="flex justify-between items-start gap-2 group">
                                            <p className="font-bold text-slate-800 text-sm leading-snug flex-1">{offer}</p>
                                            <button
                                                onClick={() => setConfirmDelete({ type: 'OFFER', index })}
                                                aria-label={`Delete offer ${index + 1}`}
                                                title="Delete offer"
                                                className="text-slate-300 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-colors"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-400 italic">No active offers set.</p>
                            )}
                        </div>
                    </div>

                    {/* Chef's Specials */}
                    <div className="p-4 flex items-start gap-4">
                        <div className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${chefSpecials.length > 0 ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                            <UtensilsCrossed size={18} />
                        </div>
                        <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Chef's Specials</p>
                                {chefSpecials.length > 0 && <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded-full text-slate-500 font-bold">{chefSpecials.length}/3</span>}
                            </div>

                            {chefSpecials.length > 0 ? (
                                <div className="space-y-3 mt-2">
                                    {chefSpecials.map((special, index) => (
                                        <div key={index} className="flex justify-between items-start gap-2 group">
                                            <p className="font-bold text-slate-800 text-sm leading-snug flex-1">{special}</p>
                                            <button
                                                onClick={() => setConfirmDelete({ type: 'SPECIAL', index })}
                                                aria-label={`Delete special ${index + 1}`}
                                                title="Delete special"
                                                className="text-slate-300 hover:text-red-500 p-1 rounded-md hover:bg-red-50 transition-colors"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-slate-400 italic">No special highlighted.</p>
                            )}
                        </div>
                    </div>

                    {/* Menu Status */}
                    <div className="p-4 flex items-start gap-4">
                        <div className={`mt-1 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${menuUpdated ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-400'}`}>
                            <FileText size={18} />
                        </div>
                        <div className="flex-1">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Menu Status</p>
                            {menuUpdated ? (
                                <div className="flex justify-between items-start">
                                    <p className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                        <CalendarCheck size={14} className="text-blue-500" />
                                        Last updated: {new Date(menuUpdated).toLocaleDateString()}
                                    </p>
                                </div>
                            ) : (
                                <p className="text-sm text-slate-400 italic">No menu uploaded.</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="h-12"></div>

            {/* Modal - Offers */}
            {activeModal === 'offers' && (
                <Modal title="Add New Offer" onClose={closeModal}>
                    <div className="space-y-5">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Offer Title</label>
                            <input
                                type="text"
                                value={offerInput}
                                onChange={(e) => setOfferInput(e.target.value)}
                                aria-label="Offer Title"
                                placeholder="e.g. 20% Off on Pasta"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm font-medium focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Valid Until</label>
                            <input type="date" aria-label="Valid Until" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm font-medium focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Details</label>
                            <textarea rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm font-medium focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all" placeholder="Terms, conditions, specific items..."></textarea>
                        </div>
                        <button
                            onClick={() => handleAdd('OFFER', offerInput || "New Offer")}
                            className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-2xl hover:bg-slate-800 active:scale-[0.98] transition-all shadow-lg"
                        >
                            Add Offer
                        </button>
                    </div>
                </Modal>
            )}

            {/* Modal - Specials */}
            {activeModal === 'special' && (
                <Modal title="Add Chef's Special" onClose={closeModal}>
                    <div className="space-y-5">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Dish Name</label>
                            <input
                                type="text"
                                value={specialInput}
                                onChange={(e) => setSpecialInput(e.target.value)}
                                aria-label="Dish Name"
                                placeholder="e.g. Truffle Risotto"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm font-medium focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Description</label>
                            <textarea rows={3} className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-sm font-medium focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all" placeholder="What makes it special?"></textarea>
                        </div>
                        <button
                            onClick={() => handleAdd('SPECIAL', specialInput || "Special Dish")}
                            className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-2xl hover:bg-slate-800 active:scale-[0.98] transition-all shadow-lg"
                        >
                            Add Special
                        </button>
                    </div>
                </Modal>
            )}

            {/* Confirm Delete Dialog */}
            {confirmDelete && (
                <ConfirmDialog
                    title="Remove this item?"
                    message="This will remove it immediately."
                    confirmLabel="Remove"
                    onConfirm={() => {
                        handleDelete(confirmDelete.type, confirmDelete.index);
                        setConfirmDelete(null);
                    }}
                    onCancel={() => setConfirmDelete(null)}
                />
            )}

            {/* Modal - Menu */}
            {activeModal === 'menu' && (
                <Modal title="Update Menu" onClose={closeModal}>
                    <div className="space-y-5">
                        <div className="border-2 border-dashed border-slate-200 rounded-3xl p-8 flex flex-col items-center justify-center text-slate-400 hover:bg-slate-50 hover:border-slate-300 transition-all cursor-pointer relative group">
                            <input type="file" aria-label="Upload Menu File" className="absolute inset-0 opacity-0 cursor-pointer" accept=".pdf,.jpg,.png" onChange={(e) => setSelectedFile(e.target.files?.[0] || null)} />
                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                <FileText size={32} className="text-slate-400" />
                            </div>
                            <p className="text-sm text-center font-medium text-slate-500">Upload Menu File</p>
                            <p className="text-xs text-slate-400 mt-1">PDF or Images</p>
                            {selectedFile && (
                                <p className="text-sm font-medium text-slate-700 mt-2 truncate max-w-[200px]">{selectedFile.name}</p>
                            )}
                        </div>
                        <button
                            onClick={() => handleAdd('MENU')}
                            className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-2xl hover:bg-slate-800 active:scale-[0.98] transition-all shadow-lg"
                        >
                            Update Menu
                        </button>
                    </div>
                </Modal>
            )}

        </div>
    );
};

export default Inputs;