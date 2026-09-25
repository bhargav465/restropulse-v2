export interface FeedbackCategory {
  id: string;
  label: string;
  question: string;
}

export const FEEDBACK_CATEGORIES: FeedbackCategory[] = [
  { id: 'Caption', label: 'Caption', question: "What's the issue with the text?" },
  { id: 'Media',   label: 'Media',   question: "What's wrong with the visual?" },
  { id: 'Timing',  label: 'Timing',  question: "When should this go out?" },
  { id: 'Other',   label: 'Other',   question: "Any other details?" },
];

export const QUICK_OPTIONS: Record<string, string[]> = {
  Caption: ['Too long', 'Too short', 'Check spelling', 'Wrong tone', 'Add emojis', 'Remove emojis', 'Hard to read', 'Add hashtags', 'Inaccurate info', 'Not engaging'],
  Media:   ['Blurry/Low Quality', 'Wrong item/dish', 'Bad lighting', 'Crop/Framing issue', 'Branding missing', 'Prefer Video', 'Prefer Image', 'Old content', 'Distracting background'],
  Timing:  ['Post Sooner', 'Post Later', 'Weekend Only', 'Weekdays Only', 'Morning Slot', 'Lunch Slot', 'Dinner Slot', 'Specific Date'],
  Other:   ['Check Pricing', 'Wrong Location', 'Tag Partner', 'Link in Bio', 'Regulatory Issue', 'Competitor visible', 'Music Choice', 'Add Logo'],
};
