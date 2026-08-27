import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

it('renders the offline home heading', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: '选择学习范围' })).toBeVisible();
});
