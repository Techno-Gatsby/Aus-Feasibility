import type { Metadata } from 'next';
import 'leaflet/dist/leaflet.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Land Intel — Melissa & Prosper, TX',
  description:
    'Site feasibility screening: parcel, zoning, constraints, soils and ' +
    'net developable acreage from free public GIS.',
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
