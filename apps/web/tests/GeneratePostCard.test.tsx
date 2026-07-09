import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Post } from '@restropulse/shared';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import GeneratePostCard from '../components/GeneratePostCard';

// Mock the API module
vi.mock('../api', () => ({
    postsAPI: {
        generatePost: vi.fn(),
    },
}));

import { postsAPI } from '../api';

const generatedPost: Post = {
    id: 'gen-1',
    type: 'IMAGE',
    status: 'PENDING_APPROVAL',
    thumbnail: 'https://placehold.co/600x600',
    caption: 'Weekend special — tandoori platter at 20% off! #DemoKitchen',
    platforms: ['INSTAGRAM', 'FACEBOOK'],
    restaurantId: 'r1',
};

describe('GeneratePostCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(postsAPI.generatePost).mockResolvedValue(generatedPost);
    });

    it('disables Generate while the brief is empty', () => {
        render(<GeneratePostCard onGenerated={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Generate/ })).toBeDisabled();
    });

    it('calls postsAPI.generatePost with brief + tone and hands the post to the parent', async () => {
        const onGenerated = vi.fn();
        render(<GeneratePostCard onGenerated={onGenerated} />);

        fireEvent.change(screen.getByPlaceholderText(/Tell us what's happening/), {
            target: { value: "Weekend special: our new tandoori platter at 20% off" },
        });
        fireEvent.change(screen.getByLabelText('Tone'), { target: { value: 'spicy' } });

        const button = screen.getByRole('button', { name: /Generate/ });
        expect(button).toBeEnabled();
        fireEvent.click(button);

        await waitFor(() => {
            expect(postsAPI.generatePost).toHaveBeenCalledWith({
                brief: 'Weekend special: our new tandoori platter at 20% off',
                tone: 'spicy',
            });
        });
        await waitFor(() => expect(onGenerated).toHaveBeenCalledWith(generatedPost));
        // Brief is cleared after a successful generation
        expect(screen.getByPlaceholderText(/Tell us what's happening/)).toHaveValue('');
    });

    it('shows a loading state while generating', async () => {
        let resolveGenerate!: (post: Post) => void;
        vi.mocked(postsAPI.generatePost).mockImplementation(
            () => new Promise<Post>((resolve) => { resolveGenerate = resolve; }),
        );
        render(<GeneratePostCard onGenerated={vi.fn()} />);

        fireEvent.change(screen.getByPlaceholderText(/Tell us what's happening/), {
            target: { value: 'New dessert launch' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Generate/ }));

        expect(await screen.findByText(/Generating…/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Generating/ })).toBeDisabled();

        resolveGenerate(generatedPost);
        await waitFor(() => expect(screen.queryByText(/Generating…/)).not.toBeInTheDocument());
    });

    it('reports failures through onError and keeps the brief', async () => {
        vi.mocked(postsAPI.generatePost).mockRejectedValueOnce(new Error('generation failed'));
        const onError = vi.fn();
        render(<GeneratePostCard onGenerated={vi.fn()} onError={onError} />);

        fireEvent.change(screen.getByPlaceholderText(/Tell us what's happening/), {
            target: { value: 'Happy hour 5-7' },
        });
        fireEvent.click(screen.getByRole('button', { name: /Generate/ }));

        await waitFor(() => expect(onError).toHaveBeenCalledWith('generation failed'));
        expect(screen.getByPlaceholderText(/Tell us what's happening/)).toHaveValue('Happy hour 5-7');
    });
});
