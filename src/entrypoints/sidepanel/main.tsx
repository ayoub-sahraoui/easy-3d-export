import { createRoot } from 'react-dom/client';
import App from './App';
import '@/styles/global.css';
import { Toaster } from '@/components/ui/sonner';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <>
    <App />
    <Toaster />
  </>,
);
