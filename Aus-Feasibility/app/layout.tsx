import type { Metadata, Viewport } from 'next';
import './globals.css';
import 'leaflet/dist/leaflet.css';

export const metadata: Metadata = {
  title: 'Land Feasibility — Australia',
  description: 'Land, lots and apartment development appraisal',
  manifest: '/manifest.json',
};
export const viewport: Viewport = {
  themeColor: '#082652',            // the masthead navy of the single-file build
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
