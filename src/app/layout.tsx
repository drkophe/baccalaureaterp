import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Baccalaureat - le Petit Bac en ligne',
  description:
    'Jouez au Baccalaureat (Petit Bac) a plusieurs, en temps reel, sans inscription. Un pseudo suffit.',
  applicationName: 'Baccalaureat',
  openGraph: {
    title: 'Baccalaureat - le Petit Bac en ligne',
    description: 'Une lettre, des categories, et le premier qui finit stoppe tout le monde.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0a1a',
  width: 'device-width',
  initialScale: 1,
  // Le jeu se joue au telephone : on garde le zoom accessible, sans zoom auto a la saisie.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-[100dvh]">{children}</body>
    </html>
  );
}
