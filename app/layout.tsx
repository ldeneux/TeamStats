import './globals.css';
import ServiceWorkerRegister from '../components/ServiceWorkerRegister';

export const metadata = {
  title: 'Sathonay Basket Stats',
  description: 'Suivi de match en direct - Sathonay Basket',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon-192.png', apple: '/icon-192.png' },
  appleWebApp: { capable: true, title: 'Stats Basket', statusBarStyle: 'black-translucent' as const },
};

export const viewport = {
  themeColor: '#0b1b3a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="bg-slate-950 min-h-screen text-slate-100 antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
